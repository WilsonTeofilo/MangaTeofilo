/**
 * Auditoria: soma de pagamentos em creatorData vs campos de saldo.
 * Reparo opcional (callable admin): `repairCreatorLifetimeNetFromPaymentsSum`.
 */

import { logger } from 'firebase-functions';
import { round2 } from './creatorDataLedger.js';

function sumPaymentAmounts(paymentsVal) {
  if (!paymentsVal || typeof paymentsVal !== 'object') return 0;
  let s = 0;
  for (const row of Object.values(paymentsVal)) {
    if (!row || typeof row !== 'object') continue;
    const st = String(row.status || 'approved').toLowerCase();
    if (st === 'refunded' || st === 'charged_back') continue;
    const a = Number(row.amount);
    if (Number.isFinite(a)) s += a;
  }
  return round2(s);
}

/**
 * @param {import('firebase-admin/database').Database} db
 * @param {{ creatorId?: string, maxCreators?: number }} opts
 */
export async function auditCreatorLedgerVsPayments(db, opts = {}) {
  const max = Math.min(500, Math.max(1, Number(opts.maxCreators) || 80));
  const singleId = opts.creatorId ? String(opts.creatorId).trim() : '';

  const root = db.ref('creatorData');
  const snap = await root.get();
  if (!snap.exists()) {
    return { ok: true, scanned: 0, rows: [], note: 'sem creatorData' };
  }

  const all = snap.val() || {};
  let ids = Object.keys(all);
  if (singleId) {
    ids = ids.includes(singleId) ? [singleId] : [];
  }
  ids = ids.slice(0, max);

  const rows = [];
  for (const cid of ids) {
    const node = all[cid] || {};
    const balance = node.balance && typeof node.balance === 'object' ? node.balance : {};
    const payments = node.payments;
    const sumPay = sumPaymentAmounts(payments);
    const lifetimeNet = round2(Number(balance.lifetimeNetBRL || 0));
    const available = round2(Number(balance.availableBRL || 0));
    const pending = round2(Number(balance.pendingPayoutBRL || 0));
    const delta = round2(sumPay - lifetimeNet);
    const flag = Math.abs(delta) > 0.05;
    if (flag || singleId) {
      rows.push({
        creatorId: cid,
        sumPaymentAmounts: sumPay,
        lifetimeNetBRL: lifetimeNet,
        availableBRL: available,
        pendingPayoutBRL: pending,
        deltaSumVsLifetime: delta,
        mismatch: flag,
      });
    }
  }

  const mismatches = rows.filter((r) => r.mismatch);
  if (mismatches.length) {
    logger.warn('ledgerReconciliation: divergencias encontradas', {
      count: mismatches.length,
      sample: mismatches.slice(0, 5).map((m) => m.creatorId),
    });
  }

  return {
    ok: true,
    scanned: ids.length,
    mismatches: mismatches.length,
    rows: singleId ? rows : rows.slice(0, 120),
    note:
      'Heuristica: soma de creatorData/.../payments.amount (status nao refunded) vs lifetimeNetBRL. ' +
      'Pode divergir por payouts manuais, ajustes antigos ou linhas com status atipico — usar como alerta, nao prova absoluta.',
  };
}

/**
 * Alinha lifetimeNetBRL à soma de payments (opcionalmente ajusta available pelo mesmo Δ).
 * Só invocar quando a divergência for explicada (ex.: bug de gravação); não substitui conciliação com extrato MP.
 *
 * @param {import('firebase-admin/database').Database} db
 * @param {string} creatorId
 * @param {{ apply?: boolean, adjustAvailable?: boolean }} opts
 */
export async function repairCreatorLifetimeNetFromPaymentsSum(db, creatorId, opts = {}) {
  const cid = String(creatorId || '').trim();
  if (!cid) {
    return { ok: false, error: 'creatorId_invalido' };
  }
  const apply = opts.apply === true;
  const adjustAvailable = opts.adjustAvailable === true;

  const snap = await db.ref(`creatorData/${cid}`).get();
  if (!snap.exists()) {
    return { ok: false, error: 'creator_sem_creatorData' };
  }
  const node = snap.val() || {};
  const balance = node.balance && typeof node.balance === 'object' ? node.balance : {};
  const sumPay = sumPaymentAmounts(node.payments);
  const lifetimeBefore = round2(Number(balance.lifetimeNetBRL || 0));
  const availableBefore = round2(Number(balance.availableBRL || 0));
  const pendingBefore = round2(Number(balance.pendingPayoutBRL || 0));
  const delta = round2(sumPay - lifetimeBefore);
  const lifetimeAfter = sumPay;
  let availableAfter = availableBefore;
  const rawAvailAfter = round2(availableBefore + delta);
  if (adjustAvailable) {
    availableAfter = rawAvailAfter;
    if (availableAfter < 0) availableAfter = 0;
  }

  const warnings = [];
  if (delta < -0.05) {
    warnings.push(
      'Delta negativo (soma payments < lifetimeNet): confira extrato e motivo antes de aplicar — o reparo reduz o lifetime.'
    );
  }
  if (adjustAvailable && Math.abs(pendingBefore) > 0.01) {
    warnings.push('Existe pendingPayoutBRL > 0; ajustar disponivel pelo mesmo delta costuma ser arriscado.');
  }
  if (adjustAvailable && rawAvailAfter < -0.001) {
    warnings.push(
      'availableBRL + delta seria negativo; o valor aplicado sera 0 (informacao do excesso negativo perde-se no clamp).'
    );
  }

  const out = {
    ok: true,
    creatorId: cid,
    apply,
    adjustAvailable: apply && adjustAvailable,
    sumPaymentAmounts: sumPay,
    lifetimeNetBRLBefore: lifetimeBefore,
    lifetimeNetBRLAfter: lifetimeAfter,
    availableBRLBefore: availableBefore,
    availableBRLAfter: apply && adjustAvailable ? availableAfter : availableBefore,
    pendingPayoutBRL: pendingBefore,
    deltaSumVsLifetime: delta,
    wouldChange: Math.abs(delta) > 0.05,
    warnings,
  };

  if (!apply || !out.wouldChange) {
    return out;
  }

  const patch = {
    lifetimeNetBRL: lifetimeAfter,
  };
  if (adjustAvailable) {
    patch.availableBRL = availableAfter;
  }
  await db.ref(`creatorData/${cid}/balance`).update(patch);
  logger.warn('ledgerReconciliation: lifetimeNet reparado manualmente', {
    creatorId: cid,
    adjustAvailable,
    delta,
    by: 'adminRepairCreatorLifetimeNet',
  });
  return out;
}
