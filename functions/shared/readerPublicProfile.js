export const WORK_FAVORITES_LEGACY_KEY = 'favoritosObras';
export const WORK_FAVORITES_CANON_KEY = 'favorites';
export const WORK_LIKED_CANON_KEY = 'likedWorks';

export function isReaderPublicProfileEffective(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.readerProfilePublic === true) return true;
  const creatorStatus = String(row.creatorStatus || '').trim().toLowerCase();
  return creatorStatus === 'active' || creatorStatus === 'onboarding';
}

export function mergeReaderWorkMaps(...maps) {
  return maps.reduce((acc, current) => {
    if (!current || typeof current !== 'object') return acc;
    return { ...acc, ...current };
  }, {});
}

export function buildReaderSourceMap(row) {
  const source = row && typeof row === 'object' ? row : {};
  return mergeReaderWorkMaps(
    source[WORK_LIKED_CANON_KEY],
    source[WORK_FAVORITES_CANON_KEY],
    source[WORK_FAVORITES_LEGACY_KEY]
  );
}

export function buildPublicReaderFavoritesMap(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const [workId, row] of Object.entries(source)) {
    if (!workId || !row || typeof row !== 'object') continue;
    const title = String(row.titulo || row.title || workId).trim().slice(0, 120) || workId;
    const coverUrl = String(row.coverUrl || row.capaUrl || '').trim().slice(0, 2048);
    const slug = String(row.slug || '').trim().slice(0, 80);
    const addedAt = Number(row.savedAt || row.addedAt || row.likedAt || row.lastLikedAt || Date.now());
    out[workId] = {
      workId,
      title,
      coverUrl,
      ...(slug ? { slug } : {}),
      addedAt: Number.isFinite(addedAt) ? addedAt : Date.now(),
    };
  }
  return out;
}
