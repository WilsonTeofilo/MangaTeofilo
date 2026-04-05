import { PLATFORM_LEGACY_CREATOR_UID } from '../constants';

export const OBRAS_SCHEMA_VERSION = 1;

export const OBRA_PADRAO_ID = 'shito';

/** Dono da obra para permissoes multi-tenant (fallback = plataforma legada). */
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
