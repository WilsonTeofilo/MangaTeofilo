import { POD_ORDER_STATUS, normalizePodOrderStatusInput } from './printOnDemandPricingV2';

const POD_STATUS_LABELS = {
  [POD_ORDER_STATUS.PENDING_PAYMENT]: 'Aguardando pagamento',
  [POD_ORDER_STATUS.PAID]: 'Pagamento confirmado',
  [POD_ORDER_STATUS.IN_PRODUCTION]: 'Em produção',
  [POD_ORDER_STATUS.READY_TO_SHIP]: 'Pronto para envio',
  [POD_ORDER_STATUS.SHIPPED]: 'Enviado',
  [POD_ORDER_STATUS.DELIVERED]: 'Entregue',
  [POD_ORDER_STATUS.CANCELLED]: 'Cancelado',
};

export function normalizePodStatus(status) {
  return normalizePodOrderStatusInput(status);
}

export function formatPodStatusLabel(status) {
  const normalized = normalizePodStatus(status);
  return POD_STATUS_LABELS[normalized] || (normalized ? normalized : 'Status desconhecido');
}

export function isPodStatusPendingPayment(status) {
  return normalizePodStatus(status) === POD_ORDER_STATUS.PENDING_PAYMENT;
}

export function isPodStatusPaidLike(status) {
  const normalized = normalizePodStatus(status);
  return [
    POD_ORDER_STATUS.PAID,
    POD_ORDER_STATUS.IN_PRODUCTION,
    POD_ORDER_STATUS.READY_TO_SHIP,
    POD_ORDER_STATUS.SHIPPED,
    POD_ORDER_STATUS.DELIVERED,
  ].includes(normalized);
}

export function podStatusBadgeClass(status) {
  const normalized = normalizePodStatus(status);
  if (normalized === POD_ORDER_STATUS.CANCELLED) return 'ot-badge ot-badge--cancel';
  if (normalized === POD_ORDER_STATUS.PENDING_PAYMENT) return 'ot-badge ot-badge--payment';
  if (normalized === POD_ORDER_STATUS.PAID || normalized === POD_ORDER_STATUS.IN_PRODUCTION) {
    return 'ot-badge ot-badge--production';
  }
  if (normalized === POD_ORDER_STATUS.READY_TO_SHIP || normalized === POD_ORDER_STATUS.SHIPPED) {
    return 'ot-badge ot-badge--transit';
  }
  if (normalized === POD_ORDER_STATUS.DELIVERED) return 'ot-badge ot-badge--done';
  return 'ot-badge ot-badge--neutral';
}
