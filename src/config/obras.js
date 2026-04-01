import { PLATFORM_LEGACY_CREATOR_UID } from '../constants';

export const OBRAS_SCHEMA_VERSION = 1;

export const OBRA_PADRAO_ID = 'shito';

export const OBRA_SHITO_DEFAULT = {
  id: OBRA_PADRAO_ID,
  slug: OBRA_PADRAO_ID,
  titulo: 'Shito: Fragmentos da Tempestade',
  tituloCurto: 'Shito',
  sinopse: '',
  status: 'ongoing',
  isPublished: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  creatorId: PLATFORM_LEGACY_CREATOR_UID,
};

/** Dono da obra para permissões multi-tenant (fallback = plataforma legada). */
export function obraCreatorId(obra) {
  const c = String(obra?.creatorId || '').trim();
  if (c) return c;
  return PLATFORM_LEGACY_CREATOR_UID;
}

export function normalizarObraId(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return OBRA_PADRAO_ID;
  return v.replace(/[^a-z0-9_-]/g, '').slice(0, 40) || OBRA_PADRAO_ID;
}

export function ensureLegacyShitoObra(list) {
  const obras = Array.isArray(list) ? list : [];
  const temShito = obras.some((obra) => normalizarObraId(obra?.id) === OBRA_PADRAO_ID);
  if (temShito) return obras;
  return [
    ...obras,
    {
      ...OBRA_SHITO_DEFAULT,
      id: OBRA_PADRAO_ID,
      slug: OBRA_PADRAO_ID,
      createdAt: 0,
      updatedAt: 0,
      isPublished: true,
      creatorId: OBRA_SHITO_DEFAULT.creatorId,
    },
  ];
}

/**
 * Identificador da obra no capítulo: `workId` (novo) ou `obraId` (legado).
 * Sempre normalizado; vazio cai no Shito padrão.
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
    return slugifyObraSlug(s) === slugNorm || s.toLowerCase() === lower;
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
