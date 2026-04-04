import { AVATAR_FALLBACK } from '../constants';

function asNonEmptyString(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

export function buildUsuarioBaseRecord({
  uid,
  email = '',
  userName = 'Guerreiro',
  userAvatar = AVATAR_FALLBACK,
  status = 'pendente',
  now = Date.now(),
} = {}) {
  return {
    uid,
    email: asNonEmptyString(email, ''),
    userName: asNonEmptyString(userName, 'Guerreiro'),
    userAvatar: asNonEmptyString(userAvatar, AVATAR_FALLBACK),
    role: 'user',
    accountType: 'comum',
    gender: 'nao_informado',
    birthYear: null,
    status,
    notifyNewChapter: false,
    notifyPromotions: false,
    marketingOptIn: false,
    marketingOptInAt: null,
    membershipStatus: 'inativo',
    memberUntil: null,
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
  if (!asNonEmptyString(current.accountType)) patch.accountType = desired.accountType;
  if (!asNonEmptyString(current.gender)) patch.gender = desired.gender;
  if (!asNonEmptyString(current.sourceAcquisition)) patch.sourceAcquisition = desired.sourceAcquisition;
  if (!asNonEmptyString(current.membershipStatus)) patch.membershipStatus = desired.membershipStatus;
  if (!asNonEmptyString(current.signupIntent)) patch.signupIntent = desired.signupIntent;
  if (!hasOwn(current, 'creatorApplicationStatus')) patch.creatorApplicationStatus = desired.creatorApplicationStatus;
  if (!hasOwn(current, 'creatorRequestedAt')) patch.creatorRequestedAt = desired.creatorRequestedAt;
  if (typeof current.birthYear !== 'number' && current.birthYear !== null) patch.birthYear = desired.birthYear;
  if (typeof current.notifyNewChapter !== 'boolean') patch.notifyNewChapter = desired.notifyNewChapter;
  if (typeof current.notifyPromotions !== 'boolean') patch.notifyPromotions = desired.notifyPromotions;
  if (typeof current.marketingOptIn !== 'boolean') patch.marketingOptIn = desired.marketingOptIn;
  if (typeof current.marketingOptInAt !== 'number' && current.marketingOptInAt !== null) patch.marketingOptInAt = desired.marketingOptInAt;
  if (typeof current.memberUntil !== 'number' && current.memberUntil !== null) patch.memberUntil = desired.memberUntil;
  if (typeof current.currentPlanId !== 'string' && current.currentPlanId !== null) patch.currentPlanId = desired.currentPlanId;
  if (typeof current.lastPaymentAt !== 'number' && current.lastPaymentAt !== null) patch.lastPaymentAt = desired.lastPaymentAt;
  if (typeof current.premium5dNotifiedForUntil !== 'number' && current.premium5dNotifiedForUntil !== null) {
    patch.premium5dNotifiedForUntil = desired.premium5dNotifiedForUntil;
  }
  if (typeof current.createdAt !== 'number') patch.createdAt = desired.createdAt;

  return patch;
}

export function buildUsuarioPublicoPatch(current = {}, options = {}) {
  const now = Number(options.now || Date.now());
  const patch = {};

  const userName = asNonEmptyString(options.userName || current.userName, 'Guerreiro');
  const userAvatar = asNonEmptyString(options.userAvatar || current.userAvatar, AVATAR_FALLBACK);
  const accountType = asNonEmptyString(options.accountType || current.accountType, 'comum');
  const signupIntent = asNonEmptyString(options.signupIntent || current.signupIntent, 'reader');

  if (!asNonEmptyString(current.uid)) patch.uid = options.uid;
  if (options.userName || !asNonEmptyString(current.userName)) patch.userName = userName;
  if (options.userAvatar || !asNonEmptyString(current.userAvatar)) patch.userAvatar = userAvatar;
  if (options.accountType || !asNonEmptyString(current.accountType)) patch.accountType = accountType;
  if (!asNonEmptyString(current.signupIntent)) patch.signupIntent = signupIntent;

  const uhIn = options.userHandle != null ? String(options.userHandle || '').trim().toLowerCase() : null;
  if (uhIn && uhIn !== String(current.userHandle || '').trim().toLowerCase()) {
    patch.userHandle = uhIn;
  }

  if (Object.keys(patch).length) patch.updatedAt = now;

  return patch;
}
