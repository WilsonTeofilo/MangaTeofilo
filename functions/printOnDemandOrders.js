import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { getDatabase } from 'firebase-admin/database';
import { getAdminAuthContext, requireSuperAdmin, listStaffUids } from './adminRbac.js';
import { assertTrustedAppRequest } from './appCheckGuard.js';
import { pushUserNotification as pushStaffInAppNotification } from './notificationPush.js';
import {
  BOOK_FORMAT,
  PERSONAL_QUANTITIES,
  PLATFORM_QUANTITIES,
  SALE_MODEL,
  computePersonalOrder,
  computePlatformOrder,
  computeStorePromoOrder,
  productionDays,
  POD_PENDING_PAYMENT_TTL_MS,
  computeFixedZoneShippingParts,
  REGIONAL_FREIGHT_DISCOUNT_CAP_BRL,
  REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY,
  REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL,
  REGIONAL_FREIGHT_DISCOUNT_RATE,
  STORE_PROMO_THRESHOLDS,
} from '../shared/printOnDemandPricing.js';
import {
  readCreatorStatsFromDb,
  resolveCreatorMonetizationPreferenceFromDb,
  resolveCreatorMonetizationStatusFromDb,
} from './creatorRecord.js';
import { enforceCommerceAbuseShield } from './commerceGuard.js';

/**
 * Nível 2 — venda POD com repasse (alinhado a `CREATOR_LEVEL_THRESHOLDS[2]` no app).
 * ORIGINAL: { followers: 1000, views: 20000, likes: 500 } — reverter com o restante do teste.
 */
const CREATOR_LEVEL_2_THRESHOLDS = { followers: 200, views: 10000, likes: 80 };
const POD_ORDER_ID_RE = /^[A-Za-z0-9_-]{4,120}$/;

function assertPodOrderId(raw, label = 'orderId') {
  const value = String(raw || '').trim();
  if (!POD_ORDER_ID_RE.test(value)) {
    throw new HttpsError('invalid-argument', `${label} invalido.`);
  }
  return value;
}

function normalizePodStatus(value, fallback = 'pending') {
  const raw = String(value || fallback).trim().toLowerCase().replace(/\s+/g, '_');
  if (!raw) return fallback;
  if (raw === 'pending_payment') return 'pending';
  if (raw === 'processing') return 'in_production';
  if (raw === 'ready_to_ship') return 'in_production';
  if (raw === 'canceled') return 'cancelled';
  return raw;
}

function creatorMeetsPlatformSaleLevel(userRow, creatorStatsRow = null) {
  const stats = readCreatorStatsFromDb(userRow, creatorStatsRow);
  const followers = Number(stats.followersCount || 0);
  const views = Number(stats.totalViews || 0);
  const likes = Number(stats.likesTotal || 0);
  return (
    followers >= CREATOR_LEVEL_2_THRESHOLDS.followers &&
    views >= CREATOR_LEVEL_2_THRESHOLDS.views &&
    likes >= CREATOR_LEVEL_2_THRESHOLDS.likes
  );
}
/** Alinhado a database.rules.json em obras/$obraId */
const OBRA_ID_RE = /^[a-z0-9_-]{2,40}$/;

async function verifyStorePromoEligibility(db, uid, workId) {
  const wid = String(workId || '').trim();
  if (!wid) {
    return {
      ok: false,
      code: 'missing_work',
      followers: 0,
      views: 0,
      likes: 0,
      thresholds: STORE_PROMO_THRESHOLDS,
    };
  }
  const obraSnap = await db.ref(`obras/${wid}`).get();
  if (!obraSnap.exists()) {
    return {
      ok: false,
      code: 'obra_not_found',
      followers: 0,
      views: 0,
      likes: 0,
      thresholds: STORE_PROMO_THRESHOLDS,
    };
  }
  const obra = obraSnap.val() || {};
  if (String(obra.creatorId || '').trim() !== uid) {
    return {
      ok: false,
      code: 'not_owner',
      followers: 0,
      views: 0,
      likes: 0,
      thresholds: STORE_PROMO_THRESHOLDS,
    };
  }
  let followers = 0;
  const st = await db.ref(`creators/${uid}/stats`).get();
  if (st.exists()) {
    followers = Number(st.val()?.followersCount || 0);
  }
  let views = Number(obra.viewsCount ?? obra.visualizacoes ?? 0);
  let likes = Number(obra.likesCount ?? obra.curtidas ?? obra.favoritesCount ?? 0);
  const capsSnap = await db.ref('capitulos').get();
  if (capsSnap.exists()) {
    const caps = capsSnap.val() || {};
    for (const row of Object.values(caps)) {
      const cap = row && typeof row === 'object' ? row : {};
      const oid = String(cap.obraId || cap.workId || '').trim();
      if (oid !== wid) continue;
      views += Number(cap.viewsCount ?? cap.visualizacoes ?? 0);
      likes += Number(cap.likesCount ?? cap.curtidas ?? 0);
    }
  }
  const ok =
    followers >= STORE_PROMO_THRESHOLDS.followers &&
    views >= STORE_PROMO_THRESHOLDS.views &&
    likes >= STORE_PROMO_THRESHOLDS.likes;
  return {
    ok,
    code: ok ? 'ok' : 'thresholds',
    followers,
    views,
    likes,
    thresholds: STORE_PROMO_THRESHOLDS,
  };
}

/**
 * Pipeline de POD: estados pending → paid → … cobrem pagamento e produção.
 * Criar vitrine em loja/produtos (listed) a partir do pedido ainda é fluxo manual/admin — não automatizado aqui.
 */

function isHttpsUrl(s, maxLen = 2048) {
  const t = String(s || '').trim();
  return t.length >= 12 && t.length <= maxLen && /^https:\/\//i.test(t);
}

function assertNoClientControlledPodFinancialFields(body) {
  const src = body && typeof body === 'object' ? body : {};
  const forbiddenFields = [
    'amountDueBRL',
    'expectedPayBRL',
    'productionCostTotalBRL',
    'grossRetailTotalBRL',
    'creatorProfitPerSoldUnitBRL',
    'creatorProfitTotalIfAllSoldBRL',
    'goodsTotalBRL',
    'shippingBRL',
    'subtotal',
    'total',
    'status',
    'paidAt',
    'createdAt',
    'updatedAt',
    'expiresAt',
    'checkoutUrl',
    'snapshot',
    'orderEvents',
    'creatorUid',
    'payoutStatus',
  ];
  const present = forbiddenFields.filter((field) => src[field] != null);
  if (present.length) {
    throw new HttpsError(
      'invalid-argument',
      `Nao envie campos financeiros/sistemicos no checkout POD: ${present.join(', ')}.`
    );
  }
}

/** Buckets do projeto (getDownloadURL do SDK Web usa host firebasestorage.googleapis.com). */
const POD_STORAGE_BUCKETS = new Set([
  'shitoproject-ed649.firebasestorage.app',
  'shitoproject-ed649.appspot.com',
]);

/**
 * Garante que o arquivo esta em print_on_demand/{uid}/... no Storage do projeto (anti URL externa).
 */
function isFirebaseStoragePrintOnDemandObjectForUser(uid, urlStr) {
  if (!isHttpsUrl(urlStr)) return false;
  const owner = String(uid || '').trim();
  if (!owner || owner.includes('/') || owner.includes('..')) return false;
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return false;
  }
  if (u.hostname !== 'firebasestorage.googleapis.com') return false;
  const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
  if (!m) return false;
  const bucket = m[1];
  const encodedObject = m[2];
  if (!POD_STORAGE_BUCKETS.has(bucket)) return false;
  let objectPath;
  try {
    objectPath = decodeURIComponent(encodedObject.replace(/\+/g, ' '));
  } catch {
    return false;
  }
  if (objectPath.includes('..') || objectPath.includes('//') || objectPath.startsWith('/')) return false;
  const prefix = `print_on_demand/${owner}/`;
  if (!objectPath.startsWith(prefix)) return false;
  const rest = objectPath.slice(prefix.length);
  if (!rest || rest.includes('/')) return false;
  return true;
}

function assertPodUrlsInUserStorage(uid, pdfUrl, coverUrl) {
  const pdfOk = isFirebaseStoragePrintOnDemandObjectForUser(uid, pdfUrl);
  const coverOk = isFirebaseStoragePrintOnDemandObjectForUser(uid, coverUrl);
  if (!pdfOk || !coverOk) {
    throw new HttpsError(
      'invalid-argument',
      'Envie o PDF e a capa pelo formulario: os links precisam ser do armazenamento do app na sua pasta print_on_demand.'
    );
  }
}

function usuarioIsMangaka(row) {
  return String(row?.role || '').trim().toLowerCase() === 'mangaka';
}

function usuarioMonetizacaoAtiva(row) {
  const pref = resolveCreatorMonetizationPreferenceFromDb(row);
  if (pref !== 'monetize') return false;
  return resolveCreatorMonetizationStatusFromDb(row) === 'active';
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
  'pending',
  'paid',
  'in_production',
  'shipped',
  'delivered',
  'cancelled',
]);

/** Transições manuais (admin). «paid» só entra via webhook do Mercado Pago. */
const ADMIN_NON_CANCEL_NEXT = {
  pending: new Set(['pending']),
  paid: new Set(['paid', 'in_production']),
  in_production: new Set(['in_production', 'shipped']),
  shipped: new Set(['shipped', 'delivered']),
  delivered: new Set(['delivered']),
  cancelled: new Set(['cancelled']),
};

async function pushPodOrderEvent(db, orderId, evt) {
  const oid = String(orderId || '').trim();
  if (!oid || !evt || typeof evt !== 'object') return;
  await db.ref(`loja/printOnDemandOrders/${oid}/orderEvents`).push({
    at: Date.now(),
    ...evt,
  });
}

/** UIDs da equipe (super admins + registry exceto mangaka) — alinhado a `notifyCreatorRequestAdmins` em index.js */
async function collectStaffAdminUids(db) {
  const adminIds = await listStaffUids();
  return [...new Set(adminIds.map((uid) => String(uid || '').trim()).filter(Boolean))];
}

/**
 * Espelha o aviso ao comprador quando o admin cancela: a equipe recebe o motivo quando o comprador cancela.
 */
async function notifyAdminsPodBuyerCancelled(db, { orderId, buyerUid, reason }) {
  const oid = String(orderId || '').trim();
  const uid = String(buyerUid || '').trim();
  const r = String(reason || '').trim();
  if (!oid || !uid || !r) return;
  const shortId = oid.slice(-8).toUpperCase();
  const excerpt = r.length > 280 ? `${r.slice(0, 277)}...` : r;
  let buyerLabel = uid.slice(0, 8);
  try {
    const uSnap = await db.ref(`usuarios/${uid}`).get();
    if (uSnap.exists()) {
      const ur = uSnap.val() || {};
      const name = String(ur.creatorDisplayName || ur.userName || '').trim();
      if (name) buyerLabel = name;
    }
  } catch {
    /* ignore */
  }
  const adminIds = await collectStaffAdminUids(db);
  const targetPath = '/admin/pedidos?tab=producao';
  await Promise.all(
    adminIds
      .filter((id) => id && id !== uid)
      .map((adminUid) =>
        pushStaffInAppNotification(db, adminUid, {
          type: 'system',
          title: 'POD: comprador cancelou pedido',
          message: `${buyerLabel} cancelou o pedido #${shortId} (antes do pagamento). Motivo: ${excerpt}`,
          targetPath,
          priority: 2,
          dedupeKey: `pod:admin:buyer_cancel:${oid}`,
          dedupeWindowMs: 0,
          allowGrouping: false,
          data: { orderId: oid, buyerUid: uid, kind: 'pod_buyer_cancel', readPath: `/pedidos/fisico/${oid}` },
        })
      )
  );
}

export async function notifyPrintOnDemandPaid(db, creatorUid, orderId) {
  const oid = String(orderId || '').trim();
  if (!oid || !creatorUid) return;
  await pushUserNotification(db, creatorUid, {
    type: 'print_on_demand',
    title: 'Pagamento confirmado',
    message: `Pedido #${oid.slice(-8).toUpperCase()} pago. Acompanhe a produção do seu lote.`,
    orderId: oid,
    dedupeKey: `pod:paid:${oid}`,
    data: { orderId: oid, status: 'paid' },
  });
}

async function pushUserNotification(db, uid, payload) {
  if (!uid || !payload) return;
  const now = Date.now();
  const notificationsRef = db.ref(`usuarios/${uid}/notifications`);
  const dedupeKey = String(payload.dedupeKey || '').trim() || `pod:${payload.orderId || 'na'}:${now}`;
  const orderId = String(payload.orderId || payload.data?.orderId || '').trim();
  const readPath =
    String(payload.readPath || '').trim() ||
    (orderId ? `/pedidos/fisico/${orderId}` : '/loja/pedidos');
  const row = {
    type: String(payload.type || 'print_on_demand'),
    title: String(payload.title || 'Producao fisica'),
    message: String(payload.message || ''),
    read: false,
    createdAt: now,
    updatedAt: now,
    dedupeKey,
    data: { ...(payload.data || {}), readPath },
  };
  await notificationsRef.push(row);
}

/**
 * Cria pedido POD (pending). Sem notificação — o cliente deve redirecionar ao MP.
 * @returns {{ orderId: string, order: object }}
 */
export async function persistPrintOnDemandOrder(db, uid, body) {
  assertNoClientControlledPodFinancialFields(body);
  const saleModel = String(body.saleModel || '').trim().toLowerCase();
  const format = String(body.format || '').trim().toLowerCase();
  const quantity = Number(body.quantity);

  if (
    saleModel !== SALE_MODEL.PLATFORM &&
    saleModel !== SALE_MODEL.PERSONAL &&
    saleModel !== SALE_MODEL.STORE_PROMO
  ) {
    throw new HttpsError('invalid-argument', 'Modelo de venda invalido.');
  }
  if (format !== BOOK_FORMAT.TANKOBON && format !== BOOK_FORMAT.MEIO_TANKO) {
    throw new HttpsError('invalid-argument', 'Formato invalido.');
  }

  if (saleModel === SALE_MODEL.PLATFORM || saleModel === SALE_MODEL.STORE_PROMO) {
    if (!PLATFORM_QUANTITIES.includes(quantity)) {
      throw new HttpsError('invalid-argument', 'Quantidade invalida para este modo de loja.');
    }
  } else if (!PERSONAL_QUANTITIES.includes(quantity)) {
    throw new HttpsError('invalid-argument', 'Quantidade invalida para compra pessoal.');
  }

  const linkedWorkId =
    saleModel === SALE_MODEL.STORE_PROMO ? String(body.linkedWorkId || '').trim() : '';
  if (saleModel === SALE_MODEL.STORE_PROMO && !linkedWorkId) {
    throw new HttpsError('invalid-argument', 'Selecione a obra vinculada ao pedido.');
  }
  if (saleModel === SALE_MODEL.STORE_PROMO && !OBRA_ID_RE.test(linkedWorkId)) {
    throw new HttpsError('invalid-argument', 'ID da obra invalido.');
  }

  const pdfUrl = String(body.pdfUrl || '').trim();
  const coverUrl = String(body.coverUrl || '').trim();
  if (!isHttpsUrl(pdfUrl) || !isHttpsUrl(coverUrl)) {
    throw new HttpsError('invalid-argument', 'Envie URLs HTTPS validas do miolo (PDF) e da capa.');
  }
  assertPodUrlsInUserStorage(uid, pdfUrl, coverUrl);

  const addr = body.shippingAddress && typeof body.shippingAddress === 'object' ? body.shippingAddress : {};
  const needAddress = saleModel === SALE_MODEL.PERSONAL;
  const zipRaw = String(addr.zip || addr.cep || '').trim();
  const zipDigits = zipRaw.replace(/\D/g, '');
  const streetBase = String(addr.street || addr.logradouro || addr.streetBase || '').trim();
  const streetNumber = String(addr.streetNumber || addr.numero || addr.number || '').trim();
  const neighborhood = String(addr.neighborhood || addr.bairro || '').trim();
  const city = String(addr.city || addr.cidade || '').trim();
  const state = String(addr.state || addr.uf || '').trim().toUpperCase().slice(0, 2);
  const name = String(addr.name || addr.nome || '').trim();
  let street = String(addr.street || addr.logradouro || '').trim();
  if (needAddress) {
    if (zipDigits.length !== 8) {
      throw new HttpsError('invalid-argument', 'CEP invalido: use 8 digitos (ex.: 01310100).');
    }
    if (name.length < 3 || city.length < 2 || state.length !== 2) {
      throw new HttpsError('invalid-argument', 'Preencha nome completo, cidade e UF validos.');
    }
    if (streetBase.length < 3) {
      throw new HttpsError('invalid-argument', 'Informe o logradouro (rua/avenida) com pelo menos 3 caracteres.');
    }
    if (neighborhood.length < 2) {
      throw new HttpsError('invalid-argument', 'Informe o bairro.');
    }
    if (streetNumber.length < 1 || !/\d/.test(streetNumber)) {
      throw new HttpsError('invalid-argument', 'Informe o numero do endereco (ex.: 123 ou s/n 45).');
    }
    street = `${streetBase}, ${streetNumber}`.trim();
  }
  if (needAddress && street.length < 6) {
    throw new HttpsError('invalid-argument', 'Endereco de entrega incompleto.');
  }
  const zip = needAddress ? zipDigits : zipRaw;

  const pr = productionDays(saleModel, format, quantity);
  const now = Date.now();
  const [userSnap, creatorStatsSnap] = await Promise.all([
    db.ref(`usuarios/${uid}`).get(),
    db.ref(`creators/${uid}/stats`).get(),
  ]);
  const userRow = userSnap.exists() ? userSnap.val() || {} : {};
  const creatorStatsRow = creatorStatsSnap.exists() ? creatorStatsSnap.val() || {} : {};
  let storePromoElig = null;

  if (saleModel === SALE_MODEL.STORE_PROMO) {
    if (!usuarioIsMangaka(userRow)) {
      throw new HttpsError('permission-denied', 'Apenas criadores (mangaka) podem usar divulgacao na loja.');
    }
    if (usuarioMonetizacaoAtiva(userRow)) {
      throw new HttpsError(
        'failed-precondition',
        'Com monetizacao ativa use "Venda pela plataforma" para precos com repasse ao autor.'
      );
    }
    storePromoElig = await verifyStorePromoEligibility(db, uid, linkedWorkId);
    if (!storePromoElig.ok) {
      throw new HttpsError(
        'failed-precondition',
        'Requisitos de divulgacao nao atingidos: 300 seguidores, 5 mil views na obra e 100 likes (obra + capitulos).'
      );
    }
  }

  if (saleModel === SALE_MODEL.PLATFORM) {
    if (!usuarioIsMangaka(userRow)) {
      throw new HttpsError(
        'permission-denied',
        'Venda pela plataforma e exclusiva de criadores com perfil mangaka.'
      );
    }
    if (!usuarioMonetizacaoAtiva(userRow)) {
      throw new HttpsError(
        'failed-precondition',
        'Venda na loja exige monetizacao ativa e dados para repasse. Use Comprar para mim ou ative a monetizacao no perfil e aguarde aprovacao do admin.'
      );
    }
    if (!creatorMeetsPlatformSaleLevel(userRow, creatorStatsRow)) {
      throw new HttpsError(
        'failed-precondition',
        `Venda com repasse exige Nivel 2 nas metricas da plataforma: ${CREATOR_LEVEL_2_THRESHOLDS.followers} seguidores, ${CREATOR_LEVEL_2_THRESHOLDS.views} views totais e ${CREATOR_LEVEL_2_THRESHOLDS.likes} likes totais.`
      );
    }
  }

  let snapshot = null;
  if (saleModel === SALE_MODEL.STORE_PROMO) {
    const calc = computeStorePromoOrder(format, quantity);
    if (!calc) throw new HttpsError('invalid-argument', 'Nao foi possivel calcular o pedido (divulgacao).');
    const elig = storePromoElig;
    snapshot = {
      saleModel,
      format,
      quantity,
      linkedWorkId,
      storePromoMetrics: {
        followers: elig.followers,
        views: elig.views,
        likes: elig.likes,
        thresholds: elig.thresholds,
      },
      ...calc,
      platformApprovalDays: pr.high,
      platformListingUnlocksOnStatus: 'paid',
      estimatedProductionDaysLow: pr.low,
      estimatedProductionDaysHigh: pr.high,
      estimatedProductionHours: 0,
      manualProductionHours: pr.productionHours || 0,
      estimateKind: pr.kind || 'approval',
    };
  } else if (saleModel === SALE_MODEL.PLATFORM) {
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
    let shippingBRL = 0;
    let shippingExtra = '';
    if (!calc.freeShipping) {
      const goods = Number(calc.goodsTotalBRL || 0);
      const parts = computeFixedZoneShippingParts({ state, quantity, cartTotal: goods });
      shippingBRL = parts.priceBrl;
      shippingExtra = parts.regionalFreightDiscountApplied
        ? ` Desconto no frete (Sudeste/Sul/Centro-Oeste): pedido a partir de R$ ${REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL} ou ${REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY}+ un.; ate ${Math.round(REGIONAL_FREIGHT_DISCOUNT_RATE * 100)}% do frete (teto R$ ${REGIONAL_FREIGHT_DISCOUNT_CAP_BRL}). Frete final R$ ${shippingBRL.toFixed(2)}.`
        : ` Frete (${state}) via Correios: R$ ${shippingBRL.toFixed(2)}.`;
    }
    const amountDue = Math.round((Number(calc.goodsTotalBRL || 0) + shippingBRL) * 100) / 100;
    snapshot = {
      saleModel,
      format,
      quantity,
      ...calc,
      shippingBRL,
      shippingCarrierDefault: 'Correios',
      personalFreightDiscountMinSubtotalBRL: REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL,
      personalFreightDiscountMinQuantity: REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY,
      personalFreightDiscountCapBRL: REGIONAL_FREIGHT_DISCOUNT_CAP_BRL,
      personalFreightDiscountRate: REGIONAL_FREIGHT_DISCOUNT_RATE,
      amountDueBRL: amountDue,
      shippingNote: `${calc.freeShipping ? calc.shippingNote : calc.shippingNote}${shippingExtra} Peso estimado do lote: ~${calc.weightGramsTotal || 0} g.`,
      estimatedProductionDaysLow: pr.low,
      estimatedProductionDaysHigh: pr.high,
      estimatedProductionHours: pr.totalHours,
      manualProductionHours: pr.productionHours || pr.totalHours,
      estimateKind: pr.kind || 'delivery',
    };
  }

  const orderRef = db.ref('loja/printOnDemandOrders').push();
  const orderId = orderRef.key;
  const expiresAt = now + POD_PENDING_PAYMENT_TTL_MS;
  const order = {
    id: orderId,
    creatorUid: uid,
    linkedWorkId: saleModel === SALE_MODEL.STORE_PROMO ? linkedWorkId : null,
    status: 'pending',
    pdfUrl,
    coverUrl,
    shippingAddress: needAddress
      ? {
          name,
          street,
          streetBase,
          streetNumber,
          neighborhood,
          city,
          state,
          zip,
          complement: String(addr.complement || addr.complemento || '').trim(),
        }
      : null,
    snapshot,
    productionChecklist: emptyChecklist(),
    trackingCode: '',
    shippingCarrier: 'Correios',
    createdAt: now,
    updatedAt: now,
    expiresAt,
    paidAt: null,
    productionStartedAt: null,
    readyToShipAt: null,
    shippedAt: null,
    deliveredAt: null,
  };

  await orderRef.set(order);
  await pushPodOrderEvent(db, orderId, {
    type: 'order_created',
    message: 'Pedido criado - aguardando pagamento (reserva de 24 horas).',
    actor: 'system',
  });
  return { orderId, order };
}

export const listMyPrintOnDemandOrders = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const db = getDatabase();
  await enforceCommerceAbuseShield(db, {
    request,
    scope: 'listMyPodOrders',
    key: uid,
    minIntervalMs: 350,
    windowMs: 60 * 1000,
    maxHits: 30,
    networkWindowMs: 60 * 1000,
    networkMaxHits: 50,
    ipWindowMs: 5 * 60 * 1000,
    ipMaxHits: 90,
    message: 'Muitas consultas de pedidos POD em pouco tempo. Aguarde alguns segundos.',
  });
  const snap = await db.ref('loja/printOnDemandOrders').get();
  const all = snap.val() || {};
  const list = Object.entries(all)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .filter((o) => String(o.creatorUid || '') === uid)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return { ok: true, orders: list };
});

export const getMyPrintOnDemandOrder = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const orderId = assertPodOrderId(request.data?.orderId, 'orderId');
  const db = getDatabase();
  await enforceCommerceAbuseShield(db, {
    request,
    scope: 'viewPodOrder',
    key: request.auth.uid,
    minIntervalMs: 350,
    windowMs: 60 * 1000,
    maxHits: 40,
    networkWindowMs: 60 * 1000,
    networkMaxHits: 70,
    ipWindowMs: 5 * 60 * 1000,
    ipMaxHits: 120,
    message: 'Muitas consultas de pedido POD em pouco tempo. Aguarde alguns segundos.',
  });
  const snap = await db.ref(`loja/printOnDemandOrders/${orderId}`).get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Pedido nao encontrado.');
  }
  const row = snap.val() || {};
  if (String(row.creatorUid || '') !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Sem permissao.');
  }
  return { ok: true, order: { id: orderId, ...row } };
});

export const adminListPrintOnDemandOrders = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const db = getDatabase();
  await enforceCommerceAbuseShield(db, {
    request,
    scope: 'adminListPodOrders',
    key: request.auth.uid,
    minIntervalMs: 400,
    windowMs: 60 * 1000,
    maxHits: 30,
    networkWindowMs: 60 * 1000,
    networkMaxHits: 50,
    ipWindowMs: 5 * 60 * 1000,
    ipMaxHits: 90,
    message: 'Muitas consultas de pedidos POD em pouco tempo. Aguarde alguns segundos.',
  });
  const ctx = await getAdminAuthContext(request.auth);
  if (!ctx) {
    throw new HttpsError('permission-denied', 'Sem acesso ao painel.');
  }
  const can =
    ctx.super === true || ctx.permissions?.canAccessLojaAdmin === true;
  if (!can) {
    throw new HttpsError('permission-denied', 'Sem permissao para producao fisica.');
  }
  const snap = await db.ref('loja/printOnDemandOrders').get();
  const all = snap.val() || {};
  const list = Object.entries(all)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return { ok: true, orders: list };
});

export const adminUpdatePrintOnDemandOrder = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const db = getDatabase();
  await enforceCommerceAbuseShield(db, {
    request,
    scope: 'adminUpdatePodOrder',
    key: request.auth.uid,
    minIntervalMs: 700,
    windowMs: 60 * 1000,
    maxHits: 15,
    networkWindowMs: 60 * 1000,
    networkMaxHits: 25,
    ipWindowMs: 5 * 60 * 1000,
    ipMaxHits: 40,
    message: 'Muitas atualizacoes de pedido POD em pouco tempo. Aguarde alguns segundos.',
  });
  const ctx = await getAdminAuthContext(request.auth);
  if (!ctx) {
    throw new HttpsError('permission-denied', 'Sem acesso ao painel.');
  }
  const can =
    ctx.super === true || ctx.permissions?.canAccessLojaAdmin === true;
  if (!can) {
    throw new HttpsError('permission-denied', 'Sem permissao.');
  }

  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const orderId = assertPodOrderId(body.orderId, 'orderId');

  if (body.shippingAddress != null) {
    throw new HttpsError(
      'failed-precondition',
      'Alteracao de endereco pelo painel nao suportada aqui. Apos pagamento o endereco fica travado; antes do pagamento o cliente refaz o pedido.'
    );
  }

  const ref = db.ref(`loja/printOnDemandOrders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Pedido nao encontrado.');
  }
  const prev = snap.val() || {};
  const patch = { updatedAt: Date.now() };
  const prevStatus = normalizePodStatus(String(prev.status || '').trim().toLowerCase(), '');

  let statusRaw = body.status != null ? normalizePodStatus(body.status, '') : '';
  if (statusRaw) {
    if (!STATUS_FLOW.has(statusRaw)) {
      throw new HttpsError(
        'invalid-argument',
        `Status invalido (${statusRaw || 'vazio'}). Confira o deploy das Cloud Functions ou o valor enviado.`
      );
    }
    if (statusRaw === 'paid') {
      throw new HttpsError(
        'permission-denied',
        'O status «pago» so pode ser definido pelo webhook do Mercado Pago apos confirmacao do pagamento.'
      );
    }
    if (statusRaw === 'cancelled') {
      if (prevStatus !== 'cancelled') {
        if (prevStatus === 'delivered') {
          throw new HttpsError('failed-precondition', 'Pedido entregue: nao pode cancelar.');
        }
        const reason = String(body.cancellationReason || body.adminCancellationReason || '').trim();
        if (reason.length < 3) {
          throw new HttpsError(
            'invalid-argument',
            'Informe o motivo do cancelamento (minimo 3 caracteres).'
          );
        }
        if (reason.length > 2000) {
          throw new HttpsError('invalid-argument', 'Motivo muito longo (maximo 2000 caracteres).');
        }
        patch.status = 'cancelled';
        patch.adminCancellationReason = reason;
        patch.cancelledAt = Date.now();
        patch.cancelledByAdminUid = String(request.auth?.uid || '').trim() || null;
      }
    } else {
      if (prevStatus === 'cancelled') {
        throw new HttpsError('failed-precondition', 'Pedido cancelado: nao e possivel alterar o status.');
      }
      if (statusRaw !== prevStatus) {
        const allowed = ADMIN_NON_CANCEL_NEXT[prevStatus];
        if (!allowed || !allowed.has(statusRaw)) {
          throw new HttpsError(
            'failed-precondition',
            `Transicao de status nao permitida: «${prevStatus}» -> «${statusRaw}».`
          );
        }
      }
      patch.status = statusRaw;
    }
  }

  const trackingCode = body.trackingCode != null ? String(body.trackingCode || '').trim() : null;
  if (trackingCode != null) {
    if (prevStatus === 'cancelled' && trackingCode !== String(prev.trackingCode || '').trim()) {
      throw new HttpsError('failed-precondition', 'Pedido cancelado: rastreio nao pode ser alterado.');
    }
    if (trackingCode.length > 120) {
      throw new HttpsError('invalid-argument', 'Codigo de rastreio muito longo.');
    }
    patch.trackingCode = trackingCode;
  }

  if (body.productionChecklist && typeof body.productionChecklist === 'object') {
    if (prevStatus === 'cancelled' || patch.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'Pedido cancelado: checklist nao pode ser alterado.');
    }
    const cur = { ...(prev.productionChecklist || {}), ...emptyChecklist() };
    for (const k of Object.keys(emptyChecklist())) {
      if (body.productionChecklist[k] != null) {
        cur[k] = Boolean(body.productionChecklist[k]);
      }
    }
    patch.productionChecklist = cur;
  }

  const ts = Date.now();
  if (patch.status && patch.status !== prevStatus) {
    if (patch.status === 'in_production' && !prev.productionStartedAt) {
      patch.productionStartedAt = ts;
    }
    if (patch.status === 'shipped') {
      patch.shippedAt = prev.shippedAt || ts;
      if (!patch.shippingCarrier && !prev.shippingCarrier) {
        patch.shippingCarrier = 'Correios';
      }
    }
    if (patch.status === 'delivered') {
      patch.deliveredAt = prev.deliveredAt || ts;
    }
  }

  await ref.update(patch);
  const creatorUid = String(prev.creatorUid || '');
  const nextStatus = patch.status || prevStatus;

  if (patch.status && patch.status !== prevStatus) {
    let evMsg = `Status: ${prevStatus} -> ${nextStatus}.`;
    if (nextStatus === 'cancelled') {
      evMsg = `Cancelado pela equipe: ${String(patch.adminCancellationReason || '').slice(0, 200)}`;
    }
    await pushPodOrderEvent(getDatabase(), orderId, {
      type: 'status_change',
      message: evMsg,
      actor: 'admin',
      adminUid: String(request.auth?.uid || '').trim() || null,
      from: prevStatus,
      to: nextStatus,
    });
  }

  if (creatorUid && patch.status && patch.status !== prevStatus) {
    const titles = {
      paid: 'Pagamento confirmado',
      in_production: 'Pedido em producao',
      shipped: 'Pedido enviado',
      delivered: 'Pedido entregue',
      pending: 'Aguardando pagamento',
      cancelled: 'Pedido cancelado',
    };
    const shortId = orderId.slice(-8).toUpperCase();
    let message = `Seu pedido de mangá físico #${shortId} mudou para: ${nextStatus}.`;
    if (nextStatus === 'cancelled') {
      const r = String(patch.adminCancellationReason || '').trim();
      const excerpt = r.length > 280 ? `${r.slice(0, 277)}...` : r;
      message = `Seu pedido #${shortId} foi cancelado. Motivo: ${excerpt}`;
    }
    await pushUserNotification(getDatabase(), creatorUid, {
      type: 'print_on_demand',
      title: titles[nextStatus] || 'Atualizacao do pedido',
      message,
      orderId,
      dedupeKey: `pod:status:${orderId}:${nextStatus}`,
      data: { orderId, status: nextStatus },
    });
  }

  return { ok: true };
});

/**
 * Comprador (creatorUid do pedido) cancela antes do pagamento — sem estorno MP aqui.
 */
export const cancelMyPrintOnDemandOrder = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const orderId = assertPodOrderId(body.orderId, 'orderId');
  const reason = String(body.cancellationReason || '').trim();
  if (reason.length < 3) {
    throw new HttpsError('invalid-argument', 'Informe o motivo do cancelamento (minimo 3 caracteres).');
  }
  if (reason.length > 2000) {
    throw new HttpsError('invalid-argument', 'Motivo muito longo (maximo 2000 caracteres).');
  }

  const db = getDatabase();
  await enforceCommerceAbuseShield(db, {
    request,
    scope: 'cancelPodOrder',
    key: uid,
    minIntervalMs: 1000,
    windowMs: 60 * 1000,
    maxHits: 6,
    networkWindowMs: 60 * 1000,
    networkMaxHits: 12,
    ipWindowMs: 5 * 60 * 1000,
    ipMaxHits: 20,
    message: 'Muitas tentativas de cancelamento em pouco tempo. Aguarde alguns segundos.',
  });
  const r = db.ref(`loja/printOnDemandOrders/${orderId}`);
  const snap = await r.get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Pedido nao encontrado.');
  }
  const row = snap.val() || {};
  if (String(row.creatorUid || '') !== uid) {
    throw new HttpsError('permission-denied', 'Este pedido nao esta na sua conta.');
  }
  const st = String(row.status || '').trim().toLowerCase();
  if (st === 'cancelled') {
    return { ok: true, alreadyCancelled: true };
  }
  if (normalizePodStatus(st, '') !== 'pending') {
    throw new HttpsError(
      'failed-precondition',
      'So e possivel cancelar pelo site enquanto o pagamento estiver pendente. Se ja pagou ou a producao comecou, fale com o suporte.'
    );
  }

  const now = Date.now();
  await r.update({
    status: 'cancelled',
    buyerCancellationReason: reason,
    cancelledAt: now,
    cancelledByBuyerUid: uid,
    updatedAt: now,
  });

  await pushPodOrderEvent(db, orderId, {
    type: 'buyer_cancel',
    message: `Cancelado pelo comprador: ${reason.slice(0, 200)}`,
    actor: 'buyer',
    buyerUid: uid,
  });

  try {
    await notifyAdminsPodBuyerCancelled(db, { orderId, buyerUid: uid, reason });
  } catch (err) {
    logger.warn('notifyAdminsPodBuyerCancelled falhou', { orderId, err: err?.message || String(err) });
  }

  await pushUserNotification(db, uid, {
    type: 'print_on_demand',
    title: 'Pedido cancelado',
    message: `Voce cancelou o pedido de mangá fisico #${orderId.slice(-8).toUpperCase()}.`,
    orderId,
    dedupeKey: `pod:buyer_cancel:${orderId}`,
    data: { orderId, status: 'cancelled' },
  });

  return { ok: true };
});

/** Super-admin: ajuste manual se necessario (ex.: corrigir URL). */
export const adminPatchPrintOnDemandOrderSuper = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  await requireSuperAdmin(request.auth);
  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const orderId = assertPodOrderId(body.orderId, 'orderId');
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

/** Cancela reservas pending após 24h sem pagamento (alinhado a `POD_PENDING_PAYMENT_TTL_MS`). */
export const expirePrintOnDemandPendingPayments = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'America/Sao_Paulo',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const db = getDatabase();
    const now = Date.now();
    const snap = await db.ref('loja/printOnDemandOrders').get();
    if (!snap.exists()) return;
    const all = snap.val() || {};
    let cancelled = 0;
    for (const [id, row] of Object.entries(all)) {
      const r = row && typeof row === 'object' ? row : {};
      if (normalizePodStatus(String(r.status || '').toLowerCase(), '') !== 'pending') continue;
      const exp = Number(r.expiresAt || 0);
      if (!exp || now < exp) continue;
      const oref = db.ref(`loja/printOnDemandOrders/${id}`);
      await oref.update({
        status: 'cancelled',
        cancelledAt: now,
        autoCancelled: true,
        cancelReasonCode: 'payment_timeout_24h',
        adminCancellationReason:
          'Pedido cancelado automaticamente: prazo de 24 horas para pagamento sem confirmacao.',
        updatedAt: now,
      });
      await pushPodOrderEvent(db, id, {
        type: 'auto_expired',
        message: 'Reserva expirada (24h sem pagamento).',
        actor: 'system',
      });
      const uid = String(r.creatorUid || '');
      if (uid) {
        try {
          await pushUserNotification(db, uid, {
            type: 'print_on_demand',
            title: 'Pedido expirado',
            message: `Seu pedido de mangá fisico #${id.slice(-8).toUpperCase()} foi cancelado por falta de pagamento no prazo.`,
            orderId: id,
            dedupeKey: `pod:expired:${id}`,
            data: { orderId: id, status: 'cancelled' },
          });
        } catch (e) {
          logger.warn('POD expire notify fail', { id, error: e?.message });
        }
      }
      cancelled += 1;
    }
    if (cancelled) logger.info('expirePrintOnDemandPendingPayments', { cancelled });
  }
);
