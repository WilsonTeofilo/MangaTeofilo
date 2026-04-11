export const REGIONAL_FREIGHT_DISCOUNT_RATE = 0.3;
export const REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL = 165;
export const REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY = 3;
export const REGIONAL_FREIGHT_DISCOUNT_CAP_BRL = 20;

const REGION_BY_UF = {
  AC: 'norte',
  AL: 'nordeste',
  AP: 'norte',
  AM: 'norte',
  BA: 'nordeste',
  CE: 'nordeste',
  DF: 'centro-oeste',
  ES: 'sudeste',
  GO: 'centro-oeste',
  MA: 'nordeste',
  MT: 'centro-oeste',
  MS: 'centro-oeste',
  MG: 'sudeste',
  PA: 'norte',
  PB: 'nordeste',
  PR: 'sul',
  PE: 'nordeste',
  PI: 'nordeste',
  RJ: 'sudeste',
  RN: 'nordeste',
  RS: 'sul',
  RO: 'norte',
  RR: 'norte',
  SC: 'sul',
  SP: 'sudeste',
  SE: 'nordeste',
  TO: 'norte',
};

const DEFAULT_PRICES = {
  sudeste: 27,
  sul: 29,
  'centro-oeste': 34,
  nordeste: 42,
  norte: 48,
};

export function normalizeRegionalFreightRegion(uf) {
  const raw = String(uf || '').trim().toUpperCase();
  if (!raw) return null;
  if (Object.values(DEFAULT_PRICES).includes(raw)) return raw;
  return REGION_BY_UF[raw] || null;
}

export function computeFixedZoneShippingParts({
  region,
  subtotal,
  quantity,
}) {
  const base = DEFAULT_PRICES[region] ?? DEFAULT_PRICES.sudeste;
  const qty = Number(quantity || 0);
  const shouldDiscount =
    region === 'sudeste' || region === 'sul'
      ? Number(subtotal || 0) >= REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL ||
        qty >= REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY
      : false;
  if (!shouldDiscount) {
    return {
      base,
      discount: 0,
      total: base,
    };
  }
  const discount = Math.min(REGIONAL_FREIGHT_DISCOUNT_CAP_BRL, Math.round(base * REGIONAL_FREIGHT_DISCOUNT_RATE * 100) / 100);
  return {
    base,
    discount,
    total: Math.max(0, Math.round((base - discount) * 100) / 100),
  };
}
