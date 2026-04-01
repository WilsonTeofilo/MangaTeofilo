function toMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(value, fallback = 'inativo') {
  const raw = String(value || fallback).trim().toLowerCase();
  return raw || fallback;
}

function normalizeGlobalEntitlement(profile = {}) {
  const now = Date.now();
  const raw = profile?.userEntitlements?.global || {};
  const fallbackUntil = toMs(profile.memberUntil);
  const fallbackStatus = normalizeStatus(profile.membershipStatus, fallbackUntil > now ? 'ativo' : 'inativo');
  const fallbackIsPremium =
    String(profile.accountType || '').toLowerCase() === 'premium' &&
    fallbackStatus === 'ativo' &&
    fallbackUntil > now;

  const memberUntil = toMs(raw.memberUntil || raw.premiumUntil || fallbackUntil);
  const status = normalizeStatus(raw.status, fallbackStatus);
  const isPremium =
    raw.isPremium === true ||
    (fallbackIsPremium && status === 'ativo' && memberUntil > now);

  return {
    isPremium: Boolean(isPremium && memberUntil > now && status === 'ativo'),
    status: memberUntil > now ? status : (status === 'ativo' ? 'vencido' : status),
    memberUntil,
  };
}

function normalizeCreatorMembershipRow(creatorId, row) {
  const cid = String(creatorId || '').trim();
  if (!cid || !row || typeof row !== 'object') return null;
  const memberUntil = toMs(row.memberUntil);
  const status = normalizeStatus(row.status, memberUntil > Date.now() ? 'ativo' : 'inativo');
  const isMember = row.isMember === true || (status === 'ativo' && memberUntil > Date.now());
  return {
    creatorId: cid,
    creatorName: row.creatorName || null,
    isMember,
    status: memberUntil > Date.now() ? status : (status === 'ativo' ? 'vencido' : status),
    memberUntil,
    updatedAt: toMs(row.updatedAt),
    lastPaymentAt: toMs(row.lastPaymentAt),
    lastPaymentId: row.lastPaymentId || null,
    lastPaymentAmount: Number.isFinite(Number(row.lastPaymentAmount)) ? Number(row.lastPaymentAmount) : null,
    lastPaymentCurrency: row.lastPaymentCurrency || null,
  };
}

export function buildUserEntitlements(profile = {}) {
  const global = normalizeGlobalEntitlement(profile);
  const creators = {};

  const entCreators = profile?.userEntitlements?.creators;
  if (entCreators && typeof entCreators === 'object') {
    for (const [creatorId, row] of Object.entries(entCreators)) {
      const normalized = normalizeCreatorMembershipRow(creatorId, row);
      if (normalized) creators[normalized.creatorId] = normalized;
    }
  }

  const legacyCreators = profile?.creatorMemberships;
  if (legacyCreators && typeof legacyCreators === 'object') {
    for (const [creatorId, row] of Object.entries(legacyCreators)) {
      const normalized = normalizeCreatorMembershipRow(creatorId, row);
      if (!normalized) continue;
      const current = creators[normalized.creatorId];
      if (!current || normalized.memberUntil >= current.memberUntil) {
        creators[normalized.creatorId] = {
          ...current,
          ...normalized,
        };
      }
    }
  }

  return {
    global,
    creators,
    updatedAt: Date.now(),
  };
}

export function buildUserEntitlementsPatch(profile = {}) {
  const entitlements = buildUserEntitlements(profile);
  const patch = {
    userEntitlements: {
      global: {
        isPremium: entitlements.global.isPremium,
        status: entitlements.global.status,
        memberUntil: entitlements.global.memberUntil || null,
      },
      creators: {},
      updatedAt: entitlements.updatedAt,
    },
  };

  for (const [creatorId, row] of Object.entries(entitlements.creators)) {
    patch.userEntitlements.creators[creatorId] = {
      isMember: row.isMember,
      status: row.status,
      memberUntil: row.memberUntil || null,
      creatorName: row.creatorName || null,
      lastPaymentAt: row.lastPaymentAt || null,
      lastPaymentId: row.lastPaymentId || null,
      lastPaymentAmount: row.lastPaymentAmount ?? null,
      lastPaymentCurrency: row.lastPaymentCurrency || null,
      updatedAt: row.updatedAt || entitlements.updatedAt,
    };
  }

  return patch;
}

