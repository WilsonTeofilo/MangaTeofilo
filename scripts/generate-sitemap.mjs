import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SITE_URL = (process.env.SITE_URL || 'https://mangateofilo.com').replace(/\/+$/, '');
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://shitoproject-ed649-default-rtdb.firebaseio.com';

const STATIC_ROUTES = ['/', '/works', '/mangas', '/sobre-autor', '/apoie', '/loja'];

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

function chapterLastmod(cap) {
  const a = Number(cap?.publicReleaseAt);
  if (Number.isFinite(a) && a > 0) return a;
  const b = Date.parse(cap?.dataUpload || '');
  if (Number.isFinite(b) && b > 0) return b;
  return Date.now();
}

async function main() {
  const [obrasRaw, capsRaw] = await Promise.all([
    getJson('obras').catch(() => null),
    getJson('capitulos').catch(() => null),
  ]);

  const obras = Object.entries(obrasRaw || {})
    .map(([id, data]) => ({ id, ...(data || {}) }))
    .filter((obra) => obra?.isPublished === true);
  if (obras.length === 0) {
    obras.push({
      id: 'shito',
      titulo: 'Shito: Fragmentos da Tempestade',
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
    const slug = encodeURIComponent(String(obra.slug || obra.id || '').trim() || obra.id);
    urls.push({
      loc: `${SITE_URL}/work/${slug}`,
      lastmod: toIso(Number(obra?.updatedAt || obra?.createdAt || Date.now())),
      changefreq: 'daily',
      priority: '0.9',
    });
    urls.push({
      loc: `${SITE_URL}/obra/${encodeURIComponent(obra.id)}`,
      lastmod: toIso(Number(obra?.updatedAt || obra?.createdAt || Date.now())),
      changefreq: 'weekly',
      priority: '0.75',
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
    `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`,
    'utf8'
  );

  // eslint-disable-next-line no-console
  console.log(`Sitemap gerado com ${urls.length} URLs.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[sitemap] erro:', err.message);
  process.exitCode = 1;
});

