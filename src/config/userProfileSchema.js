import { AVATAR_FALLBACK, DEFAULT_USER_DISPLAY_NAME } from '../constants';

function asNonEmptyString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function hasCanonicalCreatorState(source = {}) {
  const creator = source?.creator && typeof source.creator === 'object' ? source.creator : {};
  const creatorProfilePublic =
    source?.creatorProfile && typeof source.creatorProfile === 'object' ? source.creatorProfile : {};
  const creatorApplicationStatus = asNonEmptyString(source.creatorApplicationStatus, '').toLowerCase();
  const creatorStatus = asNonEmptyString(source.creatorStatus, '').toLowerCase();
  return (
    source.isCreatorProfile === true ||
    creatorApplicationStatus === 'approved' ||
    creatorStatus === 'active' ||
    creatorStatus === 'onboarding' ||
    creatorProfilePublic.isCreator === true ||
    creator.isCreator === true ||
    creator.onboardingCompleted === true
  );
}

function buildCreatorPublicMonetization(source = {}, creatorSupportOffer = {}) {
  const creatorMonetization =
    source?.creator?.monetization && typeof source.creator.monetization === 'object'
      ? source.creator.monetization
      : {};
  const preference = asNonEmptyString(creatorMonetization.preference, 'publish_only').toLowerCase() === 'monetize'
    ? 'monetize'
    : 'publish_only';
  const applicationStatus = asNonEmptyString(
    creatorMonetization?.application?.status,
    source?.creator?.meta?.isAdult === false ? 'blocked_underage' : 'not_requested'
  ).toLowerCase();
  const financialStatus = asNonEmptyString(
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
      membershipEnabled: creatorSupportOffer?.membershipEnabled === true,
      membershipPriceBRL: Number(creatorSupportOffer?.membershipPriceBRL || 0) || null,
      donationSuggestedBRL: Number(creatorSupportOffer?.donationSuggestedBRL || 0) || null,
      updatedAt: Number(creatorSupportOffer?.updatedAt || 0) || 0,
    },
  };
}

export function buildUsuarioBaseRecord({
  uid,
  email = '',
  userName = DEFAULT_USER_DISPLAY_NAME,
  userAvatar = AVATAR_FALLBACK,
  status = 'pendente',
  now = Date.now(),
} = {}) {
  return {
    uid,
    email: asNonEmptyString(email, ''),
    userName: asNonEmptyString(userName, DEFAULT_USER_DISPLAY_NAME),
    userAvatar: asNonEmptyString(userAvatar, AVATAR_FALLBACK),
    role: 'user',
    gender: 'nao_informado',
    birthYear: null,
    status,
    notifyNewChapter: false,
    notifyPromotions: false,
    marketingOptIn: false,
    marketingOptInAt: null,
    currentPlanId: null,
    lastPaymentAt: null,
    premium5dNotifiedForUntil: null,
    sourceAcquisition: 'organico',
    signupIntent: 'reader',
    creatorApplicationStatus: null,
    creatorRequestedAt: null,
    createdAt: now,
    lastLogin: now,
  };
}

export function buildUsuarioPublicProfileRecord(current = {}, uidOverride = null) {
  const source = current && typeof current === 'object' ? current : {};
  const creatorProfile =
    source?.creator?.profile && typeof source.creator.profile === 'object'
      ? source.creator.profile
      : {};
  const publicCreatorProfile =
    source?.creatorProfile && typeof source.creatorProfile === 'object'
      ? source.creatorProfile
      : {};
  const creatorSocial =
    source?.creator?.social && typeof source.creator.social === 'object'
      ? source.creator.social
      : {};
  const userHandle = asNonEmptyString(source.userHandle, '').toLowerCase();
  const creatorDisplayName = asNonEmptyString(
    creatorProfile.displayName || source.creatorDisplayName || source.userName,
    DEFAULT_USER_DISPLAY_NAME
  );
  const creatorBio = asNonEmptyString(creatorProfile.bio || source.creatorBio, '');
  const instagramUrl = asNonEmptyString(creatorSocial.instagram || source.instagramUrl, '');
  const youtubeUrl = asNonEmptyString(creatorSocial.youtube || source.youtubeUrl, '');
  const userAvatar = asNonEmptyString(source.userAvatar, AVATAR_FALLBACK);
  const creatorAvatarUrl = asNonEmptyString(
    creatorProfile.avatarUrl ||
      publicCreatorProfile.avatarUrl ||
      source.creatorAvatarUrl ||
      source.readerProfileAvatarUrl ||
      userAvatar,
    userAvatar
  );
  const creatorStatus = asNonEmptyString(source.creatorStatus, '');
  const creatorApplicationStatus = asNonEmptyString(source.creatorApplicationStatus, '');
  const isCreatorProfile = hasCanonicalCreatorState(source);
  const creatorSupportOffer =
    source?.creator?.monetization?.offer && typeof source.creator.monetization.offer === 'object'
      ? source.creator.monetization.offer
      : null;
  const creatorBannerUrl = asNonEmptyString(
    source.creatorBannerUrl || publicCreatorProfile.bannerUrl || creatorProfile.bannerUrl,
    ''
  );
  const publicCreatorMonetization = isCreatorProfile
    ? buildCreatorPublicMonetization(source, creatorSupportOffer)
    : null;

  return {
    uid: asNonEmptyString(uidOverride || source.uid, ''),
    userName: asNonEmptyString(source.userName, DEFAULT_USER_DISPLAY_NAME),
    userHandle,
    userAvatar,
    isCreatorProfile,
    status: asNonEmptyString(source.status, ''),
    creatorDisplayName: isCreatorProfile ? creatorDisplayName : '',
    creatorUsername: userHandle,
    creatorBio: isCreatorProfile ? creatorBio : '',
    creatorBannerUrl: isCreatorProfile ? creatorBannerUrl : '',
    instagramUrl: isCreatorProfile ? instagramUrl : '',
    youtubeUrl: isCreatorProfile ? youtubeUrl : '',
    readerProfilePublic: source.readerProfilePublic === true,
    readerProfileAvatarUrl: asNonEmptyString(source.userAvatar || source.readerProfileAvatarUrl, userAvatar),
    readerSince: Number(source.createdAt || source.readerSince || 0) || 0,
    creatorStatus: isCreatorProfile ? creatorStatus : '',
    creatorApplicationStatus: isCreatorProfile ? creatorApplicationStatus : '',
    updatedAt:
      Number(source?.creator?.meta?.updatedAt || source.updatedAt || source.lastLogin || source.createdAt || 0) || 0,
    ...(isCreatorProfile
      ? {
          creatorProfile: {
            displayName: creatorDisplayName,
            username: userHandle,
            avatarUrl: creatorAvatarUrl,
            bannerUrl: creatorBannerUrl || null,
            bioFull: creatorBio,
            socialLinks: {
              instagramUrl,
              youtubeUrl,
            },
            monetization: publicCreatorMonetization,
          },
        }
      : {}),
  };
}

export function buildUsuarioMissingFieldsPatch(current = {}, options = {}) {
  const now = Number(options.now || Date.now());
  const desired = buildUsuarioBaseRecord({
    uid: options.uid || current.uid,
    email: options.email || current.email,
    userName: options.userName || current.userName,
    userAvatar: options.userAvatar || current.userAvatar,
    status: options.status || current.status || 'pendente',
    now,
  });
  const patch = { lastLogin: now };

  if (options.userName && asNonEmptyString(options.userName) !== asNonEmptyString(current.userName)) {
    patch.userName = asNonEmptyString(options.userName, desired.userName);
  } else if (!asNonEmptyString(current.userName)) {
    patch.userName = desired.userName;
  }

  if (options.userAvatar && asNonEmptyString(options.userAvatar) !== asNonEmptyString(current.userAvatar)) {
    patch.userAvatar = asNonEmptyString(options.userAvatar, desired.userAvatar);
  } else if (!asNonEmptyString(current.userAvatar)) {
    patch.userAvatar = desired.userAvatar;
  }

  if (!asNonEmptyString(current.email) && asNonEmptyString(desired.email)) {
    patch.email = desired.email;
  }

  if (!asNonEmptyString(current.uid)) patch.uid = desired.uid;
  if (!asNonEmptyString(current.role)) patch.role = desired.role;
  if (!asNonEmptyString(current.gender)) patch.gender = desired.gender;
  if (!asNonEmptyString(current.sourceAcquisition)) patch.sourceAcquisition = desired.sourceAcquisition;
  if (!asNonEmptyString(current.signupIntent)) patch.signupIntent = desired.signupIntent;
  if (!hasOwn(current, 'creatorApplicationStatus')) patch.creatorApplicationStatus = desired.creatorApplicationStatus;
  if (!hasOwn(current, 'creatorRequestedAt')) patch.creatorRequestedAt = desired.creatorRequestedAt;
  if (typeof current.birthYear !== 'number' && current.birthYear !== null) patch.birthYear = desired.birthYear;
  if (typeof current.notifyNewChapter !== 'boolean') patch.notifyNewChapter = desired.notifyNewChapter;
  if (typeof current.notifyPromotions !== 'boolean') patch.notifyPromotions = desired.notifyPromotions;
  if (typeof current.marketingOptIn !== 'boolean') patch.marketingOptIn = desired.marketingOptIn;
  if (typeof current.marketingOptInAt !== 'number' && current.marketingOptInAt !== null) patch.marketingOptInAt = desired.marketingOptInAt;
  if (typeof current.currentPlanId !== 'string' && current.currentPlanId !== null) patch.currentPlanId = desired.currentPlanId;
  if (typeof current.lastPaymentAt !== 'number' && current.lastPaymentAt !== null) patch.lastPaymentAt = desired.lastPaymentAt;
  if (typeof current.premium5dNotifiedForUntil !== 'number' && current.premium5dNotifiedForUntil !== null) {
    patch.premium5dNotifiedForUntil = desired.premium5dNotifiedForUntil;
  }
  if (typeof current.createdAt !== 'number') patch.createdAt = desired.createdAt;

  return patch;
}

