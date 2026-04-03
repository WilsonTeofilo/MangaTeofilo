import { obraCreatorId, obterObraIdCapitulo } from '../config/obras';
import { resolveEffectiveWorkCreatorId } from './workCreatorResolution';

/** Nomes de teste / legado tipo "Criador1", "criador 10", "user3" — não usar como nome público. */
export function isPlaceholderCreatorLabel(raw) {
  const s = String(raw || '').trim();
  if (s.length < 2) return true;
  if (/^criador\s*\d+$/i.test(s)) return true;
  if (/^user\s*\d+$/i.test(s)) return true;
  if (/^mangaka\s*\d+$/i.test(s)) return true;
  return false;
}

function firstNonPlaceholder(candidates) {
  for (const c of candidates) {
    const v = String(c ?? '').trim();
    if (v && !isPlaceholderCreatorLabel(v)) return v;
  }
  return '';
}

/**
 * Nome do autor para catálogo / home pública.
 * Prioriza nome artístico (perfil criador) e ignora userName placeholder.
 */
export function resolvePublicCreatorName({ creatorPublicProfile = null, obra = null, fallback = 'Autor' } = {}) {
  const p = creatorPublicProfile;
  const o = obra;
  const resolved = firstNonPlaceholder([
    p?.creatorProfile?.displayName,
    p?.creatorDisplayName,
    typeof p?.displayName === 'string' ? p.displayName : null,
    o?.creatorDisplayName,
    o?.creatorName,
    p?.userName,
  ]);
  return resolved || fallback;
}

/**
 * @param {object} obra
 * @param {Record<string, object>|null} creatorsMap - snapshot de `usuarios_publicos`
 * @param {object[]|null} [allCapitulos] - quando informado, infere UID do autor pelos capítulos
 *   se `obra.creatorId` estiver vazio ou for o UID legado da plataforma.
 */
export function resolveCreatorNameFromObra(obra, creatorsMap, allCapitulos = null) {
  const obraId = String(obra?.id || '').toLowerCase();
  const creatorId =
    allCapitulos && Array.isArray(allCapitulos)
      ? resolveEffectiveWorkCreatorId(
          obra,
          allCapitulos.filter((cap) => obterObraIdCapitulo(cap) === obraId)
        )
      : String(obra?.creatorId || '').trim() || obraCreatorId(obra);
  const profile =
    creatorsMap && creatorId ? creatorsMap[creatorId] || creatorsMap[String(creatorId).trim()] || null : null;
  return resolvePublicCreatorName({ creatorPublicProfile: profile, obra, fallback: 'Autor' });
}
