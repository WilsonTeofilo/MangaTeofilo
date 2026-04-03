import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SITE_URL = (process.env.SITE_URL || 'https://mangateofilo.com').replace(/\/+$/, '');
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://shitoproject-ed649-default-rtdb.firebaseio.com';

const STATIC_ROUTES = ['/', '/works', '/mangas', '/sobre-autor', '/apoie', '/loja', '/print-on-demand', '/creators'];

function toIso(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return new Date().toISOString();
  return new Date(ms).toISOString();
}

function xmlEscape(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function getJson(endpoint) {
  const res = await fetch(`${DATABASE_URL}/${endpoint}.json`);
  if (!res.ok) throw new Error(`Falha ao baixar ${endpoint}: ${res.status}`);
  return res.json();
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

const OBRA_PADRAO_ID = 'shito';

/** Espelha `obraSegmentoUrlPublica` em `src/config/obras.js` para URLs do sitemap. */
function obraSegmentoUrlPublica(obra) {
  const id = String(obra?.id || '').trim().toLowerCase();
  const slugS = slugifyObraSlug(String(obra?.slug || '').trim());
  const titleS = slugifyObraSlug(String(obra?.titulo || '').trim());
  if (id === OBRA_PADRAO_ID) return titleS || slugS || id;
  if (slugS && slugS !== id) return slugS;
  return titleS || slugS || id || OBRA_PADRAO_ID;
}

function chapterLastmod(cap) {
  const a = Number(cap?.publicReleaseAt);
  if (Number.isFinite(a) && a > 0) return a;
  const b = Date.parse(cap?.dataUpload || '');
  if (Number.isFinite(b) && b > 0) return b;
  return Date.now();
}

async function main() {
  const [obrasRaw, capsRaw, publicosRaw] = await Promise.all([
    getJson('obras').catch(() => null),
    getJson('capitulos').catch(() => null),
    getJson('usuarios_publicos').catch(() => null),
  ]);

  const obras = Object.entries(obrasRaw || {})
    .map(([id, data]) => ({ id, ...(data || {}) }))
    .filter((obra) => obra?.isPublished === true);
  if (obras.length === 0) {
    obras.push({
      id: 'shito',
      slug: 'kokuin-heranca-do-abismo',
      titulo: 'Kokuin : Heranca do Abismo',
      updatedAt: Date.now(),
      isPublished: true,
    });
  }

  const capitulos = Object.entries(capsRaw || {}).map(([id, data]) => ({ id, ...(data || {}) }));
  const obraIds = new Set(obras.map((o) => String(o.id || '').toLowerCase()));
  const capitulosPublicos = capitulos.filter((cap) => {
    const obraId = String(cap?.workId || cap?.obraId || 'shito').toLowerCase();
    return obraIds.has(obraId);
  });

  const urls = [];

  STATIC_ROUTES.forEach((route) => {
    urls.push({
      loc: `${SITE_URL}${route}`,
      lastmod: toIso(Date.now()),
      changefreq: route === '/' ? 'daily' : 'weekly',
      priority: route === '/' ? '1.0' : '0.7',
    });
  });

  obras.forEach((obra) => {
    const seg = encodeURIComponent(obraSegmentoUrlPublica(obra));
    urls.push({
      loc: `${SITE_URL}/work/${seg}`,
      lastmod: toIso(Number(obra?.updatedAt || obra?.createdAt || Date.now())),
      changefreq: 'daily',
      priority: '0.9',
    });
  });

  capitulosPublicos.forEach((cap) => {
    urls.push({
      loc: `${SITE_URL}/ler/${encodeURIComponent(cap.id)}`,
      lastmod: toIso(chapterLastmod(cap)),
      changefreq: 'weekly',
      priority: '0.8',
    });
  });

  const perfisPublicos = Object.entries(publicosRaw || {});
  let criadoresNoMapa = 0;
  const maxCriadoresSitemap = 200;
  for (const [uid, row] of perfisPublicos) {
    if (criadoresNoMapa >= maxCriadoresSitemap) break;
    const u = String(uid || '').trim();
    if (!u || u.length < 8) continue;
    if (String(row?.creatorStatus || '').trim().toLowerCase() !== 'active') continue;
    urls.push({
      loc: `${SITE_URL}/criador/${encodeURIComponent(u)}`,
      lastmod: toIso(Number(row?.updatedAt || Date.now())),
      changefreq: 'weekly',
      priority: '0.65',
    });
    criadoresNoMapa += 1;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${xmlEscape(u.loc)}</loc>
    <lastmod>${xmlEscape(u.lastmod)}</lastmod>
    <changefreq>${xmlEscape(u.changefreq)}</changefreq>
    <priority>${xmlEscape(u.priority)}</priority>
  </url>`).join('\n')}
</urlset>
`;

  const publicDir = path.resolve(process.cwd(), 'public');
  await writeFile(path.join(publicDir, 'sitemap.xml'), xml, 'utf8');
  await writeFile(
    path.join(publicDir, 'robots.txt'),
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /creator',
      'Disallow: /perfil',
      'Disallow: /login',
      'Disallow: /biblioteca',
      'Disallow: /loja/carrinho',
      'Disallow: /loja/pedidos',
      `Sitemap: ${SITE_URL}/sitemap.xml`,
      '',
    ].join('\n'),
    'utf8'
  );

  console.log(`Sitemap gerado com ${urls.length} URLs.`);
}

main().catch((err) => {
  console.error('[sitemap] erro:', err.message);
  process.exitCode = 1;
});
