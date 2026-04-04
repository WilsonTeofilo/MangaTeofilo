/**
 * Frete da loja: preço fixo por UF (tabela comercial) + R$ 2 por unidade extra; PAC usa esse valor,
 * SEDEX aplica multiplicador sobre a mesma base. Prazos de trânsito seguem a região da UF.
 */

import {
  computeFixedZoneShippingParts,
  FREE_SHIPPING_MAX_SHIPPING_BRL,
  FREE_SHIPPING_MIN_SUBTOTAL_BRL,
} from './fixedZoneShipping.js';

/** Dias úteis entre pagamento e postagem; somados ao trânsito PAC/SEDEX (`pacDays`/`sedexDays`). */
export const STORE_INTERNAL_PREP_DAYS_MIN = 2;
export const STORE_INTERNAL_PREP_DAYS_MAX = 4;

export const STORE_SHIPPING_REGIONS = {
  sudeste: { label: 'Sudeste', states: ['SP', 'RJ', 'MG', 'ES'], pacBase: 25, sedexBase: 34, pacPerKg: 6, sedexPerKg: 9, pacDays: 5, sedexDays: 2 },
  sul: { label: 'Sul', states: ['PR', 'SC', 'RS'], pacBase: 30, sedexBase: 39, pacPerKg: 7, sedexPerKg: 10, pacDays: 6, sedexDays: 3 },
  centro_oeste: { label: 'Centro-Oeste', states: ['DF', 'GO', 'MT', 'MS'], pacBase: 35, sedexBase: 45, pacPerKg: 8, sedexPerKg: 11, pacDays: 7, sedexDays: 3 },
  nordeste: { label: 'Nordeste', states: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'], pacBase: 45, sedexBase: 58, pacPerKg: 10, sedexPerKg: 14, pacDays: 9, sedexDays: 4 },
  norte: { label: 'Norte', states: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'], pacBase: 60, sedexBase: 76, pacPerKg: 13, sedexPerKg: 18, pacDays: 11, sedexDays: 5 },
};

export const STORE_SHIPPING_SERVICES = {
  PAC: { label: 'PAC' },
  SEDEX: { label: 'SEDEX' },
};

export function normalizeShippingRegions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, base] of Object.entries(STORE_SHIPPING_REGIONS)) {
    const patch = src[key] && typeof src[key] === 'object' ? src[key] : {};
    out[key] = {
      ...base,
      pacBase: Number.isFinite(Number(patch.pacBase)) ? Math.max(0, Number(patch.pacBase)) : base.pacBase,
      sedexBase: Number.isFinite(Number(patch.sedexBase)) ? Math.max(0, Number(patch.sedexBase)) : base.sedexBase,
      pacPerKg: Number.isFinite(Number(patch.pacPerKg)) ? Math.max(0, Number(patch.pacPerKg)) : base.pacPerKg,
      sedexPerKg: Number.isFinite(Number(patch.sedexPerKg)) ? Math.max(0, Number(patch.sedexPerKg)) : base.sedexPerKg,
      pacDays: Number.isFinite(Number(patch.pacDays)) ? Math.max(1, Number(patch.pacDays)) : base.pacDays,
      sedexDays: Number.isFinite(Number(patch.sedexDays)) ? Math.max(1, Number(patch.sedexDays)) : base.sedexDays,
    };
  }
  return out;
}

export function detectShippingRegionFromState(state) {
  const uf = String(state || '').trim().toUpperCase();
  for (const [key, region] of Object.entries(STORE_SHIPPING_REGIONS)) {
    if (region.states.includes(uf)) return key;
  }
  return 'sudeste';
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

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

export function buildStoreShippingQuote({ items, productsById, config, buyerProfile, subtotal }) {
  const normalizedRegions = normalizeShippingRegions(config?.shippingRegions);
  const regionKey = detectShippingRegionFromState(buyerProfile?.state);
  const region = normalizedRegions[regionKey] || normalizedRegions.sudeste;
  const sub = Number(subtotal || 0);

  let totalUnits = 0;
  let totalWeightGrams = 0;
  for (const item of items || []) {
    const product = productsById?.[item.productId];
    if (!product) continue;
    const qty = Math.max(1, Number(item.quantity) || 1);
    totalUnits += qty;
    totalWeightGrams += Math.max(1, Number(product.weightGrams || 450)) * qty;
  }
  if (totalUnits < 1) totalUnits = 1;

  const zoneParts = computeFixedZoneShippingParts({
    state: buyerProfile?.state,
    quantity: totalUnits,
    cartTotal: sub,
  });

  const options = Object.keys(STORE_SHIPPING_SERVICES).map((serviceCode) => {
    const mult = serviceCode === 'SEDEX' ? 1.35 : 1;
    const raw =
      mult === 1
        ? zoneParts.originalPriceBrl
        : Math.max(0, Math.ceil((zoneParts.baseBrl + zoneParts.extraBrl) * mult));
    const freeApplied = sub >= FREE_SHIPPING_MIN_SUBTOTAL_BRL && raw <= FREE_SHIPPING_MAX_SHIPPING_BRL;
    const discountBrl = freeApplied ? raw : 0;
    const priceBrl = freeApplied ? 0 : raw;
    const transitDays = serviceCode === 'SEDEX' ? region.sedexDays : region.pacDays;
    const deliveryDaysLow = transitDays + STORE_INTERNAL_PREP_DAYS_MIN;
    const deliveryDaysHigh = transitDays + STORE_INTERNAL_PREP_DAYS_MAX;
    return {
      serviceCode,
      label: STORE_SHIPPING_SERVICES[serviceCode].label,
      regionKey,
      regionLabel: region.label,
      totalWeightGrams,
      originalPriceBrl: round2(raw),
      discountBrl: round2(discountBrl),
      priceBrl: round2(priceBrl),
      internalCostBrl: round2(raw),
      transitDays,
      deliveryDays: transitDays,
      deliveryDaysLow,
      deliveryDaysHigh,
    };
  });

  return {
    regionKey,
    regionLabel: region.label,
    options,
    defaultServiceCode: options[0]?.serviceCode || 'PAC',
  };
}
