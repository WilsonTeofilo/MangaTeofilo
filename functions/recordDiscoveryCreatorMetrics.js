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

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function incrementPathTx(ref, amount) {
  await ref.transaction((current) => Math.max(0, Number(current || 0) + amount));
}

async function markUniquePath(ref) {
  let created = false;
  await ref.transaction((current) => {
    if (current) return current;
    created = true;
    return Date.now();
  });
  return created;
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

async function updateWorkRetentionRead(db, { workId, chapterId, chapterNumber, chapterTitle, viewerUid }) {
  if (!workId || !chapterId || !viewerUid) return;
  const readerPath = db.ref(`workRetentionRaw/${workId}/chapterReaders/${chapterId}/${viewerUid}`);
  const isFirstReadForChapter = await markUniquePath(readerPath);
  if (!isFirstReadForChapter) return;

  await Promise.all([
    incrementPathTx(db.ref(`workRetention/${workId}/chapters/${chapterId}/readersCount`), 1),
    db.ref(`workRetention/${workId}/chapters/${chapterId}/chapterId`).set(chapterId),
    db.ref(`workRetention/${workId}/chapters/${chapterId}/chapterNumber`).set(safeNumber(chapterNumber)),
    db
      .ref(`workRetention/${workId}/chapters/${chapterId}/chapterTitle`)
      .set(String(chapterTitle || '').trim() || `Capitulo ${chapterNumber || ''}`.trim()),
  ]);

  const lastReadRef = db.ref(`workRetentionRaw/${workId}/lastReadByUser/${viewerUid}`);
  const lastReadSnap = await lastReadRef.get();
  const lastRead = lastReadSnap.exists() ? lastReadSnap.val() || {} : {};
  const prevChapterId = String(lastRead?.chapterId || '').trim();
  const prevChapterNumber = Number(lastRead?.chapterNumber || 0);
  const nextChapterNumber = Number(chapterNumber || 0);

  if (
    prevChapterId &&
    prevChapterId !== chapterId &&
    Number.isFinite(prevChapterNumber) &&
    Number.isFinite(nextChapterNumber) &&
    prevChapterNumber > 0 &&
    nextChapterNumber === prevChapterNumber + 1
  ) {
    const transitionId = `${prevChapterId}__${chapterId}`;
    const transitionSeenRef = db.ref(`workRetentionRaw/${workId}/transitionsSeen/${transitionId}/${viewerUid}`);
    const isFirstTransition = await markUniquePath(transitionSeenRef);
    if (isFirstTransition) {
      const tBase = `workRetention/${workId}/transitions/${transitionId}`;
      await Promise.all([
        db.ref(`${tBase}/fromChapterId`).set(prevChapterId),
        db.ref(`${tBase}/toChapterId`).set(chapterId),
        db.ref(`${tBase}/fromChapterNumber`).set(prevChapterNumber),
        db.ref(`${tBase}/toChapterNumber`).set(nextChapterNumber),
        incrementPathTx(db.ref(`${tBase}/retainedReaders`), 1),
      ]);
    }
  }

  await lastReadRef.set({
    chapterId,
    chapterNumber: safeNumber(chapterNumber),
    readAt: Date.now(),
  });
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
    const chapterNumber = Number(data.chapterNumber || 0);
    const chapterTitle = String(data.chapterTitle || '').trim();

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

    if (action === 'chapter_read') {
      await Promise.all([
        incrementPathTx(db.ref(`capitulos/${chapterId}/viewsCount`), delta),
        incrementPathTx(db.ref(`capitulos/${chapterId}/visualizacoes`), delta),
        incrementPathTx(db.ref(`obras/${workId}/viewsCount`), delta),
        incrementPathTx(db.ref(`obras/${workId}/visualizacoes`), delta),
      ]);
      if (delta === 1) {
        await db.ref(`workRetention/${workId}/updatedAt`).set(Date.now());
        if (viewerUid) {
          await updateWorkRetentionRead(db, {
            workId,
            chapterId,
            chapterNumber,
            chapterTitle,
            viewerUid,
          });
        }
      }
    }

    if (action === 'work_favorite') {
      await incrementPathTx(db.ref(`obras/${workId}/favoritesCount`), delta);
    }

    if (action === 'chapter_comment') {
      await Promise.all([
        incrementPathTx(db.ref(`capitulos/${chapterId}/commentsCount`), delta),
        incrementPathTx(db.ref(`obras/${workId}/commentsCount`), delta),
      ]);
    }

    if (action === 'chapter_like') {
      await incrementPathTx(db.ref(`obras/${workId}/likesCount`), delta);
    }

    await applyCreatorMetricDelta(db, creatorId, field, delta, dk);

    if (action === 'chapter_read' && delta === 1 && viewerUid) {
      await handleChapterReadUnique(db, creatorId, viewerUid, dk);
    }

    return { ok: true };
  }
);
