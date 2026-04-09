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
import { isValidCreatorMembershipPriceBRL } from './creatorMembershipPricing.js';

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

export function normalizeCreatorMonetizationPreference(value, fallback = 'publish_only') {
  return String(value || fallback || 'publish_only').trim().toLowerCase() === 'monetize'
    ? 'monetize'
    : 'publish_only';
}

function normalizeCreatorSupportOfferShape(input = {}, { defaultEnabled = false } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const membershipPriceRaw = Number(source.membershipPriceBRL);
  const donationSuggestedRaw = Number(source.donationSuggestedBRL);
  return {
    membershipEnabled:
      typeof source.membershipEnabled === 'boolean' ? source.membershipEnabled : defaultEnabled,
    membershipPriceBRL: isValidCreatorMembershipPriceBRL(membershipPriceRaw) ? membershipPriceRaw : null,
    donationSuggestedBRL: isValidCreatorMembershipPriceBRL(donationSuggestedRaw) ? donationSuggestedRaw : null,
    updatedAt: Number(source.updatedAt || 0) || 0,
  };
}

export function readCreatorSupportOfferFromDb(row) {
  if (!row || typeof row !== 'object') {
    return normalizeCreatorSupportOfferShape({}, { defaultEnabled: false });
  }
  const canonicalOffer =
    row?.creator?.monetization?.offer && typeof row.creator.monetization.offer === 'object'
      ? row.creator.monetization.offer
      : null;
  if (canonicalOffer) {
    return normalizeCreatorSupportOfferShape(canonicalOffer, { defaultEnabled: false });
  }
  const projectedOffer =
    row?.publicProfile?.creatorProfile?.supportOffer &&
    typeof row.publicProfile.creatorProfile.supportOffer === 'object'
      ? row.publicProfile.creatorProfile.supportOffer
      : null;
  if (projectedOffer) {
    return normalizeCreatorSupportOfferShape(projectedOffer, { defaultEnabled: false });
  }
  return normalizeCreatorSupportOfferShape({}, { defaultEnabled: false });
}

export function resolveCreatorMonetizationPreferenceFromDb(row, fallback = 'publish_only') {
  const mon = row?.creator?.monetization;
  if (mon && typeof mon === 'object') {
    if (String(mon.preference || '').trim().length > 0) {
      return normalizeCreatorMonetizationPreference(mon.preference, fallback);
    }
    const applicationStatus = String(mon?.application?.status || '').trim().toLowerCase();
    const financialStatus = String(mon?.financial?.status || '').trim().toLowerCase();
    if (
      ['pending', 'approved', 'rejected', 'blocked_underage'].includes(applicationStatus) ||
      ['active', 'paused'].includes(financialStatus) ||
      Boolean(mon.legal) ||
      Boolean(mon.payout)
    ) {
      return 'monetize';
    }
  }
  return String(fallback || 'publish_only').trim().toLowerCase() === 'monetize' ? 'monetize' : 'publish_only';
}

export function resolveCreatorMonetizationApplicationStatusFromDb(row) {
  if (!row || typeof row !== 'object') return 'not_requested';
  const mon = row?.creator?.monetization;
  const canonical = String(mon?.application?.status || '').trim().toLowerCase();
  if (canonical) return canonical;
  if (row?.creator?.meta?.isAdult === false) return 'blocked_underage';
  return 'not_requested';
}

export function resolveCreatorFinancialStatusFromDb(row) {
  if (!row || typeof row !== 'object') return 'inactive';
  const mon = row?.creator?.monetization;
  const canonical = String(mon?.financial?.status || '').trim().toLowerCase();
  if (canonical === 'active' || canonical === 'inactive' || canonical === 'paused') {
    return canonical;
  }
  return 'inactive';
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
  const pref = normalizeCreatorMonetizationPreference(
    monetizationPreference,
    row?.creator?.monetization?.preference || 'publish_only'
  );
  const st = String(creatorMonetizationStatus || 'disabled').trim().toLowerCase();

  const prev = row?.creator && typeof row.creator === 'object' ? row.creator : {};
  const prevMon =
    prev.monetization && typeof prev.monetization === 'object' ? prev.monetization : {};
  const createdAt = Number(prev.meta?.createdAt) || now;
  const previousApplicationStatus = resolveCreatorMonetizationApplicationStatusFromDb(row);
  const previousFinancialStatus = resolveCreatorFinancialStatusFromDb(row);
  const previousOffer = readCreatorSupportOfferFromDb(row);
  const approvedOnce =
    previousApplicationStatus === 'approved' ||
    st === 'active';

  const ig = String(instagramUrl || '').trim().slice(0, 200) || null;
  const yt = String(youtubeUrl || '').trim().slice(0, 200) || null;

  let applicationStatus = 'not_requested';
  let financialStatus = 'inactive';
  if (!isAdult) {
    applicationStatus = 'blocked_underage';
  } else if (pref === 'monetize') {
    applicationStatus = approvedOnce ? 'approved' : 'pending';
    financialStatus = applicationStatus === 'approved' && st === 'active' ? 'active' : 'inactive';
  } else if (previousApplicationStatus === 'approved' || previousApplicationStatus === 'rejected') {
    applicationStatus = previousApplicationStatus;
    financialStatus = previousFinancialStatus === 'active' && st === 'active' ? 'active' : 'inactive';
  }

  let monetization;
  if (!isAdult) {
    monetization = {
      preference: pref,
      application: {
        status: applicationStatus,
        requestedAt: null,
        reviewedAt: prevMon?.application?.reviewedAt || null,
        reviewedBy: prevMon?.application?.reviewedBy || null,
        reviewReason: prevMon?.application?.reviewReason || null,
      },
      financial: {
        status: 'inactive',
        activatedAt: null,
        updatedAt: now,
      },
      offer: {
        ...previousOffer,
        membershipEnabled: false,
        updatedAt: now,
      },
      legal: null,
      payout: null,
    };
  } else if (pref !== 'monetize') {
    monetization = {
      preference: pref,
      application: {
        status: applicationStatus,
        requestedAt: prevMon?.application?.requestedAt || null,
        reviewedAt:
          applicationStatus === 'approved' || applicationStatus === 'rejected'
            ? prevMon?.application?.reviewedAt || now
            : null,
        reviewedBy: prevMon?.application?.reviewedBy || null,
        reviewReason: prevMon?.application?.reviewReason || null,
      },
      financial: {
        status: financialStatus,
        activatedAt:
          financialStatus === 'active' ? prevMon?.financial?.activatedAt || now : prevMon?.financial?.activatedAt || null,
        updatedAt: now,
      },
      offer: {
        ...previousOffer,
        updatedAt: now,
      },
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
      preference: pref,
      application: {
        status: applicationStatus,
        requestedAt:
          applicationStatus === 'pending'
            ? prevMon?.application?.requestedAt || now
            : prevMon?.application?.requestedAt || null,
        reviewedAt:
          applicationStatus === 'approved' || applicationStatus === 'rejected'
            ? prevMon?.application?.reviewedAt || now
            : prevMon?.application?.reviewedAt || null,
        reviewedBy: prevMon?.application?.reviewedBy || null,
        reviewReason: prevMon?.application?.reviewReason || null,
      },
      financial: {
        status: financialStatus,
        activatedAt:
          financialStatus === 'active' ? prevMon?.financial?.activatedAt || now : prevMon?.financial?.activatedAt || null,
        updatedAt: now,
      },
      offer: {
        ...previousOffer,
        updatedAt: now,
      },
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
  const applicationStatus = resolveCreatorMonetizationApplicationStatusFromDb(row);
  const financialStatus = resolveCreatorFinancialStatusFromDb(row);
  if (applicationStatus === 'blocked_underage' || row?.creator?.meta?.isAdult === false) {
    return 'blocked_underage';
  }
  if (applicationStatus === 'approved' && financialStatus === 'active') {
    return 'active';
  }
  return 'disabled';
}
