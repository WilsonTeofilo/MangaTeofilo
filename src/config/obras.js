export const OBRAS_SCHEMA_VERSION = 1;

export const OBRA_PADRAO_ID = 'shito';

export const OBRA_SHITO_DEFAULT = {
  id: OBRA_PADRAO_ID,
  slug: OBRA_PADRAO_ID,
  titulo: 'Shito: Fragmentos da Tempestade',
  tituloCurto: 'Shito',
  sinopse: '',
  status: 'ongoing',
  isPublished: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export function normalizarObraId(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return OBRA_PADRAO_ID;
  return v.replace(/[^a-z0-9_-]/g, '').slice(0, 40) || OBRA_PADRAO_ID;
}

export function obterObraIdCapitulo(capitulo) {
  return normalizarObraId(capitulo?.obraId);
}

export function capituloPertenceObra(capitulo, obraId = OBRA_PADRAO_ID) {
  return obterObraIdCapitulo(capitulo) === normalizarObraId(obraId);
}

export function buildChapterCampaignId(capId, obraId) {
  return `chapter_${normalizarObraId(obraId)}_${String(capId || '').slice(0, 80)}`;
}
