import { formatLojaOrderStatusPt } from '../../config/store';
import { storeOrderTimelineMeta } from '../../utils/orderTrackingUi';
import { normalizeStoreOrderStatus } from '../../utils/storeOrderDomain';

/** @returns {{ className: string, label: string }} */
export function storeOrderBadgeProps(order) {
  const s = normalizeStoreOrderStatus(order?.status, '');
  const meta = storeOrderTimelineMeta(order?.status, order?.paymentStatus);
  const label = formatLojaOrderStatusPt(order?.status);
  if (meta.cancelled) return { className: 'ot-badge ot-badge--cancel', label };
  if (meta.problem) return { className: 'ot-badge ot-badge--problem', label: 'Problema no pagamento' };
  if (s === 'pending') return { className: 'ot-badge ot-badge--payment', label };
  if (s === 'in_production' || s === 'paid') {
    return { className: 'ot-badge ot-badge--production', label };
  }
  if (s === 'shipped') return { className: 'ot-badge ot-badge--transit', label };
  if (s === 'delivered') return { className: 'ot-badge ot-badge--done', label };
  return { className: 'ot-badge ot-badge--neutral', label };
}
