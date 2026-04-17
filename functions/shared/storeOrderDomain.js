export const STORE_ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  IN_PRODUCTION: 'in_production',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
});

export const STORE_ORDER_VIEWER_ROLE = Object.freeze({
  BUYER: 'buyer',
  SELLER: 'seller',
  ADMIN: 'admin',
});

export function normalizeStoreOrderStatus(value, fallback = STORE_ORDER_STATUS.PENDING) {
  const raw = String(value || fallback).trim().toLowerCase().replace(/\s+/g, '_');
  if (!raw) return fallback;
  if (raw === 'pending_payment') return STORE_ORDER_STATUS.PENDING;
  if (raw === 'order_received') return STORE_ORDER_STATUS.PAID;
  if (raw === 'processing') return STORE_ORDER_STATUS.IN_PRODUCTION;
  if (raw === 'ready_to_ship') return STORE_ORDER_STATUS.IN_PRODUCTION;
  if (raw === 'canceled') return STORE_ORDER_STATUS.CANCELLED;
  return raw;
}

export function storeOrderHasPaymentProblem(status, paymentStatus) {
  const normalizedStatus = normalizeStoreOrderStatus(status, '');
  const normalizedPaymentStatus = String(paymentStatus || '').trim().toLowerCase();
  return (
    normalizedPaymentStatus === 'rejected' ||
    normalizedPaymentStatus === 'cancelled' ||
    normalizedPaymentStatus === 'refunded' ||
    (normalizedStatus !== STORE_ORDER_STATUS.CANCELLED &&
      normalizedStatus === STORE_ORDER_STATUS.PENDING &&
      normalizedPaymentStatus !== '' &&
      normalizedPaymentStatus !== 'approved')
  );
}

export function isStoreOrderPaymentPending(status) {
  return normalizeStoreOrderStatus(status, '') === STORE_ORDER_STATUS.PENDING;
}

export function isStoreOrderPaidLike(status) {
  const normalizedStatus = normalizeStoreOrderStatus(status, '');
  return (
    normalizedStatus === STORE_ORDER_STATUS.PAID ||
    normalizedStatus === STORE_ORDER_STATUS.IN_PRODUCTION ||
    normalizedStatus === STORE_ORDER_STATUS.SHIPPED ||
    normalizedStatus === STORE_ORDER_STATUS.DELIVERED
  );
}

export function formatStoreOrderStatusPt(status) {
  const normalizedStatus = normalizeStoreOrderStatus(status, '');
  if (normalizedStatus === STORE_ORDER_STATUS.PENDING) return 'Aguardando pagamento';
  if (normalizedStatus === STORE_ORDER_STATUS.PAID) return 'Pedido confirmado';
  if (normalizedStatus === STORE_ORDER_STATUS.IN_PRODUCTION) return 'Em producao';
  if (normalizedStatus === STORE_ORDER_STATUS.SHIPPED) return 'Enviado · em transito';
  if (normalizedStatus === STORE_ORDER_STATUS.DELIVERED) return 'Entregue';
  if (normalizedStatus === STORE_ORDER_STATUS.CANCELLED) return 'Cancelado';
  return 'Em andamento';
}

export function formatStorePayoutStatusPt(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'released') return 'Liberado ao criador';
  return 'Retido ate a entrega';
}

export function canViewStoreOrderShippingAddress(viewerRole) {
  const role = String(viewerRole || '').trim().toLowerCase();
  return role === STORE_ORDER_VIEWER_ROLE.BUYER || role === STORE_ORDER_VIEWER_ROLE.ADMIN;
}

export function canAccessStorePaidFiles(status) {
  return isStoreOrderPaidLike(status);
}

export function canResumeStoreOrderPayment(orderLike = {}) {
  const expiresAt = Number(orderLike?.expiresAt || 0);
  return isStoreOrderPaymentPending(orderLike?.status) && !(expiresAt > 0 && Date.now() > expiresAt);
}

export function buildStoreOrderViewerCapabilities(orderLike = {}, viewerRole = '') {
  const role = String(viewerRole || '').trim().toLowerCase();
  return {
    viewerRole: role,
    canViewShippingAddress: canViewStoreOrderShippingAddress(role),
    canAccessPaidFiles: canAccessStorePaidFiles(orderLike?.status),
    canResumePayment: role === STORE_ORDER_VIEWER_ROLE.BUYER && canResumeStoreOrderPayment(orderLike),
    canSeeProductionChecklist:
      role === STORE_ORDER_VIEWER_ROLE.SELLER || role === STORE_ORDER_VIEWER_ROLE.ADMIN,
    canSeePayoutStatus:
      role === STORE_ORDER_VIEWER_ROLE.SELLER || role === STORE_ORDER_VIEWER_ROLE.ADMIN,
    hasPaymentProblem: storeOrderHasPaymentProblem(orderLike?.status, orderLike?.paymentStatus),
  };
}
