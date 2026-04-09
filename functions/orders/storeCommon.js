import { HttpsError } from 'firebase-functions/v2/https';
import { buildStoreShippingQuote } from '../storeShipping.js';
import { normalizeAndValidateCpf } from '../creatorCompliance.js';
import { buildUserEntitlements } from '../userEntitlements.js';
import { sanitizeCreatorId } from '../creatorDataLedger.js';

export const STORE_ORDER_STATUS_CANON = new Set([
  'pending',
  'paid',
  'in_production',
  'shipped',
  'delivered',
  'cancelled',
]);

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function normalizeStoreOrderStatusInput(raw, fallback = 'pending') {
  const value = String(raw || fallback).trim().toLowerCase().replace(/\s+/g, '_');
  if (!value) return fallback;
  if (value === 'pending_payment') return 'pending';
  if (value === 'order_received') return 'paid';
  if (value === 'processing') return 'in_production';
  if (value === 'ready_to_ship') return 'in_production';
  if (value === 'canceled') return 'cancelled';
  return value;
}

export function normalizeStoreBuyerProfile(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const digits = (value, max) => String(value || '').replace(/\D+/g, '').slice(0, max);
  return {
    fullName: String(src.fullName || '').trim(),
    cpf: normalizeAndValidateCpf(src.cpf || '') || '',
    phone: digits(src.phone, 11),
    postalCode: digits(src.postalCode, 8),
    state: String(src.state || '').trim().toUpperCase().slice(0, 2),
    city: String(src.city || '').trim(),
    neighborhood: String(src.neighborhood || '').trim(),
    addressLine1: String(src.addressLine1 || '').trim(),
    addressLine2: String(src.addressLine2 || '').trim(),
  };
}

export function storeBuyerProfileMissingFields(raw) {
  const profile = normalizeStoreBuyerProfile(raw);
  const missing = [];
  if (profile.fullName.length < 6) missing.push('nome completo');
  if (!profile.cpf) missing.push('CPF');
  if (profile.phone.length < 10) missing.push('telefone');
  if (profile.postalCode.length !== 8) missing.push('CEP');
  if (profile.state.length !== 2) missing.push('estado');
  if (profile.city.length < 2) missing.push('cidade');
  if (profile.neighborhood.length < 2) missing.push('bairro');
  if (profile.addressLine1.length < 6) missing.push('endereco');
  return missing;
}

export function maskCpf(cpf) {
  const digits = String(cpf || '').replace(/\D+/g, '');
  if (digits.length !== 11) return '';
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function storeProductIsOnDemand(product) {
  return String(product?.inventoryMode || '').toLowerCase() === 'on_demand';
}

export function parseStoreCartLineItem(item, products, { vip, vipDiscountPct, enforceStock }) {
  const productId = String(item?.productId || '').trim();
  const quantity = Math.max(1, Math.floor(Number(item?.quantity || 1)));
  if (!productId) {
    throw new HttpsError('invalid-argument', 'Item invalido (productId ausente).');
  }
  const product = products[productId];
  if (!product) {
    throw new HttpsError('not-found', `Produto ${productId} nao encontrado.`);
  }
  if (product.isActive === false) {
    throw new HttpsError('failed-precondition', `Produto ${productId} indisponivel.`);
  }
  if (product.isStoreDemo === true) {
    throw new HttpsError('failed-precondition', `Produto ${productId} nao esta disponivel para venda.`);
  }
  const onDemand = storeProductIsOnDemand(product);
  if (enforceStock && !onDemand) {
    const stock = Math.max(0, Number(product.stock || 0));
    if (quantity > stock) {
      throw new HttpsError(
        'failed-precondition',
        `Estoque insuficiente para ${product.title || productId}.`
      );
    }
  }

  const type = String(product.type || 'manga').toLowerCase();
  const sizes = Array.isArray(product.sizes)
    ? product.sizes.map((size) => String(size || '').trim()).filter(Boolean)
    : [];
  let size = String(item?.size || '').trim();
  if (type === 'roupa' && sizes.length) {
    if (!size || !sizes.includes(size)) {
      throw new HttpsError(
        'invalid-argument',
        `Informe um tamanho valido para ${product.title || productId}.`
      );
    }
  } else {
    size = '';
  }

  const basePrice = Number(
    product.isOnSale === true && Number(product.promoPrice) > 0
      ? product.promoPrice
      : product.price
  );
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    throw new HttpsError('failed-precondition', `Preco invalido para ${product.title || productId}.`);
  }
  let unitPrice = round2(basePrice);
  if (vip && product.isVIPDiscountEnabled === true) {
    unitPrice = round2(basePrice * (1 - vipDiscountPct / 100));
  }
  const lineTotal = round2(unitPrice * quantity);
  const baseTitle = String(product.title || productId);
  const productCreatorId = sanitizeCreatorId(product?.creatorId) || null;
  return {
    productId,
    title: size ? `${baseTitle} (${size})` : baseTitle,
    description: String(product.description || ''),
    quantity,
    unitPrice,
    lineTotal,
    size: size || null,
    type: type || 'manga',
    creatorId: productCreatorId,
    inventoryMode: onDemand ? 'on_demand' : 'fixed',
  };
}

export function buildStoreShippingQuoteForUser({ rawItems, products, config, profile }) {
  const buyerProfile = normalizeStoreBuyerProfile(profile?.buyerProfile);
  const missingBuyerFields = storeBuyerProfileMissingFields(buyerProfile);
  if (missingBuyerFields.length) {
    throw new HttpsError(
      'failed-precondition',
      `Complete seu perfil de compra antes de calcular o frete: ${missingBuyerFields.join(', ')}.`
    );
  }
  const vip = buildUserEntitlements(profile).global.isPremium === true;
  const vipDiscountPct = Math.max(0, Math.min(60, Number(config.vipDiscountPct || 10)));
  let subtotal = 0;
  const items = [];
  const pricedLines = [];
  for (const item of rawItems) {
    const line = parseStoreCartLineItem(item, products, {
      vip,
      vipDiscountPct,
      enforceStock: true,
    });
    subtotal += line.lineTotal;
    items.push({ productId: line.productId, quantity: line.quantity });
    pricedLines.push({
      productId: line.productId,
      quantity: line.quantity,
      title: line.title,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      size: line.size ?? null,
    });
  }
  subtotal = round2(subtotal);
  return {
    quote: buildStoreShippingQuote({
      items,
      productsById: products,
      config,
      buyerProfile,
      subtotal,
    }),
    subtotal,
    pricedLines,
    buyerProfile,
    vip,
    vipDiscountPct,
  };
}

export function orderItemsForCreator(order, creatorUid) {
  const cid = String(creatorUid || '').trim();
  if (!cid) return [];
  return (Array.isArray(order?.items) ? order.items : []).filter(
    (item) => String(item?.creatorId || '').trim() === cid
  );
}

export function sanitizeStoreOrderForViewer(orderId, row, viewerUid) {
  const items = orderItemsForCreator(row, viewerUid);
  const containsForeignItems = (Array.isArray(row?.items) ? row.items : []).length > items.length;
  const creatorSubtotal = items.reduce((sum, item) => sum + Number(item?.lineTotal || 0), 0);
  const rawShippingAddress =
    row?.shippingAddress && typeof row.shippingAddress === 'object' ? row.shippingAddress : null;
  const sellerSafeShippingAddress = rawShippingAddress
    ? {
        state: String(rawShippingAddress.state || '').trim(),
        city: String(rawShippingAddress.city || '').trim(),
      }
    : null;
  return {
    id: orderId,
    status: normalizeStoreOrderStatusInput(row?.status, ''),
    createdAt: Number(row?.createdAt || 0),
    updatedAt: Number(row?.updatedAt || 0),
    paidAt: Number(row?.paidAt || 0) || null,
    refundedAt: Number(row?.refundedAt || 0) || null,
    paymentStatus: String(row?.paymentStatus || ''),
    paymentId: row?.paymentId ?? null,
    payoutStatus: String(row?.payoutStatus || ''),
    trackingCode: String(row?.trackingCode || row?.codigoRastreio || ''),
    shippingAddress: sellerSafeShippingAddress,
    productionChecklist:
      row?.productionChecklist && typeof row.productionChecklist === 'object'
        ? row.productionChecklist
        : null,
    vipApplied: row?.vipApplied === true,
    creatorSubtotal,
    total: creatorSubtotal,
    subtotal: creatorSubtotal,
    containsForeignItems,
    items,
  };
}

export async function reserveStoreInventoryForOrderItems(db, orderItems) {
  const reserved = [];
  try {
    for (const item of Array.isArray(orderItems) ? orderItems : []) {
      const productId = String(item?.productId || '').trim();
      const quantity = Math.max(1, Math.floor(Number(item?.quantity || 1)));
      if (!productId) continue;
      if (String(item?.inventoryMode || '').toLowerCase() === 'on_demand') continue;
      const stockRef = db.ref(`loja/produtos/${productId}/stock`);
      const tx = await stockRef.transaction((curr) => {
        const stock = Math.max(0, Number(curr || 0));
        if (stock < quantity) return;
        return stock - quantity;
      });
      if (!tx.committed) {
        throw new HttpsError(
          'failed-precondition',
          `Estoque insuficiente para o produto ${productId}.`
        );
      }
      reserved.push({ productId, quantity });
    }
    return reserved;
  } catch (error) {
    for (const item of reserved) {
      await db.ref(`loja/produtos/${item.productId}/stock`).transaction((curr) => {
        const stock = Math.max(0, Number(curr || 0));
        return stock + item.quantity;
      });
    }
    throw error;
  }
}

export async function releaseStoreInventoryReservation(db, order) {
  if (!order || typeof order !== 'object') return false;
  if (order.inventoryReserved !== true) return false;
  if (Number(order.inventoryReleasedAt || 0) > 0) return false;

  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    const productId = String(item?.productId || '').trim();
    const quantity = Math.max(1, Math.floor(Number(item?.quantity || 1)));
    if (!productId) continue;
    if (String(item?.inventoryMode || '').toLowerCase() === 'on_demand') continue;
    await db.ref(`loja/produtos/${productId}/stock`).transaction((curr) => {
      const stock = Math.max(0, Number(curr || 0));
      return stock + quantity;
    });
  }
  return true;
}
