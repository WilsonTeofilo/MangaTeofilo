import {
  computeFixedZoneShippingParts as computeFixedZoneShippingPartsImported,
  FREE_SHIPPING_MAX_SHIPPING_BRL,
  FREE_SHIPPING_MIN_SUBTOTAL_BRL,
} from './fixedZoneShipping.js';

export const SALE_MODEL = {
  PLATFORM: 'platform',
  PERSONAL: 'personal',
  /** Vitrine com preço fixo; criador não monetizado não recebe repasse. */
  STORE_PROMO: 'store_promo',
};

export const BOOK_FORMAT = {
  TANKOBON: 'tankobon',
  MEIO_TANKO: 'meio_tanko',
};

export const PLATFORM_BATCH_COST_TOTAL_BRL = {
  [BOOK_FORMAT.TANKOBON]: { 10: 372, 20: 740, 30: 1104 },
  [BOOK_FORMAT.MEIO_TANKO]: { 10: 235, 20: 466, 30: 690 },
};

export const PLATFORM_QUANTITIES = [10, 20, 30];
export const PERSONAL_QUANTITIES = [5, 10, 15, 20, 25, 30];

/** Preço fixo na loja (sem repasse ao criador). */
export const STORE_PROMO_FIXED_RETAIL_UNIT_BRL = {
  [BOOK_FORMAT.TANKOBON]: 43,
  [BOOK_FORMAT.MEIO_TANKO]: 26.5,
};

export const PLATFORM_RETAIL_UNIT_BRL = {
  [BOOK_FORMAT.TANKOBON]: { baseCost: 37.2, defaultPrice: 56, min: 46, max: 70 },
  [BOOK_FORMAT.MEIO_TANKO]: { baseCost: 23.5, defaultPrice: 36, min: 30, max: 43 },
};

export const PERSONAL_UNIT_BRL = {
  [BOOK_FORMAT.TANKOBON]: { unitCost: 34.7, platformProfitIncluded: 16.5, freeShippingAt: 10 },
  [BOOK_FORMAT.MEIO_TANKO]: { unitCost: 22.5, platformProfitIncluded: 12, freeShippingAt: 10 },
};

export const PLATFORM_APPROVAL_SLA_DAYS = 2;
export const PERSONAL_DELIVERY_BUFFER_DAYS = 12;

/** Reserva do checkout: 3 horas para concluir pagamento (cancelamento automático depois). */
export const POD_PENDING_PAYMENT_TTL_MS = 3 * 60 * 60 * 1000;

export { computeFixedZoneShippingPartsImported as computeFixedZoneShippingParts };
export { FREE_SHIPPING_MIN_SUBTOTAL_BRL, FREE_SHIPPING_MAX_SHIPPING_BRL };

/** Subtotal mínimo (só produtos) para poder isentar frete quando o valor calculado por UF for baixo. */
export const PERSONAL_ORDER_SUBTOTAL_FREE_SHIPPING_BRL = FREE_SHIPPING_MIN_SUBTOTAL_BRL;

/** Frete modo «Produzir para mim»: tabela fixa por UF + R$ 2/unidade extra + regra de grátis condicional. */
export function quotePersonalDeliveryShippingBRL(uf, quantity, goodsSubtotal) {
  return computeFixedZoneShippingPartsImported({
    state: uf,
    quantity,
    cartTotal: goodsSubtotal,
  }).priceBrl;
}

const WEIGHT_GRAMS_PER_UNIT = {
  [BOOK_FORMAT.TANKOBON]: 300,
  [BOOK_FORMAT.MEIO_TANKO]: 160,
};

const PRODUCTION_TIME_RULES = {
  [BOOK_FORMAT.TANKOBON]: {
    hoursPerUnit: 4,
    platformBatchOverheadHours: 4,
    personalBatchOverheadHours: 2,
  },
  [BOOK_FORMAT.MEIO_TANKO]: {
    hoursPerUnit: 3,
    platformBatchOverheadHours: 3,
    personalBatchOverheadHours: 1.5,
  },
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function computePlatformCreatorProfit(unitSalePrice, catalogBaseCost) {
  const margin = Math.max(0, Number(unitSalePrice || 0) - Number(catalogBaseCost || 0));
  return {
    creator: Math.round(margin * 100) / 100,
    margin: Math.round(margin * 100) / 100,
  };
}

export function productionDays(saleModel, format, quantity) {
  const qty = Math.max(1, Number(quantity) || 1);
  const rules = PRODUCTION_TIME_RULES[format] || PRODUCTION_TIME_RULES[BOOK_FORMAT.TANKOBON];
  const totalHours =
    qty * rules.hoursPerUnit +
    (saleModel === SALE_MODEL.PLATFORM || saleModel === SALE_MODEL.STORE_PROMO
      ? rules.platformBatchOverheadHours
      : rules.personalBatchOverheadHours);
  if (saleModel === SALE_MODEL.PLATFORM || saleModel === SALE_MODEL.STORE_PROMO) {
    return {
      low: PLATFORM_APPROVAL_SLA_DAYS,
      high: PLATFORM_APPROVAL_SLA_DAYS,
      totalHours: 0,
      productionHours: Math.round(totalHours * 10) / 10,
      kind: 'approval',
    };
  }
  const productionLow = Math.max(2, Math.ceil(totalHours / 8) + 1);
  const productionHigh = Math.max(productionLow + 1, Math.ceil(totalHours / 6) + 2);
  return {
    low: productionLow + PERSONAL_DELIVERY_BUFFER_DAYS,
    high: productionHigh + PERSONAL_DELIVERY_BUFFER_DAYS,
    totalHours: Math.round(totalHours * 10) / 10,
    productionHours: Math.round(totalHours * 10) / 10,
    kind: 'delivery',
  };
}

export function computePlatformOrder(format, quantity, unitSalePriceBRL) {
  const qty = Number(quantity);
  const retail = PLATFORM_RETAIL_UNIT_BRL[format];
  const batchTotal = PLATFORM_BATCH_COST_TOTAL_BRL[format]?.[qty];
  if (!retail || batchTotal == null) return null;
  const unit = clamp(Number(unitSalePriceBRL), retail.min, retail.max);
  const creatorProfit = computePlatformCreatorProfit(unit, retail.baseCost);
  return {
    productionCostTotalBRL: batchTotal,
    amountDueBRL: batchTotal,
    unitSalePriceBRL: unit,
    unitProductionCostBRL: retail.baseCost,
    creatorProfitPerSoldUnitBRL: creatorProfit.creator,
    creatorProfitTotalIfAllSoldBRL: Math.round(creatorProfit.creator * qty * 100) / 100,
    grossRetailTotalBRL: Math.round(unit * qty * 100) / 100,
    shippingNote: 'Sem frete nesta etapa. Depois do pagamento, o admin tem ate 2 dias uteis para aprovar e liberar o produto na loja.',
    creatorProductKind: 'monetized',
  };
}

export function computeStorePromoOrder(format, quantity) {
  const qty = Number(quantity);
  const batchTotal = PLATFORM_BATCH_COST_TOTAL_BRL[format]?.[qty];
  const unitFixed = STORE_PROMO_FIXED_RETAIL_UNIT_BRL[format];
  const retail = PLATFORM_RETAIL_UNIT_BRL[format];
  if (batchTotal == null || unitFixed == null || !retail) return null;
  return {
    productionCostTotalBRL: batchTotal,
    amountDueBRL: batchTotal,
    unitSalePriceBRL: unitFixed,
    unitProductionCostBRL: retail.baseCost,
    creatorProfitPerSoldUnitBRL: 0,
    creatorProfitTotalIfAllSoldBRL: 0,
    grossRetailTotalBRL: Math.round(unitFixed * qty * 100) / 100,
    shippingNote:
      'Modo divulgacao: preco fixo na loja, sem repasse. Apos o pagamento, o admin analisa antes de liberar na vitrine.',
    creatorProductKind: 'non_monetized_promo',
  };
}

export function computePersonalOrder(format, quantity) {
  const qty = Number(quantity);
  const row = PERSONAL_UNIT_BRL[format];
  if (!row || !PERSONAL_QUANTITIES.includes(qty)) return null;
  const goodsTotal = Math.round(row.unitCost * qty * 100) / 100;
  const platformProfitIncludedTotal = Math.round(row.platformProfitIncluded * qty * 100) / 100;
  const freeShipping = qty >= Number(row.freeShippingAt || 999);
  const wUnit = WEIGHT_GRAMS_PER_UNIT[format] || 300;
  return {
    unitCostBRL: row.unitCost,
    creatorUnitPriceBRL: row.unitCost,
    goodsTotalBRL: goodsTotal,
    platformProfitIncludedTotalBRL: platformProfitIncludedTotal,
    amountDueBRL: goodsTotal,
    freeShipping,
    freeShippingAt: row.freeShippingAt,
    creatorProductKind: 'personal_purchase',
    weightGramsPerUnit: wUnit,
    weightGramsTotal: Math.round(wUnit * qty),
    shippingNote: freeShipping
      ? `Frete gratis a partir de ${row.freeShippingAt} unidades. O prazo abaixo ja considera producao + entrega.`
      : `Frete a parte: abaixo de ${row.freeShippingAt} unidades o frete e cobrado separadamente.`,
  };
}
