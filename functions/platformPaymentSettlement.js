/**
 * Canonical settlement layer for approved payments.
 *
 * It computes the split and applies it once to the real ledger:
 * - creatorData/*
 * - financas/creatorRevenueEvents
 * - financas/creatorRevenueSummary
 */

import { logger } from 'firebase-functions';
import {
  round2,
  sanitizeCreatorId,
  applyExplicitApprovedFinancialSettlement,
} from './creatorDataLedger.js';

/** @typedef {'STORE_MEMBERSHIP' | 'CREATOR_MEMBERSHIP' | 'DONATION'} UnifiedTransactionType */

/**
 * @param {string | null | undefined} rawSource
 * @param {string | null | undefined} creatorIdHint
 * @returns {'platform' | 'creator_link'}
 */
export function normalizeUnifiedSource(rawSource, creatorIdHint) {
  const source = String(rawSource || '').toLowerCase().trim();
  if (source === 'creator_link' || source === 'platform') return source;
  return sanitizeCreatorId(creatorIdHint) ? 'creator_link' : 'platform';
}

/**
 * @param {string} unifiedType
 * @param {'platform' | 'creator_link'} source
 * @param {number} grossBRL
 */
export function computeUnifiedSplit(unifiedType, source, grossBRL) {
  const gross = round2(grossBRL);
  const normalizedSource = source === 'creator_link' ? 'creator_link' : 'platform';
  const type = String(unifiedType || '').toUpperCase();
  let platformPct = 1;
  let creatorPct = 0;

  if (type === 'STORE_MEMBERSHIP') {
    if (normalizedSource === 'creator_link') {
      platformPct = 0.85;
      creatorPct = 0.15;
    }
  } else if (type === 'CREATOR_MEMBERSHIP') {
    platformPct = 0.2;
    creatorPct = 0.8;
  } else if (type === 'DONATION') {
    if (normalizedSource === 'creator_link') {
      platformPct = 0.2;
      creatorPct = 0.8;
    }
  }

  const platformAmount = round2(gross * platformPct);
  const creatorAmount = round2(Math.max(0, gross - platformAmount));
  return { platformAmount, creatorAmount, platformPct, creatorPct };
}

/**
 * @param {import('firebase-admin/database').Database} db
 * @param {{
 *   mpPaymentId: string,
 *   userId: string,
 *   unifiedType: UnifiedTransactionType | string,
 *   creatorId?: string | null,
 *   source: 'platform' | 'creator_link',
 *   grossBRL: number,
 *   currency?: string,
 *   creatorDataPaymentType: string,
 *   extra?: Record<string, unknown>,
 *   orderId?: string | null,
 * }} input
 * @returns {Promise<{ ok: boolean, duplicate?: boolean, reason?: string }>}
 */
export async function tryCommitUnifiedApprovedSettlement(db, input) {
  const paymentId = String(input.mpPaymentId || '').trim();
  const userId = String(input.userId || '').trim();
  if (!paymentId || !userId) {
    logger.warn('settlement: missing paymentId or userId', { paymentId, userId });
    return { ok: false, reason: 'missing_ids' };
  }

  const gross = round2(input.grossBRL);
  if (!Number.isFinite(gross) || gross <= 0) {
    logger.warn('settlement: invalid gross', { paymentId, gross });
    return { ok: false, reason: 'invalid_gross' };
  }

  const source = input.source === 'creator_link' ? 'creator_link' : 'platform';
  const unifiedType = String(input.unifiedType || '').toUpperCase();
  let creatorId = sanitizeCreatorId(input.creatorId);
  const { platformAmount, creatorAmount, platformPct, creatorPct } = computeUnifiedSplit(
    unifiedType,
    source,
    gross
  );

  let platformFeeBRL = platformAmount;
  let creatorNetBRL = creatorAmount;
  if (creatorNetBRL > 0 && !creatorId) {
    logger.warn('settlement: creator share without creatorId, consolidating to platform', {
      paymentId,
      unifiedType,
    });
    platformFeeBRL = round2(platformFeeBRL + creatorNetBRL);
    creatorNetBRL = 0;
  }

  if (unifiedType === 'STORE_MEMBERSHIP' && source === 'platform') {
    creatorId = null;
    if (creatorNetBRL > 0) {
      platformFeeBRL = round2(platformFeeBRL + creatorNetBRL);
      creatorNetBRL = 0;
    }
  }

  const result = await applyExplicitApprovedFinancialSettlement(db, {
    creatorId,
    buyerUid: userId,
    paymentId,
    currency: String(input.currency || 'BRL'),
    grossBRL: gross,
    creatorNetBRL,
    platformFeeBRL,
    creatorDataPaymentType: String(input.creatorDataPaymentType || 'other'),
    extra: {
      unifiedType,
      source,
      platformPct,
      creatorPct,
      ...(input.extra && typeof input.extra === 'object' ? input.extra : {}),
    },
    orderId: input.orderId || null,
    entryKey: `unified_${unifiedType}_${paymentId}`,
  });

  if (!result?.ok) {
    if (result?.duplicate) return { ok: false, duplicate: true };
    return { ok: false, reason: result?.reason || 'contention' };
  }

  return { ok: true };
}
