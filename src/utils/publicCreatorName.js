import { obraCreatorId, obterObraIdCapitulo } from '../config/obras';
import { normalizeUsernameInput, validateUsernameHandle } from './usernameValidation';
import { resolvePublicProfileAvatarUrl, resolvePublicProfileDisplayName } from './publicUserProfile';
import { resolvePublicProfilePath } from './publicProfilePaths';
import {
  resolveCanonicalWorkCreator,
  resolveCreatorPublicProfileById,
  resolveEffectiveWorkCreatorId,
} from './workCreatorResolution';

/** Nomes de teste / legado tipo "Criador1", "criador 10", "user3" â€” nÃ£o usar como nome pÃºblico. */
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

function publicRowShape(profile) {
  if (profile?.publicProfile && typeof profile.publicProfile === 'object') {
    return profile.publicProfile;
  }
  return profile && typeof profile === 'object' ? profile : {};
}
/** Handle publico (@usuario) a partir do `publicProfile` canonico ou objeto equivalente. */
export function normalizePublicHandle(profile) {
  const p = publicRowShape(profile);
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
 * Uma linha: Â«Nome (@handle)Â». Se sÃ³ existe handle, mostra `@handle`.
 * Objetos de admin / callable costumam ter userName, creatorDisplayName, userHandle, creatorProfile.
 */
export function formatUserDisplayWithHandle(creatorPublicProfile, fallback = 'Leitor') {
  const p = publicRowShape(creatorPublicProfile);
  const handle = normalizePublicHandle(p);
  const name = firstNonPlaceholder([
    resolvePublicProfileDisplayName(p, ''),
    handle,
  ]);
  if (handle) {
    if (!name || name.toLowerCase() === handle.toLowerCase()) return `@${handle}`;
    return `${name} (@${handle})`;
  }
  return name || fallback;
}

/** Alias para linhas de admin / pedidos quando o snapshot mistura campos do usuario e do perfil publico. */
export function formatUserDisplayFromMixed(row) {
  return formatUserDisplayWithHandle(row && typeof row === 'object' ? row : {});
}

/**
 * Nome do autor para catÃ¡logo / home pÃºblica.
 * Com handle pÃºblico, o identificador canÃ´nico Ã© o @username (nome legado sÃ³ como fallback).
 */
export function resolvePublicCreatorName({ creatorPublicProfile = null, obra = null, fallback = 'Autor' } = {}) {
  const p = creatorPublicProfile;
  const o = obra;
  const formattedLine = formatUserDisplayWithHandle(p, '');
  if (formattedLine) return formattedLine;
  const resolved = firstNonPlaceholder([
    resolvePublicProfileDisplayName(p, ''),
    p?.userHandle,
    p?.creatorUsername,
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
  ]);
  return resolved || fallback;
}

/**
 * Resolve o nome publico do criador para uma obra.
 * `creatorsMap` deve ser derivado do perfil publico canonico em `usuarios`.
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
  return 'Autor';
}

/**
 * Texto curto para listagens (home, catÃ¡logo): prioriza @username do perfil pÃºblico.
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

export function resolvePublicCreatorIdentity(obra, creatorsMap, allCapitulos = null) {
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

  let label = resolvePublicCreatorName({ creatorPublicProfile: profile, obra, fallback: 'Autor' });
  if (!label || label === 'Leitor') {
    label = resolveCreatorNameFromObra(obra, creatorsMap, allCapitulos);
  }
  if (!label || label === 'Leitor') {
    label = 'Autor';
  }

  return {
    creatorId,
    profile,
    label,
    handle: normalizePublicHandle(profile),
    avatarUrl: resolvePublicProfileAvatarUrl(profile, {
      mode: 'creator',
      fallback: '/assets/fotos/shito.jpg',
    }),
    path: resolvePublicProfilePath(profile, creatorId, { tab: 'works' }),
  };
}

