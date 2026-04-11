import { SHIPPING_MODE } from './shippingEnv.js';
import { computeFixedZoneShippingParts } from './fixedZoneShipping.js';

export { SHIPPING_MODE };

const REGION_SHIPPING_RATES = {
  sudeste: 27,
  sul: 29,
  'centro-oeste': 34,
  nordeste: 42,
  norte: 48,
};

export function normalizeShippingRegions(config = {}) {
  const out = {};
  Object.entries(config || {}).forEach(([key, raw]) => {
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0) out[key] = v;
  });
  return out;
}

export function computeRegionalShippingByUf(uf, config = {}) {
  const ufUpper = String(uf || '').trim().toUpperCase();
  const map = {
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
  const region = map[ufUpper] || 'sudeste';
  const normalized = normalizeShippingRegions(config);
  return normalized[region] ?? REGION_SHIPPING_RATES[region];
}

export function computeStoreShipping({
  mode,
  uf,
  regionalRates,
  quantity,
  subtotal,
}) {
  const m = mode || SHIPPING_MODE.API;
  if (m === SHIPPING_MODE.FIXED) {
    return {
      total: Number(subtotal || 0) >= 99999 ? 0 : 29,
      mode: SHIPPING_MODE.FIXED,
    };
  }
  if (m === SHIPPING_MODE.REGION) {
    const base = computeRegionalShippingByUf(uf, regionalRates);
    return {
      total: base,
      mode: SHIPPING_MODE.REGION,
    };
  }
  const region = computeRegionalShippingByUf(uf, regionalRates);
  const parts = computeFixedZoneShippingParts({
    region: Object.keys(REGION_SHIPPING_RATES).find((k) => REGION_SHIPPING_RATES[k] === region) || 'sudeste',
    subtotal,
    quantity,
  });
  return {
    total: parts.total,
    base: parts.base,
    discount: parts.discount,
    mode: SHIPPING_MODE.API,
  };
}
