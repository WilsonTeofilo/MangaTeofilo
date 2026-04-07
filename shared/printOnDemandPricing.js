/**
 * Print-on-demand (mangá físico): mesma fonte no app (Vite) e nas Cloud Functions.
 */

import {
  computeFixedZoneShippingParts,
  FREE_SHIPPING_MAX_SHIPPING_BRL,
  FREE_SHIPPING_MIN_SUBTOTAL_BRL,
  REGIONAL_FREIGHT_DISCOUNT_CAP_BRL,
  REGIONAL_FREIGHT_DISCOUNT_ELIGIBLE_UFS,
  REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY,
  REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL,
  REGIONAL_FREIGHT_DISCOUNT_RATE,
} from './fixedZoneShipping.js';
import { STORE_PROMO_ELIGIBILITY_THRESHOLDS } from './promoThresholds.js';

export const SALE_MODEL = {
  PLATFORM: 'platform',
  PERSONAL: 'personal',
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
export const PERSONAL_QUANTITIES = [1, 5, 10, 15, 20, 25, 30];

export const PERSONAL_TEST_SINGLE_UNIT_GOODS_BRL = 0.5;

export const STORE_PROMO_FIXED_RETAIL_UNIT_BRL = {
  [BOOK_FORMAT.TANKOBON]: 43,
  [BOOK_FORMAT.MEIO_TANKO]: 26.5,
};

/** Metas vitrine POD — alinhado a `creatorProgression` Nível 1 via `shared/promoThresholds.js`. */
export const STORE_PROMO_THRESHOLDS = STORE_PROMO_ELIGIBILITY_THRESHOLDS;

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

export const POD_PENDING_PAYMENT_TTL_MS = 3 * 60 * 60 * 1000;

export const PRODUCTION_TIME_RULES = {
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

export const POD_PRODUCTION_ORDER_CUTOFF_HOUR_BR = 14;

export const POD_ORDER_STATUS = {
  PENDING_PAYMENT: 'pending_payment',
  PAID: 'paid',
  IN_PRODUCTION: 'in_production',
  READY_TO_SHIP: 'ready_to_ship',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
};

export function normalizePodOrderStatusInput(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === POD_ORDER_STATUS.PENDING_PAYMENT || raw === 'pending') return POD_ORDER_STATUS.PENDING_PAYMENT;
  if (raw === POD_ORDER_STATUS.PAID || raw === 'order_received') return POD_ORDER_STATUS.PAID;
  if (raw === POD_ORDER_STATUS.IN_PRODUCTION || raw === 'processing') return POD_ORDER_STATUS.IN_PRODUCTION;
  if (raw === POD_ORDER_STATUS.READY_TO_SHIP) return POD_ORDER_STATUS.READY_TO_SHIP;
  if (raw === POD_ORDER_STATUS.SHIPPED) return POD_ORDER_STATUS.SHIPPED;
  if (raw === POD_ORDER_STATUS.DELIVERED) return POD_ORDER_STATUS.DELIVERED;
  if (raw === POD_ORDER_STATUS.CANCELLED) return POD_ORDER_STATUS.CANCELLED;
  return raw;
}

export const PRODUCTION_CHECKLIST_KEYS = [
  { key: 'printMiolo', label: 'Imprimir miolo' },
  { key: 'printCapa', label: 'Imprimir capa' },
  { key: 'organizePaginas', label: 'Organizar paginas' },
  { key: 'colarLombada', label: 'Colar lombada' },
  { key: 'prensar', label: 'Prensar' },
  { key: 'cortar', label: 'Cortar' },
  { key: 'finalizar', label: 'Finalizar' },
];

export {
  computeFixedZoneShippingParts,
  FREE_SHIPPING_MIN_SUBTOTAL_BRL,
  FREE_SHIPPING_MAX_SHIPPING_BRL,
  REGIONAL_FREIGHT_DISCOUNT_CAP_BRL,
  REGIONAL_FREIGHT_DISCOUNT_ELIGIBLE_UFS,
  REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY,
  REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL,
  REGIONAL_FREIGHT_DISCOUNT_RATE,
};

const WEIGHT_GRAMS_PER_UNIT = {
  [BOOK_FORMAT.TANKOBON]: 300,
  [BOOK_FORMAT.MEIO_TANKO]: 160,
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

/** Alias usado no front (mesmo retorno que `productionDays`). */
export function getProductionDaysRange(saleModel, format, quantity) {
  return productionDays(saleModel, format, quantity);
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
  if (qty === 1) {
    const wUnit = WEIGHT_GRAMS_PER_UNIT[format] || 300;
    const g = PERSONAL_TEST_SINGLE_UNIT_GOODS_BRL;
    return {
      unitCostBRL: g,
      creatorUnitPriceBRL: g,
      goodsTotalBRL: g,
      platformProfitIncludedTotalBRL: 0,
      amountDueBRL: g,
      freeShipping: false,
      freeShippingAt: row.freeShippingAt,
      creatorProductKind: 'personal_purchase',
      weightGramsPerUnit: wUnit,
      weightGramsTotal: wUnit,
      personalTestSingleUnit: true,
      shippingNote:
        'Pedido de teste (1 un. a R$ 0,50): em dev use UF WT para frete de teste quando habilitado.',
    };
  }
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

export function formatBRL(n) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);
}

export function aggregateChapterStatsForWork(capsVal, workId) {
  let views = 0;
  let likes = 0;
  const wid = String(workId || '').trim();
  if (!wid || !capsVal || typeof capsVal !== 'object') return { views, likes };
  for (const row of Object.values(capsVal)) {
    const cap = row && typeof row === 'object' ? row : {};
    const oid = String(cap.obraId || cap.workId || '').trim();
    if (oid !== wid) continue;
    views += Number(cap.viewsCount ?? cap.visualizacoes ?? 0);
    likes += Number(cap.likesCount ?? cap.curtidas ?? 0);
  }
  return { views, likes };
}

export function computeStorePromoEligibilityClient({ obra, workId, capsVal, followersCount }) {
  const t = STORE_PROMO_THRESHOLDS;
  const wid = String(workId || '').trim();
  if (!obra || !wid) {
    return {
      ok: false,
      followers: Math.max(0, Number(followersCount) || 0),
      views: 0,
      likes: 0,
      thresholds: t,
    };
  }
  const chap = aggregateChapterStatsForWork(capsVal, wid);
  const views =
    Number(obra.viewsCount ?? obra.visualizacoes ?? 0) + chap.views;
  const likes =
    Number(obra.likesCount ?? obra.curtidas ?? obra.favoritesCount ?? 0) + chap.likes;
  const followers = Math.max(0, Number(followersCount) || 0);
  const ok = followers >= t.followers && views >= t.views && likes >= t.likes;
  return { ok, followers, views, likes, thresholds: t };
}
