import { correiosRastreamentoUrl } from '../config/store';
import {
  BOOK_FORMAT,
  SALE_MODEL,
  POD_PRODUCTION_ORDER_CUTOFF_HOUR_BR,
  formatBRL,
  getProductionDaysRange,
} from './printOnDemandPricingV2';

const POD_STATUS_LABELS = {
  pending_payment: 'Aguardando pagamento',
  paid: 'Pagamento confirmado',
  in_production: 'Em produção',
  ready_to_ship: 'Pronto para envio',
  shipped: 'Enviado',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

/** @param {string} [status] */
export function formatPodOrderStatusPt(status) {
  const k = String(status || '').trim();
  return POD_STATUS_LABELS[k] || (k ? k : 'Status desconhecido');
}

/** @param {string} [format] */
export function formatPodBookFormatPt(format) {
  const f = String(format || '').trim().toLowerCase();
  if (f === BOOK_FORMAT.TANKOBON) return 'Tankōbon';
  if (f === BOOK_FORMAT.MEIO_TANKO) return 'Meio-Tankō';
  return f || '—';
}

/** @param {string} [saleModel] */
export function formatPodSaleModelPt(saleModel) {
  const m = String(saleModel || '').trim().toLowerCase();
  if (m === SALE_MODEL.PLATFORM) return 'Venda pela plataforma';
  if (m === SALE_MODEL.STORE_PROMO) return 'Vitrine (sem lucro)';
  if (m === SALE_MODEL.PERSONAL) return 'Produzir para mim';
  return m || '—';
}

/** @param {string} [id] */
export function shortPodOrderId(id) {
  return String(id || '').slice(-8).toUpperCase();
}

/** @param {string} [trackingCode] */
export function podOrderTrackingUrl(trackingCode) {
  return correiosRastreamentoUrl(String(trackingCode || '').trim());
}

/**
 * Valor exibido ao criador (snapshot gravado no pedido).
 * @param {Record<string, unknown>} [snapshot]
 */
export function formatPodOrderAmountDue(snapshot) {
  const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const n = Number(s.amountDueBRL ?? s.productionCostTotalBRL ?? s.totalBRL ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return formatBRL(n);
}

/**
 * Texto único para checkout e pós-pagamento (prazo estimado).
 * @param {string} [saleModel]
 * @param {string} [format]
 * @param {number} [quantity]
 */
export function describePodLeadTimePt(saleModel, format, quantity) {
  const r = getProductionDaysRange(saleModel, format, quantity);
  if (!r) return '';
  const fila = `Confirmação do pagamento até ${POD_PRODUCTION_ORDER_CUTOFF_HOUR_BR}h (Brasil): entra na fila no mesmo dia útil; depois disso, no próximo dia útil.`;
  if (r.kind === 'approval') {
    return `Prazo estimado: até ${r.low} dias úteis para análise e liberação na loja; em seguida entra na fila de produção. ${fila}`;
  }
  return `Produção sob demanda (cada pedido é produzido individualmente). Prazo em dias úteis: ${r.low}–${r.high} (produção + envio aos Correios). ${fila}`;
}
