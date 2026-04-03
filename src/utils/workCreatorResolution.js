import { PLATFORM_LEGACY_CREATOR_UID } from '../constants';

/**
 * UID mais frequente nos capítulos (ignora vazio e UID legado da plataforma).
 * Cobre obras antigas / base `shito` cujo `creatorId` ainda aponta para o admin legado
 * mas os caps foram publicados pelo mangaká autenticado.
 */
export function inferDominantCreatorIdFromChapters(caps) {
  if (!Array.isArray(caps) || caps.length === 0) return '';
  const counts = new Map();
  for (const cap of caps) {
    const cid = String(cap?.creatorId || '').trim();
    if (!cid || cid === PLATFORM_LEGACY_CREATOR_UID) continue;
    counts.set(cid, (counts.get(cid) || 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [cid, n] of counts) {
    if (n > bestN) {
      best = cid;
      bestN = n;
    }
  }
  return best;
}

export function resolveEffectiveWorkCreatorId(obra, caps) {
  const fromObra = String(obra?.creatorId || '').trim();
  const inferred = inferDominantCreatorIdFromChapters(caps);
  if (fromObra && fromObra !== PLATFORM_LEGACY_CREATOR_UID) return fromObra;
  if (inferred) return inferred;
  return fromObra || PLATFORM_LEGACY_CREATOR_UID;
}
