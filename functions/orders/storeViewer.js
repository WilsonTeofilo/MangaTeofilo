import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getAdminAuthContext, isCreatorAccountAuth } from '../adminRbac.js';
import {
  buildCommerceFingerprint,
  enforceCommerceAbuseShield,
  readCommerceIdempotency,
  writeCommerceIdempotency,
} from '../commerceGuard.js';
import { assertTrustedAppRequest } from '../appCheckGuard.js';
import {
  STORE_ORDER_STATUS_CANON,
  buildStoreShippingQuoteForUser,
  normalizeStoreOrderStatusInput,
  orderItemsForCreator,
  sanitizeStoreOrderForViewer,
} from './storeCommon.js';

function extractStoragePathFromDownloadUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/o\/([^?]+)/i);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

function resolveStoreInternalPdfPath(product) {
  const path = String(product?.internalFiles?.mioloPdfPath || '').trim();
  if (path) return path;
  return extractStoragePathFromDownloadUrl(product?.internalFiles?.mioloPdfUrl);
}

function canManageStoreOrdersGlobally(ctx) {
  return (
    ctx?.super === true ||
    ctx?.permissions?.canAccessLojaAdmin === true ||
    ctx?.permissions?.canAccessPedidos === true
  );
}

async function listVisibleStoreOrdersRuntime(request, { creatorOnly = false } = {}) {
  assertTrustedAppRequest(request);
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const db = getDatabase();
  await enforceCommerceAbuseShield(db, {
    request,
    scope: creatorOnly ? 'creatorStoreOrdersList' : 'adminStoreOrdersList',
    key: request.auth.uid,
    minIntervalMs: 400,
    windowMs: 60 * 1000,
    maxHits: 30,
    networkWindowMs: 60 * 1000,
    networkMaxHits: 50,
    ipWindowMs: 5 * 60 * 1000,
    ipMaxHits: 90,
    message: 'Muitas consultas de pedidos em pouco tempo. Aguarde alguns segundos.',
  });
  const ctx = await getAdminAuthContext(request.auth);
  const isCreator = ctx ? false : await isCreatorAccountAuth(request.auth);
  if (!ctx && !isCreator) {
    throw new HttpsError('permission-denied', 'Sem acesso ao painel.');
  }
  if (creatorOnly && !isCreator) {
    throw new HttpsError('permission-denied', 'Apenas creators podem usar este endpoint.');
  }

  const snap = await db.ref('loja/pedidos').get();
  const orders = snap.val() || {};
  const list = Object.entries(orders)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

  if (isCreator) {
    const visible = list
      .filter((order) => orderItemsForCreator(order, request.auth.uid).length > 0)
      .map((order) => sanitizeStoreOrderForViewer(order.id, order, request.auth.uid));
    return { ok: true, orders: visible, scopedToCreator: true };
  }

  if (!canManageStoreOrdersGlobally(ctx)) {
    throw new HttpsError('permission-denied', 'Sem permissao para pedidos da loja.');
  }
  return { ok: true, orders: list, scopedToCreator: false };
}

async function updateVisibleStoreOrderRuntime(request, { creatorOnly = false } = {}) {
  assertTrustedAppRequest(request);
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const db = getDatabase();
  await enforceCommerceAbuseShield(db, {
    request,
    scope: creatorOnly ? 'creatorStoreOrderUpdate' : 'adminStoreOrderUpdate',
    key: request.auth.uid,
    minIntervalMs: 700,
    windowMs: 60 * 1000,
    maxHits: 15,
    networkWindowMs: 60 * 1000,
    networkMaxHits: 25,
    ipWindowMs: 5 * 60 * 1000,
    ipMaxHits: 40,
    message: 'Muitas atualizacoes de pedido em pouco tempo. Aguarde alguns segundos.',
  });
  const ctx = await getAdminAuthContext(request.auth);
  const isCreator = ctx ? false : await isCreatorAccountAuth(request.auth);
  if (!ctx && !isCreator) {
    throw new HttpsError('permission-denied', 'Sem acesso ao painel.');
  }
  if (creatorOnly && !isCreator) {
    throw new HttpsError('permission-denied', 'Apenas creators podem usar este endpoint.');
  }

  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const orderId = String(body.orderId || '').trim();
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId obrigatorio.');
  }
  const statusRaw = body.status == null ? '' : String(body.status).trim();
  const trackingCode = body.trackingCode == null ? null : String(body.trackingCode || '').trim();
  const productionChecklist =
    body.productionChecklist && typeof body.productionChecklist === 'object'
      ? body.productionChecklist
      : null;
  if (!statusRaw && trackingCode == null && !productionChecklist) {
    throw new HttpsError('invalid-argument', 'Envie status, trackingCode ou productionChecklist.');
  }

  const orderRef = db.ref(`loja/pedidos/${orderId}`);
  const snap = await orderRef.get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Pedido nao encontrado.');
  }
  const order = snap.val() || {};
  const patch = { updatedAt: Date.now() };
  const currentStatus = normalizeStoreOrderStatusInput(String(order.status || ''), '');
  const setHeldIfMissing = () => {
    if (
      order?.payoutStatus == null &&
      patch.payoutStatus == null &&
      ['paid', 'in_production', 'shipped', 'delivered'].includes(
        String(patch.status || currentStatus || '').trim().toLowerCase()
      )
    ) {
      patch.payoutStatus = 'held';
    }
  };

  if (isCreator) {
    const ownItems = orderItemsForCreator(order, request.auth.uid);
    const hasForeignItems = (Array.isArray(order?.items) ? order.items : []).length > ownItems.length;
    if (!ownItems.length) {
      throw new HttpsError('permission-denied', 'Pedido fora do seu escopo.');
    }
    if (hasForeignItems) {
      throw new HttpsError('failed-precondition', 'Pedido misto deve ser atualizado pelo admin.');
    }
  } else if (!canManageStoreOrdersGlobally(ctx)) {
    throw new HttpsError('permission-denied', 'Sem permissao para atualizar pedido.');
  }

  if (statusRaw) {
    const normalizedStatus = normalizeStoreOrderStatusInput(statusRaw, '');
    if (!normalizedStatus || !STORE_ORDER_STATUS_CANON.has(normalizedStatus)) {
      throw new HttpsError('invalid-argument', 'Status invalido.');
    }
    if (isCreator) {
      const allowedCreatorTransitions = {
        paid: ['in_production'],
        in_production: ['shipped'],
        shipped: ['shipped'],
      };
      const nextAllowed = allowedCreatorTransitions[String(currentStatus || '').trim().toLowerCase()] || [];
      if (!nextAllowed.includes(normalizedStatus)) {
        throw new HttpsError(
          'failed-precondition',
          'Creators so podem avancar o pedido de pago para em producao e depois para enviado.'
        );
      }
    }
    patch.status = normalizedStatus;
    if (!isCreator && ['paid', 'in_production', 'shipped', 'delivered'].includes(normalizedStatus)) {
      patch.payoutStatus = 'held';
      if (normalizedStatus !== 'delivered') {
        patch.payoutReleasedAt = null;
      }
    }
    setHeldIfMissing();
  }
  if (trackingCode != null) {
    if (trackingCode.length > 80) {
      throw new HttpsError('invalid-argument', 'trackingCode muito longo.');
    }
    patch.trackingCode = trackingCode;
  }
  if (productionChecklist) {
    patch.productionChecklist = {
      printing: productionChecklist.printing === true,
      organizing: productionChecklist.organizing === true,
      gluing: productionChecklist.gluing === true,
      pressing: productionChecklist.pressing === true,
      cutting: productionChecklist.cutting === true,
      finishing: productionChecklist.finishing === true,
    };
    setHeldIfMissing();
  }

  if (trackingCode != null) {
    setHeldIfMissing();
  }

  await orderRef.update(patch);
  return { ok: true };
}

export const quoteStoreShipping = onCall(
  {
    region: 'us-central1',
    cors: true,
  },
  async (request) => {
    assertTrustedAppRequest(request);
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para calcular o frete.');
    }
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw new HttpsError('invalid-argument', 'Carrinho vazio.');

    const db = getDatabase();
    await enforceCommerceAbuseShield(db, {
      request,
      scope: 'shippingQuote',
      key: request.auth.uid,
      minIntervalMs: 1200,
      windowMs: 60 * 1000,
      maxHits: 12,
      networkMinIntervalMs: 500,
      networkWindowMs: 60 * 1000,
      networkMaxHits: 20,
      ipWindowMs: 5 * 60 * 1000,
      ipMaxHits: 35,
      message: 'Muitas cotações de frete em pouco tempo. Aguarde alguns segundos.',
    });
    const quoteFingerprint = buildCommerceFingerprint({ items: rawItems });
    const cachedQuote = await readCommerceIdempotency(db, {
      scope: 'shippingQuote',
      key: request.auth.uid,
      fingerprint: quoteFingerprint,
    });
    if (cachedQuote) {
      return { ...cachedQuote, reused: true };
    }
    const [cfgSnap, productsSnap, userSnap] = await Promise.all([
      db.ref('loja/config').get(),
      db.ref('loja/produtos').get(),
      db.ref(`usuarios/${request.auth.uid}`).get(),
    ]);
    const config = cfgSnap.exists() ? cfgSnap.val() || {} : {};
    if (config.storeEnabled !== true || config.acceptingOrders !== true) {
      throw new HttpsError('failed-precondition', 'Loja nao esta aceitando pedidos agora.');
    }

    const products = productsSnap.exists() ? productsSnap.val() || {} : {};
    const profile = userSnap.exists() ? userSnap.val() || {} : {};
    const { quote, subtotal, pricedLines } = buildStoreShippingQuoteForUser({
      rawItems,
      products,
      config,
      profile,
    });
    const response = { ok: true, quote, subtotal, pricedLines, currency: 'BRL' };
    await writeCommerceIdempotency(db, {
      scope: 'shippingQuote',
      key: request.auth.uid,
      fingerprint: quoteFingerprint,
      ttlMs: 15 * 1000,
      response,
    });
    return response;
  }
);

export const adminListVisibleStoreOrders = onCall({ region: 'us-central1' }, async (request) =>
  listVisibleStoreOrdersRuntime(request)
);

export const creatorListOwnStoreOrders = onCall({ region: 'us-central1' }, async (request) =>
  listVisibleStoreOrdersRuntime(request, { creatorOnly: true })
);

export const listMyStoreOrders = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const db = getDatabase();
  await enforceCommerceAbuseShield(db, {
    request,
    scope: 'listMyStoreOrders',
    key: uid,
    minIntervalMs: 350,
    windowMs: 60 * 1000,
    maxHits: 30,
    networkWindowMs: 60 * 1000,
    networkMaxHits: 50,
    ipWindowMs: 5 * 60 * 1000,
    ipMaxHits: 90,
    message: 'Muitas consultas de pedidos em pouco tempo. Aguarde alguns segundos.',
  });
  const snap = await db
    .ref('loja/pedidos')
    .orderByChild('uid')
    .equalTo(uid)
    .get();
  const orders = snap.val() || {};
  const list = Object.entries(orders)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return { ok: true, orders: list };
});

export const getStoreOrderForViewer = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const orderId = String(request.data?.orderId || '').trim();
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId obrigatorio.');
  }
  const db = getDatabase();
  await enforceCommerceAbuseShield(db, {
    request,
    scope: 'viewStoreOrder',
    key: request.auth.uid,
    minIntervalMs: 350,
    windowMs: 60 * 1000,
    maxHits: 40,
    networkWindowMs: 60 * 1000,
    networkMaxHits: 70,
    ipWindowMs: 5 * 60 * 1000,
    ipMaxHits: 120,
    message: 'Muitas consultas de pedido em pouco tempo. Aguarde alguns segundos.',
  });
  const snap = await db.ref(`loja/pedidos/${orderId}`).get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Pedido nao encontrado.');
  }
  const row = snap.val() || {};
  const uid = request.auth.uid;
  if (String(row.uid || '') === uid) {
    return { ok: true, viewerRole: 'buyer', order: { id: orderId, ...row } };
  }
  const ctx = await getAdminAuthContext(request.auth);
  const isCreator = ctx ? false : await isCreatorAccountAuth(request.auth);
  if (!ctx && !isCreator) {
    throw new HttpsError('permission-denied', 'Sem permissao.');
  }
  if (ctx && canManageStoreOrdersGlobally(ctx)) {
    return {
      ok: true,
      viewerRole: 'admin',
      order: { id: orderId, ...row },
    };
  }
  if (isCreator && orderItemsForCreator({ id: orderId, ...row }, uid).length > 0) {
    return {
      ok: true,
      viewerRole: 'seller',
      order: sanitizeStoreOrderForViewer(orderId, { id: orderId, ...row }, uid),
    };
  }
  throw new HttpsError('permission-denied', 'Sem permissao para ver este pedido.');
});

export const getStoreProductFileAccessUrl = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const orderId = String(body.orderId || '').trim();
  const productId = String(body.productId || '').trim();
  if (!productId) {
    throw new HttpsError('invalid-argument', 'productId obrigatorio.');
  }

  const db = getDatabase();
  await enforceCommerceAbuseShield(db, {
    request,
    scope: 'storeFileAccess',
    key: request.auth.uid,
    minIntervalMs: 500,
    windowMs: 60 * 1000,
    maxHits: 20,
    networkWindowMs: 60 * 1000,
    networkMaxHits: 35,
    ipWindowMs: 5 * 60 * 1000,
    ipMaxHits: 60,
    message: 'Muitas tentativas de acesso a arquivo em pouco tempo. Aguarde alguns segundos.',
  });
  const productSnap = await db.ref(`loja/produtos/${productId}`).get();
  if (!productSnap.exists()) {
    throw new HttpsError('not-found', 'Produto nao encontrado.');
  }
  const product = productSnap.val() || {};
  const filePath = resolveStoreInternalPdfPath(product);
  if (!filePath) {
    throw new HttpsError('failed-precondition', 'Este produto nao possui arquivo interno disponivel.');
  }

  const uid = request.auth.uid;
  const ctx = await getAdminAuthContext(request.auth);
  const isCreator = ctx ? false : await isCreatorAccountAuth(request.auth);
  const isAdmin =
    canManageStoreOrdersGlobally(ctx);

  let allowed = false;
  if (isAdmin) {
    allowed = true;
  } else if (isCreator && String(product.creatorId || '').trim() === uid) {
    allowed = true;
  } else if (orderId) {
    const orderSnap = await db.ref(`loja/pedidos/${orderId}`).get();
    if (!orderSnap.exists()) {
      throw new HttpsError('not-found', 'Pedido nao encontrado.');
    }
    const order = orderSnap.val() || {};
    const status = normalizeStoreOrderStatusInput(String(order.status || ''), '');
    const buyerOwnsOrder = String(order.uid || '').trim() === uid;
    const containsProduct = (Array.isArray(order.items) ? order.items : []).some(
      (item) => String(item?.productId || '').trim() === productId
    );
    const paidEnough = ['paid', 'in_production', 'shipped', 'delivered'].includes(status);
    if (buyerOwnsOrder && containsProduct && paidEnough) {
      allowed = true;
    }
  }

  if (!allowed) {
    throw new HttpsError('permission-denied', 'Sem permissao para acessar este arquivo.');
  }

  const [url] = await getStorage().bucket().file(filePath).getSignedUrl({
    action: 'read',
    expires: Date.now() + 5 * 60 * 1000,
  });
  return { ok: true, url };
});

export const adminUpdateVisibleStoreOrder = onCall({ region: 'us-central1' }, async (request) =>
  updateVisibleStoreOrderRuntime(request)
);

export const creatorUpdateOwnStoreOrder = onCall({ region: 'us-central1' }, async (request) =>
  updateVisibleStoreOrderRuntime(request, { creatorOnly: true })
);
