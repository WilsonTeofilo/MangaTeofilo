/**
 * Links de apoio com atribuição ao criador (query + rota curta).
 */

/** @param {string} creatorUid */
export function apoiePathParaCriador(creatorUid) {
  const c = String(creatorUid || '').trim();
  if (!c || c.length < 10 || c.length > 128) return '/apoie';
  if (!/^[a-zA-Z0-9_-]+$/.test(c)) return '/apoie';
  return `/apoie/criador/${encodeURIComponent(c)}`;
}

/** URL absoluta (clipboard / compartilhar). */
export function apoieUrlAbsolutaParaCriador(creatorUid) {
  if (typeof window === 'undefined') return '';
  const base = String(window.location.origin || '').replace(/\/$/, '');
  const path = apoiePathParaCriador(creatorUid);
  return `${base}${path}`;
}
