/**
 * Regras do formulário de obra (catálogo / SEO) — usado pelo ObrasAdmin.
 * Campos no RTDB permanecem em português onde o app já usa (titulo, sinopse, capaUrl…).
 */

import { slugifyObraSlug } from './obras';
import { isTrustedPlatformAssetUrl } from '../utils/trustedAssetUrls';

export const OBRAS_WORK_GENRE_IDS = [
  'acao',
  'aventura',
  'fantasia',
  'terror',
  'romance',
  'drama',
  'comedia',
  'sci-fi',
  'sobrenatural',
  'esporte',
  'misterio',
];

const GENRE_ID_SET = new Set(OBRAS_WORK_GENRE_IDS);

export const OBRAS_WORK_GENRE_LABELS = {
  acao: 'Ação',
  aventura: 'Aventura',
  fantasia: 'Fantasia',
  terror: 'Terror',
  romance: 'Romance',
  drama: 'Drama',
  comedia: 'Comédia',
  'sci-fi': 'Sci-fi',
  sobrenatural: 'Sobrenatural',
  esporte: 'Esporte',
  misterio: 'Mistério',
};

export const OBRAS_WORK_STATUS = [
  { id: 'ongoing', label: 'Em lançamento' },
  { id: 'completed', label: 'Completo' },
  { id: 'hiatus', label: 'Hiato' },
];

export const TITLE_MIN = 3;
export const TITLE_MAX = 80;
export const DESCRIPTION_MIN = 50;
/** Sinopse na página da obra (o resumo SEO para Google continua limitado a 160 em `buildSeoDescriptionFromDescription`). */
export const DESCRIPTION_MAX = 600;
export const SEO_DESCRIPTION_MAX = 160;
export const MAX_GENRES = 3;
export const MAX_TAGS = 5;
export const TAG_MAX_LEN = 32;
/** Limite do arquivo escolhido pelo autor antes do processamento (capa/banner). */
export const MAX_COVER_UPLOAD_BYTES = Math.round(1.2 * 1024 * 1024);
export const SEO_TITLE_MAX = 70;
export const TITULO_CURTO_MAX = 40;
export const SEO_KEYWORDS_MAX = 400;

/** UID Firebase (segmentos alfanuméricos, típico 28 chars). */
const UID_RE = /^[a-zA-Z0-9]{10,128}$/;

/** URL HTTP(S) com caminho que parece imagem raster (evita texto aleatório no campo). */
export function isLikelyHttpImageUrl(url) {
  return isTrustedPlatformAssetUrl(url, { allowLocalAssets: true });
}

export function obraSlugFromTitle(title) {
  return slugifyObraSlug(String(title || '').trim());
}

export function buildSeoDescriptionFromDescription(description) {
  const t = String(description || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!t) return '';
  if (t.length <= SEO_DESCRIPTION_MAX) return t;
  const cut = t.slice(0, SEO_DESCRIPTION_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[.,;:\s]+$/g, '')}…`.slice(0, SEO_DESCRIPTION_MAX);
}

export function normalizeGenreList(selected) {
  const arr = Array.isArray(selected) ? selected : [];
  const out = [];
  for (const g of arr) {
    const id = String(g || '').trim().toLowerCase();
    if (!GENRE_ID_SET.has(id)) continue;
    if (!out.includes(id)) out.push(id);
    if (out.length >= MAX_GENRES) break;
  }
  return out;
}

/** Gêneros válidos para o formulário admin a partir do registro RTDB (inglês ou legado PT). */
export function parseObraGenreIdsForForm(obra) {
  const rawGenres = obra?.genres;
  const fromGenres = Array.isArray(rawGenres)
    ? rawGenres
    : rawGenres && typeof rawGenres === 'object'
      ? Object.values(rawGenres)
      : [];
  let ids = normalizeGenreList(fromGenres);
  if (ids.length === 0 && Array.isArray(obra?.generos)) {
    ids = normalizeGenreList(obra.generos);
  } else if (ids.length === 0 && typeof obra?.generos === 'string') {
    ids = normalizeGenreList(obra.generos.split(','));
  } else if (ids.length === 0 && typeof obra?.genero === 'string') {
    ids = normalizeGenreList([obra.genero]);
  }
  const mainRaw = String(obra?.mainGenre || '').trim().toLowerCase();
  if (ids.length === 0 && GENRE_ID_SET.has(mainRaw)) ids = normalizeGenreList([mainRaw]);
  return ids;
}

export function normalizeTagsFromInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const parts = s
    .split(/[,#\n]+/)
    .map((p) =>
      String(p || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
    )
    .filter(Boolean);
  const out = [];
  for (const p of parts) {
    const t = p.slice(0, TAG_MAX_LEN).replace(/[^a-z0-9-]/g, '');
    if (!t || out.includes(t)) continue;
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function tagsToSeoKeywords(tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

export function publicoAlvoFromMainGenre(mainGenre) {
  const id = String(mainGenre || '').trim();
  return OBRAS_WORK_GENRE_LABELS[id] || 'Geral';
}

export function normalizeStatusForForm(raw) {
  const s = String(raw || '').trim();
  if (s === 'draft') return 'ongoing';
  if (OBRAS_WORK_STATUS.some((o) => o.id === s)) return s;
  return 'ongoing';
}

export function isValidCreatorUid(uid) {
  return UID_RE.test(String(uid || '').trim());
}

/**
 * @param {object} p
 * @param {string} p.titulo
 * @param {string} p.sinopse
 * @param {string[]} p.genres
 * @param {string} p.mainGenre
 * @param {string} p.tagsRaw
 * @param {string} p.status
 * @param {boolean} p.hasCapaFile
 * @param {string} p.capaUrl
 * @param {boolean} p.hasBannerFile
 * @param {string} p.bannerUrl
 * @param {string} [p.seoTitle]
 * @param {string} [p.tituloCurto]
 * @param {string|null} p.editandoId
 * @param {object[]} p.obrasTodas — lista completa (não filtrada) para duplicados
 * @param {boolean} p.isMangaka
 * @param {string} p.adminCreatorId — obrigatório se !isMangaka && !editandoId
 */
export function validateObraWorkForm(p) {
  const errors = [];
  const titulo = String(p.titulo || '').trim();
  if (!titulo) errors.push('Título é obrigatório.');
  else if (titulo.length < TITLE_MIN) errors.push(`Título: mínimo ${TITLE_MIN} caracteres.`);
  else if (titulo.length > TITLE_MAX) errors.push(`Título: máximo ${TITLE_MAX} caracteres.`);

  const sinopse = String(p.sinopse || '').trim();
  if (!sinopse) errors.push('Descrição (sinopse) é obrigatória.');
  else if (sinopse.length < DESCRIPTION_MIN) errors.push(`Descrição: mínimo ${DESCRIPTION_MIN} caracteres.`);
  else if (sinopse.length > DESCRIPTION_MAX) errors.push(`Descrição: máximo ${DESCRIPTION_MAX} caracteres.`);

  const genres = normalizeGenreList(p.genres);
  if (genres.length === 0) errors.push('Selecione pelo menos um gênero (até 3).');
  if (genres.length > MAX_GENRES) errors.push(`No máximo ${MAX_GENRES} gêneros.`);

  const main = String(p.mainGenre || '').trim();
  if (!main) errors.push('Gênero principal é obrigatório.');
  else if (!genres.includes(main)) errors.push('O gênero principal deve estar entre os gêneros selecionados.');

  const tags = normalizeTagsFromInput(p.tagsRaw);

  const statusOk = OBRAS_WORK_STATUS.some((o) => o.id === p.status);
  if (!statusOk) errors.push('Status inválido.');

  const capaUrlTrim = String(p.capaUrl || '').trim();
  const capaOk = Boolean(p.hasCapaFile) || isLikelyHttpImageUrl(capaUrlTrim);
  if (!capaOk) {
    errors.push('Capa obrigatória: envie JPG/PNG/WebP (até 1,2 MB) ou uma URL https/http direta para .jpg, .png ou .webp.');
  }

  const bannerUrlTrim = String(p.bannerUrl || '').trim();
  const bannerOk =
    !bannerUrlTrim && !p.hasBannerFile
      ? true
      : Boolean(p.hasBannerFile) || isLikelyHttpImageUrl(bannerUrlTrim);
  if (!bannerOk) {
    errors.push('URL do banner inválida: use link direto terminando em .jpg, .png ou .webp, ou envie um arquivo.');
  }

  const tc = String(p.tituloCurto || '').trim();
  if (tc.length > TITULO_CURTO_MAX) {
    errors.push(`Título curto: no máximo ${TITULO_CURTO_MAX} caracteres.`);
  }

  const seoT = String(p.seoTitle || '').trim();
  if (seoT.length > SEO_TITLE_MAX) {
    errors.push(`Título SEO: no máximo ${SEO_TITLE_MAX} caracteres.`);
  }

  const slug = obraSlugFromTitle(titulo);
  if (!slug || slug.length < 2) errors.push('Título deve gerar um slug válido (use letras ou números).');

  const list = Array.isArray(p.obrasTodas) ? p.obrasTodas : [];
  const excludeId = p.editandoId ? String(p.editandoId) : null;
  const titleLower = titulo.toLowerCase();
  const dupTitle = list.some(
    (o) =>
      String(o.id) !== excludeId && String(o.titulo || '').trim().toLowerCase() === titleLower && titleLower.length > 0
  );
  if (dupTitle) errors.push('Já existe uma obra com este título (ignorando maiúsculas).');

  if (slug && !p.editandoId) {
    const dupSlug = list.some((o) => {
      const id = String(o.id || '');
      const s = slugifyObraSlug(o.slug || o.id || '');
      return id === slug || s === slug;
    });
    if (dupSlug) errors.push(`O slug "${slug}" já está em uso. Altere o título.`);
  }

  if (p.isMangaka) {
    if (!p.currentUid) errors.push('Faça login novamente para criar ou editar obras.');
    else if (!isValidCreatorUid(p.currentUid)) errors.push('Sessão inválida para definir autor.');
  }

  if (!p.isMangaka && !p.editandoId) {
    const cid = String(p.adminCreatorId || '').trim();
    if (!isValidCreatorUid(cid)) errors.push('Selecione ou informe o UID do autor (criador) da obra.');
  }

  if (!p.isMangaka && p.editandoId) {
    const cidEdit = String(p.adminCreatorId || '').trim();
    if (cidEdit && !isValidCreatorUid(cidEdit)) {
      errors.push('UID do autor inválido (use o ID Firebase Auth do criador).');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    genres,
    tags,
    slug,
    seoDescription: buildSeoDescriptionFromDescription(sinopse),
  };
}
