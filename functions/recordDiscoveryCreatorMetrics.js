/**
 * Agrega métricas de criador (views, likes, comentários, favoritos de obra) no servidor.
 * Substitui escritas diretas do cliente em creators/*, creatorStatsDaily/* e espelhos públicos.
 */
import { getDatabase } from 'firebase-admin/database';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

const REGION = 'us-central1';

function dateKeySaoPaulo(timestamp = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

function workIdFromChapter(cap) {
  if (!cap || typeof cap !== 'object') return '';
  const w = String(cap.workId || '').trim();
  if (w) return w;
  return String(cap.obraId || '').trim();
}

async function incrementPathTx(ref, amount) {
  await ref.transaction((current) => Math.max(0, Number(current || 0) + amount));
}

async function bumpAuthRateLimit(db, uid) {
  const r = db.ref(`rateLimits/discoveryMetrics/${uid}`);
  const result = await r.transaction((curr) => {
    const now = Date.now();
    const c = curr && typeof curr === 'object' ? curr : {};
    let ws = Number(c.windowStart || 0);
    let cnt = Number(c.count || 0);
    if (now - ws > 60000) {
      ws = now;
      cnt = 0;
    }
    if (cnt >= 120) return undefined;
    return { windowStart: ws, count: cnt + 1 };
  });
  if (!result.committed) {
    throw new HttpsError('resource-exhausted', 'Muitas atualizacoes. Tente em instantes.');
  }
}

async function bumpAnonRateLimit(db, chapterId) {
  const r = db.ref(`rateLimits/discoveryAnonRead/${chapterId}`);
  const result = await r.transaction((curr) => {
    const now = Date.now();
    const c = curr && typeof curr === 'object' ? curr : {};
    let ws = Number(c.windowStart || 0);
    let cnt = Number(c.count || 0);
    if (now - ws > 60000) {
      ws = now;
      cnt = 0;
    }
    if (cnt >= 400) return undefined;
    return { windowStart: ws, count: cnt + 1 };
  });
  if (!result.committed) {
    throw new HttpsError('resource-exhausted', 'Limite temporario. Tente mais tarde.');
  }
}

const FIELD_BY_ACTION = {
  work_favorite: 'followersCount',
  chapter_read: 'totalViews',
  chapter_comment: 'commentsTotal',
  chapter_like: 'likesTotal',
};

function legacyPublicField(field) {
  if (field === 'followersCount') return 'followersCount';
  if (field === 'totalViews') return 'totalViews';
  if (field === 'commentsTotal') return 'totalComments';
  if (field === 'likesTotal') return 'totalLikes';
  return null;
}

function dailyMetricKey(field) {
  if (field === 'followersCount') return 'followersAdded';
  return field;
}

async function applyCreatorMetricDelta(db, creatorId, field, delta, dateKey) {
  const legacy = legacyPublicField(field);
  const dailyKey = dailyMetricKey(field);
  const ops = [
    incrementPathTx(db.ref(`creators/${creatorId}/stats/${field}`), delta),
    incrementPathTx(db.ref(`creatorStatsDaily/${creatorId}/${dateKey}/${dailyKey}`), delta),
  ];
  if (legacy) {
    ops.push(incrementPathTx(db.ref(`usuarios_publicos/${creatorId}/stats/${legacy}`), delta));
    ops.push(incrementPathTx(db.ref(`usuarios/${creatorId}/creatorProfile/stats/${legacy}`), delta));
  }
  await Promise.all(ops);
  await db.ref(`creatorStatsDaily/${creatorId}/${dateKey}/updatedAt`).set(Date.now());
}

async function handleChapterReadUnique(db, creatorId, viewerUid, dateKey) {
  const seenRef = db.ref(`creatorAudienceSeen/${creatorId}/allReaders/${viewerUid}`);
  const seenSnap = await seenRef.get();
  if (!seenSnap.exists()) {
    await seenRef.set(Date.now());
    await incrementPathTx(db.ref(`creators/${creatorId}/stats/uniqueReaders`), 1);
    await incrementPathTx(db.ref(`creatorStatsDaily/${creatorId}/${dateKey}/uniqueReaders`), 1);
    await db.ref(`creatorAudienceSeen/${creatorId}/dailyReaders/${dateKey}/${viewerUid}`).set(Date.now());
    return;
  }
  const daySeenRef = db.ref(`creatorAudienceSeen/${creatorId}/dailyReaders/${dateKey}/${viewerUid}`);
  const daySnap = await daySeenRef.get();
  if (!daySnap.exists()) {
    await daySeenRef.set(Date.now());
    await incrementPathTx(db.ref(`creatorStatsDaily/${creatorId}/${dateKey}/uniqueReaders`), 1);
  }
}

export const recordDiscoveryCreatorMetrics = onCall(
  { region: REGION, cors: true, invoker: 'public' },
  async (request) => {
    const data = request.data || {};
    const action = String(data.action || '').trim();
    const delta = Number(data.delta);
    const workId = String(data.workId || '').trim();
    const chapterId = String(data.chapterId || '').trim();
    const viewerUid = String(data.viewerUid || '').trim();

    if (!['work_favorite', 'chapter_read', 'chapter_comment', 'chapter_like'].includes(action)) {
      throw new HttpsError('invalid-argument', 'action invalida.');
    }
    if (delta !== 1 && delta !== -1) {
      throw new HttpsError('invalid-argument', 'delta deve ser 1 ou -1.');
    }
    if (!workId.match(/^[a-z0-9_-]{2,40}$/)) {
      throw new HttpsError('invalid-argument', 'workId invalida.');
    }

    const db = getDatabase();
    const authUid = request.auth?.uid ? String(request.auth.uid).trim() : '';

    if (action !== 'work_favorite') {
      if (!chapterId) throw new HttpsError('invalid-argument', 'chapterId obrigatorio.');
      const capSnap = await db.ref(`capitulos/${chapterId}`).get();
      if (!capSnap.exists()) throw new HttpsError('not-found', 'Capitulo nao encontrado.');
      const resolved = workIdFromChapter(capSnap.val() || {});
      if (resolved !== workId) throw new HttpsError('invalid-argument', 'Capitulo nao pertence a obra.');
    }

    const obraSnap = await db.ref(`obras/${workId}`).get();
    if (!obraSnap.exists()) throw new HttpsError('not-found', 'Obra nao encontrada.');
    const creatorId = String(obraSnap.val()?.creatorId || '').trim();
    if (!creatorId) throw new HttpsError('failed-precondition', 'Obra sem creatorId.');

    if (action === 'work_favorite' || action === 'chapter_comment' || action === 'chapter_like') {
      if (!authUid) throw new HttpsError('unauthenticated', 'Login necessario.');
      await bumpAuthRateLimit(db, authUid);
    } else if (action === 'chapter_read') {
      if (viewerUid) {
        if (!authUid || authUid !== viewerUid) {
          throw new HttpsError('permission-denied', 'Sessao invalida para esta leitura.');
        }
        await bumpAuthRateLimit(db, authUid);
      } else {
        await bumpAnonRateLimit(db, chapterId);
      }
    }

    const field = FIELD_BY_ACTION[action];
    const dk = dateKeySaoPaulo();

    await applyCreatorMetricDelta(db, creatorId, field, delta, dk);

    if (action === 'chapter_read' && delta === 1 && viewerUid) {
      await handleChapterReadUnique(db, creatorId, viewerUid, dk);
    }

    return { ok: true };
  }
);
