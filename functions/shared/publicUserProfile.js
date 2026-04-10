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
  const publicCreatorProfile =
    source?.creatorProfile && typeof source.creatorProfile === 'object'
      ? source.creatorProfile
      : {};
  const publicMonetization =
    publicCreatorProfile?.monetization && typeof publicCreatorProfile.monetization === 'object'
      ? publicCreatorProfile.monetization
      : {};
  const preference = asString(
    creatorMonetization.preference || publicMonetization.preference,
    'publish_only'
  ).toLowerCase() === 'monetize'
    ? 'monetize'
    : 'publish_only';
  const applicationStatus = asString(
    creatorMonetization?.application?.status || publicMonetization.applicationStatus,
    root?.creator?.meta?.isAdult === false ? 'blocked_underage' : 'not_requested'
  ).toLowerCase();
  const financialStatus = asString(
    creatorMonetization?.financial?.status || publicMonetization.financialStatus,
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
    isApproved: applicationStatus === 'approved',
    isActive: financialStatus === 'active',
    supportOffer: {
      membershipEnabled: supportOffer?.membershipEnabled === true,
      membershipPriceBRL: asNumber(supportOffer?.membershipPriceBRL, 0) || null,
      donationSuggestedBRL: asNumber(supportOffer?.donationSuggestedBRL, 0) || null,
      updatedAt: asNumber(supportOffer?.updatedAt, 0),
    },
  };
}

function hasMeaningfulCreatorFields(source = {}) {
  return Boolean(
    String(source.creatorDisplayName || '').trim() ||
      String(source.creatorBio || '').trim() ||
      String(source.instagramUrl || '').trim() ||
      String(source.youtubeUrl || '').trim() ||
      String(source.creatorBannerUrl || '').trim()
  );
}

function hasNestedCreatorProfileData(profile = {}) {
  return Boolean(
    String(profile.displayName || '').trim() ||
      String(profile.bio || '').trim() ||
      String(profile.bioFull || '').trim() ||
      String(profile.bioShort || '').trim() ||
      String(profile.username || '').trim() ||
      String(profile.avatarUrl || '').trim()
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
      privateCreatorProfile.displayName ||
      sourceCreatorProfile.displayName ||
      source.creatorDisplayName ||
      source.userName ||
      root.userName,
    'Leitor'
  );
  const creatorBio = asString(
      privateCreatorProfile.bio ||
      sourceCreatorProfile.bioFull ||
      sourceCreatorProfile.bioShort ||
      source.creatorBio ||
      root.creatorBio
  );
  const instagramUrl = asString(
    privateCreatorSocial.instagram || sourceCreatorSocial.instagramUrl || source.instagramUrl || root.instagramUrl
  );
  const youtubeUrl = asString(
    privateCreatorSocial.youtube || sourceCreatorSocial.youtubeUrl || source.youtubeUrl || root.youtubeUrl
  );
  const userAvatar = asString(source.userAvatar || root.userAvatar, AVATAR_FALLBACK);
  const creatorStatus = asString(source.creatorStatus || root.creatorStatus).toLowerCase();
  const signupIntent = asString(source.signupIntent || root.signupIntent, 'reader').toLowerCase();
  const role = asString(root.role || source.role, 'user').toLowerCase();
  const isCreatorProfile =
    creatorStatus === 'active' ||
    creatorStatus === 'onboarding' ||
    signupIntent === 'creator' ||
    role === 'mangaka' ||
    hasMeaningfulCreatorFields(source) ||
    hasMeaningfulCreatorFields(root) ||
    hasNestedCreatorProfileData(sourceCreatorProfile) ||
    hasNestedCreatorProfileData(privateCreatorProfile);
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
  const creatorMonetization = creatorProfile
    ? buildCreatorPublicMonetization(root, source, creatorProfile.supportOffer)
    : null;
  if (creatorProfile && creatorMonetization) {
    creatorProfile.monetization = creatorMonetization;
  }

  return {
    ...source,
    uid: asString(uidOverride || source.uid),
    userName: asString(source.userName || root.userName, 'Leitor'),
    userHandle,
    userAvatar,
    accountType: asString(source.accountType, 'comum'),
    signupIntent,
    status: asString(source.status),
    creatorDisplayName: isCreatorProfile ? creatorDisplayName : '',
    creatorUsername: userHandle,
    creatorBio: isCreatorProfile ? creatorBio : '',
    creatorBannerUrl: isCreatorProfile ? asString(source.creatorBannerUrl) : '',
    instagramUrl,
    youtubeUrl,
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
