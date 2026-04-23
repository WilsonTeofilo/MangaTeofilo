import { obterObraIdCapitulo, resolveObraAuthorState } from '../config/obras';
import { normalizeUsernameInput, validateUsernameHandle } from './usernameValidation';
import { resolvePublicProfileAvatarUrl, resolvePublicProfileDisplayName } from './publicUserProfile';
import { resolvePublicProfilePath } from './publicProfilePaths';
import {
  resolveCreatorPublicProfileById,
} from './workCreatorResolution';

/** Nomes de teste / legado tipo "Criador1", "criador 10", "user3" �?" não usar como nome público. */
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

function buildPublicCreatorLookupByUid(creatorsMap = {}) {
  const entries = Object.entries(creatorsMap || {});
  if (!entries.length) return {};
  const out = {};
  entries.forEach(([uid, profile]) => {
    const p = publicRowShape(profile);
    const normalizedUid = String(uid || p?.uid || '').trim();
    if (!normalizedUid) return;
    const handle = normalizePublicHandle(p);
    const displayName = firstNonPlaceholder([
      resolvePublicProfileDisplayName(p, ''),
      handle ? `@${handle}` : '',
    ]);
    out[normalizedUid] = {
      uid: normalizedUid,
      handle,
      displayName: displayName || '',
      avatarUrl: resolvePublicProfileAvatarUrl(p, {
        mode: 'creator',
        fallback: '/assets/avatares/ava1.webp',
      }),
      profile: p,
    };
  });
  return out;
}

function resolvePublicWorkAuthorState(obra, creatorsMap, allCapitulos = null) {
  const obraId = String(obra?.id || '').toLowerCase();
  const matchingCaps =
    allCapitulos && Array.isArray(allCapitulos)
      ? allCapitulos.filter((cap) => obterObraIdCapitulo(cap) === obraId)
      : [];
  const creatorLookupByUid = buildPublicCreatorLookupByUid(creatorsMap);
  return {
    matchingCaps,
    creatorLookupByUid,
    ...resolveObraAuthorState(obra, {
      creatorLookupByUid,
      chapterRows: matchingCaps,
    }),
  };
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
 * Uma linha: «Nome (@handle)». Se só existe handle, mostra `@handle`.
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
 * Nome do autor para catálogo / home pública.
 * Com handle público, o identificador canônico é o @username (nome legado só como fallback).
 */
export function resolvePublicCreatorName({ creatorPublicProfile = null, obra = null, fallback = 'Autor' } = {}) {
  const p = creatorPublicProfile;
  const o = obra;
  const formattedLine = formatUserDisplayWithHandle(p, '');
  if (formattedLine) return formattedLine;
  const resolved = firstNonPlaceholder([
    resolvePublicProfileDisplayName(p, ''),
    p?.userHandle,
    p?.creatorProfile?.username,
    p?.creatorUsername,
    o?.creatorProfile?.displayName,
    o?.creatorProfile?.username,
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
  const author = resolvePublicWorkAuthorState(obra, creatorsMap, allCapitulos);
  if (author.authorState === 'linked') {
    if (author.creatorHandle) return `@${author.creatorHandle}`;
    if (author.creatorDisplayName) return author.creatorDisplayName;
  }
  if (author.authorState === 'removed') return 'Autor removido';
  if (author.authorState === 'unassigned') return 'Sem autor vinculado';
  return 'Autor';
}

/**
 * Texto curto para listagens (home, catálogo): prioriza @username do perfil público.
 */
export function resolveCreatorFeedLabel(obra, creatorsMap, allCapitulos = null) {
  const author = resolvePublicWorkAuthorState(obra, creatorsMap, allCapitulos);
  if (author.authorState === 'linked') {
    if (author.creatorHandle) return `@${author.creatorHandle}`;
    if (author.creatorDisplayName) return author.creatorDisplayName;
  }
  if (author.authorState === 'removed') return 'Autor removido';
  if (author.authorState === 'unassigned') return 'Sem autor vinculado';
  return 'Autor';
}

export function resolvePublicCreatorIdentity(obra, creatorsMap, allCapitulos = null) {
  const author = resolvePublicWorkAuthorState(obra, creatorsMap, allCapitulos);
  const linkedProfile =
    author.authorState === 'linked'
      ? resolveCreatorPublicProfileById(creatorsMap, author.creatorId) ||
        author.creatorLookupByUid?.[author.creatorId]?.profile ||
        null
      : null;
  const handle = author.authorState === 'linked' ? String(author.creatorHandle || '').trim() : '';
  const label =
    author.authorState === 'linked'
      ? (handle ? `@${handle}` : author.creatorDisplayName || 'Autor')
      : author.authorState === 'removed'
        ? 'Autor removido'
        : 'Sem autor vinculado';
  const creatorId = author.authorState === 'linked' ? String(author.creatorId || '').trim() : '';
  return {
    authorState: author.authorState,
    creatorId,
    profile: linkedProfile,
    label,
    handle,
    avatarUrl:
      author.authorState === 'linked'
        ? resolvePublicProfileAvatarUrl(linkedProfile, {
            mode: 'creator',
            fallback: '/assets/avatares/ava1.webp',
          })
        : '/assets/avatares/ava1.webp',
    path:
      author.authorState === 'linked' && linkedProfile
        ? resolvePublicProfilePath(linkedProfile, creatorId, { tab: 'works' })
        : '',
  };
}

