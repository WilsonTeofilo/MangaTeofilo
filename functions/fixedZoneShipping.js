/**
 * Frete fixo por UF (tabela comercial) + R$ 2 por unidade adicional + frete grátis condicional.
 * Usado pela loja física e pelo POD «Produzir para mim».
 */

export const SHIPPING_EXTRA_PER_UNIT_BRL = 2;

/** Subtotal do carrinho / pedido (só produtos) — acima disso pode zerar o frete se o valor calculado for baixo. */
export const FREE_SHIPPING_MIN_SUBTOTAL_BRL = 150;

/** Só isenta frete se o valor bruto (base + extras) for até este teto (protege Norte/Nordeste caro). */
export const FREE_SHIPPING_MAX_SHIPPING_BRL = 60;

export const SHIPPING_UNKNOWN_UF_BASE_BRL = 60;

/** Base por UF (R$) — alinhado à tabela operacional. */
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
 * @param {{ state?: string, quantity?: number, cartTotal?: number }} p
 * @returns {{ priceBrl: number, originalPriceBrl: number, discountBrl: number, baseBrl: number, extraBrl: number, freeApplied: boolean }}
 */
export function computeFixedZoneShippingParts(p) {
  const uf = String(p?.state || '').trim().toUpperCase();
  const baseBrl = Number.isFinite(SHIPPING_BASE_BRL_BY_UF[uf])
    ? SHIPPING_BASE_BRL_BY_UF[uf]
    : SHIPPING_UNKNOWN_UF_BASE_BRL;
  const q = Math.max(1, Math.floor(Number(p?.quantity) || 1));
  const extraBrl = Math.max(0, q - 1) * SHIPPING_EXTRA_PER_UNIT_BRL;
  const raw = Math.ceil(Math.max(baseBrl + extraBrl, 0));
  const subtotal = Number(p?.cartTotal || 0);
  const freeApplied =
    subtotal >= FREE_SHIPPING_MIN_SUBTOTAL_BRL && raw <= FREE_SHIPPING_MAX_SHIPPING_BRL;
  const priceBrl = freeApplied ? 0 : raw;
  return {
    priceBrl,
    originalPriceBrl: raw,
    discountBrl: freeApplied ? raw : 0,
    baseBrl,
    extraBrl,
    freeApplied,
  };
}
