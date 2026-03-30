import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SITE_NAME = 'MangaTeofilo';
const SITE_URL = 'https://mangateofilo.com';
const DEFAULT_IMAGE = '/assets/fotos/shito.jpg';

function upsertMeta(selector, attr, value) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  const [k, v] = attr;
  el.setAttribute(k, v);
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

function upsertJsonLd(id, data) {
  let el = document.head.querySelector(`script[data-seo="${id}"]`);
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.setAttribute('data-seo', id);
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

function buildSeo(pathname) {
  const slugFromPath = decodeURIComponent(pathname.split('/')[2] || '').trim();

  const defs = {
    title: `${SITE_NAME} | Mangás autorais em português`,
    description: 'Leia mangás autorais de Teófilo em uma plataforma única: capítulos, obras, favoritos e atualizações.',
    image: DEFAULT_IMAGE,
    robots: 'index,follow,max-image-preview:large',
    type: 'website',
  };

  if (pathname === '/mangas') {
    return {
      ...defs,
      title: `Lista de Mangás | ${SITE_NAME}`,
      description: 'Explore o catálogo de obras autorais, veja status, novidades e favorite seus mangás.',
    };
  }

  if (pathname.startsWith('/obra/')) {
    const obraNome = slugFromPath || 'Obra';
    return {
      ...defs,
      type: 'article',
      title: `${obraNome} | ${SITE_NAME}`,
      description: `Leia capítulos, sinopse e novidades da obra ${obraNome} no ${SITE_NAME}.`,
    };
  }

  if (pathname.startsWith('/ler/')) {
    return {
      ...defs,
      type: 'article',
      title: `Leitor de Capítulos | ${SITE_NAME}`,
      description: 'Acompanhe capítulos lançados e leitura premium no leitor oficial.',
    };
  }

  if (pathname === '/capitulos') {
    return {
      ...defs,
      title: `Biblioteca de Capítulos | ${SITE_NAME}`,
      description: 'Veja todos os capítulos disponíveis, datas e acesso premium antecipado.',
    };
  }

  if (pathname === '/loja' || pathname.startsWith('/loja/produto/')) {
    return {
      ...defs,
      title: `Loja Física | ${SITE_NAME}`,
      description: 'Compre produtos físicos oficiais e acompanhe seus pedidos na Loja do MangaTeofilo.',
    };
  }

  if (pathname === '/biblioteca' || pathname.startsWith('/admin') || pathname === '/perfil' || pathname === '/login') {
    return {
      ...defs,
      robots: 'noindex,nofollow',
    };
  }

  return defs;
}

export default function SeoManager() {
  const { pathname } = useLocation();

  useEffect(() => {
    const cleanPath = pathname || '/';
    const seo = buildSeo(cleanPath);
    const canonical = `${SITE_URL}${cleanPath}`;

    document.title = seo.title;

    upsertMeta('meta[name="description"]', ['name', 'description'], seo.description);
    upsertMeta('meta[name="robots"]', ['name', 'robots'], seo.robots);

    upsertMeta('meta[property="og:site_name"]', ['property', 'og:site_name'], SITE_NAME);
    upsertMeta('meta[property="og:type"]', ['property', 'og:type'], seo.type);
    upsertMeta('meta[property="og:title"]', ['property', 'og:title'], seo.title);
    upsertMeta('meta[property="og:description"]', ['property', 'og:description'], seo.description);
    upsertMeta('meta[property="og:image"]', ['property', 'og:image'], seo.image);
    upsertMeta('meta[property="og:url"]', ['property', 'og:url'], canonical);

    upsertMeta('meta[name="twitter:card"]', ['name', 'twitter:card'], 'summary_large_image');
    upsertMeta('meta[name="twitter:title"]', ['name', 'twitter:title'], seo.title);
    upsertMeta('meta[name="twitter:description"]', ['name', 'twitter:description'], seo.description);
    upsertMeta('meta[name="twitter:image"]', ['name', 'twitter:image'], seo.image);

    upsertLinkRel('canonical', canonical);

    upsertJsonLd('website', {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${SITE_URL}/mangas`,
        'query-input': 'required name=query',
      },
    });

    if (cleanPath.startsWith('/obra/')) {
      const obraNome = decodeURIComponent(cleanPath.split('/')[2] || 'obra');
      upsertJsonLd('obra', {
        '@context': 'https://schema.org',
        '@type': 'CreativeWorkSeries',
        name: obraNome,
        url: canonical,
        inLanguage: 'pt-BR',
      });
    } else {
      const old = document.head.querySelector('script[data-seo="obra"]');
      if (old) old.remove();
    }
  }, [pathname]);

  return null;
}

