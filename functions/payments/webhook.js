import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { parseApoioExternalRef } from '../mercadoPagoApoio.js';
import {
  PREMIUM_D_MS,
  PREMIUM_PLAN_ID,
  PREMIUM_PRICE_BRL,
  parsePremiumExternalRef,
} from '../mercadoPagoPremium.js';
import { parsePodExternalRef, parseStoreExternalRef } from '../mercadoPagoStore.js';
import { verifyMercadoPagoWebhookSignature } from '../mercadoPagoWebhookVerify.js';
import { notifyPrintOnDemandPaid } from '../printOnDemandOrders.js';
import {
  recordCreatorAttributedPremium,
  recordCreatorMembershipSubscription,
  recordCreatorPayment,
  round2,
  sanitizeCreatorId,
} from '../creatorDataLedger.js';
import {
  normalizeUnifiedSource,
  tryCommitUnifiedApprovedSettlement,
} from '../platformPaymentSettlement.js';
import {
  commitUnifiedPodPaidMirror,
  commitUnifiedRefundAdjustmentMirror,
  commitUnifiedStorePhysicalMirror,
} from '../unifiedFinanceMirror.js';
import { validPromoPrice } from '../promoUtils.js';
import { buildUserEntitlementsPatch } from '../userEntitlements.js';
import {
  normalizeStoreOrderStatusInput,
  releaseStoreInventoryReservation,
} from '../orders/storeCommon.js';
import { APP_BASE_URL, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET } from './config.js';
import {
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_USER,
  getSmtpFrom,
  getTransporter,
} from '../notifications/delivery.js';

const REFUND_PAYMENT_STATUSES = new Set([
  'refunded',
  'charged_back',
  'cancelled',
  'rejected',
]);
const MP_WEBHOOK_PAYMENTS_PATH = 'financas/mp_webhook_payments';
const MP_WEBHOOK_LAST_PATH = 'financas/mp_webhook_last';
const MP_PROCESSED_STALE_MS = 10 * 60 * 1000;
const MS_DAY = 86400000;
const AVATAR_FALLBACK_FUNCTIONS = '/assets/avatares/ava1.webp';
const CREATOR_MEMBERSHIP_D_MS = 30 * 24 * 60 * 60 * 1000;

function formatarDataBr(ms) {
  try {
    return new Date(ms).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return String(ms);
  }
}

function buildPremiumConfirmedHtml(memberUntilMs) {
  const fim = formatarDataBr(memberUntilMs);
  return `
    <!DOCTYPE html>
    <html lang="pt-BR"><head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
        <tr><td align="center">
          <table width="520" cellpadding="0" cellspacing="0" style="background:#111;border-radius:12px;border:1px solid #222;overflow:hidden;">
            <tr><td style="background:linear-gradient(90deg,#b8860b,#ffcc00);padding:20px;text-align:center;">
              <h1 style="margin:0;color:#000;font-size:22px;">Membro Premium - MangaTeofilo</h1>
            </td></tr>
            <tr><td style="padding:32px;color:#ddd;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px;">Pagamento confirmado. Sua assinatura de <strong>30 dias</strong> esta ativa.</p>
              <p style="margin:0 0 8px;color:#aaa;">Valida ate:</p>
              <p style="margin:0 0 24px;color:#ffcc00;font-size:18px;font-weight:bold;">${fim}</p>
              <p style="margin:0;color:#888;font-size:13px;">Regalias: acesso antecipado a capitulos, leitura sem anuncios, distintivo nos comentarios e mais melhorias no perfil.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
  `;
}

function buildPremiumExpiryWarningHtml(memberUntilMs) {
  const fim = formatarDataBr(memberUntilMs);
  const base = APP_BASE_URL.value().replace(/\/$/, '');
  return `
    <!DOCTYPE html>
    <html lang="pt-BR"><head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
        <tr><td align="center">
          <table width="520" cellpadding="0" cellspacing="0" style="background:#111;border-radius:12px;border:1px solid #333;">
            <tr><td style="padding:28px;color:#ddd;font-size:15px;line-height:1.6;">
              <h2 style="margin:0 0 16px;color:#ffcc00;">Sua assinatura Premium termina em breve</h2>
              <p style="margin:0 0 16px;">Faltam cerca de <strong>5 dias</strong> para o fim do periodo atual.</p>
              <p style="margin:0 0 8px;color:#aaa;">Encerra em:</p>
              <p style="margin:0 0 24px;color:#fff;">${fim}</p>
              <a href="${base}/apoie" style="display:inline-block;background:#ffcc00;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Renovar em Apoie a Obra</a>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
  `;
}

function appendNestedPatch(target, basePath, value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${basePath}/${key}`;
    if (
      nested &&
      typeof nested === 'object' &&
      !Array.isArray(nested) &&
      !(nested instanceof Date)
    ) {
      appendNestedPatch(target, nextPath, nested);
    } else {
      target[nextPath] = nested;
    }
  }
}

function extractMercadoPagoPaymentId(req) {
  if (req.method === 'GET') {
    const topic = req.query?.topic;
    const id = req.query?.id ?? req.query?.['data.id'];
    if (topic === 'payment' && id != null && String(id).length > 0) return String(id);
    return null;
  }
  if (req.method !== 'POST') return null;
  let b = req.body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      return null;
    }
  }
  if (!b || typeof b !== 'object') return null;
  if (b.type === 'payment' && b.data?.id != null) return String(b.data.id);
  if (b.topic === 'payment' && b.resource) {
    const m = String(b.resource).match(/(\d+)\s*$/);
    if (m) return m[1];
  }
  return null;
}

async function fetchMercadoPagoPayment(accessToken, paymentId) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText || 'MP payment fetch error';
    throw new Error(msg);
  }
  return data;
}

function isRefundLikeStatus(status) {
  return REFUND_PAYMENT_STATUSES.has(String(status || '').toLowerCase());
}

async function appendUniqueFinanceEvent(db, key, payload) {
  const safeKey = String(key || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
  if (!safeKey) return false;
  const lockRef = db.ref(`financas/event_locks/${safeKey}`);
  const trx = await lockRef.transaction((curr) => (curr ? undefined : { at: Date.now() }));
  if (!trx.committed) return false;
  await db.ref('financas/eventos').push(payload);
  return true;
}

async function markProcessedPaymentStatus(db, paymentId, status) {
  const pid = String(paymentId || '').trim();
  if (!pid) return;
  const now = Date.now();
  try {
    await Promise.all([
      db.ref(`${MP_WEBHOOK_LAST_PATH}/${pid}`).update({
        lastStatus: String(status || 'unknown'),
        lastStatusAt: now,
      }),
      db.ref(`${MP_WEBHOOK_PAYMENTS_PATH}/${pid}`).update({
        lastStatus: String(status || 'unknown'),
        lastStatusAt: now,
        updatedAt: now,
      }),
    ]);
  } catch (err) {
    logger.warn('MP: falha ao atualizar lastStatus', { paymentId: pid, error: err?.message });
  }
}

function buildMpPaymentPatch(paymentId, payload = {}, now = Date.now()) {
  return {
    paymentId,
    uid: payload.uid == null ? '' : String(payload.uid || '').trim(),
    orderId: payload.orderId == null ? null : String(payload.orderId || '').trim() || null,
    tipo: payload.tipo == null ? '' : String(payload.tipo || '').trim(),
    amount:
      payload.amount === undefined
        ? null
        : Number.isFinite(Number(payload.amount))
          ? round2(Number(payload.amount))
          : null,
    currency: payload.currency == null ? 'BRL' : String(payload.currency || 'BRL'),
    source: payload.source == null ? null : String(payload.source || '').trim() || null,
    status: String(payload.status || 'processing'),
    updatedAt: now,
  };
}

async function reserveMpProcessedPayment(db, paymentId, payload) {
  const pid = String(paymentId || '').trim();
  if (!pid) throw new Error('paymentId obrigatorio.');
  const now = Date.now();
  const ref = db.ref(`${MP_WEBHOOK_PAYMENTS_PATH}/${pid}`);
  const tx = await ref.transaction((curr) => {
    const row = curr && typeof curr === 'object' ? curr : null;
    const finalizedAt = Number(row?.finalizedAt || 0);
    if (finalizedAt > 0) return;
    const processingAt = Number(row?.processingAt || 0);
    if (processingAt > 0 && now - processingAt < MP_PROCESSED_STALE_MS) return;
    return {
      ...(row || {}),
      ...buildMpPaymentPatch(
        pid,
        {
          uid: payload?.uid || row?.uid || '',
          orderId: payload?.orderId == null ? (row?.orderId ?? null) : payload.orderId,
          tipo: payload?.tipo || row?.tipo || '',
          amount: Number.isFinite(Number(payload?.amount)) ? payload.amount : (row?.amount ?? null),
          currency: payload?.currency || row?.currency || 'BRL',
          source: payload?.source == null ? (row?.source ?? null) : payload.source,
          status: 'processing',
        },
        now
      ),
      processingAt: now,
      at: Number(row?.at || 0) > 0 ? Number(row.at) : now,
      finalizedAt: null,
    };
  });
  if (tx.committed) {
    const snapshot = tx.snapshot?.val() || null;
    return { acquired: true, duplicate: false, snapshot };
  }
  const existing = tx.snapshot?.val() || null;
  if (existing && Number(existing.finalizedAt || 0) > 0) {
    return { acquired: false, duplicate: true, snapshot: existing };
  }
  return { acquired: false, duplicate: false, snapshot: existing };
}

async function finalizeMpProcessedPayment(db, paymentId, payload = {}) {
  const pid = String(paymentId || '').trim();
  if (!pid) return;
  const now = Date.now();
  const patch = {
    ...buildMpPaymentPatch(pid, payload, now),
    finalizedAt: now,
    processingAt: null,
  };
  await db.ref(`${MP_WEBHOOK_PAYMENTS_PATH}/${pid}`).update(patch);
}

async function recordCreatorRefundAdjustment(db, entries) {
  const rows = Array.isArray(entries) ? entries : [];
  for (const row of rows) {
    const amount = round2(Math.abs(Number(row?.amount || 0)));
    if (!amount) continue;
    await recordCreatorPayment(db, {
      creatorId: row?.creatorId,
      amount: -amount,
      currency: row?.currency || 'BRL',
      type: row?.type || 'refund_adjustment',
      buyerUid: row?.buyerUid || null,
      paymentId: row?.paymentId || '',
      orderId: row?.orderId || null,
      status: row?.status || 'refunded',
      entryKey: row?.entryKey || '',
      extra: {
        adjustment: 'debit',
        note: 'Ajuste financeiro por reembolso/chargeback/cancelamento confirmado no Mercado Pago.',
        ...(row?.extra && typeof row.extra === 'object' ? row.extra : {}),
      },
    });
  }
}

async function aplicarMembershipCriadorAprovada(
  db,
  uid,
  creatorId,
  paymentId,
  paymentAmount,
  paymentCurrency
) {
  const cid = sanitizeCreatorId(creatorId);
  if (!uid || !cid) return { applied: false, duplicate: false };

  const now = Date.now();
  const creatorPublicSnap = await db.ref(`usuarios_publicos/${cid}`).get();
  const creatorPublic = creatorPublicSnap.val() || {};
  const creatorName = String(creatorPublic.creatorDisplayName || creatorPublic.userName || '').trim();
  const currentEntitlementSnap = await db.ref(`usuarios/${uid}/userEntitlements/creators/${cid}`).get();
  const atual = currentEntitlementSnap.exists() ? currentEntitlementSnap.val() || {} : {};
  const currentUntil = Number(atual.memberUntil || 0);
  const newUntil = Math.max(now, currentUntil) + CREATOR_MEMBERSHIP_D_MS;
  await db.ref(`usuarios/${uid}/userEntitlements/creators/${cid}`).update({
    isMember: true,
    status: 'ativo',
    memberUntil: newUntil,
    creatorName: creatorName || atual.creatorName || null,
    lastPaymentAt: now,
    lastPaymentId: String(paymentId || ''),
    lastPaymentAmount: Number.isFinite(Number(paymentAmount)) ? round2(paymentAmount) : null,
    lastPaymentCurrency: String(paymentCurrency || 'BRL'),
    updatedAt: now,
  });
  await db.ref(`usuarios/${uid}/userEntitlements/updatedAt`).set(now);
  await recordCreatorMembershipSubscription(db, {
    creatorId: cid,
    subscriberUid: uid,
    paymentId,
    amount: paymentAmount,
    memberUntil: newUntil,
  });

  try {
    await tryCommitUnifiedApprovedSettlement(db, {
      mpPaymentId: String(paymentId),
      userId: uid,
      unifiedType: 'CREATOR_MEMBERSHIP',
      creatorId: cid,
      source: 'creator_link',
      grossBRL: Number.isFinite(Number(paymentAmount)) ? round2(paymentAmount) : 0,
      currency: String(paymentCurrency || 'BRL'),
      creatorDataPaymentType: 'creator_membership',
      extra: { durationDays: 30 },
    });
  } catch (e) {
    logger.error('Membership criador: falha unified settlement', {
      uid,
      paymentId,
      error: e?.message,
    });
  }

  return { applied: true, newUntil };
}

async function reverterMembershipCriadorSeNecessario(db, uid, creatorId, paymentId, status) {
  const cid = sanitizeCreatorId(creatorId);
  if (!uid || !cid || !paymentId) return;
  const membershipRef = db.ref(`usuarios/${uid}/userEntitlements/creators/${cid}`);
  const snap = await membershipRef.get();
  if (!snap.exists()) return;
  const row = snap.val() || {};
  if (String(row.lastPaymentId || '') !== String(paymentId)) return;
  await membershipRef.update({
    status: 'cancelado',
    memberUntil: Date.now(),
    isMember: false,
    refundStatus: String(status || 'refunded'),
    updatedAt: Date.now(),
  });
  await db.ref(`usuarios/${uid}/userEntitlements/updatedAt`).set(Date.now());
}

async function aplicarPremiumAprovado(
  db,
  uid,
  paymentId,
  paymentAmount,
  paymentCurrency,
  promoId,
  promoName,
  trafficSource,
  trafficCampaign,
  trafficClickId,
  attributionCreatorId = null,
  unifiedSource = null
) {
  const now = Date.now();
  const snap = await db.ref(`usuarios/${uid}`).get();
  if (!snap.exists()) {
    logger.error('Premium: usuario nao existe', { uid, paymentId });
    return { applied: false, duplicate: false };
  }
  const buildPremiumUnifiedPayload = () => {
    const attrC = sanitizeCreatorId(attributionCreatorId);
    const storeSrc = normalizeUnifiedSource(unifiedSource, attributionCreatorId);
    return {
      mpPaymentId: String(paymentId),
      userId: uid,
      unifiedType: 'STORE_MEMBERSHIP',
      creatorId: attrC,
      source: storeSrc,
      grossBRL: Number.isFinite(Number(paymentAmount)) ? round2(paymentAmount) : PREMIUM_PRICE_BRL,
      currency: String(paymentCurrency || 'BRL'),
      creatorDataPaymentType: attrC ? 'premium_attribution' : 'store_membership',
      extra: {
        planId: PREMIUM_PLAN_ID,
        promoId: promoId || null,
        promoName: promoName || null,
        trafficSource: trafficSource || null,
        trafficCampaign: trafficCampaign || null,
        trafficClickId: trafficClickId || null,
      },
    };
  };
  const procLock = await reserveMpProcessedPayment(db, paymentId, {
    uid,
    tipo: 'premium_aprovado',
    amount: Number.isFinite(Number(paymentAmount)) ? paymentAmount : PREMIUM_PRICE_BRL,
    currency: String(paymentCurrency || 'BRL'),
    source: 'premium',
  });
  if (!procLock.acquired) {
    try {
      await tryCommitUnifiedApprovedSettlement(db, buildPremiumUnifiedPayload());
    } catch (e) {
      logger.warn('Premium: unified settlement na reentrancia', { paymentId, error: e?.message });
    }
    return { applied: false, duplicate: true };
  }

  const profile = snap.val() || {};
  const currentUntil = typeof profile.memberUntil === 'number' ? profile.memberUntil : 0;
  const base = Math.max(now, currentUntil);
  const newUntil = base + PREMIUM_D_MS;

  const pubSnap = await db.ref(`usuarios_publicos/${uid}`).get();
  const pub = pubSnap.val() || {};
  const userNamePub = pub.userName || profile.userName || 'Leitor';
  let avatarPub = String(pub.userAvatar || profile.userAvatar || '').trim();
  if (!avatarPub) avatarPub = AVATAR_FALLBACK_FUNCTIONS;

  const patch = {};
  patch[`usuarios/${uid}/accountType`] = 'premium';
  patch[`usuarios/${uid}/membershipStatus`] = 'ativo';
  patch[`usuarios/${uid}/memberUntil`] = newUntil;
  patch[`usuarios/${uid}/lastPaymentAt`] = now;
  patch[`usuarios/${uid}/currentPlanId`] = PREMIUM_PLAN_ID;
  patch[`usuarios/${uid}/premium5dNotifiedForUntil`] = null;
  patch[`usuarios/${uid}/userEntitlements/global/isPremium`] = true;
  patch[`usuarios/${uid}/userEntitlements/global/status`] = 'ativo';
  patch[`usuarios/${uid}/userEntitlements/global/memberUntil`] = newUntil;
  patch[`usuarios/${uid}/userEntitlements/updatedAt`] = now;
  patch[`usuarios_publicos/${uid}/uid`] = uid;
  patch[`usuarios_publicos/${uid}/userName`] = userNamePub;
  patch[`usuarios_publicos/${uid}/userAvatar`] = avatarPub;
  patch[`usuarios_publicos/${uid}/accountType`] = 'premium';
  patch[`usuarios_publicos/${uid}/updatedAt`] = now;

  await db.ref().update(patch);
  await finalizeMpProcessedPayment(db, paymentId, {
    uid,
    tipo: 'premium_aprovado',
    amount: Number.isFinite(Number(paymentAmount)) ? paymentAmount : PREMIUM_PRICE_BRL,
    currency: String(paymentCurrency || 'BRL'),
    source: 'premium',
    status: 'approved',
  });

  await db.ref('financas/eventos').push({
    tipo: 'premium_aprovado',
    uid,
    paymentId: String(paymentId),
    amount: Number.isFinite(paymentAmount) ? paymentAmount : PREMIUM_PRICE_BRL,
    currency: String(paymentCurrency || 'BRL'),
    origem: PREMIUM_PLAN_ID,
    promoId: promoId || null,
    promoName: promoName || null,
    trafficSource: trafficSource || null,
    trafficCampaign: trafficCampaign || null,
    trafficClickId: trafficClickId || null,
    at: now,
    memberUntil: newUntil,
  });

  try {
    const authUser = await getAuth().getUser(uid);
    const to = authUser?.email;
    if (to && !authUser.disabled) {
      await getTransporter().sendMail({
        from: getSmtpFrom(),
        to,
        subject: 'MangaTeofilo - Assinatura Premium ativa',
        text: `Sua assinatura Premium (30 dias) foi confirmada. Valida ate ${formatarDataBr(newUntil)}.\n\n${APP_BASE_URL.value()}/apoie`,
        html: buildPremiumConfirmedHtml(newUntil),
      });
    }
  } catch (err) {
    logger.error('Premium: falha e-mail confirmacao', { uid, error: err?.message });
  }

  const attrC = sanitizeCreatorId(attributionCreatorId);
  if (attrC) {
    await recordCreatorAttributedPremium(db, {
      creatorId: attrC,
      subscriberUid: uid,
      paymentId,
      amount: paymentAmount,
      memberUntil: newUntil,
    });
  }

  try {
    await tryCommitUnifiedApprovedSettlement(db, buildPremiumUnifiedPayload());
  } catch (e) {
    logger.error('Premium: falha unified settlement', { uid, paymentId, error: e?.message });
  }

  return { applied: true, newUntil };
}

async function tratarNotificacaoPagamentoPremium(accessToken, paymentId) {
  const pay = await fetchMercadoPagoPayment(accessToken, paymentId);
  const status = String(pay?.status || '');
  const db = getDatabase();
  await markProcessedPaymentStatus(db, paymentId, status);
  const premiumUid = parsePremiumExternalRef(pay.external_reference);
  const metadata = pay.metadata && typeof pay.metadata === 'object' ? pay.metadata : {};

  if (status !== 'approved' && !isRefundLikeStatus(status)) {
    logger.info('MP: pagamento nao aprovado', { paymentId, status });
    return;
  }

  if (premiumUid) {
    const amount = Number(pay.transaction_amount);
    if (isRefundLikeStatus(status)) {
      const attrCid = metadata.attributionCreatorId ? String(metadata.attributionCreatorId).trim() : null;
      const wrote = await appendUniqueFinanceEvent(db, `premium_refund_${paymentId}_${status}`, {
        tipo: 'premium_estornado',
        uid: premiumUid,
        paymentId: String(paymentId),
        amount: Number.isFinite(amount) ? amount : null,
        currency: String(pay.currency_id || 'BRL'),
        origem: PREMIUM_PLAN_ID,
        status,
        at: Date.now(),
      });
      if (wrote && attrCid) {
        await recordCreatorRefundAdjustment(db, [{
          creatorId: attrCid,
          amount,
          currency: String(pay.currency_id || 'BRL'),
          type: 'premium_refund_adjustment',
          buyerUid: premiumUid,
          paymentId,
          status,
          entryKey: `premium_refund_adjustment_${paymentId}_${status}`,
          extra: { planId: PREMIUM_PLAN_ID },
        }]);
        try {
          await commitUnifiedRefundAdjustmentMirror(db, {
            mpPaymentId: String(paymentId),
            creatorId: attrCid,
            amount,
            currency: String(pay.currency_id || 'BRL'),
            kind: 'PREMIUM_ATTRIBUTION_REFUND',
            status: String(status),
            buyerUid: premiumUid,
            extra: { flow: 'premium_attribution_refund', planId: PREMIUM_PLAN_ID },
          });
        } catch (e) {
          logger.warn('unified refund mirror premium', { paymentId, error: e?.message });
        }
      }
      return;
    }
    const expectedAmount = validPromoPrice(metadata.expectedAmount) || PREMIUM_PRICE_BRL;
    if (!Number.isFinite(amount) || Math.abs(amount - expectedAmount) > 0.02) {
      logger.error('MP: valor inesperado para premium', { paymentId, amount, uid: premiumUid });
      return;
    }
    await aplicarPremiumAprovado(
      db,
      premiumUid,
      paymentId,
      amount,
      String(pay.currency_id || 'BRL'),
      metadata.promoId ? String(metadata.promoId) : null,
      metadata.promoName ? String(metadata.promoName) : null,
      metadata.trafficSource ? String(metadata.trafficSource) : null,
      metadata.trafficCampaign ? String(metadata.trafficCampaign) : null,
      metadata.trafficClickId ? String(metadata.trafficClickId) : null,
      metadata.attributionCreatorId ? String(metadata.attributionCreatorId).trim() : null,
      metadata.source != null ? String(metadata.source) : null
    );
    return;
  }

  const storeRef = parseStoreExternalRef(pay.external_reference);
  if (storeRef) {
    const orderSnapPre = await db.ref(`loja/pedidos/${storeRef.orderId}`).get();
    if (!orderSnapPre.exists()) return;
    const orderPre = orderSnapPre.val() || {};
    const amount = Number(pay.transaction_amount);
    if (isRefundLikeStatus(status)) {
      const orderItemsRefund = Array.isArray(orderPre.items) ? orderPre.items : [];
      const refundNow = Date.now();
      const releasedInventory =
        orderPre.status === 'delivered' ? false : await releaseStoreInventoryReservation(db, orderPre);
      await db.ref(`loja/pedidos/${storeRef.orderId}`).update({
        paymentStatus: status,
        refundStatus: status,
        refundedAt: refundNow,
        updatedAt: refundNow,
        inventoryReleasedAt: releasedInventory ? refundNow : orderPre.inventoryReleasedAt ?? null,
        status: orderPre.status === 'delivered' ? orderPre.status : 'cancelled',
      });
      const wrote = await appendUniqueFinanceEvent(db, `store_refund_${paymentId}_${status}`, {
        tipo: 'loja_pedido_estornado',
        uid: storeRef.uid,
        orderId: storeRef.orderId,
        paymentId: String(paymentId),
        amount: Number.isFinite(amount) ? amount : Number(orderPre.total || 0),
        currency: String(pay?.currency_id || 'BRL'),
        origem: 'loja_fisica',
        status,
        at: Date.now(),
      });
      if (wrote) {
        const byCreatorRefund = new Map();
        for (const item of orderItemsRefund) {
          const cid = sanitizeCreatorId(item?.creatorId);
          if (!cid) continue;
          const lt = round2(item?.lineTotal);
          if (!lt) continue;
          byCreatorRefund.set(cid, (byCreatorRefund.get(cid) || 0) + lt);
        }
        await recordCreatorRefundAdjustment(
          db,
          [...byCreatorRefund.entries()].map(([cid, amt]) => ({
            creatorId: cid,
            amount: amt,
            currency: String(pay?.currency_id || 'BRL'),
            type: 'loja_refund_adjustment',
            buyerUid: storeRef.uid,
            paymentId,
            orderId: storeRef.orderId,
            status,
            entryKey: `loja_refund_adjustment_${paymentId}_${cid}`,
            extra: { source: 'checkout_store' },
          }))
        );
        for (const [cid, amt] of byCreatorRefund) {
          try {
            await commitUnifiedRefundAdjustmentMirror(db, {
              mpPaymentId: String(paymentId),
              creatorId: cid,
              amount: amt,
              currency: String(pay?.currency_id || 'BRL'),
              kind: 'STORE_PHYSICAL_REFUND',
              status: String(status),
              orderId: storeRef.orderId,
              buyerUid: storeRef.uid,
              extra: { source: 'checkout_store' },
            });
          } catch (e) {
            logger.warn('unified refund mirror loja', { paymentId, creatorId: cid, error: e?.message });
          }
        }
      }
      return;
    }
    const expected = Number(orderPre.total || 0);
    if (!Number.isFinite(amount) || !Number.isFinite(expected) || Math.abs(amount - expected) > 0.05) return;
    const stPre = normalizeStoreOrderStatusInput(String(orderPre.status || '').toLowerCase(), '');
    if (stPre !== 'pending') return;
    const expAt = Number(orderPre.expiresAt || 0);
    if (expAt && Date.now() > expAt) {
      const expiredAt = Date.now();
      logger.warn('Loja: pagamento recebido apos expiracao do pedido', {
        orderId: storeRef.orderId,
        paymentId,
        expiresAt: expAt,
      });
      const releasedInventory = await releaseStoreInventoryReservation(db, orderPre);
      await db.ref(`loja/pedidos/${storeRef.orderId}`).update({
        status: 'cancelled',
        cancelReason: 'expired_unpaid',
        paymentStatus: String(pay?.status || 'approved'),
        inventoryReleasedAt: releasedInventory ? expiredAt : orderPre.inventoryReleasedAt ?? null,
        updatedAt: expiredAt,
      });
      return;
    }

    const procLock = await reserveMpProcessedPayment(db, paymentId, {
      uid: storeRef.uid,
      orderId: storeRef.orderId,
      tipo: 'loja_pedido_pago',
      amount,
      currency: String(pay?.currency_id || 'BRL'),
      source: 'checkout_store',
    });
    if (!procLock.acquired) return;

    const orderRef = db.ref(`loja/pedidos/${storeRef.orderId}`);
    const now = Date.now();
    const txOrder = await orderRef.transaction((cur) => {
      if (!cur || typeof cur !== 'object') return;
      if (normalizeStoreOrderStatusInput(String(cur.status || '').toLowerCase(), '') !== 'pending') return;
      return {
        ...cur,
        status: 'paid',
        paidAt: now,
        paymentId: String(paymentId),
        paymentStatus: String(pay?.status || 'approved'),
        paymentAmount: Number(pay?.transaction_amount || 0),
        payoutStatus: 'held',
        updatedAt: now,
      };
    });
    if (!txOrder.committed) return;
    const order = txOrder.snapshot.exists() ? txOrder.snapshot.val() || {} : {};
    await finalizeMpProcessedPayment(db, paymentId, {
      uid: storeRef.uid,
      orderId: storeRef.orderId,
      tipo: 'loja_pedido_pago',
      amount,
      currency: String(pay?.currency_id || 'BRL'),
      source: 'checkout_store',
      status: 'approved',
    });

    const orderItems = Array.isArray(order.items) ? order.items : [];

    await db.ref('financas/eventos').push({
      tipo: 'loja_pedido_pago',
      uid: storeRef.uid,
      orderId: storeRef.orderId,
      paymentId: String(paymentId),
      amount: Number.isFinite(Number(pay?.transaction_amount))
        ? Number(pay.transaction_amount)
        : Number(order.total || 0),
      currency: String(pay?.currency_id || 'BRL'),
      origem: 'loja_fisica',
      at: now,
    });

    try {
      const byCreator = new Map();
      for (const item of orderItems) {
        const cid = sanitizeCreatorId(item?.creatorId);
        if (!cid) continue;
        const lt = round2(item?.lineTotal);
        if (!Number.isFinite(lt) || lt <= 0) continue;
        byCreator.set(cid, (byCreator.get(cid) || 0) + lt);
      }
      for (const [cid, amt] of byCreator) {
        await recordCreatorPayment(db, {
          creatorId: cid,
          amount: round2(amt),
          currency: String(pay?.currency_id || 'BRL'),
          type: 'loja',
          buyerUid: storeRef.uid,
          paymentId,
          orderId: storeRef.orderId,
          extra: { source: 'checkout_store' },
        });
      }
      const lines = [...byCreator.entries()].map(([creatorId, lineAmount]) => ({
        creatorId,
        amount: round2(lineAmount),
      }));
      await commitUnifiedStorePhysicalMirror(db, {
        mpPaymentId: String(paymentId),
        buyerUid: storeRef.uid,
        orderId: storeRef.orderId,
        currency: String(pay?.currency_id || 'BRL'),
        totalBRL: expected,
        lines,
      });
    } catch (e) {
      logger.warn('Loja: falha ao registrar creatorData', { orderId: storeRef.orderId, error: e?.message });
    }
    return;
  }

  const podRef = parsePodExternalRef(pay.external_reference);
  if (podRef) {
    const orderSnapPre = await db.ref(`loja/printOnDemandOrders/${podRef.orderId}`).get();
    if (!orderSnapPre.exists()) return;
    const orderPre = orderSnapPre.val() || {};
    if (String(orderPre.status || '').toLowerCase() === 'cancelled') return;
    if (String(orderPre.creatorUid || '') !== podRef.uid) return;
    if (normalizeStoreOrderStatusInput(String(orderPre.status || '').toLowerCase(), '') !== 'pending') return;
    const expAt = Number(orderPre.expiresAt || 0);
    if (expAt && Date.now() > expAt) return;
    const amount = Number(pay.transaction_amount);
    const snap = orderPre.snapshot && typeof orderPre.snapshot === 'object' ? orderPre.snapshot : {};
    const expected = round2(Number(snap.amountDueBRL ?? orderPre.expectedPayBRL ?? 0));
    if (isRefundLikeStatus(status)) {
      await db.ref(`loja/printOnDemandOrders/${podRef.orderId}`).update({
        paymentStatus: status,
        updatedAt: Date.now(),
      });
      return;
    }
    if (!Number.isFinite(amount) || !Number.isFinite(expected) || Math.abs(amount - expected) > 0.05) return;
    const procLock = await reserveMpProcessedPayment(db, paymentId, {
      uid: podRef.uid,
      orderId: podRef.orderId,
      tipo: 'pod_pago',
      amount,
      currency: String(pay?.currency_id || 'BRL'),
      source: 'print_on_demand',
    });
    if (!procLock.acquired) return;
    const now = Date.now();
    const podOrderRef = db.ref(`loja/printOnDemandOrders/${podRef.orderId}`);
    await podOrderRef.update({
      status: 'paid',
      paidAt: now,
      paymentId: String(paymentId),
      paymentStatus: String(pay?.status || 'approved'),
      paymentAmount: amount,
      updatedAt: now,
    });
    await finalizeMpProcessedPayment(db, paymentId, {
      uid: podRef.uid,
      orderId: podRef.orderId,
      tipo: 'pod_pago',
      amount,
      currency: String(pay?.currency_id || 'BRL'),
      source: 'print_on_demand',
      status: 'approved',
    });
    await podOrderRef.child('orderEvents').push({
      at: now,
      type: 'payment_approved',
      message: 'Pagamento confirmado via Mercado Pago (webhook).',
      actor: 'webhook',
      paymentId: String(paymentId),
    });
    await db.ref('financas/eventos').push({
      tipo: 'pod_pedido_pago',
      uid: podRef.uid,
      orderId: podRef.orderId,
      paymentId: String(paymentId),
      amount,
      currency: String(pay?.currency_id || 'BRL'),
      origem: 'print_on_demand',
      at: now,
    });
    try {
      await notifyPrintOnDemandPaid(db, podRef.uid, podRef.orderId);
    } catch (e) {
      logger.warn('POD: falha notificacao', { orderId: podRef.orderId, error: e?.message });
    }
    try {
      await commitUnifiedPodPaidMirror(db, {
        mpPaymentId: String(paymentId),
        userId: podRef.uid,
        orderId: podRef.orderId,
        amountBRL: amount,
        currency: String(pay?.currency_id || 'BRL'),
      });
    } catch (e) {
      logger.warn('POD: falha unified mirror', { orderId: podRef.orderId, error: e?.message });
    }
    return;
  }

  const metadataUid = metadata.uid == null ? '' : String(metadata.uid).trim();
  const apoioUid = parseApoioExternalRef(pay.external_reference) || metadataUid;
  if (!apoioUid) return;

  const amount = Number(pay.transaction_amount);
  const currency = String(pay.currency_id || 'BRL');
  const apoioAttr = sanitizeCreatorId(metadata.attributionCreatorId);
  const creatorMembershipMode =
    metadata.creatorMembership === true || String(metadata.tipo || '') === 'creator_membership';
  if (isRefundLikeStatus(status)) {
    const origemRefund = String(metadata.planId || metadata.tipo || 'doacao_livre');
    const wrote = await appendUniqueFinanceEvent(db, `apoio_refund_${paymentId}_${status}`, {
      tipo: 'apoio_estornado',
      uid: apoioUid,
      paymentId: String(paymentId),
      amount: Number.isFinite(amount) ? amount : null,
      currency,
      origem: origemRefund,
      status,
      at: Date.now(),
    });
    if (wrote && apoioAttr && Number.isFinite(amount) && amount > 0) {
      await recordCreatorRefundAdjustment(db, [{
        creatorId: apoioAttr,
        amount,
        currency,
        type: creatorMembershipMode ? 'creator_membership_refund_adjustment' : 'apoio_refund_adjustment',
        buyerUid: apoioUid,
        paymentId,
        status,
        entryKey: `${creatorMembershipMode ? 'creator_membership' : 'apoio'}_refund_adjustment_${paymentId}_${status}`,
        extra: { origem: origemRefund },
      }]);
      try {
        await commitUnifiedRefundAdjustmentMirror(db, {
          mpPaymentId: String(paymentId),
          creatorId: apoioAttr,
          amount,
          currency,
          kind: creatorMembershipMode ? 'CREATOR_MEMBERSHIP_REFUND' : 'DONATION_REFUND',
          status: String(status),
          buyerUid: apoioUid,
          extra: { origem: origemRefund },
        });
      } catch (e) {
        logger.warn('unified refund mirror apoio', { paymentId, error: e?.message });
      }
    }
    if (creatorMembershipMode && apoioAttr) {
      await reverterMembershipCriadorSeNecessario(db, apoioUid, apoioAttr, paymentId, status);
    }
    return;
  }

  const description = String(pay.description || '').toLowerCase();
  let origem = 'doacao_livre';
  if (String(metadata.planId || '').trim()) origem = String(metadata.planId).trim();
  else if (description.includes('cafe')) origem = 'cafe';
  else if (description.includes('marmita')) origem = 'marmita';
  else if (description.includes('lendario')) origem = 'lendario';

  const procLock = await reserveMpProcessedPayment(db, paymentId, {
    uid: apoioUid,
    tipo: 'apoio_aprovado',
    amount,
    currency,
    source: creatorMembershipMode ? 'creator_membership' : 'donation',
  });
  if (!procLock.acquired) {
    if (!creatorMembershipMode && Number.isFinite(amount) && amount > 0) {
      try {
        await tryCommitUnifiedApprovedSettlement(db, {
          mpPaymentId: String(paymentId),
          userId: apoioUid,
          unifiedType: 'DONATION',
          creatorId: apoioAttr || null,
          source: normalizeUnifiedSource(metadata.source, apoioAttr),
          grossBRL: amount,
          currency,
          creatorDataPaymentType: 'apoio',
          extra: { origem },
        });
      } catch (e) {
        logger.warn('Apoio: unified settlement na reentrancia', { paymentId, error: e?.message });
      }
    } else if (creatorMembershipMode && apoioAttr && Number.isFinite(amount) && amount > 0) {
      try {
        await tryCommitUnifiedApprovedSettlement(db, {
          mpPaymentId: String(paymentId),
          userId: apoioUid,
          unifiedType: 'CREATOR_MEMBERSHIP',
          creatorId: apoioAttr,
          source: 'creator_link',
          grossBRL: amount,
          currency,
          creatorDataPaymentType: 'creator_membership',
          extra: { origem, repair: true },
        });
      } catch (e) {
        logger.warn('Apoio: unified membership settlement na reentrancia', { paymentId, error: e?.message });
      }
    }
    return;
  }

  const now = Date.now();
  await finalizeMpProcessedPayment(db, paymentId, {
    uid: apoioUid,
    tipo: 'apoio_aprovado',
    amount,
    currency,
    source: creatorMembershipMode ? 'creator_membership' : 'donation',
    status: 'approved',
  });
  await db.ref('financas/eventos').push({
    tipo: creatorMembershipMode ? 'creator_membership_aprovada' : 'apoio_aprovado',
    uid: apoioUid,
    paymentId: String(paymentId),
    amount: Number.isFinite(amount) ? amount : null,
    currency,
    origem,
    at: now,
  });

  if (Number.isFinite(amount) && amount > 0) {
    if (creatorMembershipMode) {
      if (apoioAttr) {
        await aplicarMembershipCriadorAprovada(db, apoioUid, apoioAttr, paymentId, amount, currency);
      }
    } else {
      await tryCommitUnifiedApprovedSettlement(db, {
        mpPaymentId: String(paymentId),
        userId: apoioUid,
        unifiedType: 'DONATION',
        creatorId: apoioAttr || null,
        source: normalizeUnifiedSource(metadata.source, apoioAttr),
        grossBRL: amount,
        currency,
        creatorDataPaymentType: 'apoio',
        extra: { origem },
      }).catch((e) => logger.warn('Apoio: unified settlement falhou', { paymentId, error: e?.message }));
    }
  }
}

export const mercadopagowebhook = onRequest(
  {
    region: 'us-central1',
    secrets: [
      MP_ACCESS_TOKEN,
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASS,
      SMTP_FROM,
    ],
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    let paymentId;
    try {
      paymentId = extractMercadoPagoPaymentId(req);
    } catch (e) {
      logger.error('mercadopagowebhook parse', { error: e?.message });
      res.status(200).send('OK');
      return;
    }
    if (!paymentId) {
      res.status(200).send('OK');
      return;
    }

    const mpWebhookSecret = String(MP_WEBHOOK_SECRET.value() || '').trim();
    if (mpWebhookSecret) {
      if (req.method === 'POST') {
        const sigCheck = verifyMercadoPagoWebhookSignature(req, paymentId, mpWebhookSecret);
        if (!sigCheck.ok && !sigCheck.skipped) {
          logger.warn('mercadopagowebhook assinatura invalida', { paymentId, reason: sigCheck.reason });
          res.status(401).send('Unauthorized');
          return;
        }
      } else {
        res.status(401).send('Unauthorized');
        return;
      }
    }

    let token;
    try {
      token = String(MP_ACCESS_TOKEN.value()).trim();
    } catch {
      logger.error('mercadopagowebhook: MP_ACCESS_TOKEN ausente');
      res.status(500).send('Config');
      return;
    }
    if (!token) {
      res.status(500).send('Config');
      return;
    }

    try {
      await tratarNotificacaoPagamentoPremium(token, paymentId);
    } catch (err) {
      logger.error('mercadopagowebhook', { paymentId, error: err?.message });
      res.status(500).send('Error');
      return;
    }
    res.status(200).send('OK');
  }
);

export const assinaturasPremiumDiario = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'America/Sao_Paulo',
    memory: '256MiB',
    timeoutSeconds: 300,
    secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async () => {
    const db = getDatabase();
    const snap = await db.ref('usuarios').get();
    if (!snap.exists()) {
      logger.info('assinaturasPremiumDiario: sem usuarios');
      return;
    }

    const now = Date.now();
    const users = snap.val() || {};
    let lembretes = 0;
    let expirados = 0;

    const transporter = getTransporter();
    const fromAddr = getSmtpFrom();

    for (const [uid, profile] of Object.entries(users)) {
      const needsEntitlementsRepair =
        !profile?.userEntitlements ||
        typeof profile.userEntitlements !== 'object' ||
        typeof profile.userEntitlements.global !== 'object' ||
        typeof profile.userEntitlements.creators !== 'object';
      if (needsEntitlementsRepair) {
        try {
          const repairPatch = {};
          appendNestedPatch(repairPatch, `usuarios/${uid}`, buildUserEntitlementsPatch(profile));
          await db.ref().update(repairPatch);
        } catch (err) {
          logger.error('userEntitlements repair falhou', { uid, error: err?.message });
        }
      }

      const statusMembro = profile?.membershipStatus;
      const mu = profile?.memberUntil;
      const tipoConta = String(profile?.accountType || 'comum').toLowerCase();
      const appStatus = profile?.status;
      if (appStatus !== 'ativo') continue;

      if (statusMembro === 'ativo' && typeof mu === 'number' && mu < now && tipoConta === 'premium') {
        try {
          const pubSnap = await db.ref(`usuarios_publicos/${uid}`).get();
          const pub = pubSnap.val() || {};
          let avatarPub = String(pub.userAvatar || profile.userAvatar || '').trim();
          if (!avatarPub) avatarPub = AVATAR_FALLBACK_FUNCTIONS;
          await db.ref(`usuarios/${uid}`).update({
            membershipStatus: 'vencido',
            accountType: 'comum',
            userEntitlements: {
              ...(profile?.userEntitlements && typeof profile.userEntitlements === 'object'
                ? profile.userEntitlements
                : {}),
              global: {
                isPremium: false,
                status: 'vencido',
                memberUntil: typeof mu === 'number' ? mu : null,
              },
              updatedAt: now,
            },
          });
          await db.ref(`usuarios_publicos/${uid}`).update({
            uid,
            userName: pub.userName || profile.userName || 'Leitor',
            userAvatar: avatarPub,
            accountType: 'comum',
            updatedAt: now,
          });
          expirados += 1;
        } catch (err) {
          logger.error('Premium expirar falhou', { uid, error: err?.message });
        }
        continue;
      }

      if (statusMembro !== 'ativo' || typeof mu !== 'number' || mu <= now) continue;
      const remaining = mu - now;
      if (remaining > 5 * MS_DAY || remaining <= 0) continue;
      const notified = profile?.premium5dNotifiedForUntil;
      if (notified === mu) continue;

      try {
        const authUser = await getAuth().getUser(uid);
        const to = authUser?.email;
        if (to && !authUser.disabled) {
          await transporter.sendMail({
            from: fromAddr,
            to,
            subject: 'MangaTeofilo - sua assinatura Premium acaba em breve',
            text: `Faltam cerca de 5 dias para o fim do seu Premium (ate ${formatarDataBr(mu)}). Renove em ${APP_BASE_URL.value().replace(/\/$/, '')}/apoie`,
            html: buildPremiumExpiryWarningHtml(mu),
          });
          await db.ref(`usuarios/${uid}/premium5dNotifiedForUntil`).set(mu);
          lembretes += 1;
        }
      } catch (err) {
        logger.error('Premium lembrete falhou', { uid, error: err?.message });
      }
    }

    logger.info('assinaturasPremiumDiario ok', {
      lembretes,
      expirados,
      totalUsuarios: Object.keys(users).length,
    });
  }
);
