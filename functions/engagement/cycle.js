import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onValueWritten } from 'firebase-functions/v2/database';
import {
  metricsFromUsuarioRow as metricsFromUsuarioRowServer,
  processEngagementCycleTick as processEngagementCycleTickServer,
  toRecordList as toRecordListServer,
} from '../creatorEngagementCycleServer.js';

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
    const creatorId = String(after?.creatorId || before?.creatorId || '').trim();
    if (creatorId) {
      await queueCommitCreatorEngagementForUid(creatorId);
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
