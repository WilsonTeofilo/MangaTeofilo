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

/**
 * @param {import('firebase-admin/database').Database} db
 */
export async function recordCreatorPayment(db, rec) {
  const cid = sanitizeCreatorId(rec.creatorId);
  const amount = round2(rec.amount);
  if (!cid || !Number.isFinite(amount) || amount === 0) return;
  try {
    const id = buildCreatorLedgerEntryKey(rec, 'payment');
    await db.ref(`creatorData/${cid}/payments/${id}`).set({
      creatorId: cid,
      amount,
      currency: String(rec.currency || 'BRL'),
      type: String(rec.type || 'other'),
      buyerUid: rec.buyerUid ? String(rec.buyerUid) : null,
      paymentId: String(rec.paymentId || ''),
      orderId: rec.orderId ? String(rec.orderId) : null,
      createdAt: Date.now(),
      status: rec.status ? String(rec.status) : 'approved',
      ...(rec.extra && typeof rec.extra === 'object' ? rec.extra : {}),
    });
  } catch (e) {
    logger.error('creatorDataLedger recordCreatorPayment', { cid, error: e?.message });
  }
}

/**
 * Assinatura premium da plataforma atribuída a um criador (rastreio / repasse futuro).
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
 * Membership real do criador.
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
  } catch (e) {
    logger.error('creatorDataLedger recordCreatorMembershipSubscription', { cid, error: e?.message });
  }
}
