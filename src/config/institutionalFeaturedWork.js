export const INSTITUTIONAL_FEATURED_WORK_ID = 'shito';
export const INSTITUTIONAL_FEATURED_WORK_SLUG = 'kokuin-heranca-do-abismo';

export const INSTITUTIONAL_FEATURED_WORK_FALLBACK = {
  id: INSTITUTIONAL_FEATURED_WORK_ID,
  slug: INSTITUTIONAL_FEATURED_WORK_SLUG,
  titulo: 'Kokuin: Heranca do Abismo',
  tituloCurto: 'Kokuin',
  sinopse:
    'Em um mundo marcado por reliquias ancestrais e conflitos silenciosos, Kokuin segue como a obra fundadora que apresenta a visao da MangaTeofilo para autores e leitores.',
  bannerUrl: '/assets/fotos/shito.jpg',
  capaUrl: '/assets/fotos/shito.jpg',
  status: 'ongoing',
  isPublished: true,
};

function normalizeWorkKey(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function isInstitutionalFeaturedWork(obra) {
  if (!obra || typeof obra !== 'object') return false;
  const id = normalizeWorkKey(obra.id);
  const slug = normalizeWorkKey(obra.slug);
  const title = normalizeWorkKey(obra.titulo || obra.title);
  return (
    id === INSTITUTIONAL_FEATURED_WORK_ID ||
    slug === INSTITUTIONAL_FEATURED_WORK_SLUG ||
    title.includes('kokuin')
  );
}

export function buildInstitutionalFeaturedWork(works = []) {
  const list = Array.isArray(works) ? works : [];
  const live = list.find((obra) => isInstitutionalFeaturedWork(obra));
  if (live) {
    return {
      ...INSTITUTIONAL_FEATURED_WORK_FALLBACK,
      ...live,
      id: String(live.id || INSTITUTIONAL_FEATURED_WORK_ID).trim() || INSTITUTIONAL_FEATURED_WORK_ID,
      slug:
        String(live.slug || INSTITUTIONAL_FEATURED_WORK_SLUG).trim() ||
        INSTITUTIONAL_FEATURED_WORK_SLUG,
    };
  }
  return { ...INSTITUTIONAL_FEATURED_WORK_FALLBACK };
}
