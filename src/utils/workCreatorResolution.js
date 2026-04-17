
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
    if (!cid) continue;
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

function normalizeCreatorId(raw) {
  return String(raw || '').trim();
}

function collectChapterCreatorIds(caps) {
  if (!Array.isArray(caps) || caps.length === 0) return [];
  const out = [];
  caps.forEach((cap) => {
    out.push(
      normalizeCreatorId(cap?.creatorId),
      normalizeCreatorId(cap?.creatorProfile?.creatorId),
      normalizeCreatorId(cap?.creatorProfile?.userId),
      normalizeCreatorId(cap?.userId),
      normalizeCreatorId(cap?.uid)
    );
  });
  return out.filter(Boolean);
}

export function resolveCreatorPublicProfileById(creatorsMap, creatorId) {
  if (!creatorsMap || typeof creatorsMap !== 'object') return null;
  const cid = normalizeCreatorId(creatorId);
  if (!cid) return null;
  return creatorsMap[cid] || creatorsMap[cid.toLowerCase()] || null;
}

export function resolveCanonicalWorkCreator(obra, caps, creatorsMap = null) {
  const fromObra = normalizeCreatorId(obra?.creatorId);
  const inferred = inferDominantCreatorIdFromChapters(caps);
  const chapterIds = collectChapterCreatorIds(caps);
  const candidates = [...new Set([fromObra, inferred, ...chapterIds].filter(Boolean))];
  const fallbackCreatorId = fromObra || inferred || candidates[0] || '';

  const profileBacked = candidates.find((cid) => {
    if (!cid) return false;
    return Boolean(resolveCreatorPublicProfileById(creatorsMap, cid));
  });
  if (profileBacked) {
    return {
      creatorId: profileBacked,
      profile: resolveCreatorPublicProfileById(creatorsMap, profileBacked),
    };
  }

  const preferredCandidate = candidates.find(Boolean);
  if (preferredCandidate) {
    return {
      creatorId: preferredCandidate,
      profile: resolveCreatorPublicProfileById(creatorsMap, preferredCandidate),
    };
  }

  return {
    creatorId: fallbackCreatorId,
    profile: resolveCreatorPublicProfileById(creatorsMap, fallbackCreatorId),
  };
}

export function resolveEffectiveWorkCreatorId(obra, caps, creatorsMap = null) {
  return resolveCanonicalWorkCreator(obra, caps, creatorsMap).creatorId;
}
