import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  APOIO_PLANOS_MP,
  criarPreferenciaApoio,
  criarPreferenciaApoioValorLivre,
} from '../mercadoPagoApoio.js';
import {
  PREMIUM_PRICE_BRL,
  criarPreferenciaPremium,
} from '../mercadoPagoPremium.js';
import {
  criarPreferenciaLoja,
  criarPreferenciaPrintOnDemand,
} from '../mercadoPagoStore.js';
import { persistPrintOnDemandOrder } from '../printOnDemandOrders.js';
import {
  CREATOR_MEMBERSHIP_PRICE_MAX_BRL,
  CREATOR_MEMBERSHIP_PRICE_MIN_BRL,
  isValidCreatorMembershipPriceBRL,
} from '../creatorMembershipPricing.js';
import { sanitizeCreatorId } from '../creatorDataLedger.js';
import { getPremiumOfferAt } from '../promoUtils.js';
import {
  sanitizeTrackingValue,
  normalizeTrackingSource,
} from '../trackingUtils.js';
import {
  buildStoreShippingQuoteForUser,
  maskCpf,
  normalizeStoreOrderStatusInput,
  parseStoreCartLineItem,
  round2,
} from '../orders/storeCommon.js';
import { getMonetizableCreatorPublicProfile } from '../creator/publicProfile.js';
import { pushMarketingEvent } from './marketing.js';
import {
  APP_BASE_URL,
  FUNCTIONS_PUBLIC_URL,
  MP_ACCESS_TOKEN,
  getMercadoPagoAccessTokenOrThrow,
} from './config.js';

const APOIO_CUSTOM_MIN = 1;
const APOIO_CUSTOM_MAX = 5000;
const STORE_ORDER_EXPIRY_MS = 3 * 60 * 60 * 1000;

function notificationUrlForWebhook() {
  const base = FUNCTIONS_PUBLIC_URL.value().replace(/\/$/, '');
  return `${base}/mercadopagowebhook`;
}

function throwMpConfigError(message) {
  throw new HttpsError('failed-precondition', message);
}

function getMercadoPagoTokenOrHttpsError() {
  try {
    return getMercadoPagoAccessTokenOrThrow();
  } catch (error) {
    throwMpConfigError(error?.message || 'Mercado Pago nao configurado.');
  }
}

function tryParseApoioCustomAmount(value) {
  if (value === undefined || value === null || value === '') return { present: false };
  const parsed =
    typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(parsed)) return { present: true, error: 'nan' };
  const rounded = Math.round(parsed * 100) / 100;
  if (rounded < APOIO_CUSTOM_MIN || rounded > APOIO_CUSTOM_MAX) {
    return { present: true, error: 'range' };
  }
  return { present: true, value: rounded };
}

function normalizeApoioPlanId(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (!value) return null;
  return APOIO_PLANOS_MP[value] ? value : null;
}

export const criarCheckoutApoio = onCall(
  {
    region: 'us-central1',
    secrets: [MP_ACCESS_TOKEN],
    cors: true,
    invoker: 'public',
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para apoiar a obra.');
    }

    const payload = request.data && typeof request.data === 'object' ? request.data : {};
    const attributionCreatorId = sanitizeCreatorId(payload.attributionCreatorId);
    const creatorMembership = payload.creatorMembership === true;
    const creatorMembershipCreatorId =
      sanitizeCreatorId(payload.creatorMembershipCreatorId) || attributionCreatorId;
    const planRaw = payload.planId;
    const customTry = tryParseApoioCustomAmount(payload.customAmount);
    const planNorm = normalizeApoioPlanId(planRaw);

    const hasValidCustom = customTry.present && 'value' in customTry;
    const hasValidPlan = Boolean(planNorm);

    logger.info('criarCheckoutApoio entrada', {
      planId: planRaw,
      customAmount: payload.customAmount,
      hasValidPlan,
      hasValidCustom,
      creatorMembership,
    });

    let creatorMembershipPrice = null;
    const db = getDatabase();
    if (creatorMembership) {
      if (!creatorMembershipCreatorId) {
        throw new HttpsError('invalid-argument', 'Membership do criador exige um creatorId valido.');
      }
      if (creatorMembershipCreatorId === request.auth.uid) {
        throw new HttpsError('failed-precondition', 'Voce nao pode assinar a propria membership de criador.');
      }
      const creatorPublic = await getMonetizableCreatorPublicProfile(db, creatorMembershipCreatorId, {
        requireMembershipEnabled: true,
      });
      const creatorName = String(creatorPublic.creatorDisplayName || creatorPublic.userName || '').trim();
      if (!creatorName) {
        throw new HttpsError(
          'failed-precondition',
          'Este criador ainda nao concluiu a identidade publica minima.'
        );
      }
      creatorMembershipPrice = Number(creatorPublic.creatorMembershipPriceBRL);
      if (!isValidCreatorMembershipPriceBRL(creatorMembershipPrice)) {
        throw new HttpsError(
          'failed-precondition',
          `Este criador ainda nao configurou um valor valido de membership (R$ ${CREATOR_MEMBERSHIP_PRICE_MIN_BRL} a R$ ${CREATOR_MEMBERSHIP_PRICE_MAX_BRL}).`
        );
      }
    }

    if (hasValidPlan && hasValidCustom) {
      throw new HttpsError('invalid-argument', 'Use planId OU customAmount, nao os dois.');
    }

    if (creatorMembership && (hasValidPlan || hasValidCustom)) {
      throw new HttpsError(
        'invalid-argument',
        'Membership do criador usa o valor configurado pelo criador e nao aceita planId/customAmount.'
      );
    }

    if (!hasValidCustom && !hasValidPlan) {
      if (customTry.present && customTry.error === 'nan') {
        throw new HttpsError('invalid-argument', 'customAmount invalido. Informe um numero entre 1 e 5000.');
      }
      if (customTry.present && customTry.error === 'range') {
        throw new HttpsError(
          'invalid-argument',
          `customAmount deve estar entre ${APOIO_CUSTOM_MIN} e ${APOIO_CUSTOM_MAX}.`
        );
      }
      const planStr =
        planRaw === undefined || planRaw === null || planRaw === ''
          ? ''
          : String(planRaw).trim();
      if (planStr && !planNorm) {
        throw new HttpsError('invalid-argument', 'Plano invalido. Use cafe, marmita ou lendario.');
      }
      throw new HttpsError(
        'invalid-argument',
        'Envie planId (cafe|marmita|lendario) ou customAmount (1 a 5000).'
      );
    }

    if (!creatorMembership && attributionCreatorId) {
      await getMonetizableCreatorPublicProfile(db, attributionCreatorId);
    }

    const token = getMercadoPagoTokenOrHttpsError();
    const notificationUrl = notificationUrlForWebhook();

    try {
      let url;
      const creatorBackUrlQuery = attributionCreatorId
        ? `creatorId=${encodeURIComponent(attributionCreatorId)}`
        : '';
      if (creatorMembership) {
        url = await criarPreferenciaApoioValorLivre(
          token,
          creatorMembershipPrice,
          APP_BASE_URL.value(),
          request.auth.uid,
          notificationUrl,
          creatorMembershipCreatorId,
          {
            metadata: {
              tipo: 'creator_membership',
              creatorMembership: true,
              transactionType: 'CREATOR_MEMBERSHIP',
              source: 'creator_link',
            },
            backUrlQuery: `tipo=creator_membership&creatorId=${encodeURIComponent(creatorMembershipCreatorId)}`,
          }
        );
      } else if (hasValidCustom) {
        url = await criarPreferenciaApoioValorLivre(
          token,
          customTry.value,
          APP_BASE_URL.value(),
          request.auth.uid,
          notificationUrl,
          attributionCreatorId,
          creatorBackUrlQuery ? { backUrlQuery: creatorBackUrlQuery } : {}
        );
      } else {
        url = await criarPreferenciaApoio(
          token,
          planNorm,
          APP_BASE_URL.value(),
          request.auth.uid,
          notificationUrl,
          attributionCreatorId,
          creatorBackUrlQuery ? { backUrlQuery: creatorBackUrlQuery } : {}
        );
      }
      return { ok: true, url };
    } catch (err) {
      const errMsg = err?.message || String(err);
      logger.error('Mercado Pago preference', {
        planId: planNorm,
        customAmount: hasValidCustom ? customTry.value : payload.customAmount,
        error: errMsg,
      });
      const lower = errMsg.toLowerCase();
      if (lower.includes('invalid') && lower.includes('token')) {
        throwMpConfigError(
          'Mercado Pago recusou o Access Token (invalido, expirado ou ambiente errado). Gere um novo em Credenciais e rode: firebase functions:secrets:set MP_ACCESS_TOKEN'
        );
      }
      if (lower.includes('unauthorized') || errMsg.includes('401')) {
        throwMpConfigError(
          'Token rejeitado pelo Mercado Pago (401). Confira se colou o Access Token e nao a Public Key.'
        );
      }
      throw new HttpsError('internal', errMsg.length > 220 ? `${errMsg.slice(0, 220)}...` : errMsg);
    }
  }
);

export const criarCheckoutLoja = onCall(
  {
    region: 'us-central1',
    secrets: [MP_ACCESS_TOKEN],
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para finalizar a compra.');
    }
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const requestedShippingService = String(body.shippingService != null ? body.shippingService : 'PAC')
      .trim()
      .toUpperCase();
    if (!rawItems.length) throw new HttpsError('invalid-argument', 'Carrinho vazio.');
    if (rawItems.length > 20) throw new HttpsError('invalid-argument', 'Limite de 20 itens por checkout.');

    const token = getMercadoPagoTokenOrHttpsError();
    const db = getDatabase();
    const [cfgSnap, productsSnap, userSnap] = await Promise.all([
      db.ref('loja/config').get(),
      db.ref('loja/produtos').get(),
      db.ref(`usuarios/${request.auth.uid}`).get(),
    ]);
    const config = cfgSnap.exists() ? cfgSnap.val() || {} : {};
    if (config.storeEnabled !== true || config.acceptingOrders !== true) {
      throw new HttpsError('failed-precondition', 'Loja nao esta aceitando pedidos agora.');
    }

    const profile = userSnap.exists() ? userSnap.val() || {} : {};
    if (String(profile.status || '').trim().toLowerCase() !== 'ativo') {
      throw new HttpsError('failed-precondition', 'Sua conta precisa estar ativa para comprar.');
    }

    const products = productsSnap.exists() ? productsSnap.val() || {} : {};
    const { quote, subtotal, buyerProfile, vip, vipDiscountPct } = buildStoreShippingQuoteForUser({
      rawItems,
      products,
      config,
      profile,
    });

    if (subtotal <= 0) throw new HttpsError('failed-precondition', 'Subtotal invalido para checkout.');

    const shippingOption = quote.options.find(
      (option) => String(option.serviceCode || '').trim().toUpperCase() === requestedShippingService
    );
    const allowedCodes = (quote.options || []).map((option) =>
      String(option.serviceCode || '').trim().toUpperCase()
    );
    if (!shippingOption) {
      throw new HttpsError(
        'invalid-argument',
        allowedCodes.length
          ? `Servico de frete invalido (${requestedShippingService}). Opcoes: ${allowedCodes.join(', ')}.`
          : 'Nao foi possivel calcular o frete para este carrinho.'
      );
    }

    const orderItems = rawItems.map((item) =>
      parseStoreCartLineItem(item, products, {
        vip,
        vipDiscountPct,
        enforceStock: true,
      })
    );

    const shippingDiscountBrl = round2(shippingOption.discountBrl);
    const shippingBrl = round2(shippingOption.priceBrl);
    const total = round2(subtotal + shippingBrl);
    if (total <= 0) throw new HttpsError('failed-precondition', 'Total invalido para checkout.');

    const now = Date.now();
    const orderRef = db.ref('loja/pedidos').push();
    const orderId = String(orderRef.key || '').trim();
    if (!orderId) throw new HttpsError('internal', 'Falha ao gerar pedido.');

    const sellers = {};
    for (const line of orderItems) {
      const cid = sanitizeCreatorId(line?.creatorId);
      if (cid) sellers[cid] = true;
    }

    const order = {
      uid: request.auth.uid,
      status: 'pending',
      expiresAt: now + STORE_ORDER_EXPIRY_MS,
      buyer: {
        fullName: buyerProfile.fullName,
        phone: buyerProfile.phone,
        cpfMasked: maskCpf(buyerProfile.cpf),
      },
      shippingAddress: {
        postalCode: buyerProfile.postalCode,
        state: buyerProfile.state,
        city: buyerProfile.city,
        neighborhood: buyerProfile.neighborhood,
        addressLine1: buyerProfile.addressLine1,
        addressLine2: buyerProfile.addressLine2 || null,
      },
      items: orderItems,
      sellers,
      subtotal,
      shippingBrl,
      shippingOriginalBrl: round2(shippingOption.originalPriceBrl),
      shippingDiscountBrl,
      shippingFreeApplied: shippingDiscountBrl > 0,
      shippingMethod: shippingOption.serviceCode,
      shippingRegion: shippingOption.regionKey,
      shippingRegionLabel: shippingOption.regionLabel,
      shippingTransitDays: shippingOption.transitDays ?? shippingOption.deliveryDays,
      shippingDeliveryDays: shippingOption.deliveryDays,
      shippingDeliveryDaysLow: shippingOption.deliveryDaysLow ?? null,
      shippingDeliveryDaysHigh: shippingOption.deliveryDaysHigh ?? null,
      shippingWeightGrams: shippingOption.totalWeightGrams,
      shippingCostInternal: round2(shippingOption.internalCostBrl),
      total,
      currency: 'BRL',
      vipApplied: vip,
      vipDiscountPct: vip ? vipDiscountPct : 0,
      payoutStatus: 'held',
      payoutReleasedAt: null,
      createdAt: now,
      updatedAt: now,
      source: 'checkout_store',
    };
    await orderRef.set(order);

    const notificationUrl = notificationUrlForWebhook();
    const mpOrder = {
      ...order,
      orderId,
      uid: request.auth.uid,
      items: [
        ...orderItems.map((item) => ({
          title: item.title,
          description: item.description || '',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
        ...(shippingBrl > 0
          ? [
              {
                title: 'Frete',
                description: 'Envio',
                quantity: 1,
                unitPrice: shippingBrl,
              },
            ]
          : []),
      ],
      total,
    };
    const url = await criarPreferenciaLoja(token, mpOrder, APP_BASE_URL.value(), notificationUrl);
    await orderRef.update({
      checkoutUrl: url,
      checkoutStartedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { ok: true, orderId, url };
  }
);

export const createPrintOnDemandCheckout = onCall(
  {
    region: 'us-central1',
    secrets: [MP_ACCESS_TOKEN],
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para pagar.');
    }
    const uid = request.auth.uid;
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const token = getMercadoPagoTokenOrHttpsError();
    const db = getDatabase();
    let orderId;
    try {
      const created = await persistPrintOnDemandOrder(db, uid, body);
      orderId = created.orderId;
      const order = created.order;
      const snap = order.snapshot && typeof order.snapshot === 'object' ? order.snapshot : {};
      const amount = round2(Number(snap.amountDueBRL ?? 0));
      if (!Number.isFinite(amount) || amount <= 0) {
        await db.ref(`loja/printOnDemandOrders/${orderId}`).remove();
        throw new HttpsError('failed-precondition', 'Valor do pedido invalido.');
      }
      const saleModel = String(snap.saleModel || '');
      const format = String(snap.format || '');
      const qty = Number(snap.quantity || 0);
      const notificationUrl = notificationUrlForWebhook();
      const title = `Manga fisico - ${format === 'tankobon' ? 'Tankobon' : 'Meio-tanko'} x${qty}`;
      const desc =
        saleModel === 'store_promo'
          ? 'Divulgacao na loja'
          : saleModel === 'platform'
            ? 'Venda pela plataforma'
            : 'Compra pessoal';
      const url = await criarPreferenciaPrintOnDemand(token, {
        orderId,
        uid,
        title,
        description: desc,
        amountBRL: amount,
        appBaseUrl: APP_BASE_URL.value(),
        notificationUrl,
      });
      const time = Date.now();
      await db.ref(`loja/printOnDemandOrders/${orderId}`).update({
        checkoutUrl: url,
        checkoutStartedAt: time,
        expectedPayBRL: amount,
        updatedAt: time,
      });
      await db.ref(`loja/printOnDemandOrders/${orderId}/orderEvents`).push({
        at: time,
        type: 'checkout_mp_created',
        message: 'Preferencia de pagamento criada no Mercado Pago.',
        actor: 'system',
      });
      return { ok: true, orderId, url };
    } catch (error) {
      if (orderId) {
        try {
          await db.ref(`loja/printOnDemandOrders/${orderId}`).remove();
        } catch {
          /* ignore */
        }
      }
      throw error;
    }
  }
);

export const resumePrintOnDemandCheckout = onCall(
  {
    region: 'us-central1',
    secrets: [MP_ACCESS_TOKEN],
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para pagar.');
    }
    const uid = request.auth.uid;
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const orderId = String(body.orderId || '').trim();
    if (!orderId) {
      throw new HttpsError('invalid-argument', 'orderId obrigatorio.');
    }
    const token = getMercadoPagoTokenOrHttpsError();
    const db = getDatabase();
    const orderRef = db.ref(`loja/printOnDemandOrders/${orderId}`);
    const snap = await orderRef.get();
    if (!snap.exists()) {
      throw new HttpsError('not-found', 'Pedido nao encontrado.');
    }
    const row = snap.val() || {};
    if (String(row.creatorUid || '') !== uid) {
      throw new HttpsError('permission-denied', 'Sem permissao.');
    }
    const status = normalizeStoreOrderStatusInput(String(row.status || '').trim().toLowerCase(), '');
    if (status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        'So e possivel gerar pagamento para pedidos aguardando pagamento.'
      );
    }
    const exp = Number(row.expiresAt || 0);
    if (exp && Date.now() > exp) {
      throw new HttpsError(
        'failed-precondition',
        'Este pedido expirou (3 horas sem pagamento). Monte um novo lote no carrinho.'
      );
    }
    const snapOrder = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {};
    const amount = round2(Number(snapOrder.amountDueBRL ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError('failed-precondition', 'Valor do pedido invalido.');
    }
    const saleModel = String(snapOrder.saleModel || '');
    const format = String(snapOrder.format || '');
    const qty = Number(snapOrder.quantity || 0);
    const notificationUrl = notificationUrlForWebhook();
    const title = `Manga fisico - ${format === 'tankobon' ? 'Tankobon' : 'Meio-tanko'} x${qty}`;
    const desc =
      saleModel === 'store_promo'
        ? 'Divulgacao na loja'
        : saleModel === 'platform'
          ? 'Venda pela plataforma'
          : 'Compra pessoal';
    const url = await criarPreferenciaPrintOnDemand(token, {
      orderId,
      uid,
      title,
      description: desc,
      amountBRL: amount,
      appBaseUrl: APP_BASE_URL.value(),
      notificationUrl,
    });
    await orderRef.update({
      checkoutUrl: url,
      checkoutStartedAt: Date.now(),
      expectedPayBRL: amount,
      updatedAt: Date.now(),
    });
    return { ok: true, url };
  }
);

export const criarCheckoutPremium = onCall(
  {
    region: 'us-central1',
    secrets: [MP_ACCESS_TOKEN],
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para assinar o Premium.');
    }

    const token = getMercadoPagoTokenOrHttpsError();
    const notificationUrl = notificationUrlForWebhook();
    const db = getDatabase();
    const offer = await getPremiumOfferAt(db, Date.now(), PREMIUM_PRICE_BRL);
    const payload = request.data && typeof request.data === 'object' ? request.data : {};
    const attributionRaw =
      payload.attribution && typeof payload.attribution === 'object' ? payload.attribution : {};
    const attributionCreatorId = sanitizeCreatorId(payload.attributionCreatorId);
    const attribution = {
      source: normalizeTrackingSource(attributionRaw.source) || 'direct',
      campaignId: sanitizeTrackingValue(attributionRaw.campaignId, 100),
      clickId: sanitizeTrackingValue(attributionRaw.clickId, 120),
      creatorId: attributionCreatorId || null,
    };
    if (attributionCreatorId) {
      await getMonetizableCreatorPublicProfile(db, attributionCreatorId);
    }

    try {
      const url = await criarPreferenciaPremium(
        token,
        request.auth.uid,
        APP_BASE_URL.value(),
        notificationUrl,
        offer.currentPriceBRL,
        offer.isPromoActive ? { promoId: offer.promo?.promoId, promoName: offer.promo?.name } : null,
        attribution,
        attributionCreatorId
          ? { backUrlQuery: `creatorId=${encodeURIComponent(attributionCreatorId)}` }
          : {}
      );
      await pushMarketingEvent(db, {
        eventType: 'premium_checkout_started',
        source: attribution.source,
        campaignId: attribution.campaignId,
        clickId: attribution.clickId,
        uid: request.auth.uid,
      });
      return { ok: true, url };
    } catch (err) {
      const errMsg = err?.message || String(err);
      logger.error('criarCheckoutPremium', { uid: request.auth.uid, error: errMsg });
      throw new HttpsError('internal', errMsg.length > 200 ? `${errMsg.slice(0, 200)}...` : errMsg);
    }
  }
);
