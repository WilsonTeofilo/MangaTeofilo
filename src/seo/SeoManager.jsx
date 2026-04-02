import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';

const SITE_NAME = 'MangaTeofilo';
const SITE_URL = 'https://mangateofilo.com';
const DEFAULT_IMAGE_PATH = '/assets/fotos/shito.jpg';

function absUrl(pathOrUrl) {
  const raw = String(pathOrUrl || DEFAULT_IMAGE_PATH).trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SITE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function buildSeo(pathname) {
  const clean = pathname || '/';
  const slugFromPath = decodeURIComponent(clean.split('/')[2] || '').trim();

  const defs = {
    title: `${SITE_NAME} | Mangás autorais em português`,
    description:
      'Leia mangás autorais em português: ler mangá online, capítulos gratuitos, obras autorais e atualizações.',
    image: absUrl(DEFAULT_IMAGE_PATH),
    robots: 'index,follow,max-image-preview:large',
    ogType: 'website',
    jsonLdExtra: null,
  };

  if (clean === '/mangas' || clean === '/works') {
    return {
      ...defs,
      title: `Lista de mangás | ${SITE_NAME}`,
      description:
        'Catálogo de mangás autorais para ler online: capas, status, favoritos e novos capítulos — mobile e desktop.',
    };
  }

  if (clean.startsWith('/work/')) {
    const slugWork = decodeURIComponent(clean.split('/')[2] || '').trim() || 'Obra';
    return {
      ...defs,
      ogType: 'article',
      title: `${slugWork} | ${SITE_NAME}`,
      description: `Leia ${slugWork} online — mangá autoral, capítulos e sinopse no ${SITE_NAME}.`,
    };
  }

  if (clean.startsWith('/obra/')) {
    const obraNome = slugFromPath || 'Obra';
    return {
      ...defs,
      ogType: 'article',
      title: `${obraNome} | ${SITE_NAME}`,
      description: `Leia ${obraNome} online — capítulos e detalhes da obra no ${SITE_NAME}.`,
    };
  }

  if (clean.startsWith('/ler/')) {
    return {
      ...defs,
      ogType: 'article',
      title: `Leitor de capítulo | ${SITE_NAME}`,
      description:
        'Leia capítulos de mangá online no leitor oficial. Acesso antecipado quando o autor liberar para membros.',
    };
  }

  if (clean.startsWith('/criador/')) {
    const cid = decodeURIComponent(clean.split('/')[2] || '').trim() || 'Criador';
    return {
      ...defs,
      ogType: 'profile',
      title: `Perfil do criador | ${SITE_NAME}`,
      description: `Conheça o criador, obras e links no ${SITE_NAME}.`,
    };
  }

  if (clean === '/sobre-autor') {
    return {
      ...defs,
      title: `Sobre o autor | ${SITE_NAME}`,
      description: `Conheça o autor por trás das obras do ${SITE_NAME}.`,
    };
  }

  if (clean === '/apoie' || clean.startsWith('/apoie/')) {
    return {
      ...defs,
      title: `Apoie a obra | ${SITE_NAME}`,
      description: `Apoie criadores e tenha benefícios — assinatura e doações no ${SITE_NAME}.`,
    };
  }

  if (clean === '/loja' || clean.startsWith('/loja/')) {
    return {
      ...defs,
      title: `Loja | ${SITE_NAME}`,
      description: 'Produtos oficiais, pedidos e vitrine da loja MangaTeofilo.',
    };
  }

  if (
    clean === '/biblioteca' ||
    clean.startsWith('/admin') ||
    clean === '/perfil' ||
    clean === '/login' ||
    clean.startsWith('/creator/')
  ) {
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

      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={seo.ogType} />
      <meta property="og:title" content={seo.title} />
      <meta property="og:description" content={seo.description} />
      <meta property="og:image" content={seo.image} />
      <meta property="og:url" content={canonical} />
      <meta property="og:locale" content="pt_BR" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={seo.title} />
      <meta name="twitter:description" content={seo.description} />
      <meta name="twitter:image" content={seo.image} />

      <link rel="canonical" href={canonical} />

      <script type="application/ld+json">{JSON.stringify(websiteJsonLd)}</script>
    </Helmet>
  );
}
