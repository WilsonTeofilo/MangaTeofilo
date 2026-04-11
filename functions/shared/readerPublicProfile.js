export const WORK_FAVORITES_CANON_KEY = 'workFavorites';

export function isReaderPublicProfileEffective(row = {}) {
  if (!row || typeof row !== 'object') return false;
  if (row.isReaderProfilePublic === false) return false;
  if (row.readerProfile?.isPublic === false) return false;
  return true;
}
