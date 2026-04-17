import { obraSegmentoUrlPublica } from '../../config/obras';

export const DEFAULT_CREATOR_WORK_COVER = '/assets/mascote/vaquinhaERR.webp';

export function normalizarRede(url) {
  const valor = String(url || '').trim();
  if (!valor) return '';
  if (/^https?:\/\//i.test(valor)) return valor;
  return `https://${valor}`;
}

export function pathObra(obra) {
  return `/work/${encodeURIComponent(obraSegmentoUrlPublica(obra))}`;
}

export function pathObraFromFavoriteRow(row) {
  const workId = String(row?.workId || '').trim();
  if (!workId) return '/works';
  const slug = String(row?.slug || workId).trim();
  return `/work/${encodeURIComponent(obraSegmentoUrlPublica({ id: workId, slug }))}`;
}

export function applyImageFallback(event, fallback = DEFAULT_CREATOR_WORK_COVER) {
  if (event?.currentTarget?.dataset?.fallbackApplied === 'true') return;
  event.currentTarget.dataset.fallbackApplied = 'true';
  event.currentTarget.src = fallback;
}

export function isDefaultCreatorWorkCoverUrl(url) {
  const normalized = String(url || '').trim().toLowerCase();
  return normalized.endsWith(DEFAULT_CREATOR_WORK_COVER) || normalized.includes('/assets/fotos/shito.jpg');
}

export function resolveWorkKey(obra) {
  const raw = String(obra?.id || obra?.workId || obra?.obraId || '').trim();
  return raw ? raw.toLowerCase() : '';
}

export function resolveWorkKeyFromCap(cap) {
  const raw = String(cap?.obraId || cap?.mangaId || cap?.workId || '').trim();
  return raw ? raw.toLowerCase() : '';
}

export function resolveCreatorWorkCoverUrl(obra, overrides = null, chapterOverrides = null) {
  const coverRaw = String(obra?.capaUrl || obra?.coverUrl || '').trim();
  const cover = coverRaw && !isDefaultCreatorWorkCoverUrl(coverRaw) ? coverRaw : '';
  if (cover) return cover;
  const id = resolveWorkKey(obra);
  if (overrides && id && overrides[id]) return overrides[id];
  if (chapterOverrides && id && chapterOverrides[id]) return chapterOverrides[id];
  return DEFAULT_CREATOR_WORK_COVER;
}

export function resolveFavoriteWorkCoverUrl(row, overrides = null, chapterOverrides = null) {
  const coverRaw = String(row?.coverUrl || row?.capaUrl || '').trim();
  const cover = coverRaw && !isDefaultCreatorWorkCoverUrl(coverRaw) ? coverRaw : '';
  if (cover) return cover;
  const workId = resolveWorkKey({ id: row?.workId });
  if (overrides && workId && overrides[workId]) return overrides[workId];
  if (chapterOverrides && workId && chapterOverrides[workId]) return chapterOverrides[workId];
  return DEFAULT_CREATOR_WORK_COVER;
}

export function formatarPrecoBrl(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
}

export function formatarDataLeitor(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 'recente';
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: 'numeric',
  }).format(new Date(n));
}

export function countMapEntries(value) {
  if (!value || typeof value !== 'object') return 0;
  return Object.keys(value).length;
}

export function valueCount(value, fallbacks = []) {
  const primary = Number(value);
  if (Number.isFinite(primary) && primary >= 0) return primary;
  for (const item of fallbacks) {
    const n = Number(item);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

export function commentsCountFromValue(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

export function statsFromWork(obra, capitulosDaObra) {
  const likes = valueCount(
    obra?.likesCount,
    [
      obra?.curtidas,
      obra?.favoritosCount,
      obra?.favoritesCount,
      countMapEntries(obra?.likes),
      countMapEntries(obra?.favoritos),
    ]
  );
  const views =
    valueCount(obra?.viewsCount, [obra?.visualizacoes]) +
    capitulosDaObra.reduce((sum, cap) => sum + valueCount(cap?.viewsCount, [cap?.visualizacoes]), 0);
  const comments =
    commentsCountFromValue(obra?.comments) +
    valueCount(obra?.commentsCount) +
    capitulosDaObra.reduce(
      (sum, cap) => sum + commentsCountFromValue(cap?.comments) + valueCount(cap?.commentsCount),
      0
    );
  return { likes, views, comments };
}
