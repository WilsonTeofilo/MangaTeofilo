/**
 * Frete fixo por UF + R$ 2/unidade extra + desconto regional no frete.
 * Usado pela loja física, cotação e POD «Produzir para mim».
 */

import { isStoreWtShippingAllowed } from './shippingEnv.js';

export const SHIPPING_EXTRA_PER_UNIT_BRL = 2;

export const REGIONAL_FREIGHT_DISCOUNT_ELIGIBLE_UFS = [
  'SP',
  'RJ',
  'MG',
  'ES',
  'PR',
  'SC',
  'RS',
  'DF',
  'GO',
  'MT',
  'MS',
];

export const REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL = 165;
export const REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY = 3;
export const REGIONAL_FREIGHT_DISCOUNT_RATE = 0.3;
export const REGIONAL_FREIGHT_DISCOUNT_CAP_BRL = 20;

/** @deprecated Preferir REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL. */
export const FREE_SHIPPING_MIN_SUBTOTAL_BRL = REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL;

/** @deprecated Não usado na regra atual. */
export const FREE_SHIPPING_MAX_SHIPPING_BRL = 60;

export const SHIPPING_UNKNOWN_UF_BASE_BRL = 60;

export const SHIPPING_BASE_BRL_BY_UF = {
  SP: 35,
  RJ: 44,
  MG: 48,
  ES: 48,
  PR: 48,
  SC: 54,
  RS: 54,
  DF: 37,
  GO: 35,
  MT: 72,
  MS: 55,
  BA: 62,
  PE: 86,
  CE: 78,
  RN: 115,
  PB: 100,
  AL: 110,
  SE: 105,
  PI: 105,
  MA: 105,
  AC: 120,
  AM: 115,
  RR: 140,
  AP: 100,
  PA: 75,
  RO: 40,
  TO: 70,
};

/**
 * @param {number} raw Frete bruto (PAC ou já com multiplicador SEDEX).
 * @param {{ state?: string, quantity?: number, cartTotal?: number }} p
 */
export function getRegionalFreightDiscountBreakdown(raw, p) {
  const uf = String(p?.state || '').trim().toUpperCase();
  if (uf === 'WT' && isStoreWtShippingAllowed()) {
    const test = 0.5;
    return {
      priceBrl: test,
      originalPriceBrl: test,
      discountBrl: 0,
      regionalFreightDiscountApplied: false,
      freeApplied: false,
    };
  }
  const r = Math.max(0, Math.ceil(Number(raw) || 0));
  const subtotal = Number(p?.cartTotal || 0);
  const qty = Math.max(1, Math.floor(Number(p?.quantity) || 1));
  const isEligibleRegion = REGIONAL_FREIGHT_DISCOUNT_ELIGIBLE_UFS.includes(uf);
  const meetsCondition =
    subtotal >= REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL ||
    qty >= REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY;
  if (!isEligibleRegion || !meetsCondition) {
    return {
      priceBrl: r,
      originalPriceBrl: r,
      discountBrl: 0,
      regionalFreightDiscountApplied: false,
      freeApplied: false,
    };
  }
  const nominalDiscount = Math.min(r * REGIONAL_FREIGHT_DISCOUNT_RATE, REGIONAL_FREIGHT_DISCOUNT_CAP_BRL);
  const priceBrl = Math.max(0, Math.ceil(r - nominalDiscount));
  const discountBrl = r - priceBrl;
  return {
    priceBrl,
    originalPriceBrl: r,
    discountBrl,
    regionalFreightDiscountApplied: true,
    freeApplied: false,
  };
}

/**
 * @param {{ state?: string, quantity?: number, cartTotal?: number }} p
 */
export function computeFixedZoneShippingParts(p) {
  const uf = String(p?.state || '').trim().toUpperCase();
  if (uf === 'WT' && isStoreWtShippingAllowed()) {
    const test = 0.5;
    return {
      ...getRegionalFreightDiscountBreakdown(test, p),
      baseBrl: test,
      extraBrl: 0,
    };
  }
  const baseBrl = Number.isFinite(SHIPPING_BASE_BRL_BY_UF[uf])
    ? SHIPPING_BASE_BRL_BY_UF[uf]
    : SHIPPING_UNKNOWN_UF_BASE_BRL;
  const q = Math.max(1, Math.floor(Number(p?.quantity) || 1));
  const extraBrl = Math.max(0, q - 1) * SHIPPING_EXTRA_PER_UNIT_BRL;
  const raw = Math.ceil(Math.max(baseBrl + extraBrl, 0));
  const br = getRegionalFreightDiscountBreakdown(raw, p);
  return {
    ...br,
    baseBrl,
    extraBrl,
  };
}
