/**
 * Shell HTML para /work/:segment com OG/Twitter/canonical corretos para crawlers.
 * O SPA em React ajusta o <head> só no cliente; WhatsApp, Facebook e afins leem o HTML inicial.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getAppBaseUrl } from './payments/config.js';

const DATABASE_URL = 'https://shitoproject-ed649-default-rtdb.firebaseio.com';
const INDEX_TTL_MS = 5 * 60 * 1000;
const RESPONSE_TTL_MS = 45 * 1000;
const MAX_CACHE = 300;

if (!getApps().length) {
  initializeApp({ databaseURL: DATABASE_URL });
}

function getAppOrigin() {
  return String(getAppBaseUrl() || 'https://shitoproject-ed649.web.app').replace(/\/+$/, '');
}

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function absolutizeImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return `${getAppOrigin()}/assets/fotos/shito.jpg`;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${getAppOrigin()}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function slugifyObraSlug(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function obraSegmentoUrlPublicaFn(obra) {
  if (!obra || typeof obra !== 'object') return 'works';
  const id = String(obra.id || '').trim().toLowerCase();
  const slugS = slugifyObraSlug(String(obra.slug || '').trim());
  const titleS = slugifyObraSlug(String(obra.titulo || obra.title || '').trim());
  if (!id) return titleS || slugS || 'works';
  if (id === 'shito') return titleS || slugS || id;
  if (slugS && slugS !== id) return slugS;
  return titleS || slugS || id || 'works';
}

function pickWorkImage(obra) {
  const fallback = `${getAppOrigin()}/assets/fotos/shito.jpg`;
  if (!obra || typeof obra !== 'object') return fallback;
  const cover = String(obra.capaUrl || obra.bannerUrl || '').trim();
  return cover ? absolutizeImageUrl(cover) : fallback;
}

function stripDefaultSeo(html) {
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, '');
  out = out.replace(/<link\s+[^>]*rel=["']canonical["'][^>]*>/gi, '');
  out = out.replace(/<meta\b[\s\S]*?>/gi, (full) => {
    const lower = full.toLowerCase();
    if (lower.includes('name="robots"') || lower.includes("name='robots'")) return '';
    if (lower.includes('name="description"') || lower.includes("name='description'")) return '';
    if (lower.includes('property="og:') || lower.includes("property='og:")) return '';
    if (lower.includes('name="twitter:') || lower.includes("name='twitter:")) return '';
    return full;
  });
  return out;
}

function ogImageTypeHint(imageUrl) {
  const clean = String(imageUrl || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function buildWorkMeta(obra) {
  const site = 'MangaTeofilo';
  const titleBase = String(obra?.seoTitle || obra?.titulo || obra?.title || 'Obra').trim() || 'Obra';
  const rawDescription = String(obra?.seoDescription || obra?.sinopse || obra?.description || '').trim();
  const description =
    rawDescription.slice(0, 220) ||
    `Leia ${titleBase} online no ${site}. Veja sinopse, capítulos e acompanhe a obra.`;
  const image = pickWorkImage(obra);
  const segment = obraSegmentoUrlPublicaFn(obra);
  const canonical = `${getAppOrigin()}/work/${encodeURIComponent(segment)}`;
  const imageAlt = `${titleBase} | ${site}`;
  const modifiedAt = Number(obra?.updatedAt || obra?.updatedOn || obra?.createdAt || 0);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWorkSeries',
    name: titleBase,
    url: canonical,
    inLanguage: 'pt-BR',
    image: [image],
    genre: ['Mangá', 'Graphic Novel'],
    description,
  };

  return {
    title: `${titleBase} | ${site}`,
    description,
    canonical,
    image,
    imageAlt,
    robots: 'index,follow,max-image-preview:large',
    modifiedAt,
    jsonLd,
  };
}

function buildNotFoundMeta(rawTarget) {
  const canonical = `${getAppOrigin()}/work/${encodeURIComponent(String(rawTarget || 'obra'))}`;
  return {
    title: 'Obra não encontrada | MangaTeofilo',
    description: 'Esta obra não está disponível no MangaTeofilo.',
    canonical,
    image: `${getAppOrigin()}/assets/fotos/shito.jpg`,
    imageAlt: 'MangaTeofilo',
    robots: 'noindex,follow',
    modifiedAt: null,
    jsonLd: null,
  };
}

function buildSeoHeadBlock(meta) {
  const secureImg =
    String(meta.image || '').startsWith('https://')
      ? `<meta property="og:image:secure_url" content="${escapeAttr(meta.image)}" />`
      : '';
  const modified =
    meta.modifiedAt != null && Number(meta.modifiedAt) > 0
      ? `<meta property="article:modified_time" content="${escapeAttr(new Date(Number(meta.modifiedAt)).toISOString())}" />`
      : '';
  const jsonLd =
    meta.jsonLd != null
      ? `<script type="application/ld+json">${escapeAttr(JSON.stringify(meta.jsonLd)).replace(/&quot;/g, '"')}</script>`
      : '';

  return `
    <title>${escapeAttr(meta.title)}</title>
    <meta name="description" content="${escapeAttr(meta.description)}" />
    <meta name="robots" content="${escapeAttr(meta.robots)}" />
    <meta property="og:site_name" content="MangaTeofilo" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeAttr(meta.title)}" />
    <meta property="og:description" content="${escapeAttr(meta.description)}" />
    <meta property="og:image" content="${escapeAttr(meta.image)}" />
    ${secureImg}
    <meta property="og:image:type" content="${escapeAttr(ogImageTypeHint(meta.image))}" />
    <meta property="og:image:alt" content="${escapeAttr(meta.imageAlt)}" />
    <meta property="og:url" content="${escapeAttr(meta.canonical)}" />
    <meta property="og:locale" content="pt_BR" />
    ${modified}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(meta.title)}" />
    <meta name="twitter:description" content="${escapeAttr(meta.description)}" />
    <meta name="twitter:image" content="${escapeAttr(meta.image)}" />
    <meta name="twitter:image:alt" content="${escapeAttr(meta.imageAlt)}" />
    <link rel="canonical" href="${escapeAttr(meta.canonical)}" />
    ${jsonLd}
  `.trim();
}

function injectWorkSeo(html, meta) {
  const stripped = stripDefaultSeo(html);
  const block = buildSeoHeadBlock(meta);
  return stripped.replace(/<head>/i, `<head>\n${block}\n`);
}

let indexHtmlCache = { html: null, at: 0 };
async function fetchIndexHtml() {
  const now = Date.now();
  if (indexHtmlCache.html && now - indexHtmlCache.at < INDEX_TTL_MS) {
    return indexHtmlCache.html;
  }
  const res = await fetch(`${getAppOrigin()}/index.html`, {
    headers: { Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`fetch index.html ${res.status}`);
  const html = await res.text();
  indexHtmlCache = { html, at: now };
  return html;
}

const responseCache = new Map();

  function parseWorkRoute(req) {
    const path = String(req.path || '');
    const canonical = path.match(/\/work\/([^/?#]+)/);
    if (canonical) return { kind: 'segment', value: decodeURIComponent(canonical[1]) };
    return { kind: 'unknown', value: '' };
  }

async function resolveWorkByRouteTarget(route) {
  const db = getDatabase();
  if (route.kind === 'id') {
    const id = String(route.value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id) return null;
    const snap = await db.ref(`obras/${id}`).get();
    return snap.exists() ? { id, ...snap.val() } : null;
  }
  if (route.kind === 'segment') {
    const target = slugifyObraSlug(route.value);
    if (!target) return null;
    const snap = await db.ref('obras').get();
    if (!snap.exists()) return null;
    const obras = snap.val() || {};
    for (const [id, row] of Object.entries(obras)) {
      const obra = { id, ...(row || {}) };
      if (obraSegmentoUrlPublicaFn(obra) === target) {
        return obra;
      }
    }
  }
  return null;
}

export const workPageShell = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30, cors: false },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const route = parseWorkRoute(req);
    if (!route.value) {
      res.redirect(302, `${getAppOrigin()}/works`);
      return;
    }

    const cacheKey = `${route.kind}:${route.value}`;
    const now = Date.now();
    const cached = responseCache.get(cacheKey);
    if (cached && now - cached.at < RESPONSE_TTL_MS) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      res.status(200).send(cached.html);
      return;
    }

    try {
      const baseHtml = await fetchIndexHtml();
      const obra = await resolveWorkByRouteTarget(route);
      const meta = obra ? buildWorkMeta(obra) : buildNotFoundMeta(route.value);
      const finalHtml = injectWorkSeo(baseHtml, meta);

      if (responseCache.size > MAX_CACHE) responseCache.clear();
      responseCache.set(cacheKey, { html: finalHtml, at: now });

      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      res.status(200).send(finalHtml);
    } catch (error) {
      logger.error('workPageShell', error);
      res.redirect(302, `${getAppOrigin()}/works`);
    }
  }
);
