import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import { SITE_DEFAULT_IMAGE, SITE_NAME, SITE_ORIGIN } from '../config/site';

const SITE_URL = SITE_ORIGIN;
const DEFAULT_IMAGE_PATH = SITE_DEFAULT_IMAGE;
const NOINDEX_ROUTE_PREFIXES = ['/admin', '/creator/'];
const NOINDEX_EXACT_ROUTES = new Set(['/biblioteca', '/perfil', '/login', '/loja/carrinho', '/loja/pedidos', '/pedidos']);

function absUrl(pathOrUrl) {
  const raw = String(pathOrUrl || DEFAULT_IMAGE_PATH).trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SITE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function buildSeo(pathname) {
  const clean = pathname || '/';
  const defs = {
    title: `${SITE_NAME} | MangÃ¡s autorais em portuguÃªs`,
    description:
      'Leia mangÃ¡s autorais em portuguÃªs: ler mangÃ¡ online, capÃ­tulos gratuitos, obras autorais e atualizaÃ§Ãµes.',
    image: absUrl(DEFAULT_IMAGE_PATH),
    robots: 'index,follow,max-image-preview:large',
    ogType: 'website',
    jsonLdExtra: null,
  };

  if (clean === '/mangas' || clean === '/works') {
    return {
      ...defs,
      title: `Lista de mangÃ¡s | ${SITE_NAME}`,
      description:
        'CatÃ¡logo de mangÃ¡s autorais para ler online: capas, status, favoritos e novos capÃ­tulos â€” mobile e desktop.',
    };
  }

  if (clean.startsWith('/work/')) {
    const slugWork = decodeURIComponent(clean.split('/')[2] || '').trim() || 'Obra';
    return {
      ...defs,
      ogType: 'article',
      title: `${slugWork} | ${SITE_NAME}`,
      description: `Leia ${slugWork} online â€” mangÃ¡ autoral, capÃ­tulos e sinopse no ${SITE_NAME}.`,
    };
  }

  if (clean.startsWith('/ler/')) {
    return {
      ...defs,
      ogType: 'article',
      title: `Leitor de capÃ­tulo | ${SITE_NAME}`,
      description:
        'Leia capÃ­tulos de mangÃ¡ online no leitor oficial. Acesso antecipado quando o autor liberar para membros.',
    };
  }

  if (clean.startsWith('/criador/')) {
    return {
      ...defs,
      ogType: 'profile',
      title: `Perfil do criador | ${SITE_NAME}`,
      description: `ConheÃ§a o criador, obras e links no ${SITE_NAME}.`,
    };
  }

  if (clean === '/sobre-autor') {
    return {
      ...defs,
      title: `Sobre o autor | ${SITE_NAME}`,
      description: `ConheÃ§a o autor por trÃ¡s das obras do ${SITE_NAME}.`,
    };
  }

  if (clean === '/apoie' || clean.startsWith('/apoie/')) {
    return {
      ...defs,
      title: `Apoie a obra | ${SITE_NAME}`,
      description: `Apoie criadores e tenha benefÃ­cios â€” assinatura e doaÃ§Ãµes no ${SITE_NAME}.`,
    };
  }

  if (clean === '/premium') {
    return {
      ...defs,
      title: `Premium da plataforma | ${SITE_NAME}`,
      description: `Assine o Premium oficial da plataforma e libere os beneficios globais da sua conta no ${SITE_NAME}.`,
    };
  }

  if (clean === '/loja' || clean.startsWith('/loja/')) {
    return {
      ...defs,
      title: `Loja | ${SITE_NAME}`,
      description:
        'Produtos oficiais e vitrine MangaTeofilo. Autores: mangÃ¡ fÃ­sico e programa CREATORS a partir da loja.',
    };
  }

  if (clean === '/print-on-demand') {
    return {
      ...defs,
      title: `Lance sua linha | ${SITE_NAME}`,
      description:
        'Manga fisico (tankobon e meio-tankob): venda na loja com repasse, encomenda pessoal ou vitrine sem monetizacao. Novo autor? Programa CREATORS na MangaTeofilo.',
    };
  }

  if (NOINDEX_EXACT_ROUTES.has(clean) || NOINDEX_ROUTE_PREFIXES.some((prefix) => clean.startsWith(prefix))) {
    return {
      ...defs,
      robots: 'noindex,nofollow',
    };
  }

  return defs;
}

export default function SeoManager() {
  const { pathname } = useLocation();
  const cleanPath = pathname || '/';
  const seo = buildSeo(cleanPath);
  const canonical = `${SITE_URL}${cleanPath}`;

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: 'pt-BR',
    description: seo.description,
  };

  return (
    <Helmet prioritizeSeoTags>
      <html lang="pt-BR" />
      <title>{seo.title}</title>
      <meta name="description" content={seo.description} />
      <meta name="robots" content={seo.robots} />
      <meta name="theme-color" content="#0b1220" />

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={seo.ogType} />
      <meta property="og:title" content={seo.title} />
      <meta property="og:description" content={seo.description} />
      <meta property="og:image" content={seo.image} />
      <meta property="og:image:alt" content={seo.title} />
      <meta property="og:url" content={canonical} />
      <meta property="og:locale" content="pt_BR" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={seo.title} />
      <meta name="twitter:description" content={seo.description} />
      <meta name="twitter:image" content={seo.image} />
      <meta name="twitter:image:alt" content={seo.title} />

      <link rel="canonical" href={canonical} />

      <script type="application/ld+json">{JSON.stringify(websiteJsonLd)}</script>
    </Helmet>
  );
}
