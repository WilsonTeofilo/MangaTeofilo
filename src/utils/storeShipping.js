/**
 * Frete da loja — núcleo em `shared/storeShipping.js`; aqui só helpers de UI.
 */

export {
  STORE_INTERNAL_PREP_DAYS_MIN,
  STORE_INTERNAL_PREP_DAYS_MAX,
  STORE_SHIPPING_REGIONS,
  STORE_SHIPPING_SERVICES,
  normalizeShippingRegions,
  detectShippingRegionFromState,
  buildStoreShippingQuote,
} from '../../shared/storeShipping.js';

/** Texto curto para carrinho / confirmação (dias úteis, parâmetros da tabela regional). */
export function formatStoreShippingEtaLabel(option) {
  if (!option) return '';
  const low = Number(option.deliveryDaysLow);
  const high = Number(option.deliveryDaysHigh);
  const transit = Number(option.transitDays ?? option.deliveryDays);
  if (low > 0 && high >= low) {
    return `${low}–${high} dias úteis (≈${transit} úteis nos Correios + preparação)`;
  }
  const t = transit > 0 ? transit : '—';
  return `${t} dias úteis nos Correios (estimativa)`;
}
