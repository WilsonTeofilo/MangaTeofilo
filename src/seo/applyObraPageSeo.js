import { obraSegmentoUrlPublica } from '../config/obras';
import { SITE_DEFAULT_IMAGE, SITE_NAME, SITE_ORIGIN } from '../config/site';

const SITE_URL = SITE_ORIGIN;
const DEFAULT_IMAGE = SITE_DEFAULT_IMAGE;

function absolutizeUrl(pathOrUrl) {
  const raw = String(pathOrUrl || DEFAULT_IMAGE).trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SITE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

/**
 * Dados para <Helmet> / meta da página da obra (título, OG, JSON-LD).
 * @param {{ pathname?: string, obra: object }} p — `pathname` legado; canónico é sempre `/work/{obraSegmentoUrlPublica}`.
 * @returns {null | { title: string, description: string, image: string, canonical: string, jsonLd: object }}
 */
export function buildObraPageSeo({ obra }) {
  if (!obra || typeof obra !== 'object') return null;
  const titleBase = String(obra.seoTitle || obra.titulo || 'Obra').trim();
  const description = String(obra.seoDescription || obra.sinopse || '')
    .trim()
    .slice(0, 220);
  const descOut = description || `Leia ${titleBase} — mangá autoral em português no ${SITE_NAME}. Ler mangá online.`;
  const image = absolutizeUrl(obra.capaUrl || obra.bannerUrl || DEFAULT_IMAGE);
  const segment = obraSegmentoUrlPublica(obra);
  const canonical = `${SITE_URL}/work/${encodeURIComponent(segment)}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWorkSeries',
    name: titleBase,
    url: canonical,
    inLanguage: 'pt-BR',
    genre: ['Mangá', 'Graphic Novel'],
    image: [image],
  };
  if (description) jsonLd.description = description;

  return {
    title: `${titleBase} | ${SITE_NAME}`,
    description: descOut,
    image,
    canonical,
    jsonLd,
  };
}
