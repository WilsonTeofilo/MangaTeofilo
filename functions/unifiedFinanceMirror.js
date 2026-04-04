/**
 * Espelho canônico em financas/unified* para fluxos que ainda usam recordCreatorPayment
 * (loja física, estornos, POD). Não credita saldo — só auditoria / consistência com o ledger unificado.
 */

import { logger } from 'firebase-functions';
import { round2, sanitizeCreatorId } from './creatorDataLedger.js';

function safeLedgerKeyPart(s, max = 64) {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, max);
}

/**
 * Pedido loja física pago: um unifiedPayment + uma linha por criador (repasse 100% líquido do item).
 * Idempotente por mp_payment_id.
 */
export async function commitUnifiedStorePhysicalMirror(db, input) {
  const pid = String(input.mpPaymentId || '').trim();
  const buyerUid = String(input.buyerUid || '').trim();
  const orderId = String(input.orderId || '').trim();
  if (!pid || !buyerUid || !orderId) {
    logger.warn('commitUnifiedStorePhysicalMirror: ids incompletos', { pid, buyerUid, orderId });
    return { ok: false, reason: 'missing_ids' };
  }
  const totalBRL = round2(input.totalBRL);
  const currency = String(input.currency || 'BRL');
  const lines = Array.isArray(input.lines) ? input.lines : [];
  const normalized = [];
  for (const row of lines) {
    const cid = sanitizeCreatorId(row?.creatorId);
    const amt = round2(row?.amount);
    if (!cid || !Number.isFinite(amt) || amt <= 0) continue;
    normalized.push({ creatorId: cid, amount: amt });
  }

  const payRef = db.ref(`financas/unifiedPayments/${pid}`);
  const trx = await payRef.transaction((curr) => {
    if (curr && typeof curr === 'object' && curr.ledgerWritten === true) {
      return undefined;
    }
    return {
      mp_payment_id: pid,
      user_id: buyerUid,
      type: 'STORE_PHYSICAL',
      order_id: orderId,
      amount_total: totalBRL,
      status: 'approved',
      currency,
      created_at: Date.now(),
      ledgerWritten: true,
      source: 'checkout_store',
      line_count: normalized.length,
    };
  });
  if (!trx.committed) {
    const prev = trx.snapshot?.val();
    if (prev && typeof prev === 'object' && prev.ledgerWritten === true) {
      return { ok: false, duplicate: true };
    }
    return { ok: false, reason: 'contention' };
  }

  const patch = {};
  for (const { creatorId: cid, amount: amt } of normalized) {
    const lk = `${pid}__${safeLedgerKeyPart(cid, 90)}`;
    patch[`financas/unifiedLedger/${lk}`] = {
      payment_id: pid,
      mp_payment_id: pid,
      order_id: orderId,
      user_id: buyerUid,
      creator_id: cid,
      platform_amount: 0,
      creator_amount: amt,
      type: 'STORE_PHYSICAL',
      source: 'platform',
      currency,
      created_at: Date.now(),
    };
  }
  if (Object.keys(patch).length) {
    await db.ref().update(patch);
  }
  return { ok: true };
}

/**
 * POD pago: valor integral tratado como receita de plataforma no espelho (sem split criador no webhook).
 */
export async function commitUnifiedPodPaidMirror(db, input) {
  const pid = String(input.mpPaymentId || '').trim();
  const uid = String(input.userId || '').trim();
  const orderId = String(input.orderId || '').trim();
  const gross = round2(input.amountBRL);
  if (!pid || !uid || !orderId || !Number.isFinite(gross) || gross <= 0) {
    return { ok: false, reason: 'invalid_input' };
  }
  const currency = String(input.currency || 'BRL');
  const payRef = db.ref(`financas/unifiedPayments/${pid}`);
  const trx = await payRef.transaction((curr) => {
    if (curr && typeof curr === 'object' && curr.ledgerWritten === true) {
      return undefined;
    }
    return {
      mp_payment_id: pid,
      user_id: uid,
      type: 'PRINT_ON_DEMAND',
      order_id: orderId,
      amount_total: gross,
      platform_amount: gross,
      creator_amount: 0,
      status: 'approved',
      currency,
      created_at: Date.now(),
      ledgerWritten: true,
      source: 'print_on_demand',
    };
  });
  if (!trx.committed) {
    const prev = trx.snapshot?.val();
    if (prev?.ledgerWritten) return { ok: false, duplicate: true };
    return { ok: false, reason: 'contention' };
  }
  await db.ref(`financas/unifiedLedger/${pid}`).set({
    payment_id: pid,
    mp_payment_id: pid,
    order_id: orderId,
    user_id: uid,
    creator_id: null,
    platform_amount: gross,
    creator_amount: 0,
    type: 'PRINT_ON_DEMAND',
    source: 'platform',
    currency,
    created_at: Date.now(),
  });
  return { ok: true };
}

/**
 * Estorno / ajuste já aplicado em creatorData via recordCreatorRefundAdjustment — registro espelhado.
 */
export async function commitUnifiedRefundAdjustmentMirror(db, rec) {
  const pid = String(rec.mpPaymentId || '').trim();
  const status = safeLedgerKeyPart(rec.status, 40);
  const kind = safeLedgerKeyPart(rec.kind, 40);
  const cidRaw = rec.creatorId ? sanitizeCreatorId(rec.creatorId) : null;
  const cidPart = cidRaw || 'none';
  const ord = rec.orderId ? safeLedgerKeyPart(rec.orderId, 40) : 'noorder';
  const key = safeLedgerKeyPart(`rf_${pid}_${status}_${kind}_${cidPart}_${ord}`, 118);
  if (!pid || !kind) return { ok: false, reason: 'invalid' };

  const amountAbs = round2(Math.abs(Number(rec.amount || 0)));
  const ref = db.ref(`financas/unifiedRefundAdjustments/${key}`);
  const t = await ref.transaction((curr) => {
    if (curr) return undefined;
    return {
      mp_payment_id: pid,
      creator_id: cidRaw,
      amount_gross: amountAbs,
      adjustment_signed: round2(-amountAbs),
      currency: String(rec.currency || 'BRL'),
      kind,
      mp_status: String(rec.status || ''),
      order_id: rec.orderId ? String(rec.orderId) : null,
      buyer_uid: rec.buyerUid ? String(rec.buyerUid) : null,
      created_at: Date.now(),
      extra: rec.extra && typeof rec.extra === 'object' ? rec.extra : null,
    };
  });
  if (!t.committed) {
    return { ok: false, duplicate: true };
  }
  return { ok: true };
}
