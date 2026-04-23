const AVATAR_FALLBACK = '/assets/avatares/ava1.webp';
import { resolveCanonicalPublicHandle } from './canonicalIdentity.js';

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

function buildCreatorPublicMonetization(root = {}, supportOffer = {}) {
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

function creatorAccessIsApproved(source = {}, root = {}) {
  const sourceCreatorProfileDirect = asObject(source.creatorProfile);
  const rootCreatorProfileDirect = asObject(root.creatorProfile);
  const creatorStatus = asString(source.creatorStatus || root.creatorStatus).toLowerCase();
  const sourceCreator = asObject(source.creator);
  const rootCreator = asObject(root.creator);
  const signupIntent = asString(source.signupIntent || root.signupIntent).toLowerCase();
  const accountType = asString(source.accountType || root.accountType).toLowerCase();
  const creatorHandle = resolveCanonicalPublicHandle({
    ...root,
    ...source,
    publicProfile: {
      ...root,
      ...source,
      ...asObject(root.publicProfile),
      ...asObject(source),
    },
    creator: {
      ...rootCreator,
      ...sourceCreator,
      profile: {
        ...rootCreatorProfileDirect,
        ...sourceCreatorProfileDirect,
      },
    },
  });
  const creatorDisplayName = asString(
    sourceCreatorProfileDirect.displayName ||
      rootCreatorProfileDirect.displayName ||
      source.creatorDisplayName ||
      root.creatorDisplayName ||
      source.userName ||
      root.userName
  );
  const hasWriterIdentity = Boolean(creatorHandle || creatorDisplayName);

  return (
    source.isCreatorProfile === true ||
    root.isCreatorProfile === true ||
    creatorStatus === 'active' ||
    creatorStatus === 'onboarding' ||
    sourceCreatorProfileDirect.isCreator === true ||
    rootCreatorProfileDirect.isCreator === true ||
    sourceCreator.isCreator === true ||
    rootCreator.isCreator === true ||
    sourceCreator.onboardingCompleted === true ||
    rootCreator.onboardingCompleted === true ||
    source.creatorOnboardingCompleted === true ||
    root.creatorOnboardingCompleted === true ||
    ((signupIntent === 'creator' || accountType === 'writer' || accountType === 'creator') &&
      hasWriterIdentity)
  );
}

function hasCanonicalCreatorState(source = {}, root = {}) {
  if (!creatorAccessIsApproved(source, root)) {
    return false;
  }
  return true;
}

export function resolveProfileAvatarUrl(raw) {
  return asString(raw, AVATAR_FALLBACK) || AVATAR_FALLBACK;
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
  const userHandle = resolveCanonicalPublicHandle({
    ...root,
    ...source,
    creator: {
      ...asObject(root.creator),
      profile: {
        ...privateCreatorProfile,
      },
    },
    publicProfile: {
      ...asObject(root.publicProfile),
      ...source,
      creatorProfile: {
        ...sourceCreatorProfile,
      },
    },
  });
  const creatorDisplayName = asString(
    privateCreatorProfile.displayName ||
      sourceCreatorProfile.displayName ||
      source.creatorDisplayName ||
      root.userName ||
      source.userName,
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
    privateCreatorSocial.instagram ||
      sourceCreatorSocial.instagramUrl ||
      source.instagramUrl ||
      root.instagramUrl
  );
  const youtubeUrl = asString(
    privateCreatorSocial.youtube ||
      sourceCreatorSocial.youtubeUrl ||
      source.youtubeUrl ||
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
  const isCreatorProfile = hasCanonicalCreatorState(source, root);
  const supportOffer =
    root?.creator?.monetization?.offer && typeof root.creator.monetization.offer === 'object'
      ? root.creator.monetization.offer
      : sourceCreatorProfile?.monetization?.supportOffer &&
        typeof sourceCreatorProfile.monetization.supportOffer === 'object'
        ? sourceCreatorProfile.monetization.supportOffer
        : null;
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
      }
    : null;
  const creatorMonetization = creatorProfile
    ? buildCreatorPublicMonetization(root, {
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
      })
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
    isCreatorProfile,
    status: asString(source.status),
    creatorDisplayName: isCreatorProfile ? creatorDisplayName : '',
    creatorUsername: userHandle,
    creatorBio: isCreatorProfile ? creatorBio : '',
    creatorBannerUrl: isCreatorProfile
      ? asString(source.creatorBannerUrl || sourceCreatorProfile.bannerUrl || privateCreatorProfile.bannerUrl)
      : '',
    instagramUrl: isCreatorProfile ? instagramUrl : '',
    youtubeUrl: isCreatorProfile ? youtubeUrl : '',
    readerProfilePublic: source.readerProfilePublic === true,
    readerProfileAvatarUrl: asString(source.userAvatar || source.readerProfileAvatarUrl, userAvatar),
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

export function formatUserDisplayWithHandle(profile = {}) {
  const normalized = buildPublicProfileFromUsuarioRow(profile);
  const handle = asString(normalized?.userHandle);
  const name = asString(normalized?.userName || normalized?.creatorDisplayName);
  if (handle && name) return `${name} (@${handle})`;
  return name || (handle ? `@${handle}` : '');
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
    return asString(normalized.userAvatar || normalized.readerProfileAvatarUrl, fallback);
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
          normalized.userAvatar,
        fallback
      )
    : asString(normalized.userAvatar || normalized.readerProfileAvatarUrl, fallback);
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
