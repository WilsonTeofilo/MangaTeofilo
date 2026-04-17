/**
 * Frete da loja â€” nÃºcleo em `functions/shared/storeShipping.js`; aqui sÃ³ helpers de UI.
 */

export {
  STORE_INTERNAL_PREP_DAYS_MIN,
  STORE_INTERNAL_PREP_DAYS_MAX,
  STORE_SHIPPING_REGIONS,
  STORE_SHIPPING_SERVICES,
  normalizeShippingRegions,
  detectShippingRegionFromState,
  buildStoreShippingQuote,
} from '../../functions/shared/storeShipping.js';

/** Texto curto para carrinho / confirmaÃ§Ã£o (dias Ãºteis, parÃ¢metros da tabela regional). */
export function formatStoreShippingEtaLabel(option) {
  if (!option) return '';
  const low = Number(option.deliveryDaysLow);
  const high = Number(option.deliveryDaysHigh);
  const transit = Number(option.transitDays ?? option.deliveryDays);
  if (low > 0 && high >= low) {
    return `${low}â€“${high} dias Ãºteis (â‰ˆ${transit} Ãºteis nos Correios + preparaÃ§Ã£o)`;
  }
  const t = transit > 0 ? transit : 'â€”';
  return `${t} dias Ãºteis nos Correios (estimativa)`;
}

