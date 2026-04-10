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
  const memberUntil = toMs(raw.memberUntil || raw.premiumUntil);
  const status = normalizeStatus(raw.status, memberUntil > now ? 'ativo' : 'inativo');
  const isPremium = raw.isPremium === true;

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

function mergeCreatorEntitlementRow(target, normalized) {
  if (!normalized) return target;
  const current = target[normalized.creatorId];
  if (!current || normalized.memberUntil >= current.memberUntil) {
    target[normalized.creatorId] = current
      ? {
          ...current,
          ...normalized,
        }
      : normalized;
  }
  return target;
}

function applyCanonicalCreatorEntitlements(target, entCreators) {
  if (!entCreators || typeof entCreators !== 'object') return target;
  for (const [creatorId, row] of Object.entries(entCreators)) {
    mergeCreatorEntitlementRow(target, normalizeCreatorMembershipRow(creatorId, row));
  }
  return target;
}

/**
 * Fonte canonica atual:
 * - `usuarios/{uid}/userEntitlements/global`
 * - `usuarios/{uid}/userEntitlements/creators`
 *
 * Campos top-level de premium sobrevivem apenas como projecao compat.
 */
export function buildUserEntitlements(profile = {}) {
  const global = normalizeGlobalEntitlement(profile);
  const creators = {};
  applyCanonicalCreatorEntitlements(creators, profile?.userEntitlements?.creators);

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


