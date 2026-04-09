/**
 * Documento canônico `usuarios/{uid}/creator` (Realtime Database) — espelho do servidor.
 * Usado no save do perfil do criador; compliance sensível continua via Cloud Functions.
 */

import { CREATOR_BIO_MAX_LENGTH } from '../constants';
import { ageFromBirthDateLocal, parseBirthDateLocal } from './birthDateAge';
import { inferPayoutPixTypeFromStoredKey } from './pixKeyInput';
import {
  CREATOR_MEMBERSHIP_PRICE_MAX_BRL,
  CREATOR_MEMBERSHIP_PRICE_MIN_BRL,
} from '../constants';

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

/** Nome legal: sem dígitos (colar CPF no campo não deve “entrar”). */
export function sanitizeLegalFullNameInput(raw) {
  return String(raw || '').replace(/\d/g, '');
}

export function normalizePixKeyInput(raw) {
  return String(raw || '').trim();
}

/** CPF no formulário: somente dígitos, máximo 11. */
export function sanitizeCpfDigitsInput(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 11);
}

/**
 * Monta o objeto `creator` para merge no RTDB a partir do estado do formulário.
 * Dados legais/PIX vêm apenas de `perfilDb.creatorCompliance` (leitura; escrita só no callable).
 */
export function buildCreatorRecordForProfileSave({
  perfilDb,
  birthDateIso,
  displayName,
  bio,
  instagramUrl,
  youtubeUrl,
  now = Date.now(),
}) {
  const birth = birthDateIso && parseBirthDateLocal(birthDateIso) ? birthDateIso : '';
  const age = birth ? ageFromBirthDateLocal(birth) : null;
  const isAdult = age != null && age >= 18;
  const prev = perfilDb?.creator && typeof perfilDb.creator === 'object' ? perfilDb.creator : {};
  const createdAt = Number(prev.meta?.createdAt) || now;

  const ig = String(instagramUrl || '').trim().slice(0, 200) || null;
  const yt = String(youtubeUrl || '').trim().slice(0, 200) || null;

  const compliance = perfilDb?.creatorCompliance && typeof perfilDb.creatorCompliance === 'object'
    ? perfilDb.creatorCompliance
    : null;
  const fullName = compliance ? String(compliance.legalFullName || '').trim() : '';
  const cpfDigits = compliance ? String(compliance.taxId || '').replace(/\D/g, '') : '';
  const pixKey = compliance ? normalizePixKeyInput(compliance.payoutInstructions) : '';
  const pixTypeRaw = compliance ? String(compliance.payoutPixType || '').trim().toLowerCase() : '';
  const pixType =
    pixTypeRaw === 'cpf' || pixTypeRaw === 'email' || pixTypeRaw === 'phone' || pixTypeRaw === 'random'
      ? pixTypeRaw
      : inferPayoutPixTypeFromStoredKey(pixKey);
  const hasCompliance = fullName.length >= 6 && cpfDigits.length === 11 && pixKey.length > 0;

  const prevMon = prev.monetization && typeof prev.monetization === 'object' ? prev.monetization : {};
  const prevOffer = prevMon.offer && typeof prevMon.offer === 'object' ? prevMon.offer : {};
  const membershipPrice = Number(prevOffer.membershipPriceBRL);
  const donationSuggested = Number(prevOffer.donationSuggestedBRL);
  const hasValidMembershipPrice =
    Number.isFinite(membershipPrice) &&
    membershipPrice >= CREATOR_MEMBERSHIP_PRICE_MIN_BRL &&
    membershipPrice <= CREATOR_MEMBERSHIP_PRICE_MAX_BRL;
  const hasValidDonationSuggested =
    Number.isFinite(donationSuggested) &&
    donationSuggested >= CREATOR_MEMBERSHIP_PRICE_MIN_BRL &&
    donationSuggested <= CREATOR_MEMBERSHIP_PRICE_MAX_BRL;
  const legalDoc = hasCompliance ? { fullName, cpf: cpfDigits } : prevMon.legal || null;
  const payoutDoc = hasCompliance
    ? { type: 'pix', key: pixKey.slice(0, 2000), pixType }
    : prevMon.payout || null;
  const previousApplication =
    prevMon.application && typeof prevMon.application === 'object' ? prevMon.application : {};
  const previousFinancial =
    prevMon.financial && typeof prevMon.financial === 'object' ? prevMon.financial : {};
  const monetization = {
    ...prevMon,
    preference:
      String(prevMon.preference || '').trim().toLowerCase() === 'monetize' ? 'monetize' : 'publish_only',
    application: {
      status: String(previousApplication.status || '').trim().toLowerCase() || (isAdult ? 'not_requested' : 'blocked_underage'),
      requestedAt: previousApplication.requestedAt || null,
      reviewedAt: previousApplication.reviewedAt || null,
      reviewedBy: previousApplication.reviewedBy || null,
      reviewReason: previousApplication.reviewReason || null,
    },
    financial: {
      status:
        String(previousFinancial.status || '').trim().toLowerCase() === 'active'
          ? 'active'
          : String(previousFinancial.status || '').trim().toLowerCase() === 'paused'
            ? 'paused'
            : 'inactive',
      activatedAt: previousFinancial.activatedAt || null,
      updatedAt: now,
    },
    offer: {
      membershipEnabled:
        prevOffer.membershipEnabled === true,
      membershipPriceBRL: hasValidMembershipPrice ? membershipPrice : null,
      donationSuggestedBRL: hasValidDonationSuggested ? donationSuggested : null,
      updatedAt: now,
    },
    legal: isAdult ? legalDoc : null,
    payout: isAdult ? payoutDoc : null,
  };
  if (!isAdult) {
    monetization.application.status = 'blocked_underage';
    monetization.financial.status = 'inactive';
    monetization.offer.membershipEnabled = false;
  }

  return {
    profile: {
      displayName: String(displayName || '').trim().slice(0, 60),
      bio: String(bio || '').trim().slice(0, CREATOR_BIO_MAX_LENGTH),
      birthDate: birth || null,
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

/** Leitura resiliente: prefer `creator`, senão deriva visão mínima dos campos legados. */
export function readCreatorMonetizationSummary(row) {
  const c = row?.creator?.monetization;
  if (c && typeof c === 'object') {
    return {
      enabled: String(c?.financial?.status || '').trim().toLowerCase() === 'active',
      requested: String(c?.application?.status || '').trim().toLowerCase() === 'pending',
      approved: String(c?.application?.status || '').trim().toLowerCase() === 'approved',
      hasPixPayout: Boolean(c.payout?.key),
      hasLegal: Boolean(c.legal?.fullName && c.legal?.cpf),
    };
  }
  return {
    enabled: false,
    requested: false,
    approved: false,
    hasPixPayout: false,
    hasLegal: false,
  };
}
