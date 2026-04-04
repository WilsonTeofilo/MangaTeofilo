/**
 * Busca no catálogo público de obras (dados já carregados no cliente — RTDB).
 * Normalização + tokens (AND) + pontuação simples para ordenar resultados.
 */

function parseWorkGenres(obra) {
  if (Array.isArray(obra?.genres)) {
    return obra.genres.map((g) => String(g || '').trim()).filter(Boolean);
  }
  if (Array.isArray(obra?.generos)) {
    return obra.generos.map((g) => String(g || '').trim()).filter(Boolean);
  }
  if (typeof obra?.generos === 'string') {
    return obra.generos
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
  }
  if (typeof obra?.genero === 'string') return [obra.genero.trim()].filter(Boolean);
  return [];
}

/** Remove acentos, minúsculas, colapsa espaços. */
export function normalizeForSearch(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeQuery(query) {
  const n = normalizeForSearch(query);
  if (!n) return [];
  return n.split(/\s+/).filter(Boolean);
}

/** Só filtra com consulta “útil” (evita ruído com 1 letra). */
export function searchQueryIsActive(query) {
  return normalizeForSearch(query).replace(/\s/g, '').length >= 2;
}

/**
 * @param {object[]} cards — itens enriquecidos do catálogo (mesma forma que `obrasCards` em ListaMangas)
 * @param {string} query
 * @param {(obra: object) => string} getCreatorName
 * @returns {object[]} subconjunto ordenado por relevância
 */
export function filterAndRankMangaCatalogCards(cards, query, getCreatorName) {
  if (!Array.isArray(cards) || cards.length === 0) return [];
  if (!searchQueryIsActive(query)) return cards;

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return cards;

  const phrase = normalizeForSearch(query);
  const scored = [];

  for (const card of cards) {
    const creatorResolved = String(getCreatorName(card) || '').trim();
    const creator = normalizeForSearch(
      [creatorResolved, card.creatorDisplayName, card.creatorName, card.autor].filter(Boolean).join(' ')
    );
    const genres = parseWorkGenres(card).map(normalizeForSearch).filter(Boolean);
    const title = normalizeForSearch(card.titulo || '');
    const tituloCurto = normalizeForSearch(card.tituloCurto || '');
    const sinopse = normalizeForSearch(card.sinopse || '');
    const seoTitle = normalizeForSearch(card.seoTitle || '');
    const id = normalizeForSearch(String(card.obraId || card.id || ''));

    const haystack = [title, tituloCurto, creator, sinopse, seoTitle, id, ...genres].join(' | ');

    let score = 0;
    let allMatch = true;
    for (const t of tokens) {
      if (!haystack.includes(t)) {
        allMatch = false;
        break;
      }
      if (title.includes(t) || tituloCurto.includes(t)) score += 14;
      else if (genres.some((g) => g.includes(t))) score += 9;
      else if (creator.includes(t)) score += 7;
      else if (id.includes(t)) score += 5;
      else if (seoTitle.includes(t)) score += 5;
      else if (sinopse.includes(t)) score += 4;
      else score += 1;
    }

    if (!allMatch) continue;

    if (phrase.length >= 2) {
      if (title.includes(phrase) || tituloCurto.includes(phrase)) score += 22;
      else if (creator.includes(phrase)) score += 10;
    }

    scored.push({ card, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.card);
}

/** Top N resultados para dropdown de sugestões (mesma pontuação que a grelha). */
export function suggestMangaCatalogCards(cards, query, getCreatorName, limit = 10) {
  const n = Math.min(20, Math.max(1, Number(limit) || 10));
  return filterAndRankMangaCatalogCards(cards, query, getCreatorName).slice(0, n);
}

/** Título principal, linha secundária (título longo / SEO) e etiqueta de formato. */
export function catalogWorkDisplayMeta(card) {
  const primary = String(card?.tituloCurto || card?.titulo || card?.obraId || '').trim() || 'Obra';
  const fullTitulo = String(card?.titulo || '').trim();
  const seo = String(card?.seoTitle || '').trim();
  let secondaryTitle = '';
  if (fullTitulo && fullTitulo !== primary) secondaryTitle = fullTitulo;
  else if (seo && seo !== primary) secondaryTitle = seo;

  const caps = Number(card?.totalCapitulos || 0);
  const st = String(card?.status || '').toLowerCase();
  let typeLabel = 'Mangá';
  if (caps <= 1 && st === 'completed') typeLabel = 'One-shot';
  else if (caps === 1) typeLabel = 'Cap. único';

  return { primaryTitle: primary, secondaryTitle, typeLabel };
}

export { parseWorkGenres };
