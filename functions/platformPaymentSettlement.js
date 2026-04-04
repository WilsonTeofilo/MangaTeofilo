/**
 * Camada unificada de liquidação: split explícito + ledger canônico (financas/unified*).
 * Webhook + GET /v1/payments/{id} são fonte de verdade; metadata guia o tipo/source.
 *
 * Ordem: lock leve → applyExplicit (idempotente) → unifiedLedger → unifiedPayments final.
 */

import { logger } from 'firebase-functions';
import {
  round2,
  sanitizeCreatorId,
  applyExplicitApprovedFinancialSettlement,
} from './creatorDataLedger.js';

const PROCESSING_STALE_MS = 10 * 60 * 1000;

/** @typedef {'STORE_MEMBERSHIP' | 'CREATOR_MEMBERSHIP' | 'DONATION'} UnifiedTransactionType */

/**
 * @param {string | null | undefined} rawSource
 * @param {string | null | undefined} creatorIdHint
 * @returns {'platform' | 'creator_link'}
 */
export function normalizeUnifiedSource(rawSource, creatorIdHint) {
  const s = String(rawSource || '').toLowerCase().trim();
  if (s === 'creator_link' || s === 'platform') return s;
  return sanitizeCreatorId(creatorIdHint) ? 'creator_link' : 'platform';
}

/**
 * @param {string} unifiedType
 * @param {'platform' | 'creator_link'} source
 * @param {number} grossBRL
 */
export function computeUnifiedSplit(unifiedType, source, grossBRL) {
  const g = round2(grossBRL);
  const src = source === 'creator_link' ? 'creator_link' : 'platform';
  const t = String(unifiedType || '').toUpperCase();
  let platformPct = 1;
  let creatorPct = 0;
  if (t === 'STORE_MEMBERSHIP') {
    if (src === 'creator_link') {
      platformPct = 0.85;
      creatorPct = 0.15;
    } else {
      platformPct = 1;
      creatorPct = 0;
    }
  } else if (t === 'CREATOR_MEMBERSHIP') {
    platformPct = 0.2;
    creatorPct = 0.8;
  } else if (t === 'DONATION') {
    if (src === 'creator_link') {
      platformPct = 0.2;
      creatorPct = 0.8;
    } else {
      platformPct = 1;
      creatorPct = 0;
    }
  }
  const platformAmount = round2(g * platformPct);
  const creatorAmount = round2(Math.max(0, g - platformAmount));
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
  const pid = String(input.mpPaymentId || '').trim();
  const userId = String(input.userId || '').trim();
  if (!pid || !userId) {
    logger.warn('unified settlement: missing paymentId or userId', { pid, userId });
    return { ok: false, reason: 'missing_ids' };
  }
  const gross = round2(input.grossBRL);
  if (!Number.isFinite(gross) || gross <= 0) {
    logger.warn('unified settlement: invalid gross', { pid, gross });
    return { ok: false, reason: 'invalid_gross' };
  }
  const src = input.source === 'creator_link' ? 'creator_link' : 'platform';
  const ut = String(input.unifiedType || '').toUpperCase();
  let cid = sanitizeCreatorId(input.creatorId);
  const { platformAmount, creatorAmount, platformPct, creatorPct } = computeUnifiedSplit(ut, src, gross);

  let platformAmt = platformAmount;
  let creatorAmt = creatorAmount;
  if (creatorAmt > 0 && !cid) {
    logger.warn('unified settlement: creator share sem creator_id — consolidando na plataforma', {
      pid,
      ut,
    });
    platformAmt = round2(platformAmt + creatorAmt);
    creatorAmt = 0;
  }
  if (ut === 'STORE_MEMBERSHIP' && src === 'platform') {
    cid = null;
    if (creatorAmt > 0) {
      platformAmt = round2(platformAmt + creatorAmt);
      creatorAmt = 0;
    }
  }

  const payRef = db.ref(`financas/unifiedPayments/${pid}`);
  const doneSnap = await payRef.get();
  const doneVal = doneSnap.val();
  if (doneVal && typeof doneVal === 'object' && doneVal.ledgerWritten === true) {
    return { ok: false, duplicate: true };
  }

  const trx = await payRef.transaction((curr) => {
    const c = curr && typeof curr === 'object' ? curr : {};
    if (c.ledgerWritten === true) return undefined;
    const proc = Number(c.processingAt || 0);
    if (proc && Date.now() - proc < PROCESSING_STALE_MS) return undefined;
    return {
      ...c,
      mp_payment_id: pid,
      processingAt: Date.now(),
    };
  });
  if (!trx.committed) {
    const prev = trx.snapshot?.val();
    if (prev && typeof prev === 'object' && prev.ledgerWritten === true) {
      return { ok: false, duplicate: true };
    }
    return { ok: false, reason: 'contention' };
  }

  const record = {
    mp_payment_id: pid,
    user_id: userId,
    type: ut,
    creator_id: cid || null,
    source: src,
    amount_total: gross,
    platform_amount: platformAmt,
    creator_amount: creatorAmt,
    platform_pct: platformPct,
    creator_pct: creatorPct,
    status: 'approved',
    currency: String(input.currency || 'BRL'),
    created_at: Date.now(),
  };

  const extra = {
    unifiedType: ut,
    source: src,
    platformPct,
    creatorPct,
    ...(input.extra && typeof input.extra === 'object' ? input.extra : {}),
  };

  try {
    await applyExplicitApprovedFinancialSettlement(db, {
      creatorId: cid,
      buyerUid: userId,
      paymentId: pid,
      currency: String(input.currency || 'BRL'),
      grossBRL: gross,
      creatorNetBRL: creatorAmt,
      platformFeeBRL: platformAmt,
      creatorDataPaymentType: String(input.creatorDataPaymentType || 'other'),
      extra,
      orderId: input.orderId || null,
      entryKey: `unified_${ut}_${pid}`,
    });

    await db.ref(`financas/unifiedLedger/${pid}`).set({
      payment_id: pid,
      mp_payment_id: pid,
      user_id: userId,
      creator_id: cid || null,
      platform_amount: platformAmt,
      creator_amount: creatorAmt,
      type: ut,
      source: src,
      currency: String(input.currency || 'BRL'),
      created_at: Date.now(),
      creatorDataPaymentType: String(input.creatorDataPaymentType || ''),
    });

    await payRef.update({
      ...record,
      ledgerWritten: true,
      processingAt: null,
    });
  } catch (e) {
    logger.error('unified settlement failed', { pid, error: e?.message });
    const msg = String(e?.message || '');
    if (!msg.includes('apply_explicit_lock_contention')) {
      try {
        await payRef.update({ processingAt: null });
      } catch (err) {
        logger.warn('unified settlement: falha ao limpar processingAt', { pid, error: err?.message });
      }
    }
    throw e;
  }

  return { ok: true };
}
