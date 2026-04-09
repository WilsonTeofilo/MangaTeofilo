function toMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeStatus(value, fallback = 'inativo') {
  const raw = String(value || fallback).trim().toLowerCase();
  return raw || fallback;
}

function hasCanonicalGlobalEntitlement(raw) {
  if (!raw || typeof raw !== 'object') return false;
  return (
    typeof raw.isPremium === 'boolean' ||
    typeof raw.memberUntil === 'number' ||
    typeof raw.premiumUntil === 'number' ||
    String(raw.status || '').trim().length > 0
  );
}

function normalizeGlobalPremiumEntitlement(perfil) {
  const now = Date.now();
  const raw = perfil?.userEntitlements?.global || {};
  const memberUntil = toMs(raw.memberUntil || raw.premiumUntil);
  const status = normalizeStatus(raw.status, memberUntil > now ? 'ativo' : 'inativo');
  const isPremium = normalizeBoolean(raw.isPremium);

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
  const isMember = normalizeBoolean(row.isMember) || (status === 'ativo' && memberUntil > Date.now());
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

export function obterUserEntitlements(perfil) {
  const global = normalizeGlobalPremiumEntitlement(perfil);
  const mergedCreators = {};

  const entCreators = perfil?.userEntitlements?.creators;
  if (entCreators && typeof entCreators === 'object') {
    for (const [creatorId, row] of Object.entries(entCreators)) {
      const normalized = normalizeCreatorMembershipRow(creatorId, row);
      if (normalized) mergedCreators[normalized.creatorId] = normalized;
    }
  }

  return {
    global,
    creators: mergedCreators,
  };
}

export function obterEntitlementPremiumGlobal(perfil) {
  return obterUserEntitlements(perfil).global;
}

export function obterEntitlementCriador(perfil, creatorId) {
  const cid = String(creatorId || '').trim();
  if (!cid) return null;
  return obterUserEntitlements(perfil).creators[cid] || null;
}

export function listarEntitlementsDeCriador(perfil) {
  return Object.values(obterUserEntitlements(perfil).creators)
    .filter((row) => row?.creatorId)
    .sort((a, b) => toMs(b?.memberUntil) - toMs(a?.memberUntil));
}
