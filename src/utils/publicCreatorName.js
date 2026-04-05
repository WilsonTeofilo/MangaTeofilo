import {
  PLATFORM_LEGACY_CREATOR_DISPLAY_NAME,
  PLATFORM_LEGACY_CREATOR_UID,
} from '../constants';
import { obraCreatorId, obterObraIdCapitulo } from '../config/obras';
import { normalizeUsernameInput, validateUsernameHandle } from './usernameValidation';
import {
  resolveCanonicalWorkCreator,
  resolveCreatorPublicProfileById,
  resolveEffectiveWorkCreatorId,
} from './workCreatorResolution';

/** Nomes de teste / legado tipo "Criador1", "criador 10", "user3" — não usar como nome público. */
export function isPlaceholderCreatorLabel(raw) {
  const s = String(raw || '').trim();
  if (s.length < 2) return true;
  if (/^criador\s*\d+$/i.test(s)) return true;
  if (/^user\s*\d+$/i.test(s)) return true;
  if (/^mangaka\s*\d+$/i.test(s)) return true;
  if (/^guerreiro$/i.test(s)) return true;
  return false;
}

function firstNonPlaceholder(candidates) {
  for (const c of candidates) {
    const v = String(c ?? '').trim();
    if (v && !isPlaceholderCreatorLabel(v)) return v;
  }
  return '';
}

function extractCreatorNameCandidatesFromChapters(chapters) {
  if (!Array.isArray(chapters) || !chapters.length) return [];
  const values = [];
  chapters.forEach((cap) => {
    values.push(
      cap?.creatorProfile?.displayName,
      cap?.creatorProfile?.username,
      cap?.creatorDisplayName,
      cap?.creatorUsername,
      cap?.creatorName,
      cap?.creatorHandle,
      cap?.userHandle,
      cap?.authorName,
      cap?.authorDisplayName,
      cap?.autor,
      cap?.autorNome,
      cap?.writerName,
      cap?.userName,
      cap?.displayName
    );
  });
  return values;
}

function looksLikeUid(raw) {
  const s = String(raw || '').trim();
  return /^[A-Za-z0-9]{20,40}$/.test(s);
}

function looksLikeGeneratedHandle(raw) {
  const s = normalizeUsernameInput(raw);
  return /^[a-z][a-z0-9_]*[_-][a-z0-9]{5,8}$/.test(s);
}

/** Handle público (@usuario) a partir de `usuarios_publicos` ou objeto equivalente. */
export function normalizePublicHandle(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const raw = String(
    p.userHandle || p.creatorProfile?.username || p.creatorUsername || p.username || ''
  )
    .trim();
  const handle = normalizeUsernameInput(raw);
  if (!handle) return '';
  if (looksLikeUid(handle)) return '';
  if (looksLikeGeneratedHandle(handle)) return '';
  if (!validateUsernameHandle(handle).ok) return '';
  return handle;
}

/**
 * Uma linha: «Nome (@handle)». Se só existe handle, mostra `@handle`.
 * Objetos de admin / callable costumam ter userName, creatorDisplayName, userHandle, creatorProfile.
 */
export function formatUserDisplayWithHandle(creatorPublicProfile) {
  const p = creatorPublicProfile && typeof creatorPublicProfile === 'object' ? creatorPublicProfile : {};
  const handle = normalizePublicHandle(p);
  const name = firstNonPlaceholder([
    p.creatorProfile?.displayName,
    p.creatorDisplayName,
    typeof p.displayName === 'string' ? p.displayName : null,
    p.userName,
    handle,
  ]);
  if (handle) {
    if (!name || name.toLowerCase() === handle.toLowerCase()) return `@${handle}`;
    return `${name} (@${handle})`;
  }
  return name || 'Leitor';
}

/** Alias para linhas de admin / pedidos quando o snapshot mistura campos de `usuarios` e `usuarios_publicos`. */
export function formatUserDisplayFromMixed(row) {
  return formatUserDisplayWithHandle(row && typeof row === 'object' ? row : {});
}

/**
 * Nome do autor para catálogo / home pública.
 * Com handle público, o identificador canônico é o @username (nome legado só como fallback).
 */
export function resolvePublicCreatorName({ creatorPublicProfile = null, obra = null, fallback = 'Autor' } = {}) {
  const p = creatorPublicProfile;
  const o = obra;
  const handle = normalizePublicHandle(p);
  if (handle) return handle;
  const resolved = firstNonPlaceholder([
    p?.creatorProfile?.displayName,
    p?.creatorDisplayName,
    typeof p?.displayName === 'string' ? p.displayName : null,
    p?.userHandle,
    p?.creatorUsername,
    p?.username,
    o?.creatorDisplayName,
    o?.creatorUsername,
    o?.creatorHandle,
    o?.userHandle,
    o?.creatorName,
    o?.authorName,
    o?.authorDisplayName,
    o?.autor,
    o?.autorNome,
    o?.writerName,
    o?.creatorProfile?.displayName,
    o?.creatorUsername,
    o?.username,
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
  const matchingCaps =
    allCapitulos && Array.isArray(allCapitulos)
      ? allCapitulos.filter((cap) => obterObraIdCapitulo(cap) === obraId)
      : [];
  const { creatorId, profile } = matchingCaps.length
    ? resolveCanonicalWorkCreator(obra, matchingCaps, creatorsMap)
    : {
        creatorId: String(obra?.creatorId || '').trim() || obraCreatorId(obra),
        profile: resolveCreatorPublicProfileById(
          creatorsMap,
          String(obra?.creatorId || '').trim() || obraCreatorId(obra)
        ),
      };
  const name = resolvePublicCreatorName({ creatorPublicProfile: profile, obra, fallback: '' });
  if (name) return name;
  const chapterName = firstNonPlaceholder(extractCreatorNameCandidatesFromChapters(matchingCaps));
  if (chapterName) return chapterName;
  const obraName = firstNonPlaceholder([
    obra?.creatorDisplayName,
    obra?.creatorUsername,
    obra?.creatorHandle,
    obra?.userHandle,
    obra?.creatorName,
    obra?.authorName,
    obra?.authorDisplayName,
    obra?.autor,
    obra?.autorNome,
    obra?.writerName,
    obra?.userName,
  ]);
  if (obraName) return obraName;
  if (String(creatorId) === PLATFORM_LEGACY_CREATOR_UID) return PLATFORM_LEGACY_CREATOR_DISPLAY_NAME;
  return 'Autor';
}

/**
 * Texto curto para listagens (home, catálogo): prioriza @username do perfil público.
 */
export function resolveCreatorFeedLabel(obra, creatorsMap, allCapitulos = null) {
  const obraId = String(obra?.id || '').toLowerCase();
  const matchingCaps =
    allCapitulos && Array.isArray(allCapitulos)
      ? allCapitulos.filter((cap) => obterObraIdCapitulo(cap) === obraId)
      : [];
  const creatorId =
    matchingCaps.length
      ? resolveEffectiveWorkCreatorId(obra, matchingCaps, creatorsMap)
      : String(obra?.creatorId || '').trim() || obraCreatorId(obra);
  const profile = resolveCreatorPublicProfileById(creatorsMap, creatorId);
  if (profile) {
    const line = formatUserDisplayWithHandle(profile);
    if (line && line !== 'Leitor') return line;
  }
  return resolveCreatorNameFromObra(obra, creatorsMap, allCapitulos);
}
