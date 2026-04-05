import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onValueWritten } from 'firebase-functions/v2/database';
import { buildPublicEngagementFromCycle } from '../creatorEngagementPublicMirror.js';
import {
  metricsFromUsuarioRow as metricsFromUsuarioRowServer,
  processEngagementCycleTick as processEngagementCycleTickServer,
  toRecordList as toRecordListServer,
} from '../creatorEngagementCycleServer.js';
import { requireAdminAuth, requirePermission } from '../adminRbac.js';
import {
  syncReaderLikedWorkStateForUser,
  syncReaderPublicProfileMirrorServer,
} from './readerProfiles.js';

async function runCommitCreatorEngagementTickForUid(db, uidRaw) {
  const uid = String(uidRaw || '').trim();
  if (!uid) return { ok: false, error: 'uid_invalido' };
  const now = Date.now();
  const [userSnap, creatorStatsSnap, obrasSnap, capsSnap] = await Promise.all([
    db.ref(`usuarios/${uid}`).get(),
    db.ref(`creators/${uid}/stats`).get(),
    db.ref('obras').get(),
    db.ref('capitulos').get(),
  ]);
  const usuario = userSnap.val() || {};
  const creatorStatsRow = creatorStatsSnap.val() || {};
  const obras = toRecordListServer(obrasSnap.val() || {}).filter((o) => String(o?.creatorId || '').trim() === uid);
  const obraIds = new Set(obras.map((o) => String(o.id || '').trim().toLowerCase()));
  const caps = toRecordListServer(capsSnap.val() || {}).filter((cap) => {
    if (String(cap?.creatorId || '').trim() === uid) return true;
    const oid = String(cap?.obraId || cap?.mangaId || '').trim().toLowerCase();
    return obraIds.has(oid);
  });
  const tick = processEngagementCycleTickServer({
    engagementCycle: usuario.engagementCycle,
    metrics: metricsFromUsuarioRowServer(usuario, creatorStatsRow),
    caps,
    uid,
    now,
  });
  if (!tick.changed) {
    return { ok: true, applied: false, leveled: false };
  }
  await db.ref(`usuarios/${uid}/engagementCycle`).set(tick.state);
  return { ok: true, applied: true, leveled: tick.leveled };
}

async function queueCommitCreatorEngagementForUid(uidRaw) {
  const uid = String(uidRaw || '').trim();
  if (!uid) return;
  try {
    await runCommitCreatorEngagementTickForUid(getDatabase(), uid);
  } catch (error) {
    logger.warn('engagementCycle recalc falhou', { uid, error: error?.message || String(error) });
  }
}

export const mirrorCreatorEngagementCycleToPublicProfile = onValueWritten(
  {
    ref: '/usuarios/{uid}/engagementCycle',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const uid = String(event.params?.uid || '').trim();
    if (!uid) return;
    const after = event.data?.after?.exists() ? event.data.after.val() : null;
    const patch = buildPublicEngagementFromCycle(after, Date.now());
    try {
      await getDatabase().ref(`usuarios_publicos/${uid}`).update(patch);
    } catch (e) {
      logger.error('mirrorEngagementCycleToPublicProfile falhou', { uid, error: e?.message });
    }
  }
);

export const onCreatorEngagementStatsWritten = onValueWritten(
  {
    ref: '/creators/{uid}/stats',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    await queueCommitCreatorEngagementForUid(event.params?.uid);
  }
);

export const onChapterEngagementSourceWritten = onValueWritten(
  {
    ref: '/capitulos/{chapterId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const after = event.data?.after?.exists() ? event.data.after.val() : null;
    const before = event.data?.before?.exists() ? event.data.before.val() : null;
    const db = getDatabase();
    const creatorId = String(after?.creatorId || before?.creatorId || '').trim();
    if (creatorId) {
      await queueCommitCreatorEngagementForUid(creatorId);
    }

    const beforeLikes =
      before?.usuariosQueCurtiram && typeof before.usuariosQueCurtiram === 'object'
        ? before.usuariosQueCurtiram
        : {};
    const afterLikes =
      after?.usuariosQueCurtiram && typeof after.usuariosQueCurtiram === 'object'
        ? after.usuariosQueCurtiram
        : {};
    const changedUids = new Set([...Object.keys(beforeLikes), ...Object.keys(afterLikes)]);
    if (!changedUids.size) return;

    const workId = String(after?.obraId || after?.mangaId || before?.obraId || before?.mangaId || '').trim();
    if (!workId) return;

    for (const uid of changedUids) {
      if (Boolean(beforeLikes[uid]) === Boolean(afterLikes[uid])) continue;
      try {
        await syncReaderLikedWorkStateForUser(db, uid, workId);
        await syncReaderPublicProfileMirrorServer(db, uid);
      } catch (error) {
        logger.warn('reader likedWorks sync falhou', {
          chapterId: String(event.params?.chapterId || '').trim(),
          uid,
          workId,
          error: error?.message || String(error),
        });
      }
    }
  }
);

export const commitCreatorEngagementCycleTick = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Faca login.');
    const res = await runCommitCreatorEngagementTickForUid(getDatabase(), request.auth.uid);
    if (!res.ok) throw new HttpsError('invalid-argument', res.error || 'Erro.');
    return res;
  }
);

export const adminBackfillEngagementPublicProfiles = onCall(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'financeiro');
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const maxUpdates = Math.min(2000, Math.max(1, Number(body.maxUpdates) || 500));
    const db = getDatabase();
    const usuariosSnap = await db.ref('usuarios').get();
    if (!usuariosSnap.exists()) {
      return { ok: true, updated: 0, scannedWithCycle: 0, maxUpdates };
    }
    const all = usuariosSnap.val() || {};
    let updated = 0;
    let scannedWithCycle = 0;
    for (const [uid, row] of Object.entries(all)) {
      if (!row?.engagementCycle || typeof row.engagementCycle !== 'object') continue;
      scannedWithCycle += 1;
      if (updated >= maxUpdates) continue;
      const pubSnap = await db.ref(`usuarios_publicos/${uid}`).get();
      if (!pubSnap.exists()) continue;
      const patch = buildPublicEngagementFromCycle(row.engagementCycle, Date.now());
      try {
        await db.ref(`usuarios_publicos/${uid}`).update(patch);
        updated += 1;
      } catch (e) {
        logger.warn('adminBackfillEngagementPublicProfiles falhou', { uid, error: e?.message });
      }
    }
    return { ok: true, updated, scannedWithCycle, maxUpdates };
  }
);
