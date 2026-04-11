const AVATAR_FALLBACK = '/assets/avatares/ava1.webp';

function asString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function asNumber(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function buildCreatorPublicMonetization(root = {}, source = {}, supportOffer = {}) {
  const creatorMonetization =
    root?.creator?.monetization && typeof root.creator.monetization === 'object'
      ? root.creator.monetization
      : {};
  const preference = asString(creatorMonetization.preference, 'publish_only').toLowerCase() === 'monetize'
    ? 'monetize'
    : 'publish_only';
  const applicationStatus = asString(
    creatorMonetization?.application?.status,
    root?.creator?.meta?.isAdult === false ? 'blocked_underage' : 'not_requested'
  ).toLowerCase();
  const financialStatus = asString(
    creatorMonetization?.financial?.status,
    'inactive'
  ).toLowerCase();
  const status =
    applicationStatus === 'blocked_underage'
      ? 'blocked_underage'
      : applicationStatus === 'approved' && financialStatus === 'active'
        ? 'active'
        : 'disabled';
  return {
    preference,
    applicationStatus,
    financialStatus,
    status,
    supportOffer,
  };
}

export function resolveProfileAvatarUrl(raw) {
  return asString(raw, AVATAR_FALLBACK) || AVATAR_FALLBACK;
}

export function buildPublicProfileFromUsuarioRow(raw = {}, uid = '') {
  const root = asObject(raw);
  const publicProfile = asObject(root.publicProfile);
  const creatorProfile = asObject(publicProfile.creatorProfile);
  const readerProfile = asObject(publicProfile.readerProfile);
  const creatorRoot = asObject(root.creator);
  const handle = asString(root.userHandle || root.username || publicProfile.userHandle || publicProfile.username);
  const name = asString(root.userName || root.displayName || publicProfile.userName || publicProfile.displayName);
  const avatar =
    asString(publicProfile.userAvatar) ||
    asString(root.userAvatar) ||
    asString(readerProfile.avatarUrl) ||
    asString(root.readerProfileAvatarUrl);
  const isCreator =
    root.isCreator === true ||
    root.isMangaka === true ||
    creatorProfile.isCreator === true ||
    creatorRoot.onboardingCompleted === true ||
    creatorRoot.isCreator === true;
  const creatorDisplayName =
    asString(publicProfile.creatorDisplayName) ||
    asString(root.creatorDisplayName) ||
    asString(creatorRoot.displayName) ||
    name;
  const supportOffer = asObject(creatorRoot?.monetization?.offer);
  const monetization = buildCreatorPublicMonetization(root, creatorProfile, supportOffer);
  return {
    uid: asString(uid || root.uid || root.userId),
    userHandle: handle,
    userName: name,
    userAvatar: resolveProfileAvatarUrl(avatar),
    userBio: asString(publicProfile.userBio || root.userBio),
    readerDisplayName: asString(readerProfile.displayName || root.readerDisplayName || name),
    readerProfileAvatarUrl: resolveProfileAvatarUrl(asString(readerProfile.avatarUrl || root.readerProfileAvatarUrl || avatar)),
    creatorDisplayName,
    creatorBio: asString(creatorProfile.bio || creatorRoot.bio),
    creatorAvatarUrl: resolveProfileAvatarUrl(asString(creatorProfile.avatarUrl || creatorRoot.avatarUrl || avatar)),
    creatorSupportOffer: monetization.supportOffer,
    creatorMonetization: monetization,
    isCreatorProfile: Boolean(isCreator),
    isReaderProfilePublic: readerProfile?.isPublic !== false,
    isCreatorProfilePublic: isCreator ? true : creatorProfile?.isPublic === true,
    stats: {
      followers: asNumber(root.creatorStats?.followers || root.followers || creatorProfile?.followers),
      works: asNumber(root.creatorStats?.works || creatorProfile?.works),
      views: asNumber(root.creatorStats?.views || creatorProfile?.views),
      likes: asNumber(root.creatorStats?.likes || creatorProfile?.likes),
      comments: asNumber(root.creatorStats?.comments || creatorProfile?.comments),
      favorites: asNumber(root.creatorStats?.favorites || creatorProfile?.favorites),
    },
  };
}

export function buildPublicProfilesMapFromUsuarios(raw = {}) {
  const map = new Map();
  Object.entries(raw || {}).forEach(([uid, row]) => {
    map.set(uid, buildPublicProfileFromUsuarioRow(row || {}, uid));
  });
  return map;
}

export function formatUserDisplayWithHandle(profile = {}) {
  const handle = asString(profile?.userHandle);
  const name = asString(profile?.userName);
  if (handle && name) return `${name} (@${handle})`;
  return name || (handle ? `@${handle}` : '');
}
