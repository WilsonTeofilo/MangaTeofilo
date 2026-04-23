import { perfilCanOwnWorks } from '../auth/appRoles';
import { buildPublicProfileFromUsuarioRow } from './publicUserProfile';
import { resolveCanonicalPublicHandle } from './canonicalIdentity';
import { normalizeUsernameInput } from './usernameValidation';

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function usuarioTemBanAtivo(usuario) {
  const moderation = asObject(usuario?.moderation);
  if (moderation?.isBanned !== true) return false;
  const expiresAt = Number(moderation?.currentBanExpiresAt || 0);
  if (expiresAt > 0 && expiresAt <= Date.now()) return false;
  return true;
}

function mergeCreatorRows(usuarioRow = {}, usuarioPublicoRow = {}) {
  const usuario = asObject(usuarioRow);
  const usuarioPublico = asObject(usuarioPublicoRow);
  return {
    ...usuarioPublico,
    ...usuario,
    publicProfile: {
      ...usuarioPublico,
      ...asObject(usuario?.publicProfile),
    },
  };
}

function normalizeDirectoryUid(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value || '').trim();
  }
  if (value && typeof value === 'object') {
    const candidates = [value.uid, value.userId, value.creatorId, value.id, value.value];
    for (const candidate of candidates) {
      const normalized = String(candidate || '').trim();
      if (normalized) return normalized;
    }
  }
  return '';
}

function normalizeSearchValue(value) {
  return String(value || '').trim().toLowerCase();
}

function writerStatusFromRow(usuario = {}) {
  const row = asObject(usuario);
  const publicProfile = asObject(row.publicProfile);
  return {
    accountStatus: normalizeSearchValue(row.status || publicProfile.status),
    creatorStatus: normalizeSearchValue(row.creatorStatus || publicProfile.creatorStatus),
    creatorApplicationStatus: normalizeSearchValue(
      row.creatorApplicationStatus || publicProfile.creatorApplicationStatus
    ),
    signupIntent: normalizeSearchValue(row.signupIntent || publicProfile.signupIntent),
    accountType: normalizeSearchValue(row.accountType || publicProfile.accountType),
    role: normalizeSearchValue(row.role || publicProfile.role),
    panelRole: normalizeSearchValue(row.panelRole || publicProfile.panelRole),
  };
}

function buildEntrySearchTokens(entry = {}) {
  const tokens = new Set();
  const addToken = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return;
    tokens.add(raw.toLowerCase());
    const compact = normalizeUsernameInput(raw);
    if (compact) tokens.add(compact.toLowerCase());
  };

  addToken(entry.uid);
  addToken(entry.handle);
  addToken(entry.displayName);
  addToken(entry.optionLabel);
  (Array.isArray(entry.aliases) ? entry.aliases : []).forEach(addToken);
  return [...tokens];
}

export function usuarioPodeSerAutorAdmin(row, creatorsRow = null, usuarioPublicoRow = null) {
  const usuario = mergeCreatorRows(row, usuarioPublicoRow);
  const creatorNode = asObject(creatorsRow);
  const writerState = writerStatusFromRow(usuario);
  if (usuarioTemBanAtivo(usuario)) return false;
  if (writerState.accountStatus === 'deletado' || writerState.accountStatus === 'deleted') return false;
  if (perfilCanOwnWorks(usuario, { creatorsRow: creatorNode })) return true;
  if (!usuario || Object.keys(usuario).length === 0) return false;
  const publicProfile = buildPublicProfileFromUsuarioRow(usuario);
  if (publicProfile?.isCreatorProfile === true) return true;
  if (writerState.creatorApplicationStatus === 'approved') return true;
  if (writerState.creatorStatus === 'active' || writerState.creatorStatus === 'onboarding') return true;
  if (writerState.role === 'mangaka' || writerState.panelRole === 'mangaka') return true;
  if (writerState.signupIntent === 'creator') return true;
  if (writerState.accountType === 'writer' || writerState.accountType === 'creator') return true;
  if (Object.keys(creatorNode).length > 0) return true;
  return false;
}

export function buildAdminCreatorDirectory({
  usernames = {},
  usuarios = {},
  usuariosPublicos = {},
  creators = {},
} = {}) {
  const directoryByUid = new Map();

  const upsert = (uid, source = {}) => {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid) return;
    const usuarioRow = asObject(usuarios?.[normalizedUid]);
    const usuarioPublicoRow = asObject(usuariosPublicos?.[normalizedUid]);
    const creatorsRow = asObject(creators?.[normalizedUid]);
    if (!usuarioPodeSerAutorAdmin(usuarioRow, creatorsRow, usuarioPublicoRow)) return;

    const mergedRow = mergeCreatorRows(usuarioRow, usuarioPublicoRow);
    const publicProfile = buildPublicProfileFromUsuarioRow(mergedRow, normalizedUid);
    const canonicalHandle = resolveCanonicalPublicHandle({
      ...mergedRow,
      creatorUsername: mergedRow?.creatorUsername || creatorsRow?.profile?.username || creatorsRow?.username || '',
      creator: {
        ...asObject(mergedRow?.creator),
        ...asObject(usuarioRow?.creator),
        profile: {
          ...asObject(creatorsRow?.profile),
          ...asObject(mergedRow?.creator?.profile),
          ...asObject(usuarioRow?.creator?.profile),
        },
      },
      publicProfile: {
        ...asObject(usuarioPublicoRow),
        ...asObject(mergedRow?.publicProfile),
      },
    });

    const handle = normalizeUsernameInput(
      source.handle ||
        canonicalHandle ||
        publicProfile?.userHandle ||
        publicProfile?.creatorUsername ||
        publicProfile?.creatorProfile?.username ||
        creatorsRow?.profile?.username ||
        creatorsRow?.username ||
        usuarioPublicoRow?.userHandle ||
        usuarioPublicoRow?.username ||
        usuarioRow?.userHandle ||
        usuarioRow?.username ||
        ''
    );

    const accountStatus = normalizeSearchValue(
      mergedRow?.status || usuarioPublicoRow?.status || usuarioRow?.status
    );
    if (accountStatus === 'deletado' || accountStatus === 'deleted') return;

    const displayName = String(
      source.displayName ||
        publicProfile?.creatorDisplayName ||
        mergedRow?.creatorDisplayName ||
        mergedRow?.publicProfile?.creatorDisplayName ||
        publicProfile?.creatorProfile?.displayName ||
        publicProfile?.userName ||
        usuarioPublicoRow?.creatorDisplayName ||
        usuarioPublicoRow?.userName ||
        (handle ? `@${handle}` : normalizedUid)
    ).trim();

    const avatarUrl = String(
      source.avatarUrl ||
        publicProfile?.creatorProfile?.avatarUrl ||
        publicProfile?.userAvatar ||
        publicProfile?.readerProfileAvatarUrl ||
        mergedRow?.creatorAvatarUrl ||
        usuarioPublicoRow?.userAvatar ||
        usuarioPublicoRow?.readerProfileAvatarUrl ||
        ''
    ).trim();

    const aliases = [
      handle ? `@${handle}` : '',
      source.handle,
      source.displayName,
      publicProfile?.userHandle,
      publicProfile?.creatorUsername,
      publicProfile?.creatorProfile?.username,
      publicProfile?.creatorDisplayName,
      publicProfile?.userName,
      mergedRow?.creatorDisplayName,
      mergedRow?.userName,
      mergedRow?.creatorUsername,
      mergedRow?.userHandle,
      mergedRow?.publicProfile?.creatorDisplayName,
      mergedRow?.publicProfile?.creatorUsername,
      usuarioPublicoRow?.userHandle,
      usuarioPublicoRow?.creatorUsername,
      usuarioPublicoRow?.username,
      usuarioPublicoRow?.userName,
      usuarioPublicoRow?.creatorDisplayName,
      usuarioRow?.userHandle,
      usuarioRow?.creatorUsername,
      usuarioRow?.username,
      usuarioRow?.userName,
      usuarioRow?.creatorDisplayName,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    const optionLabel = handle ? `@${handle}` : normalizedUid;

    const nextEntry = {
      uid: normalizedUid,
      handle,
      displayName,
      avatarUrl,
      isCreator: true,
      optionLabel,
      aliases,
      sourceKind: source.sourceKind || (Object.keys(creatorsRow).length ? 'creator' : 'profile'),
    };

    directoryByUid.set(normalizedUid, {
      ...nextEntry,
      searchTokens: buildEntrySearchTokens(nextEntry),
    });
  };

  Object.entries(usernames || {}).forEach(([handleKey, uidValue]) => {
    const normalizedUid = normalizeDirectoryUid(uidValue);
    if (!normalizedUid) return;
    upsert(normalizedUid, {
      handle: normalizeUsernameInput(handleKey),
      displayName: normalizeUsernameInput(handleKey) ? `@${normalizeUsernameInput(handleKey)}` : '',
      sourceKind: 'username_index',
    });
  });

  Object.keys(usuarios || {}).forEach((uid) => {
    upsert(uid);
  });

  Object.keys(usuariosPublicos || {}).forEach((uid) => {
    upsert(uid);
  });

  Object.keys(creators || {}).forEach((uid) => {
    upsert(uid);
  });

  const list = [...directoryByUid.values()].sort((a, b) =>
    {
      const aKey = String(a.handle || a.displayName || a.uid);
      const bKey = String(b.handle || b.displayName || b.uid);
      const aScore = a.handle ? 0 : 1;
      const bScore = b.handle ? 0 : 1;
      if (aScore !== bScore) return aScore - bScore;
      return aKey.localeCompare(bKey, 'pt-BR', { sensitivity: 'base' });
    }
  );

  const byUid = Object.fromEntries(list.map((entry) => [entry.uid, entry]));
  const byHandle = Object.fromEntries(
    list.filter((entry) => entry.handle).map((entry) => [entry.handle, entry])
  );

  return {
    list,
    byUid,
    byHandle,
  };
}

export function formatAdminCreatorLookupOption(entry) {
  if (!entry) return '';
  const handlePart = entry.handle ? '@' + entry.handle : String(entry.uid || '').trim();
  const namePart =
    entry.displayName && entry.displayName !== handlePart ? ' - ' + entry.displayName : '';
  return `${handlePart}${namePart}`;
}

export function findAdminCreatorLookupMatches(rawValue, directory = [], limit = 6) {
  const raw = String(rawValue || '').trim();
  const normalized = normalizeSearchValue(raw);
  const compact = normalizeUsernameInput(raw);
  if ((!compact || compact.length < 2) && raw.length < 2) return [];

  return (Array.isArray(directory) ? directory : [])
    .filter((entry) => {
      if (!entry) return false;
      if (normalizeSearchValue(entry.uid) === normalized) return true;
      const tokens = Array.isArray(entry.searchTokens) ? entry.searchTokens : buildEntrySearchTokens(entry);
      return tokens.some((token) => {
        if (!token) return false;
        return (
          token === normalized ||
          token.startsWith(compact) ||
          token.includes(compact) ||
          token.includes(normalized)
        );
      });
    })
    .sort((a, b) => {
      const aHandle = normalizeSearchValue(a.handle);
      const bHandle = normalizeSearchValue(b.handle);
      const aExact = aHandle === compact || normalizeSearchValue(a.uid) === normalized ? 0 : 1;
      const bExact = bHandle === compact || normalizeSearchValue(b.uid) === normalized ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStarts = aHandle.startsWith(compact) ? 0 : 1;
      const bStarts = bHandle.startsWith(compact) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return String(a.handle || a.displayName || a.uid).localeCompare(
        String(b.handle || b.displayName || b.uid),
        'pt-BR',
        { sensitivity: 'base' }
      );
    })
    .slice(0, Math.max(1, Number(limit || 6)));
}

export function resolveAdminCreatorLookupValue(rawValue, directory = []) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const normalized = normalizeSearchValue(raw);
  const compact = normalizeUsernameInput(raw);
  const list = Array.isArray(directory) ? directory : [];

  const exact = list.find((entry) => {
    if (!entry) return false;
    if (normalizeSearchValue(entry.uid) === normalized) return true;
    if (normalizeSearchValue(entry.handle) === compact) return true;
    if (normalizeSearchValue(entry.displayName) === normalized) return true;
    return normalizeSearchValue(formatAdminCreatorLookupOption(entry)) === normalized;
  });
  if (exact) return exact;

  const partial = findAdminCreatorLookupMatches(raw, list, 10);
  if (partial.length === 1) return partial[0];
  return partial[0] || null;
}
