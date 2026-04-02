import { get, ref, runTransaction } from 'firebase/database';

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function incrementPath(db, path, amount) {
  if (!path || !amount) return;
  await runTransaction(ref(db, path), (current) => Math.max(0, safeNumber(current) + amount));
}

function dateKeySaoPaulo(timestamp = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(timestamp));
}

async function incrementCreatorDailyMetric(db, creatorId, field, amount, timestamp = Date.now()) {
  if (!creatorId || !field || !amount) return;
  const dateKey = dateKeySaoPaulo(timestamp);
  await incrementPath(db, `creatorStatsDaily/${creatorId}/${dateKey}/${field}`, amount);
  await runTransaction(ref(db, `creatorStatsDaily/${creatorId}/${dateKey}/updatedAt`), () => Date.now());
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

async function updateCreatorAggregateMetric(db, creatorId, field, amount) {
  if (!creatorId || !field || !amount) return;
  await incrementPath(db, `creators/${creatorId}/stats/${field}`, amount);
}

async function updateCreatorLegacyMirror(db, creatorId, field, amount) {
  if (!creatorId || !field || !amount) return;
  const publicField =
    field === 'likesTotal'
      ? 'totalLikes'
      : field === 'commentsTotal'
        ? 'totalComments'
        : field === 'totalViews'
          ? 'totalViews'
          : field === 'followersCount'
            ? 'followersCount'
            : null;
  if (!publicField) return;
  await Promise.all([
    incrementPath(db, `usuarios_publicos/${creatorId}/stats/${publicField}`, amount),
    incrementPath(db, `usuarios/${creatorId}/creatorProfile/stats/${publicField}`, amount),
  ]);
}

async function registerCreatorUniqueReader(db, { creatorId, viewerUid, timestamp = Date.now() }) {
  if (!creatorId || !viewerUid) return { creatorUnique: false, dailyUnique: false };
  const day = dateKeySaoPaulo(timestamp);
  const [creatorUnique, dailyUnique] = await Promise.all([
    markUniquePath(db, `creatorAudienceSeen/${creatorId}/allReaders/${viewerUid}`),
    markUniquePath(db, `creatorAudienceSeen/${creatorId}/dailyReaders/${day}/${viewerUid}`),
  ]);
  if (creatorUnique) {
    await updateCreatorAggregateMetric(db, creatorId, 'uniqueReaders', 1);
  }
  if (dailyUnique) {
    await incrementCreatorDailyMetric(db, creatorId, 'uniqueReaders', 1, timestamp);
  }
  return { creatorUnique, dailyUnique };
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
    runTransaction(ref(db, `workRetention/${workId}/chapters/${chapterId}/chapterTitle`), () => String(chapterTitle || '').trim() || `Capitulo ${chapterNumber || ''}`.trim()),
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

export async function applyWorkFavoriteDelta(db, { workId, creatorId, amount }) {
  const delta = Number(amount || 0);
  if (!workId || !delta) return;
  let resolvedCreatorId = String(creatorId || '').trim();
  if (!resolvedCreatorId) {
    const obraSnap = await get(ref(db, `obras/${workId}`));
    if (obraSnap.exists()) {
      resolvedCreatorId = String(obraSnap.val()?.creatorId || '').trim();
    }
  }
  await Promise.all([
    incrementPath(db, `obras/${workId}/favoritesCount`, delta),
    resolvedCreatorId ? updateCreatorAggregateMetric(db, resolvedCreatorId, 'followersCount', delta) : Promise.resolve(),
    resolvedCreatorId ? updateCreatorLegacyMirror(db, resolvedCreatorId, 'followersCount', delta) : Promise.resolve(),
    resolvedCreatorId ? incrementCreatorDailyMetric(db, resolvedCreatorId, 'followersCount', delta) : Promise.resolve(),
  ]);
}

export async function applyChapterReadDelta(db, {
  chapterId,
  workId,
  creatorId,
  amount = 1,
  viewerUid = '',
  chapterNumber = 0,
  chapterTitle = '',
}) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  await Promise.all([
    incrementPath(db, `capitulos/${chapterId}/viewsCount`, delta),
    incrementPath(db, `obras/${workId}/viewsCount`, delta),
    incrementPath(db, `obras/${workId}/visualizacoes`, delta),
    creatorId ? updateCreatorAggregateMetric(db, creatorId, 'totalViews', delta) : Promise.resolve(),
    creatorId ? updateCreatorLegacyMirror(db, creatorId, 'totalViews', delta) : Promise.resolve(),
    creatorId ? incrementCreatorDailyMetric(db, creatorId, 'totalViews', delta) : Promise.resolve(),
    creatorId && viewerUid
      ? registerCreatorUniqueReader(db, { creatorId, viewerUid })
      : Promise.resolve(),
    viewerUid
      ? updateWorkRetentionRead(db, { workId, chapterId, chapterNumber, chapterTitle, viewerUid })
      : Promise.resolve(),
  ]);
}

export async function applyChapterCommentDelta(db, { chapterId, workId, creatorId, amount = 1 }) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  await Promise.all([
    incrementPath(db, `capitulos/${chapterId}/commentsCount`, delta),
    incrementPath(db, `obras/${workId}/commentsCount`, delta),
    creatorId ? updateCreatorAggregateMetric(db, creatorId, 'commentsTotal', delta) : Promise.resolve(),
    creatorId ? updateCreatorLegacyMirror(db, creatorId, 'commentsTotal', delta) : Promise.resolve(),
    creatorId ? incrementCreatorDailyMetric(db, creatorId, 'commentsTotal', delta) : Promise.resolve(),
  ]);
}

/**
 * Propaga o delta de like do capítulo para obra e agregados do criador.
 * O contador `capitulos/{chapterId}/likesCount` já deve ter sido ajustado
 * no mesmo fluxo (ex.: runTransaction no nó do capítulo) — não duplicar aqui.
 */
export async function applyChapterLikeDelta(db, { chapterId, workId, creatorId, amount = 1 }) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  await Promise.all([
    incrementPath(db, `obras/${workId}/likesCount`, delta),
    creatorId ? updateCreatorAggregateMetric(db, creatorId, 'likesTotal', delta) : Promise.resolve(),
    creatorId ? updateCreatorLegacyMirror(db, creatorId, 'likesTotal', delta) : Promise.resolve(),
    creatorId ? incrementCreatorDailyMetric(db, creatorId, 'likesTotal', delta) : Promise.resolve(),
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
