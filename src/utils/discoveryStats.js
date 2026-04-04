import { get, ref, runTransaction } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../services/firebase';

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function incrementPath(db, path, amount) {
  if (!path || !amount) return;
  await runTransaction(ref(db, path), (current) => Math.max(0, safeNumber(current) + amount));
}

let recordDiscoveryCreatorMetricsCallable = null;
function getRecordDiscoveryCallable() {
  if (!recordDiscoveryCreatorMetricsCallable) {
    recordDiscoveryCreatorMetricsCallable = httpsCallable(functions, 'recordDiscoveryCreatorMetrics');
  }
  return recordDiscoveryCreatorMetricsCallable;
}

/**
 * Métricas agregadas do criador (creators/*, creatorStatsDaily/*, espelhos) — só no servidor.
 */
async function recordCreatorMetricsServer(payload) {
  try {
    await getRecordDiscoveryCallable()(payload);
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[recordDiscoveryCreatorMetrics]', e?.code || e?.message || e);
    }
  }
}

async function markUniquePath(db, path) {
  let created = false;
  await runTransaction(ref(db, path), (current) => {
    if (current) return current;
    created = true;
    return Date.now();
  });
  return created;
}

async function updateWorkRetentionRead(db, { workId, chapterId, chapterNumber, chapterTitle, viewerUid }) {
  if (!workId || !chapterId || !viewerUid) return;
  const readerPath = `workRetentionRaw/${workId}/chapterReaders/${chapterId}/${viewerUid}`;
  const isFirstReadForChapter = await markUniquePath(db, readerPath);
  if (!isFirstReadForChapter) return;

  await Promise.all([
    incrementPath(db, `workRetention/${workId}/chapters/${chapterId}/readersCount`, 1),
    runTransaction(ref(db, `workRetention/${workId}/chapters/${chapterId}/chapterId`), () => chapterId),
    runTransaction(ref(db, `workRetention/${workId}/chapters/${chapterId}/chapterNumber`), () => safeNumber(chapterNumber)),
    runTransaction(
      ref(db, `workRetention/${workId}/chapters/${chapterId}/chapterTitle`),
      () => String(chapterTitle || '').trim() || `Capitulo ${chapterNumber || ''}`.trim()
    ),
    runTransaction(ref(db, `workRetention/${workId}/updatedAt`), () => Date.now()),
  ]);

  const lastReadSnap = await get(ref(db, `workRetentionRaw/${workId}/lastReadByUser/${viewerUid}`));
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
    const transitionSeenPath = `workRetentionRaw/${workId}/transitionsSeen/${transitionId}/${viewerUid}`;
    const isFirstTransition = await markUniquePath(db, transitionSeenPath);
    if (isFirstTransition) {
      await Promise.all([
        incrementPath(db, `workRetention/${workId}/transitions/${transitionId}/retainedReaders`, 1),
        runTransaction(ref(db, `workRetention/${workId}/transitions/${transitionId}/fromChapterId`), () => prevChapterId),
        runTransaction(ref(db, `workRetention/${workId}/transitions/${transitionId}/toChapterId`), () => chapterId),
        runTransaction(ref(db, `workRetention/${workId}/transitions/${transitionId}/fromChapterNumber`), () => prevChapterNumber),
        runTransaction(ref(db, `workRetention/${workId}/transitions/${transitionId}/toChapterNumber`), () => nextChapterNumber),
      ]);
    }
  }

  await runTransaction(ref(db, `workRetentionRaw/${workId}/lastReadByUser/${viewerUid}`), () => ({
    chapterId,
    chapterNumber: safeNumber(chapterNumber),
    readAt: Date.now(),
  }));
}

export async function applyWorkFavoriteDelta(db, { workId, creatorId: _creatorId, amount }) {
  const delta = Number(amount || 0);
  if (!workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  await Promise.all([
    incrementPath(db, `obras/${workId}/favoritesCount`, delta),
    recordCreatorMetricsServer({ action: 'work_favorite', workId, delta: sign }),
  ]);
}

export async function applyChapterReadDelta(db, {
  chapterId,
  workId,
  creatorId: _creatorId,
  amount = 1,
  viewerUid = '',
  chapterNumber = 0,
  chapterTitle = '',
}) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  const vu = String(viewerUid || '').trim();
  await Promise.all([
    incrementPath(db, `capitulos/${chapterId}/viewsCount`, delta),
    incrementPath(db, `obras/${workId}/viewsCount`, delta),
    incrementPath(db, `obras/${workId}/visualizacoes`, delta),
    recordCreatorMetricsServer({
      action: 'chapter_read',
      workId,
      chapterId,
      viewerUid: vu,
      delta: sign,
    }),
    vu ? updateWorkRetentionRead(db, { workId, chapterId, chapterNumber, chapterTitle, viewerUid: vu }) : Promise.resolve(),
  ]);
}

export async function applyChapterCommentDelta(db, { chapterId, workId, creatorId: _creatorId, amount = 1 }) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  await Promise.all([
    incrementPath(db, `capitulos/${chapterId}/commentsCount`, delta),
    incrementPath(db, `obras/${workId}/commentsCount`, delta),
    recordCreatorMetricsServer({ action: 'chapter_comment', workId, chapterId, delta: sign }),
  ]);
}

/**
 * Propaga o delta de like do capítulo para obra e agregados do criador.
 * O contador `capitulos/{chapterId}/likesCount` já deve ter sido ajustado
 * no mesmo fluxo (ex.: runTransaction no nó do capítulo) — não duplicar aqui.
 */
export async function applyChapterLikeDelta(db, { chapterId, workId, creatorId: _creatorId, amount = 1 }) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  await Promise.all([
    incrementPath(db, `obras/${workId}/likesCount`, delta),
    recordCreatorMetricsServer({ action: 'chapter_like', workId, chapterId, delta: sign }),
  ]);
}

export async function alreadyFavorited(db, uid, workId) {
  if (!uid || !workId) return false;
  const [legacy, canon] = await Promise.all([
    get(ref(db, `usuarios/${uid}/favoritosObras/${workId}`)),
    get(ref(db, `usuarios/${uid}/favorites/${workId}`)),
  ]);
  return legacy.exists() || canon.exists();
}
