
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

function normalizeLooseKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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

export function resolveCreatorPublicProfileFromHints(creatorsMap, hints = []) {
  if (!creatorsMap || typeof creatorsMap !== 'object') return null;
  const normalizedHints = [...new Set((Array.isArray(hints) ? hints : [hints]).map(normalizeLooseKey).filter(Boolean))];
  if (!normalizedHints.length) return null;

  for (const row of Object.values(creatorsMap)) {
    if (!row || typeof row !== 'object') continue;
    const candidates = [
      row.userHandle,
      row.creatorUsername,
      row.username,
      row.userName,
      row.creatorDisplayName,
      row.displayName,
      row.creatorProfile?.username,
      row.creatorProfile?.displayName,
    ]
      .map(normalizeLooseKey)
      .filter(Boolean);
    if (candidates.some((candidate) => normalizedHints.includes(candidate))) {
      return row;
    }
  }
  return null;
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

  const hintedProfile = resolveCreatorPublicProfileFromHints(creatorsMap, [
    obra?.creatorUsername,
    obra?.creatorDisplayName,
    obra?.creatorName,
    obra?.authorName,
    obra?.authorDisplayName,
    obra?.autor,
    obra?.autorNome,
    obra?.writerName,
    obra?.userName,
    obra?.username,
    ...((Array.isArray(caps) ? caps : []).flatMap((cap) => [
      cap?.creatorDisplayName,
      cap?.creatorName,
      cap?.authorName,
      cap?.authorDisplayName,
      cap?.autor,
      cap?.autorNome,
      cap?.writerName,
      cap?.userName,
      cap?.displayName,
      cap?.creatorProfile?.displayName,
      cap?.creatorProfile?.username,
    ])),
  ]);
  if (hintedProfile) {
    const hintedCreatorId = normalizeCreatorId(
      hintedProfile.creatorId ||
        hintedProfile.userId ||
        hintedProfile.uid
    );
    return {
      creatorId: hintedCreatorId || fallbackCreatorId,
      profile: hintedProfile,
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
