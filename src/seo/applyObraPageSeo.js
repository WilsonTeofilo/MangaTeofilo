const SITE_NAME = 'MangaTeofilo';
const SITE_URL = 'https://mangateofilo.com';
const DEFAULT_IMAGE = '/assets/fotos/shito.jpg';

function upsertMeta(selector, attrPair, value) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  el.setAttribute(attrPair[0], attrPair[1]);
  el.setAttribute('content', value);
}

function upsertLinkRel(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * SEO por obra (campos seoTitle / seoDescription do admin + imagem).
 * @param {{ pathname: string, obra: object }} p
 */
export function applyObraPageSeo({ pathname, obra }) {
  if (!obra || typeof document === 'undefined') return;
  const titleBase = String(obra.seoTitle || obra.titulo || 'Obra').trim();
  const description = String(obra.seoDescription || obra.sinopse || '')
    .trim()
    .slice(0, 220);
  const rawImg = String(obra.capaUrl || obra.bannerUrl || DEFAULT_IMAGE).trim();
  const image = /^https?:\/\//i.test(rawImg)
    ? rawImg
    : `${SITE_URL}${rawImg.startsWith('/') ? '' : '/'}${rawImg}`;
  const canonical = `${SITE_URL}${pathname || '/'}`;

  document.title = `${titleBase} | ${SITE_NAME}`;

  upsertMeta('meta[name="description"]', ['name', 'description'], description || `Leia ${titleBase} no ${SITE_NAME}.`);

  upsertMeta('meta[property="og:site_name"]', ['property', 'og:site_name'], SITE_NAME);
  upsertMeta('meta[property="og:type"]', ['property', 'og:type'], 'article');
  upsertMeta('meta[property="og:title"]', ['property', 'og:title'], `${titleBase} | ${SITE_NAME}`);
  upsertMeta('meta[property="og:description"]', ['property', 'og:description'], description);
  upsertMeta('meta[property="og:image"]', ['property', 'og:image'], image);
  upsertMeta('meta[property="og:url"]', ['property', 'og:url'], canonical);

  upsertMeta('meta[name="twitter:card"]', ['name', 'twitter:card'], 'summary_large_image');
  upsertMeta('meta[name="twitter:title"]', ['name', 'twitter:title'], `${titleBase} | ${SITE_NAME}`);
  upsertMeta('meta[name="twitter:description"]', ['name', 'twitter:description'], description);
  upsertMeta('meta[name="twitter:image"]', ['name', 'twitter:image'], image);

  upsertLinkRel('canonical', canonical);
}

export function defaultSiteTitle() {
  return `${SITE_NAME} | Mangás autorais em português`;
}
