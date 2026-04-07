/**
 * Regras compartilhadas para espelho público do perfil de leitor.
 * Mantém a composição de favorites/likedWorks em um único lugar.
 */

export const WORK_FAVORITES_CANON_KEY = 'favorites';

export function isReaderPublicProfileEffective(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.readerProfilePublic === true) return true;
  const creatorStatus = String(row.creatorStatus || '').trim().toLowerCase();
  return creatorStatus === 'active' || creatorStatus === 'onboarding';
}

