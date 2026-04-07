/**
 * Documento canônico `usuarios/{uid}/creator` (Realtime Database).
 * Espelha a estrutura lógica pedida (perfil / social / monetização PIX / meta).
 * O fluxo vivo deve ler deste documento canônico; campos legados restantes existem
 * apenas para saneamento administrativo durante a migração.
 */

import {
  parseBirthDateStrict,
  resolveCreatorAgeYears,
} from './creatorCompliance.js';
import { inferPayoutPixTypeFromKey, PAYOUT_PIX_TYPES } from './pixKey.js';

/**
 * Nome legal para monetização: pelo menos 3 palavras (ex.: Nome Sobrenome Filho).
 */
export function legalFullNameHasMinThreeWords(s) {
  const parts = String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
  return parts.length >= 3;
}

export function legalFullNameHasNoDigits(s) {
  return !/\d/.test(String(s || '').trim());
}

export function normalizePixKey(raw) {
  return String(raw || '').trim();
}

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function resolveCreatorMonetizationPreferenceFromDb(row, fallback = 'publish_only') {
  const mon = row?.creator?.monetization;
  if (mon && typeof mon === 'object') {
    if (mon.requested === true) return 'monetize';
    if (
      mon.enabled === true ||
      mon.isMonetizationActive === true ||
      mon.approved === true ||
      mon.isApproved === true ||
      Boolean(mon.legal) ||
      Boolean(mon.payout)
    ) {
      return 'monetize';
    }
    if (mon.requested === false) return 'publish_only';
  }
  return String(fallback || 'publish_only').trim().toLowerCase() === 'monetize' ? 'monetize' : 'publish_only';
}

export function readCreatorStatsFromDb(row, creatorStatsRow = null) {
  const canonical =
    creatorStatsRow && typeof creatorStatsRow === 'object'
      ? creatorStatsRow
      : row?.creatorStats && typeof row.creatorStats === 'object'
        ? row.creatorStats
        : {};
  return {
    followersCount: toSafeNumber(canonical?.followersCount),
    totalViews: toSafeNumber(canonical?.totalViews),
    likesTotal: toSafeNumber(canonical?.likesTotal),
    commentsTotal: toSafeNumber(canonical?.commentsTotal),
    membersCount: toSafeNumber(canonical?.membersCount),
    revenueTotal: Math.round(toSafeNumber(canonical?.revenueTotal) * 100) / 100,
    uniqueReaders: toSafeNumber(canonical?.uniqueReaders),
    updatedAt: Number(canonical?.updatedAt ?? 0) || 0,
  };
}

function payoutPixTypeFromCompliance(c, pixKey) {
  const p = String(c?.payoutPixType || '').trim().toLowerCase();
  if (PAYOUT_PIX_TYPES.includes(p)) return p;
  return inferPayoutPixTypeFromKey(pixKey);
}

/**
 * @param {object} params
 * @param {object} params.row - linha atual usuarios/{uid}
 * @param {string} params.birthDateIso - YYYY-MM-DD
 * @param {string} params.displayName
 * @param {string} params.bio
 * @param {string} params.instagramUrl
 * @param {string} params.youtubeUrl
 * @param {'monetize'|'publish_only'} params.monetizationPreference
 * @param {string} params.creatorMonetizationStatus - disabled | active | blocked_underage
 * @param {{ legalFullName?: string, taxId?: string, payoutInstructions?: string } | null} params.compliance
 * @param {number} params.now
 */
export function assembleCreatorRecordForRtdb({
  row,
  birthDateIso,
  displayName,
  bio,
  instagramUrl,
  youtubeUrl,
  monetizationPreference,
  creatorMonetizationStatus,
  compliance,
  now,
}) {
  const birth =
    birthDateIso && parseBirthDateStrict(String(birthDateIso).trim())
      ? String(birthDateIso).trim()
      : null;
  const age = resolveCreatorAgeYears({
    ...row,
    birthDate: birth || row?.birthDate,
    birthYear: row?.birthYear,
  });
  const isAdult = age != null && age >= 18;
  const pref = monetizationPreference === 'monetize' ? 'monetize' : 'publish_only';
  const st = String(creatorMonetizationStatus || 'disabled').trim().toLowerCase();
  const approvedOnce =
    row?.creator?.monetization?.approved === true ||
    row?.creator?.monetization?.isApproved === true ||
    st === 'active';

  const prev = row?.creator && typeof row.creator === 'object' ? row.creator : {};
  const prevMon =
    prev.monetization && typeof prev.monetization === 'object' ? prev.monetization : {};
  const createdAt = Number(prev.meta?.createdAt) || now;

  const ig = String(instagramUrl || '').trim().slice(0, 200) || null;
  const yt = String(youtubeUrl || '').trim().slice(0, 200) || null;

  let monetization;
  if (!isAdult) {
    monetization = {
      enabled: false,
      isMonetizationActive: false,
      requested: false,
      approved: false,
      isApproved: false,
      legal: null,
      payout: null,
    };
  } else if (pref !== 'monetize') {
    monetization = {
      enabled: false,
      isMonetizationActive: false,
      requested: false,
      approved: approvedOnce,
      isApproved: approvedOnce,
      legal: approvedOnce ? prevMon.legal || null : null,
      payout: approvedOnce ? prevMon.payout || null : null,
    };
  } else {
    const c = compliance && typeof compliance === 'object' ? compliance : null;
    const fullName = c ? String(c.legalFullName || '').trim() : '';
    const cpfDigits = c ? String(c.taxId || '').replace(/\D/g, '') : '';
    const pixKey = c ? normalizePixKey(c.payoutInstructions) : '';
    const pixType = c ? payoutPixTypeFromCompliance(c, pixKey) : 'random';
    const hasCompliance =
      fullName.length >= 6 && cpfDigits.length === 11 && pixKey.length > 0;

    monetization = {
      enabled: st === 'active',
      isMonetizationActive: st === 'active',
      requested: true,
      approved: approvedOnce,
      isApproved: approvedOnce,
      legal: hasCompliance ? { fullName, cpf: cpfDigits } : prevMon.legal || null,
      payout: hasCompliance
        ? { type: 'pix', key: pixKey.slice(0, 2000), pixType }
        : prevMon.payout || null,
    };
  }

  const BIO_MAX = 450;
  return {
    profile: {
      displayName: String(displayName || '').trim().slice(0, 60),
      bio: String(bio || '').trim().slice(0, BIO_MAX),
      birthDate: birth,
    },
    social: {
      instagram: ig,
      youtube: yt,
    },
    monetization,
    meta: {
      isAdult,
      createdAt,
      updatedAt: now,
    },
  };
}

/**
 * Unifica status de monetização para listagens/admin quando campos divergem
 * (ex.: `creatorProfile` atualizado e raiz atrasada, ou `creator.monetization` com approved/enabled).
 */
export function resolveCreatorMonetizationStatusFromDb(row) {
  if (!row || typeof row !== 'object') return '';
  const mon = row.creator?.monetization;
  if (row?.creator?.meta?.isAdult === false) return 'blocked_underage';
  if (
    mon &&
    typeof mon === 'object' &&
    (mon.enabled === true || mon.isMonetizationActive === true) &&
    (mon.approved === true || mon.isApproved === true)
  ) {
    return 'active';
  }
  return 'disabled';
}
