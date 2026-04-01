import { get, ref, runTransaction } from 'firebase/database';

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function incrementPath(db, path, amount) {
  if (!path || !amount) return;
  await runTransaction(ref(db, path), (current) => Math.max(0, safeNumber(current) + amount));
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
    incrementPath(db, `obras/${workId}/likesCount`, delta),
    resolvedCreatorId ? incrementPath(db, `usuarios_publicos/${resolvedCreatorId}/stats/totalLikes`, delta) : Promise.resolve(),
    resolvedCreatorId ? incrementPath(db, `usuarios/${resolvedCreatorId}/creatorProfile/stats/totalLikes`, delta) : Promise.resolve(),
  ]);
}

export async function applyChapterReadDelta(db, { chapterId, workId, creatorId, amount = 1 }) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  await Promise.all([
    incrementPath(db, `capitulos/${chapterId}/viewsCount`, delta),
    incrementPath(db, `obras/${workId}/viewsCount`, delta),
    incrementPath(db, `obras/${workId}/visualizacoes`, delta),
    creatorId ? incrementPath(db, `usuarios_publicos/${creatorId}/stats/totalViews`, delta) : Promise.resolve(),
    creatorId ? incrementPath(db, `usuarios/${creatorId}/creatorProfile/stats/totalViews`, delta) : Promise.resolve(),
  ]);
}

export async function applyChapterCommentDelta(db, { chapterId, workId, creatorId, amount = 1 }) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  await Promise.all([
    incrementPath(db, `capitulos/${chapterId}/commentsCount`, delta),
    incrementPath(db, `obras/${workId}/commentsCount`, delta),
    creatorId ? incrementPath(db, `usuarios_publicos/${creatorId}/stats/totalComments`, delta) : Promise.resolve(),
    creatorId ? incrementPath(db, `usuarios/${creatorId}/creatorProfile/stats/totalComments`, delta) : Promise.resolve(),
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
