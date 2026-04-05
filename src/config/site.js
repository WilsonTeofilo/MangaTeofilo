export const SITE_ORIGIN = 'https://shitoproject-ed649.web.app';
export const SITE_NAME = 'MangaTeofilo';
export const SITE_DEFAULT_IMAGE = `${SITE_ORIGIN}/assets/fotos/shito.jpg`;

export function absolutizeSiteUrl(pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return SITE_ORIGIN;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SITE_ORIGIN}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

