import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getDatabase } from 'firebase-admin/database';
import { getAdminAuthContext, requireSuperAdmin } from './adminRbac.js';
import {
  BOOK_FORMAT,
  PERSONAL_QUANTITIES,
  PLATFORM_QUANTITIES,
  SALE_MODEL,
  computePersonalOrder,
  computePlatformOrder,
  productionDays,
} from './printOnDemandPricing.js';

/**
 * Pipeline de POD: estados pending_payment → paid → … cobrem pagamento e produção.
 * Criar vitrine em loja/produtos (listed) a partir do pedido ainda é fluxo manual/admin — não automatizado aqui.
 */

function isHttpsUrl(s, maxLen = 2048) {
  const t = String(s || '').trim();
  return t.length >= 12 && t.length <= maxLen && /^https:\/\//i.test(t);
}

function usuarioIsMangaka(row) {
  return String(row?.role || '').trim().toLowerCase() === 'mangaka';
}

function usuarioMonetizacaoAtiva(row) {
  const pref = String(row?.creatorMonetizationPreference || 'publish_only').trim().toLowerCase();
  if (pref !== 'monetize') return false;
  return String(row?.creatorMonetizationStatus || 'disabled').trim().toLowerCase() === 'active';
}

function emptyChecklist() {
  return {
    printMiolo: false,
    printCapa: false,
    organizePaginas: false,
    colarLombada: false,
    prensar: false,
    cortar: false,
    finalizar: false,
  };
}

const STATUS_FLOW = new Set([
  'pending_payment',
  'paid',
  'in_production',
  'ready_to_ship',
  'shipped',
  'delivered',
]);

async function pushUserNotification(db, uid, payload) {
  if (!uid || !payload) return;
  const now = Date.now();
  const notificationsRef = db.ref(`usuarios/${uid}/notifications`);
  const dedupeKey = String(payload.dedupeKey || '').trim() || `pod:${payload.orderId || 'na'}:${now}`;
  const row = {
    type: String(payload.type || 'print_on_demand'),
    title: String(payload.title || 'Producao fisica'),
    message: String(payload.message || ''),
    read: false,
    createdAt: now,
    updatedAt: now,
    dedupeKey,
    data: { ...(payload.data || {}), readPath: '/creator/print' },
  };
  await notificationsRef.push(row);
}

export const submitPrintOnDemandOrder = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login para enviar o pedido.');
  }
  const uid = request.auth.uid;
  const body = request.data && typeof request.data === 'object' ? request.data : {};

  const saleModel = String(body.saleModel || '').trim().toLowerCase();
  const format = String(body.format || '').trim().toLowerCase();
  const quantity = Number(body.quantity);

  if (saleModel !== SALE_MODEL.PLATFORM && saleModel !== SALE_MODEL.PERSONAL) {
    throw new HttpsError('invalid-argument', 'Modelo de venda invalido.');
  }
  if (format !== BOOK_FORMAT.TANKOBON && format !== BOOK_FORMAT.MEIO_TANKO) {
    throw new HttpsError('invalid-argument', 'Formato invalido.');
  }

  if (saleModel === SALE_MODEL.PLATFORM) {
    if (!PLATFORM_QUANTITIES.includes(quantity)) {
      throw new HttpsError('invalid-argument', 'Quantidade invalida para venda na plataforma.');
    }
  } else if (!PERSONAL_QUANTITIES.includes(quantity)) {
    throw new HttpsError('invalid-argument', 'Quantidade invalida para compra pessoal.');
  }

  const pdfUrl = String(body.pdfUrl || '').trim();
  const coverUrl = String(body.coverUrl || '').trim();
  if (!isHttpsUrl(pdfUrl) || !isHttpsUrl(coverUrl)) {
    throw new HttpsError('invalid-argument', 'Envie URLs HTTPS validas do miolo (PDF) e da capa.');
  }

  const addr = body.shippingAddress && typeof body.shippingAddress === 'object' ? body.shippingAddress : {};
  const needAddress = saleModel === SALE_MODEL.PERSONAL;
  const zip = String(addr.zip || addr.cep || '').trim();
  const street = String(addr.street || addr.logradouro || '').trim();
  const city = String(addr.city || addr.cidade || '').trim();
  const state = String(addr.state || addr.uf || '').trim();
  const name = String(addr.name || addr.nome || '').trim();
  if (needAddress) {
    if (street.length < 4 || city.length < 2 || state.length < 2 || zip.length < 5 || name.length < 3) {
      throw new HttpsError('invalid-argument', 'Preencha endereco completo para entrega (compra para si).');
    }
  }

  const pr = productionDays(saleModel, format, quantity);
  const now = Date.now();
  const db = getDatabase();

  if (saleModel === SALE_MODEL.PLATFORM) {
    const userSnap = await db.ref(`usuarios/${uid}`).get();
    const userRow = userSnap.exists() ? userSnap.val() || {} : {};
    if (usuarioIsMangaka(userRow) && !usuarioMonetizacaoAtiva(userRow)) {
      throw new HttpsError(
        'failed-precondition',
        'Venda na loja exige monetizacao ativa e dados para repasse. Use Comprar para mim ou ative a monetizacao no perfil e aguarde aprovacao do admin.'
      );
    }
  }

  let snapshot = null;
  if (saleModel === SALE_MODEL.PLATFORM) {
    const unitSale = Number(body.unitSalePriceBRL);
    const calc = computePlatformOrder(format, quantity, unitSale);
    if (!calc) throw new HttpsError('invalid-argument', 'Nao foi possivel calcular o pedido (plataforma).');
    snapshot = {
      saleModel,
      format,
      quantity,
      ...calc,
      shippingNote: 'Sem frete nesta etapa. Depois do pagamento confirmado, o admin tem ate 2 dias uteis para aprovar e liberar o produto na loja.',
      platformApprovalDays: pr.high,
      platformListingUnlocksOnStatus: 'paid',
      estimatedProductionDaysLow: pr.low,
      estimatedProductionDaysHigh: pr.high,
      estimatedProductionHours: 0,
      manualProductionHours: pr.productionHours || 0,
      estimateKind: pr.kind || 'approval',
    };
  } else {
    const calc = computePersonalOrder(format, quantity);
    if (!calc) throw new HttpsError('invalid-argument', 'Nao foi possivel calcular o pedido (pessoal).');
    snapshot = {
      saleModel,
      format,
      quantity,
      ...calc,
      shippingNote: calc.freeShipping
        ? `Frete gratis a partir de ${calc.freeShippingAt} unidades. O prazo abaixo considera producao + entrega.`
        : `Frete a parte para quantidades abaixo de ${calc.freeShippingAt} unidades.`,
      estimatedProductionDaysLow: pr.low,
      estimatedProductionDaysHigh: pr.high,
      estimatedProductionHours: pr.totalHours,
      manualProductionHours: pr.productionHours || pr.totalHours,
      estimateKind: pr.kind || 'delivery',
    };
  }

  const orderRef = db.ref('loja/printOnDemandOrders').push();
  const orderId = orderRef.key;
  const order = {
    id: orderId,
    creatorUid: uid,
    status: 'pending_payment',
    pdfUrl,
    coverUrl,
    shippingAddress:
      needAddress || street
        ? {
            name,
            street,
            city,
            state,
            zip,
            complement: String(addr.complement || addr.complemento || '').trim(),
          }
        : null,
    snapshot,
    productionChecklist: emptyChecklist(),
    trackingCode: '',
    createdAt: now,
    updatedAt: now,
    paidAt: null,
  };

  await orderRef.set(order);
  await pushUserNotification(db, uid, {
    type: 'print_on_demand',
    title: 'Pedido de mangá físico registrado',
    message: `Pedido #${orderId.slice(-8).toUpperCase()} criado. Aguardando pagamento.`,
    orderId,
    dedupeKey: `pod:created:${orderId}`,
    data: { orderId, status: 'pending_payment' },
  });

  return { ok: true, orderId };
});

export const listMyPrintOnDemandOrders = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const snap = await getDatabase().ref('loja/printOnDemandOrders').get();
  const all = snap.val() || {};
  const list = Object.entries(all)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .filter((o) => String(o.creatorUid || '') === uid)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return { ok: true, orders: list };
});

export const adminListPrintOnDemandOrders = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const ctx = await getAdminAuthContext(request.auth);
  if (!ctx) {
    throw new HttpsError('permission-denied', 'Sem acesso ao painel.');
  }
  const can =
    ctx.super === true || ctx.legacy === true || ctx.permissions?.canAccessLojaAdmin === true;
  if (!can) {
    throw new HttpsError('permission-denied', 'Sem permissao para producao fisica.');
  }
  const snap = await getDatabase().ref('loja/printOnDemandOrders').get();
  const all = snap.val() || {};
  const list = Object.entries(all)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return { ok: true, orders: list };
});

export const adminUpdatePrintOnDemandOrder = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const ctx = await getAdminAuthContext(request.auth);
  if (!ctx) {
    throw new HttpsError('permission-denied', 'Sem acesso ao painel.');
  }
  const can =
    ctx.super === true || ctx.legacy === true || ctx.permissions?.canAccessLojaAdmin === true;
  if (!can) {
    throw new HttpsError('permission-denied', 'Sem permissao.');
  }

  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const orderId = String(body.orderId || '').trim();
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId obrigatorio.');
  }

  const ref = getDatabase().ref(`loja/printOnDemandOrders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Pedido nao encontrado.');
  }
  const prev = snap.val() || {};
  const patch = { updatedAt: Date.now() };

  const statusRaw = body.status != null ? String(body.status).trim().toLowerCase() : '';
  if (statusRaw) {
    if (!STATUS_FLOW.has(statusRaw)) {
      throw new HttpsError('invalid-argument', 'Status invalido.');
    }
    patch.status = statusRaw;
  }

  const trackingCode = body.trackingCode != null ? String(body.trackingCode || '').trim() : null;
  if (trackingCode != null) {
    if (trackingCode.length > 120) {
      throw new HttpsError('invalid-argument', 'Codigo de rastreio muito longo.');
    }
    patch.trackingCode = trackingCode;
  }

  if (body.productionChecklist && typeof body.productionChecklist === 'object') {
    const cur = { ...(prev.productionChecklist || {}), ...emptyChecklist() };
    for (const k of Object.keys(emptyChecklist())) {
      if (body.productionChecklist[k] != null) {
        cur[k] = Boolean(body.productionChecklist[k]);
      }
    }
    patch.productionChecklist = cur;
  }

  await ref.update(patch);
  const creatorUid = String(prev.creatorUid || '');
  const nextStatus = patch.status || prev.status;

  if (creatorUid && patch.status && patch.status !== prev.status) {
    const titles = {
      paid: 'Pagamento confirmado',
      in_production: 'Pedido em producao',
      ready_to_ship: 'Pronto para envio',
      shipped: 'Pedido enviado',
      delivered: 'Pedido entregue',
      pending_payment: 'Aguardando pagamento',
    };
    await pushUserNotification(getDatabase(), creatorUid, {
      type: 'print_on_demand',
      title: titles[nextStatus] || 'Atualizacao do pedido',
      message: `Seu pedido de mangá físico #${orderId.slice(-8).toUpperCase()} mudou para: ${nextStatus}.`,
      orderId,
      dedupeKey: `pod:status:${orderId}:${nextStatus}`,
      data: { orderId, status: nextStatus },
    });
  }

  return { ok: true };
});

/** Super-admin: ajuste manual se necessario (ex.: corrigir URL). */
export const adminPatchPrintOnDemandOrderSuper = onCall({ region: 'us-central1' }, async (request) => {
  requireSuperAdmin(request.auth);
  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const orderId = String(body.orderId || '').trim();
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId obrigatorio.');
  }
  const ref = getDatabase().ref(`loja/printOnDemandOrders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Pedido nao encontrado.');
  }
  const patch = { updatedAt: Date.now() };
  if (body.pdfUrl != null) {
    const u = String(body.pdfUrl || '').trim();
    if (!isHttpsUrl(u)) throw new HttpsError('invalid-argument', 'pdfUrl invalido.');
    patch.pdfUrl = u;
  }
  if (body.coverUrl != null) {
    const u = String(body.coverUrl || '').trim();
    if (!isHttpsUrl(u)) throw new HttpsError('invalid-argument', 'coverUrl invalido.');
    patch.coverUrl = u;
  }
  if (Object.keys(patch).length <= 1) {
    throw new HttpsError('invalid-argument', 'Nada para atualizar.');
  }
  await ref.update(patch);
  return { ok: true };
});
