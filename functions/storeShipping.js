import {
  computeFixedZoneShippingParts,
  FREE_SHIPPING_MAX_SHIPPING_BRL,
  FREE_SHIPPING_MIN_SUBTOTAL_BRL,
} from './fixedZoneShipping.js';

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * Dias úteis entre pagamento e postagem (separação, embalagem, despacho).
 * Somados ao prazo de trânsito PAC/SEDEX da tabela regional (`pacDays` / `sedexDays`).
 */
export const STORE_INTERNAL_PREP_DAYS_MIN = 2;
export const STORE_INTERNAL_PREP_DAYS_MAX = 4;

export const STORE_SHIPPING_REGIONS = {
  sudeste: { label: 'Sudeste', states: ['SP', 'RJ', 'MG', 'ES'], pacBase: 25, sedexBase: 34, pacPerKg: 6, sedexPerKg: 9, pacDays: 5, sedexDays: 2 },
  sul: { label: 'Sul', states: ['PR', 'SC', 'RS'], pacBase: 30, sedexBase: 39, pacPerKg: 7, sedexPerKg: 10, pacDays: 6, sedexDays: 3 },
  centro_oeste: { label: 'Centro-Oeste', states: ['DF', 'GO', 'MT', 'MS'], pacBase: 35, sedexBase: 45, pacPerKg: 8, sedexPerKg: 11, pacDays: 7, sedexDays: 3 },
  nordeste: { label: 'Nordeste', states: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'], pacBase: 45, sedexBase: 58, pacPerKg: 10, sedexPerKg: 14, pacDays: 9, sedexDays: 4 },
  norte: { label: 'Norte', states: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'], pacBase: 60, sedexBase: 76, pacPerKg: 13, sedexPerKg: 18, pacDays: 11, sedexDays: 5 },
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

  const services = [
    { code: 'PAC', mult: 1 },
    { code: 'SEDEX', mult: 1.35 },
  ];
  const options = services.map(({ code: serviceCode, mult }) => {
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
      label: serviceCode,
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
