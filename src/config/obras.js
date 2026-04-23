export const OBRAS_SCHEMA_VERSION = 1;

export const OBRA_PADRAO_ID = 'shito';

/** Dono da obra para permissoes multi-tenant. */
export function obraCreatorId(obra) {
  const candidates = [
    obra?.creatorId,
    obra?.creatorProfile?.creatorId,
    obra?.creatorProfile?.userId,
    obra?.ownerUid,
    obra?.authorUid,
    obra?.userId,
    obra?.uid,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  return '';
}

export function inferObraCreatorIdFromCapitulos(capitulos = []) {
  const counts = new Map();
  (Array.isArray(capitulos) ? capitulos : []).forEach((cap) => {
    const candidates = [
      cap?.creatorId,
      cap?.creatorProfile?.creatorId,
      cap?.creatorProfile?.userId,
      cap?.userId,
      cap?.uid,
    ];
    candidates.forEach((candidate) => {
      const value = String(candidate || '').trim();
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
  });
  let best = '';
  let bestCount = 0;
  for (const [uid, count] of counts.entries()) {
    if (count > bestCount) {
      best = uid;
      bestCount = count;
    }
  }
  return best;
}

function normalizeAuthorBindingValue(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

export function buildCanonicalAuthorBinding(author = {}) {
  const creatorId = normalizeAuthorBindingValue(author?.creatorId || author?.uid);
  const creatorHandle = normalizeAuthorBindingValue(author?.creatorHandle || author?.handle)
    .toLowerCase()
    .replace(/^@+/, '');
  const creatorDisplayName = normalizeAuthorBindingValue(author?.creatorDisplayName || author?.displayName);
  const creatorAvatarUrl = normalizeAuthorBindingValue(author?.creatorAvatarUrl || author?.avatarUrl);

  if (!creatorId) {
    return {
      creatorId: null,
      creatorUsername: null,
      creatorHandle: null,
      creatorDisplayName: null,
      creatorProfile: null,
    };
  }

  return {
    creatorId,
    creatorUsername: creatorHandle || null,
    creatorHandle: creatorHandle || null,
    creatorDisplayName: creatorDisplayName || null,
    creatorProfile: {
      creatorId,
      userId: creatorId,
      username: creatorHandle || null,
      displayName: creatorDisplayName || null,
      avatarUrl: creatorAvatarUrl || null,
    },
  };
}

function resolveObraEmbeddedAuthorHints(obra) {
  const creatorHandle = String(
    obra?.creatorHandle ||
      obra?.creatorUsername ||
      obra?.creatorProfile?.username ||
      obra?.userHandle ||
      ''
  )
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');

  const creatorDisplayName = String(
    obra?.creatorDisplayName ||
      obra?.creatorProfile?.displayName ||
      obra?.authorDisplayName ||
      obra?.authorName ||
      obra?.writerName ||
      obra?.userName ||
      ''
  ).trim();

  return {
    creatorHandle,
    creatorDisplayName,
  };
}

function resolveLookupEntryFromHints(creatorLookupByUid = {}, obra, chapterRows = []) {
  const lookupList = Object.values(creatorLookupByUid || {});
  if (!lookupList.length) return null;

  const hintedIds = [
    obraCreatorId(obra),
    inferObraCreatorIdFromCapitulos(chapterRows),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const hintedId of hintedIds) {
    if (creatorLookupByUid[hintedId]) return creatorLookupByUid[hintedId];
  }

  const { creatorHandle, creatorDisplayName } = resolveObraEmbeddedAuthorHints(obra);
  if (creatorHandle) {
    const byHandle = lookupList.find(
      (entry) => String(entry?.handle || '').trim().toLowerCase() === creatorHandle
    );
    if (byHandle) return byHandle;
  }

  if (creatorDisplayName) {
    const loweredName = creatorDisplayName.toLowerCase();
    const byName = lookupList.find(
      (entry) => String(entry?.displayName || '').trim().toLowerCase() === loweredName
    );
    if (byName) return byName;
  }

  return null;
}

export function resolveObraAuthorState(
  obra,
  { creatorLookupByUid = {}, chapterRows = [] } = {}
) {
  const creatorId = obraCreatorId(obra) || inferObraCreatorIdFromCapitulos(chapterRows);
  const creatorEntry =
    creatorLookupByUid[String(creatorId || '').trim()] ||
    resolveLookupEntryFromHints(creatorLookupByUid, obra, chapterRows) ||
    null;
  if (creatorEntry) {
    const creatorHandle = String(creatorEntry.handle || '').trim();
    const creatorDisplayName = String(
      creatorEntry.displayName || (creatorHandle ? `@${creatorHandle}` : 'Autor ativo')
    ).trim();
    return {
      creatorId: String(creatorEntry.uid || creatorId || '').trim(),
      creatorHandle,
      creatorDisplayName,
      creatorAvatarUrl: String(creatorEntry.avatarUrl || '').trim(),
      resolvedFromLegacyHints:
        !creatorLookupByUid[String(creatorId || '').trim()] &&
        Boolean(resolveObraEmbeddedAuthorHints(obra).creatorHandle || resolveObraEmbeddedAuthorHints(obra).creatorDisplayName),
      authorState: 'linked',
      authorLabel: creatorHandle ? `@${creatorHandle}` : creatorDisplayName,
    };
  }
  const { creatorHandle, creatorDisplayName } = resolveObraEmbeddedAuthorHints(obra);
  if (String(creatorId || '').trim() || creatorHandle || creatorDisplayName) {
    return {
      creatorId: String(creatorId || '').trim(),
      creatorHandle: creatorHandle || '',
      creatorDisplayName: creatorDisplayName || 'Autor removido',
      creatorAvatarUrl: '',
      authorState: 'removed',
      authorLabel: 'Autor removido',
    };
  }
  return {
    creatorId: '',
    creatorHandle: '',
    creatorDisplayName: 'Sem autor vinculado',
    creatorAvatarUrl: '',
    authorState: 'unassigned',
    authorLabel: 'Sem autor vinculado',
  };
}

export function normalizarObraId(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return OBRA_PADRAO_ID;
  return v.replace(/[^a-z0-9_-]/g, '').slice(0, 40) || OBRA_PADRAO_ID;
}

/**
 * Identificador da obra no capitulo: `workId` (novo) ou `obraId` (legado).
 * Sempre normalizado; vazio cai no Shito padrao.
 */
export function obterObraIdCapitulo(capitulo) {
  const w = String(capitulo?.workId ?? '').trim();
  if (w) return normalizarObraId(w);
  return normalizarObraId(capitulo?.obraId);
}

/** Slug URL-friendly (mesma regra mental do admin de obras). */
export function slugifyObraSlug(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Segmento usado em `/work/{segment}` - SEO canonico sem mudar a chave RTDB da obra.
 * - Obra-base (`shito`): prioriza slug derivado do titulo para a URL refletir Kokuin, nao `shito`.
 * - Demais obras: usa `slug` se existir e for distinto do id; senao titulo; senao id.
 */
export function obraSegmentoUrlPublica(obra) {
  if (!obra || typeof obra !== 'object') return OBRA_PADRAO_ID;
  const id = String(obra.id || '').trim().toLowerCase();
  const slugRaw = String(obra.slug || '').trim();
  const slugS = slugifyObraSlug(slugRaw);
  const titleS = slugifyObraSlug(String(obra.titulo || '').trim());

  if (id === OBRA_PADRAO_ID) {
    return titleS || slugS || id;
  }
  if (slugS && slugS !== id) return slugS;
  return titleS || slugS || id || OBRA_PADRAO_ID;
}

/**
 * Resolve ID de obra no RTDB a partir do que veio na URL (id ou slug).
 */
export function resolverObraIdPorSlugOuId(obrasList, rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) return null;
  const list = Array.isArray(obrasList) ? obrasList : [];
  const lower = key.toLowerCase();
  const byId = list.find((o) => String(o.id || '').toLowerCase() === lower);
  if (byId) return normalizarObraId(byId.id);
  const slugNorm = slugifyObraSlug(key);
  const bySlug = list.find((o) => {
    const s = String(o.slug || o.id || '').trim();
    if (slugifyObraSlug(s) === slugNorm || s.toLowerCase() === lower) return true;
    const tituloSlug = slugifyObraSlug(String(o.titulo || '').trim());
    return tituloSlug === slugNorm && tituloSlug.length >= 2;
  });
  if (bySlug) return normalizarObraId(bySlug.id);
  return null;
}

export function capituloPertenceObra(capitulo, obraId = OBRA_PADRAO_ID) {
  return obterObraIdCapitulo(capitulo) === normalizarObraId(obraId);
}

export function buildChapterCampaignId(capId, obraId) {
  return `chapter_${normalizarObraId(obraId)}_${String(capId || '').slice(0, 80)}`;
}
