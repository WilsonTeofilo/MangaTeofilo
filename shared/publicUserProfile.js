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

export function buildPublicProfileFromUsuarioRow(row = {}, uidOverride = null) {
  const root = asObject(row);
  const source = asObject(root.publicProfile).uid || Object.keys(asObject(root.publicProfile)).length
    ? { ...root, ...asObject(root.publicProfile) }
    : root;
  const sourceCreatorProfile = asObject(source.creatorProfile);
  const sourceCreatorSocial = asObject(sourceCreatorProfile.socialLinks);
  const privateCreatorProfile = asObject(root?.creator?.profile);
  const privateCreatorSocial = asObject(root?.creator?.social);
  const userHandle = asString(
    source.userHandle || root.userHandle || sourceCreatorProfile.username
  ).toLowerCase();
  const creatorDisplayName = asString(
    source.creatorDisplayName ||
      sourceCreatorProfile.displayName ||
      privateCreatorProfile.displayName ||
      source.userName ||
      root.userName,
    'Leitor'
  );
  const creatorBio = asString(
    source.creatorBio ||
      sourceCreatorProfile.bioFull ||
      sourceCreatorProfile.bioShort ||
      privateCreatorProfile.bio ||
      root.creatorBio
  );
  const instagramUrl = asString(
    source.instagramUrl || sourceCreatorSocial.instagramUrl || privateCreatorSocial.instagram || root.instagramUrl
  );
  const youtubeUrl = asString(
    source.youtubeUrl || sourceCreatorSocial.youtubeUrl || privateCreatorSocial.youtube || root.youtubeUrl
  );
  const userAvatar = asString(source.userAvatar || root.userAvatar, AVATAR_FALLBACK);
  const creatorProfile = {
    ...sourceCreatorProfile,
    displayName: creatorDisplayName,
    username: asString(sourceCreatorProfile.username || userHandle).toLowerCase(),
    bioFull: creatorBio,
    socialLinks: {
      ...sourceCreatorSocial,
      instagramUrl,
      youtubeUrl,
    },
  };

  return {
    ...source,
    uid: asString(uidOverride || source.uid),
    userName: asString(source.userName, creatorDisplayName || 'Leitor'),
    userHandle,
    userAvatar,
    accountType: asString(source.accountType, 'comum'),
    signupIntent: asString(source.signupIntent, 'reader'),
    status: asString(source.status),
    creatorDisplayName,
    creatorUsername: userHandle,
    creatorBio,
    creatorBannerUrl: asString(source.creatorBannerUrl),
    instagramUrl,
    youtubeUrl,
    readerProfilePublic: source.readerProfilePublic === true,
    readerProfileAvatarUrl: asString(source.readerProfileAvatarUrl, userAvatar),
    readerSince: asNumber(source.readerSince || root.createdAt || root.readerSince || source.createdAt, 0),
    creatorStatus: asString(source.creatorStatus),
    creatorMembershipEnabled: source.creatorMembershipEnabled === true,
    creatorMembershipPriceBRL:
      source.creatorMembershipPriceBRL == null ? null : Number(source.creatorMembershipPriceBRL),
    creatorDonationSuggestedBRL:
      source.creatorDonationSuggestedBRL == null ? null : Number(source.creatorDonationSuggestedBRL),
    updatedAt:
      asNumber(
        source.updatedAt || root?.creator?.meta?.updatedAt || root.updatedAt || root.lastLogin || root.createdAt,
        0
      ),
    creatorProfile,
  };
}

export function buildPublicProfilesMapFromUsuarios(rows = {}) {
  const source = rows && typeof rows === 'object' ? rows : {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([, row]) => row && typeof row === 'object')
      .map(([uid, row]) => [uid, buildPublicProfileFromUsuarioRow(row, uid)])
  );
}

export function resolvePublicProfileDisplayName(profile, fallback = 'Leitor') {
  const normalized = buildPublicProfileFromUsuarioRow(profile);
  return asString(
    normalized.creatorProfile?.displayName ||
      normalized.creatorDisplayName ||
      normalized.userName,
    fallback
  );
}

export function resolvePublicProfileBio(profile, mode = 'auto') {
  const normalized = buildPublicProfileFromUsuarioRow(profile);
  if (mode === 'reader') {
    return '';
  }
  return asString(
    normalized.creatorProfile?.bioFull || normalized.creatorBio || '',
    ''
  );
}

export function resolvePublicProfileAvatarUrl(profile, { mode = 'auto', fallback = AVATAR_FALLBACK } = {}) {
  const normalized = buildPublicProfileFromUsuarioRow(profile);
  if (mode === 'reader') {
    return asString(normalized.readerProfileAvatarUrl || normalized.userAvatar, fallback);
  }
  if (mode === 'creator') {
    return asString(normalized.creatorProfile?.avatarUrl || normalized.userAvatar, fallback);
  }
  return asString(
    normalized.creatorProfile?.avatarUrl ||
      normalized.readerProfileAvatarUrl ||
      normalized.userAvatar,
    fallback
  );
}

export function resolvePublicProfileSocialLinks(profile) {
  const normalized = buildPublicProfileFromUsuarioRow(profile);
  const socialLinks = asObject(normalized.creatorProfile?.socialLinks);
  return {
    instagramUrl: asString(normalized.instagramUrl || socialLinks.instagramUrl),
    youtubeUrl: asString(normalized.youtubeUrl || socialLinks.youtubeUrl),
  };
}
