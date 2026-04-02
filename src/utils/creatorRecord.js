/**
 * Documento canônico `usuarios/{uid}/creator` (Realtime Database) — espelho do servidor.
 * Usado no save do perfil do criador; compliance sensível continua via Cloud Functions.
 */

import { CREATOR_BIO_MAX_LENGTH } from '../constants';
import { ageFromBirthDateLocal, parseBirthDateLocal } from './birthDateAge';
import { inferPayoutPixTypeFromStoredKey } from './pixKeyInput';

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
  monetizationPreference,
  monetizationStatus,
  now = Date.now(),
}) {
  const birth = birthDateIso && parseBirthDateLocal(birthDateIso) ? birthDateIso : '';
  const age = birth ? ageFromBirthDateLocal(birth) : null;
  const isAdult = age != null && age >= 18;
  const pref = String(monetizationPreference || 'publish_only').toLowerCase() === 'monetize' ? 'monetize' : 'publish_only';
  const st = String(monetizationStatus || 'disabled').toLowerCase();

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

  let monetization;
  if (!isAdult || pref !== 'monetize') {
    monetization = {
      enabled: false,
      requested: false,
      approved: false,
      legal: null,
      payout: null,
    };
  } else {
    monetization = {
      enabled: st === 'active',
      requested: true,
      approved: st === 'active',
      legal: hasCompliance ? { fullName, cpf: cpfDigits } : null,
      payout: hasCompliance ? { type: 'pix', key: pixKey.slice(0, 2000), pixType } : null,
    };
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
      enabled: c.enabled === true,
      requested: c.requested === true,
      approved: c.approved === true,
      hasPixPayout: Boolean(c.payout?.key),
      hasLegal: Boolean(c.legal?.fullName && c.legal?.cpf),
    };
  }
  const st = String(row?.creatorMonetizationStatus || '').toLowerCase();
  const pref = String(row?.creatorMonetizationPreference || '').toLowerCase();
  return {
    enabled: st === 'active',
    requested: pref === 'monetize' && (st === 'pending_review' || st === 'active' || st === 'blocked_underage'),
    approved: st === 'active',
    hasPixPayout: Boolean(String(row?.creatorCompliance?.payoutInstructions || '').trim()),
    hasLegal: Boolean(String(row?.creatorCompliance?.legalFullName || '').trim()),
  };
}
