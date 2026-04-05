/**
 * Shell HTML para /ler/:id com OG/Twitter/canonical corretos para crawlers (Facebook, WhatsApp, etc.).
 * O SPA em React atualiza o <head> só no cliente; redes sociais leem o HTML inicial — por isso este handler.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getAppBaseUrl } from './payments/config.js';

const DATABASE_URL = 'https://shitoproject-ed649-default-rtdb.firebaseio.com';
if (!getApps().length) {
  initializeApp({ databaseURL: DATABASE_URL });
}

function getAppOrigin() {
  return String(getAppBaseUrl() || 'https://shitoproject-ed649.web.app').replace(/\/+$/, '');
}

function escapeAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let indexHtmlCache = { html: null, at: 0 };
const INDEX_TTL_MS = 5 * 60 * 1000;

async function fetchIndexHtml() {
  const now = Date.now();
  if (indexHtmlCache.html && now - indexHtmlCache.at < INDEX_TTL_MS) {
    return indexHtmlCache.html;
  }
  const res = await fetch(`${getAppOrigin()}/index.html`, {
    headers: { Accept: 'text/html' },
  });
  if (!res.ok) {
    throw new Error(`fetch index.html ${res.status}`);
  }
  const html = await res.text();
  indexHtmlCache = { html, at: now };
  return html;
}

const responseCache = new Map();
const RESPONSE_TTL_MS = 45 * 1000;
const MAX_CACHE = 400;

function absolutizeImageUrl(url) {
  const u = String(url || '').trim();
  if (!u) return `${getAppOrigin()}/assets/fotos/shito.jpg`;
  if (/^https?:\/\//i.test(u)) return u;
  return `${getAppOrigin()}${u.startsWith('/') ? '' : '/'}${u}`;
}

function pickChapterImage(ch) {
  const defaultOgImage = `${getAppOrigin()}/assets/fotos/shito.jpg`;
  if (!ch || typeof ch !== 'object') return defaultOgImage;
  const capa = String(ch.capaUrl || '').trim();
  if (capa) return absolutizeImageUrl(capa);
  const p0 = Array.isArray(ch.paginas) && ch.paginas.length ? String(ch.paginas[0] || '').trim() : '';
  if (p0) return absolutizeImageUrl(p0);
  return defaultOgImage;
}

function buildChapterMeta(id, ch) {
  const SITE = 'MangaTeofilo';
  const appOrigin = getAppOrigin();
  const obraNome = String(ch?.obraTitulo || ch?.obraName || '').trim() || 'Mangá autoral';
  const num = Number(ch?.numero || 0);
  const capTitulo =
    String(ch?.titulo || '').trim() || (num ? `Capítulo ${num}` : 'Capítulo');
  const numLabel = num > 0 ? String(num) : '?';
  const canonical = `${appOrigin}/ler/${encodeURIComponent(id)}`;
  const title = `${obraNome} · Cap. ${numLabel}: ${capTitulo} | ${SITE}`;
  const description = `Leia ${capTitulo} de ${obraNome} — mangá em português no ${SITE}. Toque para abrir o leitor.`;
  const image = pickChapterImage(ch);
  const imgAlt = `${obraNome} — ${capTitulo} — ${SITE}`;
  const articleModifiedTime = Number(ch?.updatedAt || ch?.dataAtualizacao || ch?.createdAt || ch?.dataPublicacao || 0);
  return { title, description, canonical, image, imgAlt, articleModifiedTime };
}

/**
 * Remove metas de SEO do index estático para evitar duplicata; injeta bloco único após <head>.
 */
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
  const u = String(imageUrl || '').split('?')[0].toLowerCase();
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function buildSeoHeadBlock(meta) {
  const { title, description, canonical, image, imgAlt, robots, articleModifiedTime } = meta;
  const robotsContent = robots || 'index,follow,max-image-preview:large';
  const secureImg =
    String(image || '').startsWith('https://') ? `<meta property="og:image:secure_url" content="${escapeAttr(image)}" />` : '';
  const imgType = `<meta property="og:image:type" content="${escapeAttr(ogImageTypeHint(image))}" />`;
  const modified =
    articleModifiedTime != null && Number(articleModifiedTime) > 0
      ? `<meta property="article:modified_time" content="${escapeAttr(new Date(Number(articleModifiedTime)).toISOString())}" />`
      : '';
  return `
    <title>${escapeAttr(title)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
    <meta name="robots" content="${escapeAttr(robotsContent)}" />
    <meta property="og:site_name" content="MangaTeofilo" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeAttr(title)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta property="og:image" content="${escapeAttr(image)}" />
    ${secureImg}
    ${imgType}
    <meta property="og:image:alt" content="${escapeAttr(imgAlt)}" />
    <meta property="og:url" content="${escapeAttr(canonical)}" />
    <meta property="og:locale" content="pt_BR" />
    ${modified}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(title)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <meta name="twitter:image" content="${escapeAttr(image)}" />
    <meta name="twitter:image:alt" content="${escapeAttr(imgAlt)}" />
    <link rel="canonical" href="${escapeAttr(canonical)}" />
  `.trim();
}

function injectChapterSeo(html, meta) {
  const stripped = stripDefaultSeo(html);
  const block = buildSeoHeadBlock(meta);
  return stripped.replace(/<head>/i, `<head>\n${block}\n`);
}

function pathChapterId(req) {
  const p = String(req.path || '');
  const m = p.match(/\/ler\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export const chapterReaderShell = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30, cors: false },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    const id = pathChapterId(req);
    if (!id) {
      res.redirect(302, `${getAppOrigin()}/works`);
      return;
    }

    const cacheKey = id;
    const now = Date.now();
    const hit = responseCache.get(cacheKey);
    if (hit && now - hit.at < RESPONSE_TTL_MS) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      res.status(200).send(hit.html);
      return;
    }

    try {
      let baseHtml;
      try {
        baseHtml = await fetchIndexHtml();
      } catch (e) {
        logger.error('chapterReaderShell fetchIndexHtml', e);
        res.redirect(302, `${getAppOrigin()}/`);
        return;
      }

      const snap = await getDatabase().ref(`capitulos/${id}`).get();
      const ch = snap.exists() ? snap.val() : null;
      const defaultOgImage = `${getAppOrigin()}/assets/fotos/shito.jpg`;

      const notFoundMeta = {
        title: 'Capítulo não encontrado | MangaTeofilo',
        description: 'Este capítulo não está disponível no MangaTeofilo.',
        canonical: `${getAppOrigin()}/ler/${encodeURIComponent(id)}`,
        image: defaultOgImage,
        imgAlt: 'MangaTeofilo',
        robots: 'noindex,follow',
        articleModifiedTime: null,
      };

      const meta = ch ? buildChapterMeta(id, ch) : notFoundMeta;
      const finalHtml = injectChapterSeo(baseHtml, meta);

      if (responseCache.size > MAX_CACHE) {
        responseCache.clear();
      }
      responseCache.set(cacheKey, { html: finalHtml, at: now });

      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      res.status(200).send(finalHtml);
    } catch (e) {
      logger.error('chapterReaderShell', e);
      res.redirect(302, `${getAppOrigin()}/`);
    }
  }
);
