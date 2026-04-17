import { correiosRastreamentoUrl } from '../config/store';
import {
  BOOK_FORMAT,
  SALE_MODEL,
  POD_PRODUCTION_ORDER_CUTOFF_HOUR_BR,
  formatBRL,
  getProductionDaysRange,
} from './printOnDemandPricingV2';
import { formatPodStatusLabel } from './podStatus';

/** @param {string} [status] */
export function formatPodOrderStatusPt(status) {
  return formatPodStatusLabel(status);
}

/** @param {string} [format] */
export function formatPodBookFormatPt(format) {
  const f = String(format || '').trim().toLowerCase();
  if (f === BOOK_FORMAT.TANKOBON) return 'Tankobon';
  if (f === BOOK_FORMAT.MEIO_TANKO) return 'Meio-Tanko';
  return f || '-';
}

/** @param {string} [saleModel] */
export function formatPodSaleModelPt(saleModel) {
  const m = String(saleModel || '').trim().toLowerCase();
  if (m === SALE_MODEL.PLATFORM) return 'Venda pela plataforma';
  if (m === SALE_MODEL.STORE_PROMO) return 'Vitrine (sem lucro)';
  if (m === SALE_MODEL.PERSONAL) return 'Produzir para mim';
  return m || '-';
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
 * Texto unico para checkout e pos-pagamento (prazo estimado).
 * @param {string} [saleModel]
 * @param {string} [format]
 * @param {number} [quantity]
 */
export function describePodLeadTimePt(saleModel, format, quantity) {
  const r = getProductionDaysRange(saleModel, format, quantity);
  if (!r) return '';
  const fila = `Confirmacao do pagamento ate ${POD_PRODUCTION_ORDER_CUTOFF_HOUR_BR}h (Brasil): entra na fila no mesmo dia util; depois disso, no proximo dia util.`;
  if (r.kind === 'approval') {
    return `Prazo estimado: ate ${r.low} dias uteis para analise e liberacao na loja; em seguida entra na fila de producao. ${fila}`;
  }
  return `Producao sob demanda (cada pedido e produzido individualmente). Prazo em dias uteis: ${r.low}-${r.high} (producao + envio aos Correios). ${fila}`;
}
