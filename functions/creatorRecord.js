/**
 * Documento canônico `usuarios/{uid}/creator` (Realtime Database).
 * Espelha a estrutura lógica pedida (perfil / social / monetização PIX / meta).
 * Campos legados (creatorMonetizationStatus, creatorCompliance, etc.) continuam sincronizados nos callables.
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
    row?.creatorMonetizationApprovedOnce === true ||
    row?.creator?.monetization?.approved === true ||
    st === 'active';

  const prev = row?.creator && typeof row.creator === 'object' ? row.creator : {};
  const createdAt = Number(prev.meta?.createdAt) || now;

  const ig = String(instagramUrl || '').trim().slice(0, 200) || null;
  const yt = String(youtubeUrl || '').trim().slice(0, 200) || null;

  let monetization;
  if (!isAdult) {
    monetization = {
      enabled: false,
      requested: false,
      approved: false,
      legal: null,
      payout: null,
    };
  } else if (pref !== 'monetize') {
    monetization = {
      enabled: false,
      requested: false,
      approved: false,
      legal: null,
      payout: null,
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
      requested: true,
      approved: approvedOnce,
      legal: hasCompliance ? { fullName, cpf: cpfDigits } : null,
      payout: hasCompliance
        ? { type: 'pix', key: pixKey.slice(0, 2000), pixType }
        : null,
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
  const top = String(row.creatorMonetizationStatus || '').trim().toLowerCase();
  const prof = String(row.creatorProfile?.monetizationStatus || '').trim().toLowerCase();
  const mon = row.creator?.monetization;
  const nestedActive =
    mon && typeof mon === 'object' && mon.enabled === true && mon.approved === true;
  if (nestedActive) return 'active';
  const pool = [top, prof].filter(Boolean);
  if (pool.includes('active')) return 'active';
  if (pool.includes('blocked_underage')) return 'blocked_underage';
  if (pool.includes('disabled')) return 'disabled';
  if (pool.includes('pending_review')) return row?.creatorMonetizationApprovedOnce === true ? 'active' : 'disabled';
  return top || prof || '';
}
