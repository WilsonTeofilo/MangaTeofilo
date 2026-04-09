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

function hasCanonicalCreatorState(source = {}, root = {}) {
  const creatorStatus = asString(source.creatorStatus || root.creatorStatus).toLowerCase();
  const creatorMonetizationStatus = asString(
    source.creatorMonetizationStatus || root.creatorMonetizationStatus
  ).toLowerCase();
  const role = asString(
    source.role || root.role || source.panelRole || root.panelRole,
    'user'
  ).toLowerCase();
  const sourceCreator = asObject(source.creator);
  const rootCreator = asObject(root.creator);
  return (
    creatorStatus === 'active' ||
    creatorStatus === 'onboarding' ||
    creatorMonetizationStatus === 'active' ||
    role === 'mangaka' ||
    role === 'creator' ||
    sourceCreator.isApproved === true ||
    rootCreator.isApproved === true
  );
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
  const creatorStatus = asString(source.creatorStatus || root.creatorStatus).toLowerCase();
  const signupIntent = asString(source.signupIntent || root.signupIntent, 'reader').toLowerCase();
  const isCreatorProfile = hasCanonicalCreatorState(source, root);
  const creatorProfile = isCreatorProfile
    ? {
        ...sourceCreatorProfile,
        displayName: creatorDisplayName,
        username: asString(sourceCreatorProfile.username || userHandle).toLowerCase(),
        bioFull: creatorBio,
        socialLinks: {
          ...sourceCreatorSocial,
          instagramUrl,
          youtubeUrl,
        },
      }
    : null;

  return {
    ...source,
    uid: asString(uidOverride || source.uid),
    userName: asString(source.userName || root.userName, 'Leitor'),
    userHandle,
    userAvatar,
    isCreatorProfile,
    accountType: asString(source.accountType, 'comum'),
    signupIntent,
    status: asString(source.status),
    creatorDisplayName: isCreatorProfile ? creatorDisplayName : '',
    creatorUsername: userHandle,
    creatorBio: isCreatorProfile ? creatorBio : '',
    creatorBannerUrl: isCreatorProfile ? asString(source.creatorBannerUrl) : '',
    instagramUrl: isCreatorProfile ? instagramUrl : '',
    youtubeUrl: isCreatorProfile ? youtubeUrl : '',
    readerProfilePublic: source.readerProfilePublic === true,
    readerProfileAvatarUrl: asString(source.readerProfileAvatarUrl, userAvatar),
    readerSince: asNumber(source.readerSince || root.createdAt || root.readerSince || source.createdAt, 0),
    creatorStatus: isCreatorProfile ? creatorStatus : '',
    creatorMembershipEnabled: isCreatorProfile && source.creatorMembershipEnabled === true,
    creatorMembershipPriceBRL:
      isCreatorProfile && source.creatorMembershipPriceBRL != null
        ? Number(source.creatorMembershipPriceBRL)
        : null,
    creatorDonationSuggestedBRL:
      isCreatorProfile && source.creatorDonationSuggestedBRL != null
        ? Number(source.creatorDonationSuggestedBRL)
        : null,
    updatedAt:
      asNumber(
        source.updatedAt || root?.creator?.meta?.updatedAt || root.updatedAt || root.lastLogin || root.createdAt,
        0
      ),
    ...(creatorProfile ? { creatorProfile } : {}),
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

export function isCreatorPublicProfile(profile) {
  const normalized = buildPublicProfileFromUsuarioRow(profile);
  return normalized.isCreatorProfile === true;
}

export function resolvePublicProfileDisplayName(profile, fallback = 'Leitor') {
  const normalized = buildPublicProfileFromUsuarioRow(profile);
  return isCreatorPublicProfile(normalized)
    ? asString(
        normalized.creatorProfile?.displayName ||
          normalized.creatorDisplayName ||
          normalized.userName,
        fallback
      )
    : asString(normalized.userName, fallback);
}

export function resolvePublicProfileBio(profile, mode = 'auto') {
  const normalized = buildPublicProfileFromUsuarioRow(profile);
  const isCreator = isCreatorPublicProfile(normalized);
  if (mode === 'reader' || !isCreator) {
    return '';
  }
  return asString(
    normalized.creatorProfile?.bioFull || normalized.creatorBio || '',
    ''
  );
}

export function resolvePublicProfileAvatarUrl(profile, { mode = 'auto', fallback = AVATAR_FALLBACK } = {}) {
  const normalized = buildPublicProfileFromUsuarioRow(profile);
  const isCreator = isCreatorPublicProfile(normalized);
  if (mode === 'reader') {
    return asString(normalized.readerProfileAvatarUrl || normalized.userAvatar, fallback);
  }
  if (mode === 'creator') {
    return asString(
      isCreator ? normalized.creatorProfile?.avatarUrl || normalized.userAvatar : normalized.userAvatar,
      fallback
    );
  }
  return isCreator
    ? asString(
        normalized.creatorProfile?.avatarUrl ||
          normalized.readerProfileAvatarUrl ||
          normalized.userAvatar,
        fallback
      )
    : asString(normalized.readerProfileAvatarUrl || normalized.userAvatar, fallback);
}

export function resolvePublicProfileSocialLinks(profile) {
  const normalized = buildPublicProfileFromUsuarioRow(profile);
  if (!isCreatorPublicProfile(normalized)) {
    return {
      instagramUrl: '',
      youtubeUrl: '',
    };
  }
  const socialLinks = asObject(normalized.creatorProfile?.socialLinks);
  return {
    instagramUrl: asString(normalized.instagramUrl || socialLinks.instagramUrl),
    youtubeUrl: asString(normalized.youtubeUrl || socialLinks.youtubeUrl),
  };
}
