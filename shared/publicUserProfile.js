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
  const sourceCreatorProfileDirect = asObject(source.creatorProfile);
  const rootCreatorProfileDirect = asObject(root.creatorProfile);
  const creatorStatus = asString(source.creatorStatus || root.creatorStatus).toLowerCase();
  const signupIntent = asString(source.signupIntent || root.signupIntent).toLowerCase();
  const role = asString(
    source.role || root.role || source.panelRole || root.panelRole,
    'user'
  ).toLowerCase();
  const sourceCreator = asObject(source.creator);
  const rootCreator = asObject(root.creator);
  const sourceCreatorProfile = asObject(sourceCreator.profile);
  const rootCreatorProfile = asObject(rootCreator.profile);
  const sourceCreatorSocial = asObject(sourceCreator.social);
  const rootCreatorSocial = asObject(rootCreator.social);
  const hasCreatorProfileData =
    asString(source.creatorDisplayName || root.creatorDisplayName) !== '' ||
    asString(source.creatorBio || root.creatorBio) !== '' ||
    asString(source.creatorUsername || root.creatorUsername) !== '' ||
    asString(source.creatorBannerUrl || root.creatorBannerUrl) !== '' ||
    asString(source.instagramUrl || root.instagramUrl) !== '' ||
    asString(source.youtubeUrl || root.youtubeUrl) !== '' ||
    asString(sourceCreatorProfileDirect.displayName || rootCreatorProfileDirect.displayName) !== '' ||
    asString(sourceCreatorProfileDirect.bioFull || rootCreatorProfileDirect.bioFull) !== '' ||
    asString(sourceCreatorProfileDirect.username || rootCreatorProfileDirect.username) !== '' ||
    asString(sourceCreatorProfile.displayName || rootCreatorProfile.displayName) !== '' ||
    asString(sourceCreatorProfile.bio || rootCreatorProfile.bio) !== '' ||
    asString(sourceCreatorSocial.instagram || rootCreatorSocial.instagram) !== '' ||
    asString(sourceCreatorSocial.youtube || rootCreatorSocial.youtube) !== '';
  return (
    source.isCreatorProfile === true ||
    root.isCreatorProfile === true ||
    creatorStatus === 'active' ||
    creatorStatus === 'onboarding' ||
    signupIntent === 'creator' ||
    role === 'mangaka' ||
    role === 'creator' ||
    hasCreatorProfileData
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
    root.userHandle || source.userHandle || privateCreatorProfile.username || sourceCreatorProfile.username
  ).toLowerCase();
  const creatorDisplayName = asString(
    privateCreatorProfile.displayName ||
      source.creatorDisplayName ||
      sourceCreatorProfile.displayName ||
      root.userName ||
      source.userName,
    'Leitor'
  );
  const creatorBio = asString(
    privateCreatorProfile.bio ||
      source.creatorBio ||
      sourceCreatorProfile.bioFull ||
      sourceCreatorProfile.bioShort ||
      root.creatorBio
  );
  const instagramUrl = asString(
    privateCreatorSocial.instagram ||
      source.instagramUrl ||
      sourceCreatorSocial.instagramUrl ||
      root.instagramUrl
  );
  const youtubeUrl = asString(
    privateCreatorSocial.youtube ||
      source.youtubeUrl ||
      sourceCreatorSocial.youtubeUrl ||
      root.youtubeUrl
  );
  const userAvatar = asString(root.userAvatar || source.userAvatar, AVATAR_FALLBACK);
  const creatorAvatarUrl = asString(
    sourceCreatorProfile.avatarUrl ||
      privateCreatorProfile.avatarUrl ||
      source.creatorAvatarUrl ||
      source.readerProfileAvatarUrl ||
      userAvatar,
    userAvatar
  );
  const creatorStatus = asString(root.creatorStatus || source.creatorStatus).toLowerCase();
  const signupIntent = asString(root.signupIntent || source.signupIntent, 'reader').toLowerCase();
  const isCreatorProfile = hasCanonicalCreatorState(source, root);
  const creatorProfile = isCreatorProfile
    ? {
        ...sourceCreatorProfile,
        displayName: creatorDisplayName,
        username: asString(sourceCreatorProfile.username || userHandle).toLowerCase(),
        avatarUrl: creatorAvatarUrl,
        bioFull: creatorBio,
        socialLinks: {
          ...sourceCreatorSocial,
          instagramUrl,
          youtubeUrl,
        },
        supportOffer: (() => {
          const supportOffer =
            sourceCreatorProfile?.supportOffer && typeof sourceCreatorProfile.supportOffer === 'object'
              ? sourceCreatorProfile.supportOffer
              : root?.creator?.monetization?.offer && typeof root.creator.monetization.offer === 'object'
                ? root.creator.monetization.offer
                : null;
          return {
            membershipEnabled: supportOffer?.membershipEnabled === true,
            membershipPriceBRL:
              Number.isFinite(Number(supportOffer?.membershipPriceBRL))
                ? Number(supportOffer.membershipPriceBRL)
                : null,
            donationSuggestedBRL:
              Number.isFinite(Number(supportOffer?.donationSuggestedBRL))
                ? Number(supportOffer.donationSuggestedBRL)
                : null,
            updatedAt: asNumber(supportOffer?.updatedAt, 0),
          };
        })(),
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
