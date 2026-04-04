import { formatLojaOrderStatusPt } from '../../config/store';
import { normalizeStoreStatus, storeOrderTimelineMeta } from '../../utils/orderTrackingUi';

/** @returns {{ className: string, label: string }} */
export function storeOrderBadgeProps(order) {
  const s = normalizeStoreStatus(order?.status);
  const meta = storeOrderTimelineMeta(order?.status, order?.paymentStatus);
  const label = formatLojaOrderStatusPt(order?.status);
  if (meta.cancelled) return { className: 'ot-badge ot-badge--cancel', label };
  if (meta.problem) return { className: 'ot-badge ot-badge--problem', label: 'Problema no pagamento' };
  if (s === 'pending' || s === 'pending_payment') return { className: 'ot-badge ot-badge--payment', label };
  if (s === 'processing' || s === 'in_production' || s === 'paid' || s === 'order_received') {
    return { className: 'ot-badge ot-badge--production', label };
  }
  if (s === 'ready_to_ship' || s === 'shipped') return { className: 'ot-badge ot-badge--transit', label };
  if (s === 'delivered') return { className: 'ot-badge ot-badge--done', label };
  return { className: 'ot-badge ot-badge--neutral', label };
}
