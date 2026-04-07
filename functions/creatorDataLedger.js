/**
 * Gravações em creatorData/{creatorId}/… (Admin SDK — ignora RTDB rules).
 * Usado pelo webhook MP e callables após pagamentos confirmados.
 */

import { logger } from 'firebase-functions';

export function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

const CREATOR_REVENUE_SPLITS = {
  apoio: { creatorPct: 0.8, platformPct: 0.2 },
  creator_membership: { creatorPct: 0.8, platformPct: 0.2 },
  premium_attribution: { creatorPct: 0.15, platformPct: 0.85 },
  premium_refund_adjustment: { creatorPct: 0.15, platformPct: 0.85 },
  apoio_refund_adjustment: { creatorPct: 0.8, platformPct: 0.2 },
  creator_membership_refund_adjustment: { creatorPct: 0.8, platformPct: 0.2 },
  /** Repasse de pedido da loja física: valor já é o líquido do criador no item. */
  loja: { creatorPct: 1, platformPct: 0 },
  loja_refund_adjustment: { creatorPct: 1, platformPct: 0 },
};

function sanitizeKeyPart(raw, max = 80) {
  const s = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!s) return '';
  return s.slice(0, max);
}

/** Aceita UID Firebase ou id alfanumérico longo (ex.: futuros tenants). */
export function sanitizeCreatorId(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 128) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) return null;
  if (s.length < 10) return null;
  return s;
}

export function buildCreatorLedgerEntryKey(rec, fallbackPrefix = 'entry') {
  const explicit = sanitizeKeyPart(rec?.entryKey, 120);
  if (explicit) return explicit;
  const paymentId = sanitizeKeyPart(rec?.paymentId, 80);
  const orderId = sanitizeKeyPart(rec?.orderId, 80);
  const type = sanitizeKeyPart(rec?.type, 40) || fallbackPrefix;
  if (paymentId && orderId) return `${type}_${paymentId}_${orderId}`;
  if (paymentId) return `${type}_${paymentId}`;
  if (orderId) return `${type}_${orderId}`;
  const buyerUid = sanitizeKeyPart(rec?.buyerUid || rec?.subscriberUid || rec?.userId, 60);
  if (buyerUid) return `${type}_${buyerUid}`;
  return `${type}_${Date.now()}`;
}

function audienceDateKey(timestamp = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(timestamp));
}

function isPositiveMoney(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

export function resolveCreatorRevenueSplit(type, grossAmount) {
  const gross = round2(Math.abs(Number(grossAmount || 0)));
  const rule = CREATOR_REVENUE_SPLITS[String(type || '').trim().toLowerCase()] || null;
  if (!gross || !rule) {
    if (gross && !rule) {
      logger.warn('resolveCreatorRevenueSplit: tipo desconhecido — 100% plataforma (seguro)', {
        type: String(type || ''),
      });
    }
    return {
      grossAmount: gross,
      creatorNetAmount: 0,
      platformFeeAmount: gross,
      creatorPct: 0,
      platformPct: gross ? 1 : 0,
    };
  }
  const creatorNetAmount = round2(gross * Number(rule.creatorPct || 0));
  const platformFeeAmount = round2(Math.max(0, gross - creatorNetAmount));
  return {
    grossAmount: gross,
    creatorNetAmount,
    platformFeeAmount,
    creatorPct: Number(rule.creatorPct || 0),
    platformPct: Number(rule.platformPct || 0),
  };
}

async function incrementPath(db, path, amount) {
  if (!path || !Number.isFinite(Number(amount)) || Number(amount) === 0) return;
  await db.ref(path).transaction((current) => {
    const next = Number(current || 0) + Number(amount);
    return next < 0 ? 0 : next;
  });
}

async function incrementCreatorDaily(db, creatorId, field, amount, timestamp = Date.now()) {
  if (!creatorId || !field || !amount) return;
  const key = audienceDateKey(timestamp);
  await incrementPath(db, `creatorStatsDaily/${creatorId}/${key}/${field}`, amount);
  await db.ref(`creatorStatsDaily/${creatorId}/${key}/updatedAt`).set(Date.now());
}

async function registerCreatorRevenue(db, creatorId, amount, timestamp = Date.now()) {
  if (!creatorId || !amount) return;
  await Promise.all([
    incrementPath(db, `creators/${creatorId}/stats/revenueTotal`, amount),
    incrementCreatorDaily(db, creatorId, 'revenueTotal', amount, timestamp),
  ]);
}

async function adjustCreatorBalanceSummary(
  db,
  creatorId,
  { creatorNetDelta = 0, grossDelta = 0, platformFeeDelta = 0, timestamp = Date.now() }
) {
  if (!creatorId) return;
  const netDelta = round2(creatorNetDelta);
  const grossSigned = round2(grossDelta);
  const platformSigned = round2(platformFeeDelta);
  if (!netDelta && !grossSigned && !platformSigned) return;
  await db.ref(`creatorData/${creatorId}/balance`).transaction((current) => {
    const row = current && typeof current === 'object' ? current : {};
    const available = round2(Number(row.availableBRL || 0) + netDelta);
    const pending = round2(Number(row.pendingPayoutBRL || 0) + netDelta);
    return {
      availableBRL: Math.max(0, available),
      pendingPayoutBRL: Math.max(0, pending),
      lifetimeNetBRL: round2(Number(row.lifetimeNetBRL || 0) + Math.max(0, netDelta)),
      refundedNetBRL: round2(Number(row.refundedNetBRL || 0) + Math.max(0, -netDelta)),
      lifetimeGrossAttributedBRL: round2(
        Number(row.lifetimeGrossAttributedBRL || 0) + Math.max(0, grossSigned)
      ),
      refundedGrossAttributedBRL: round2(
        Number(row.refundedGrossAttributedBRL || 0) + Math.max(0, -grossSigned)
      ),
      lifetimePlatformFeeBRL: round2(
        Number(row.lifetimePlatformFeeBRL || 0) + Math.max(0, platformSigned)
      ),
      refundedPlatformFeeBRL: round2(
        Number(row.refundedPlatformFeeBRL || 0) + Math.max(0, -platformSigned)
      ),
      paidOutBRL: round2(Number(row.paidOutBRL || 0)),
      updatedAt: timestamp,
      lastCreditAt: netDelta > 0 ? timestamp : Number(row.lastCreditAt || 0) || null,
      lastDebitAt: netDelta < 0 ? timestamp : Number(row.lastDebitAt || 0) || null,
    };
  });
}

async function recordCreatorRevenuePlatformEvent(
  db,
  creatorId,
  rec,
  split,
  { creatorNetSigned = 0, grossSigned = 0, platformSigned = 0, timestamp = Date.now() }
) {
  const cid = sanitizeCreatorId(creatorId);
  const key = buildCreatorLedgerEntryKey(rec, 'creator_revenue');
  const eventPayload = {
    creatorId: cid,
    paymentId: String(rec?.paymentId || ''),
    orderId: rec?.orderId ? String(rec.orderId) : null,
    buyerUid: rec?.buyerUid ? String(rec.buyerUid) : null,
    type: String(rec?.type || 'other'),
    status: String(rec?.status || 'approved'),
    currency: String(rec?.currency || 'BRL'),
    grossAmount: round2(Math.abs(grossSigned)),
    grossSigned: round2(grossSigned),
    creatorNetAmount: round2(Math.abs(creatorNetSigned)),
    creatorNetSigned: round2(creatorNetSigned),
    platformFeeAmount: round2(Math.abs(platformSigned)),
    platformFeeSigned: round2(platformSigned),
    creatorPct: Number(split?.creatorPct || 0),
    platformPct: Number(split?.platformPct || 0),
    createdAt: timestamp,
    ...(rec?.extra && typeof rec.extra === 'object' ? { extra: rec.extra } : {}),
  };
  const tasks = [];
  if (cid) {
    tasks.push(db.ref(`financas/creatorRevenueEvents/${key}`).set(eventPayload));
  }
  tasks.push(
    db.ref('financas/creatorRevenueSummary').transaction((current) => {
      const row = current && typeof current === 'object' ? current : {};
      return {
        grossProcessedBRL: round2(Number(row.grossProcessedBRL || 0) + Math.max(0, grossSigned)),
        refundedGrossBRL: round2(Number(row.refundedGrossBRL || 0) + Math.max(0, -grossSigned)),
        creatorLiabilityBRL: Math.max(
          0,
          round2(Number(row.creatorLiabilityBRL || 0) + creatorNetSigned)
        ),
        refundedCreatorLiabilityBRL: round2(
          Number(row.refundedCreatorLiabilityBRL || 0) + Math.max(0, -creatorNetSigned)
        ),
        platformRevenueBRL: Math.max(
          0,
          round2(Number(row.platformRevenueBRL || 0) + platformSigned)
        ),
        refundedPlatformRevenueBRL: round2(
          Number(row.refundedPlatformRevenueBRL || 0) + Math.max(0, -platformSigned)
        ),
        updatedAt: timestamp,
      };
    })
  );
  await Promise.all(tasks);
}

/**
 * Repasse explícito (valores já calculados no backend) após pagamento aprovado.
 * Atualiza creatorData, saldo do criador e agregados da plataforma sem recalcular % no split legado.
 * @param {import('firebase-admin/database').Database} db
 */
const APPLY_LOCK_STALE_MS = 10 * 60 * 1000;

function classifyApplySettlementLock(lockValue, now = Date.now()) {
  if (lockValue && typeof lockValue === 'object') {
    if (lockValue.s === 'done') return { ok: false, duplicate: true, reason: 'already_applied' };
    if (lockValue.s === 'wip' && now - Number(lockValue.at || 0) < APPLY_LOCK_STALE_MS) {
      return { ok: false, duplicate: false, reason: 'in_progress' };
    }
  }
  if (lockValue === 'done') return { ok: false, duplicate: true, reason: 'already_applied' };
  return { ok: false, duplicate: false, reason: 'contention' };
}

export async function applyExplicitApprovedFinancialSettlement(db, rec) {
  const gross = round2(rec.grossBRL);
  const cNet = round2(rec.creatorNetBRL);
  const pFee = round2(rec.platformFeeBRL);
  const cid = sanitizeCreatorId(rec.creatorId);
  const pid = String(rec.paymentId || '').trim();
  if (!Number.isFinite(gross) || gross <= 0) return;
  if (!pid) {
    logger.warn('applyExplicitApprovedFinancialSettlement: paymentId ausente');
    return;
  }

  const lockRef = db.ref(`financas/unifiedPaymentApply/${pid}`);
  const lockTx = await lockRef.transaction((cur) => {
    if (cur && typeof cur === 'object' && cur.s === 'done') return undefined;
    if (cur === 'done') return undefined;
    if (cur && typeof cur === 'object' && cur.s === 'wip') {
      if (Date.now() - Number(cur.at || 0) < APPLY_LOCK_STALE_MS) return undefined;
    }
    return { s: 'wip', at: Date.now() };
  });
  if (!lockTx.committed) {
    return classifyApplySettlementLock(lockTx.snapshot?.val());
  }

  const creatorNetSigned = cNet;
  const platformSigned = pFee;
  const grossSigned = gross;
  const split = {
    grossAmount: gross,
    creatorNetAmount: cNet,
    platformFeeAmount: pFee,
    creatorPct: gross ? cNet / gross : 0,
    platformPct: gross ? pFee / gross : 0,
  };
  const payRec = {
    creatorId: cid,
    buyerUid: rec.buyerUid,
    paymentId: rec.paymentId,
    currency: rec.currency || 'BRL',
    amount: gross,
    type: String(rec.creatorDataPaymentType || rec.type || 'other'),
    status: rec.status ? String(rec.status) : 'approved',
    extra: rec.extra,
    entryKey: rec.entryKey,
    orderId: rec.orderId,
  };
  try {
    if (cid && creatorNetSigned !== 0) {
      const id = buildCreatorLedgerEntryKey(payRec, 'payment');
      await db.ref(`creatorData/${cid}/payments/${id}`).set({
        creatorId: cid,
        amount: creatorNetSigned,
        grossAmount: split.grossAmount,
        creatorNetAmount: split.creatorNetAmount,
        platformFeeAmount: split.platformFeeAmount,
        creatorPct: Number(split.creatorPct || 0),
        platformPct: Number(split.platformPct || 0),
        currency: String(payRec.currency || 'BRL'),
        type: String(payRec.type || 'other'),
        buyerUid: payRec.buyerUid ? String(payRec.buyerUid) : null,
        paymentId: String(payRec.paymentId || ''),
        orderId: payRec.orderId ? String(payRec.orderId) : null,
        createdAt: Date.now(),
        status: payRec.status,
        ...(payRec.extra && typeof payRec.extra === 'object' ? payRec.extra : {}),
      });
      await Promise.all([
        registerCreatorRevenue(db, cid, creatorNetSigned, Date.now()),
        adjustCreatorBalanceSummary(db, cid, {
          creatorNetDelta: creatorNetSigned,
          grossDelta: grossSigned,
          platformFeeDelta: platformSigned,
        }),
        recordCreatorRevenuePlatformEvent(db, cid, payRec, split, {
          creatorNetSigned,
          grossSigned,
          platformSigned,
        }),
      ]);
    } else {
      await recordCreatorRevenuePlatformEvent(db, null, payRec, split, {
        creatorNetSigned: 0,
        grossSigned,
        platformSigned,
      });
    }
    await lockRef.set({ s: 'done', at: Date.now() });
    return { ok: true, duplicate: false };
  } catch (e) {
    logger.error('creatorDataLedger applyExplicitApprovedFinancialSettlement', {
      cid,
      error: e?.message,
    });
    try {
      await lockRef.remove();
    } catch (remErr) {
      logger.warn('applyExplicit: falha ao remover lock', { pid, error: remErr?.message });
    }
    throw e;
  }
}

async function registerCreatorMembershipIndex(db, creatorId, subscriberUid, memberUntil, amount, timestamp = Date.now()) {
  if (!creatorId || !subscriberUid) return;
  const memberRef = db.ref(`creators/${creatorId}/membersIndex/${subscriberUid}`);
  const snap = await memberRef.get();
  const current = snap.exists() ? snap.val() || {} : {};
  const prevUntil = Number(current?.memberUntil || 0);
  const now = Date.now();
  const wasActive = prevUntil > now;
  const nextUntil = Number.isFinite(Number(memberUntil)) ? Number(memberUntil) : prevUntil;
  await memberRef.set({
    userId: subscriberUid,
    memberUntil: nextUntil || null,
    lifetimeValue: round2(Number(current?.lifetimeValue || 0) + Number(amount || 0)),
    updatedAt: now,
  });
  if (!wasActive && nextUntil > now) {
    await Promise.all([
      incrementPath(db, `creators/${creatorId}/stats/membersCount`, 1),
      incrementCreatorDaily(db, creatorId, 'membersAdded', 1, timestamp),
    ]);
  }
}

/**
 * @param {import('firebase-admin/database').Database} db
 */
export async function recordCreatorPayment(db, rec) {
  const cid = sanitizeCreatorId(rec.creatorId);
  const amount = round2(rec.amount);
  if (!cid || !Number.isFinite(amount) || amount === 0) return;
  try {
    const id = buildCreatorLedgerEntryKey(rec, 'payment');
    const split = resolveCreatorRevenueSplit(rec?.type, amount);
    const sign = amount < 0 ? -1 : 1;
    const creatorNetSigned = round2(split.creatorNetAmount * sign);
    const platformSigned = round2(split.platformFeeAmount * sign);
    const grossSigned = round2(split.grossAmount * sign);
    await db.ref(`creatorData/${cid}/payments/${id}`).set({
      creatorId: cid,
      amount: creatorNetSigned,
      grossAmount: split.grossAmount,
      creatorNetAmount: split.creatorNetAmount,
      platformFeeAmount: split.platformFeeAmount,
      creatorPct: Number(split.creatorPct || 0),
      platformPct: Number(split.platformPct || 0),
      currency: String(rec.currency || 'BRL'),
      type: String(rec.type || 'other'),
      buyerUid: rec.buyerUid ? String(rec.buyerUid) : null,
      paymentId: String(rec.paymentId || ''),
      orderId: rec.orderId ? String(rec.orderId) : null,
      createdAt: Date.now(),
      status: rec.status ? String(rec.status) : 'approved',
      ...(rec.extra && typeof rec.extra === 'object' ? rec.extra : {}),
    });
    await Promise.all([
      registerCreatorRevenue(db, cid, creatorNetSigned, Date.now()),
      adjustCreatorBalanceSummary(db, cid, {
        creatorNetDelta: creatorNetSigned,
        grossDelta: grossSigned,
        platformFeeDelta: platformSigned,
        timestamp: Date.now(),
      }),
      recordCreatorRevenuePlatformEvent(db, cid, rec, split, {
        creatorNetSigned,
        grossSigned,
        platformSigned,
        timestamp: Date.now(),
      }),
    ]);
  } catch (e) {
    logger.error('creatorDataLedger recordCreatorPayment', { cid, error: e?.message });
  }
}

/**
 * Indice operacional de atribuicao premium ao criador.
 * Nao grava ledger financeiro: o settlement canonico ja fez isso.
 * @param {import('firebase-admin/database').Database} db
 */
export async function recordCreatorAttributedPremium(db, rec) {
  const cid = sanitizeCreatorId(rec.creatorId);
  if (!cid || !rec.subscriberUid) return;
  try {
    const id = buildCreatorLedgerEntryKey(rec, 'subscription');
    await db.ref(`creatorData/${cid}/subscriptions/${id}`).set({
      creatorId: cid,
      userId: String(rec.subscriberUid),
      type: 'platform_premium_attribution',
      paymentId: String(rec.paymentId || ''),
      amount: round2(rec.amount),
      memberUntil: Number.isFinite(Number(rec.memberUntil)) ? Number(rec.memberUntil) : null,
      createdAt: Date.now(),
      status: rec.status ? String(rec.status) : 'approved',
    });
  } catch (e) {
    logger.error('creatorDataLedger recordCreatorAttributedPremium', { cid, error: e?.message });
  }
}

/**
 * Indice operacional da membership do criador.
 * Nao grava ledger financeiro: o settlement canonico ja fez isso.
 * Mantem apenas subscriptions + membersIndex para o workspace do creator.
 * @param {import('firebase-admin/database').Database} db
 */
export async function recordCreatorMembershipSubscription(db, rec) {
  const cid = sanitizeCreatorId(rec.creatorId);
  if (!cid || !rec.subscriberUid) return;
  try {
    const id = buildCreatorLedgerEntryKey(rec, 'creator_membership');
    await db.ref(`creatorData/${cid}/subscriptions/${id}`).set({
      creatorId: cid,
      userId: String(rec.subscriberUid),
      type: 'creator_membership',
      paymentId: String(rec.paymentId || ''),
      amount: round2(rec.amount),
      memberUntil: Number.isFinite(Number(rec.memberUntil)) ? Number(rec.memberUntil) : null,
      createdAt: Date.now(),
      status: rec.status ? String(rec.status) : 'approved',
    });
    await registerCreatorMembershipIndex(
      db,
      cid,
      String(rec.subscriberUid),
      Number.isFinite(Number(rec.memberUntil)) ? Number(rec.memberUntil) : null,
      round2(rec.amount),
      Date.now()
    );
  } catch (e) {
    logger.error('creatorDataLedger recordCreatorMembershipSubscription', { cid, error: e?.message });
  }
}

export async function recordCreatorManualPixPayout(db, rec) {
  const cid = sanitizeCreatorId(rec?.creatorId);
  const amount = round2(rec?.amount);
  if (!cid || !isPositiveMoney(amount)) return null;
  try {
    const payoutRef = db.ref(`creatorData/${cid}/payouts`).push();
    const payoutId = payoutRef.key;
    const timestamp = Number(rec?.paidAt || Date.now());
    await Promise.all([
      payoutRef.set({
        payoutId,
        creatorId: cid,
        amount,
        currency: String(rec?.currency || 'BRL'),
        status: 'paid_manual_pix',
        pixType: rec?.pixType ? String(rec.pixType) : null,
        pixKeyMasked: rec?.pixKeyMasked ? String(rec.pixKeyMasked) : null,
        paidAt: timestamp,
        paidByUid: rec?.paidByUid ? String(rec.paidByUid) : null,
        externalTransferId: rec?.externalTransferId ? String(rec.externalTransferId) : null,
        notes: rec?.notes ? String(rec.notes).slice(0, 2000) : null,
      }),
      db.ref(`creatorData/${cid}/balance`).transaction((current) => {
        const row = current && typeof current === 'object' ? current : {};
        const available = round2(Number(row.availableBRL || 0) - amount);
        const pending = round2(Number(row.pendingPayoutBRL || 0) - amount);
        return {
          ...row,
          availableBRL: Math.max(0, available),
          pendingPayoutBRL: Math.max(0, pending),
          paidOutBRL: round2(Number(row.paidOutBRL || 0) + amount),
          updatedAt: timestamp,
          lastPayoutAt: timestamp,
        };
      }),
      db.ref(`financas/creatorPayouts/${payoutId}`).set({
        payoutId,
        creatorId: cid,
        amount,
        currency: String(rec?.currency || 'BRL'),
        status: 'paid_manual_pix',
        pixType: rec?.pixType ? String(rec.pixType) : null,
        pixKeyMasked: rec?.pixKeyMasked ? String(rec.pixKeyMasked) : null,
        paidAt: timestamp,
        paidByUid: rec?.paidByUid ? String(rec.paidByUid) : null,
        externalTransferId: rec?.externalTransferId ? String(rec.externalTransferId) : null,
        notes: rec?.notes ? String(rec.notes).slice(0, 2000) : null,
      }),
      db.ref('financas/creatorRevenueSummary').transaction((current) => {
        const row = current && typeof current === 'object' ? current : {};
        return {
          ...row,
          creatorLiabilityBRL: Math.max(
            0,
            round2(Number(row.creatorLiabilityBRL || 0) - amount)
          ),
          manualPayoutsBRL: round2(Number(row.manualPayoutsBRL || 0) + amount),
          updatedAt: timestamp,
        };
      }),
    ]);
    return payoutId;
  } catch (e) {
    logger.error('creatorDataLedger recordCreatorManualPixPayout', { cid, error: e?.message });
    return null;
  }
}

