import {
  computeFixedZoneShippingParts,
  REGIONAL_FREIGHT_DISCOUNT_CAP_BRL,
  REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY,
  REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL,
  REGIONAL_FREIGHT_DISCOUNT_RATE,
} from './fixedZoneShipping.js';
import { STORE_PROMO_ELIGIBILITY_THRESHOLDS as STORE_PROMO_THRESHOLDS } from './promoThresholds.js';

export const SALE_MODEL = {
  PLATFORM: 'platform',
  PERSONAL: 'personal',
  STORE_PROMO: 'store_promo',
};

export const BOOK_FORMAT = {
  TANKOBON: 'tankobon',
  MEIO_TANKO: 'meio_tanko',
};

export const PLATFORM_QUANTITIES = [10, 20, 30];
export const PERSONAL_QUANTITIES = [1, 5, 10, 15, 20, 25, 30];

export const POD_PENDING_PAYMENT_TTL_MS = 24 * 60 * 60 * 1000;
export const POD_PRODUCTION_ORDER_CUTOFF_HOUR_BR = 14;

const POD_PRODUCTION_COSTS = {
  [BOOK_FORMAT.TANKOBON]: { 10: 372, 20: 740, 30: 1104 },
  [BOOK_FORMAT.MEIO_TANKO]: { 10: 235, 20: 466, 30: 690 },
};

const STORE_PROMO_UNIT_BRL = {
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

const POD_APPROVAL_DAYS = 2;
const POD_DELIVERY_BASE_DAYS = 12;

const POD_PRODUCTION_HOURS = {
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

const POD_TEST_UNIT_COST_BRL = 0.5;

const POD_WEIGHT_GRAMS_PER_UNIT = {
  [BOOK_FORMAT.TANKOBON]: 300,
  [BOOK_FORMAT.MEIO_TANKO]: 160,
};

export const POD_ORDER_STATUS = {
  PENDING_PAYMENT: 'pending_payment',
  PAID: 'paid',
  IN_PRODUCTION: 'in_production',
  READY_TO_SHIP: 'ready_to_ship',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
};

export function normalizePodOrderStatusInput(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === POD_ORDER_STATUS.PENDING_PAYMENT || raw === 'pending') {
    return POD_ORDER_STATUS.PENDING_PAYMENT;
  }
  if (raw === POD_ORDER_STATUS.PAID || raw === 'order_received') {
    return POD_ORDER_STATUS.PAID;
  }
  if (raw === POD_ORDER_STATUS.IN_PRODUCTION || raw === 'processing') {
    return POD_ORDER_STATUS.IN_PRODUCTION;
  }
  if (raw === POD_ORDER_STATUS.READY_TO_SHIP) return POD_ORDER_STATUS.READY_TO_SHIP;
  if (raw === POD_ORDER_STATUS.SHIPPED) return POD_ORDER_STATUS.SHIPPED;
  if (raw === POD_ORDER_STATUS.DELIVERED) return POD_ORDER_STATUS.DELIVERED;
  if (raw === POD_ORDER_STATUS.CANCELLED || raw === 'canceled') return POD_ORDER_STATUS.CANCELLED;
  return raw;
}

export const POD_PRODUCTION_CHECKLIST = [
  { key: 'printMiolo', label: 'Imprimir miolo' },
  { key: 'printCapa', label: 'Imprimir capa' },
  { key: 'organizePaginas', label: 'Organizar paginas' },
  { key: 'colarLombada', label: 'Colar lombada' },
  { key: 'prensar', label: 'Prensar' },
  { key: 'cortar', label: 'Cortar' },
  { key: 'finalizar', label: 'Finalizar' },
];

export const PRODUCTION_CHECKLIST_KEYS = POD_PRODUCTION_CHECKLIST.map((item) => item.key);

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function computePlatformCreatorProfit(unitPrice, baseCost) {
  const margin = Math.max(0, Number(unitPrice || 0) - Number(baseCost || 0));
  return {
    creator: Math.round(margin * 100) / 100,
    margin: Math.round(margin * 100) / 100,
  };
}

export function productionDays(saleModel, format, quantity) {
  const qty = Math.max(1, Number(quantity) || 1);
  const hoursCfg = POD_PRODUCTION_HOURS[format] || POD_PRODUCTION_HOURS[BOOK_FORMAT.TANKOBON];
  const totalHours =
    qty * hoursCfg.hoursPerUnit +
    (saleModel === SALE_MODEL.PLATFORM || saleModel === SALE_MODEL.STORE_PROMO
      ? hoursCfg.platformBatchOverheadHours
      : hoursCfg.personalBatchOverheadHours);

  if (saleModel === SALE_MODEL.PLATFORM || saleModel === SALE_MODEL.STORE_PROMO) {
    return {
      low: POD_APPROVAL_DAYS,
      high: POD_APPROVAL_DAYS,
      totalHours: 0,
      productionHours: Math.round(totalHours * 10) / 10,
      kind: 'approval',
    };
  }

  const low = Math.max(2, Math.ceil(totalHours / 8) + 1);
  const high = Math.max(low + 1, Math.ceil(totalHours / 6) + 2);
  return {
    low: low + POD_DELIVERY_BASE_DAYS,
    high: high + POD_DELIVERY_BASE_DAYS,
    totalHours: Math.round(totalHours * 10) / 10,
    productionHours: Math.round(totalHours * 10) / 10,
    kind: 'delivery',
  };
}

export function getProductionDaysRange(saleModel, format, quantity) {
  return productionDays(saleModel, format, quantity);
}

export function computePlatformOrder(format, quantity, unitSalePrice) {
  const qty = Number(quantity);
  const retail = PLATFORM_RETAIL_UNIT_BRL[format];
  const productionCost = POD_PRODUCTION_COSTS[format]?.[qty];
  if (!retail || productionCost == null) return null;
  const unit = clamp(Number(unitSalePrice), retail.min, retail.max);
  const profit = computePlatformCreatorProfit(unit, retail.baseCost);
  return {
    productionCostTotalBRL: productionCost,
    amountDueBRL: productionCost,
    unitSalePriceBRL: unit,
    unitProductionCostBRL: retail.baseCost,
    creatorProfitPerSoldUnitBRL: profit.creator,
    creatorProfitTotalIfAllSoldBRL: Math.round(profit.creator * qty * 100) / 100,
    grossRetailTotalBRL: Math.round(unit * qty * 100) / 100,
    shippingNote:
      'Sem frete nesta etapa. Depois do pagamento, o admin tem ate 2 dias uteis para aprovar e liberar o produto na loja.',
    creatorProductKind: 'monetized',
  };
}

export function computeStorePromoOrder(format, quantity) {
  const qty = Number(quantity);
  const productionCost = POD_PRODUCTION_COSTS[format]?.[qty];
  const unitPrice = STORE_PROMO_UNIT_BRL[format];
  const retail = PLATFORM_RETAIL_UNIT_BRL[format];
  if (productionCost == null || unitPrice == null || !retail) return null;
  return {
    productionCostTotalBRL: productionCost,
    amountDueBRL: productionCost,
    unitSalePriceBRL: unitPrice,
    unitProductionCostBRL: retail.baseCost,
    creatorProfitPerSoldUnitBRL: 0,
    creatorProfitTotalIfAllSoldBRL: 0,
    grossRetailTotalBRL: Math.round(unitPrice * qty * 100) / 100,
    shippingNote:
      'Modo divulgacao: preco fixo na loja, sem repasse. Apos o pagamento, o admin analisa antes de liberar na vitrine.',
    creatorProductKind: 'non_monetized_promo',
  };
}

export function computePersonalOrder(format, quantity) {
  const qty = Number(quantity);
  const personal = PERSONAL_UNIT_BRL[format];
  if (!personal || !PERSONAL_QUANTITIES.includes(qty)) return null;

  if (qty === 1) {
    const grams = POD_WEIGHT_GRAMS_PER_UNIT[format] || 300;
    return {
      unitCostBRL: POD_TEST_UNIT_COST_BRL,
      creatorUnitPriceBRL: POD_TEST_UNIT_COST_BRL,
      goodsTotalBRL: POD_TEST_UNIT_COST_BRL,
      platformProfitIncludedTotalBRL: 0,
      amountDueBRL: POD_TEST_UNIT_COST_BRL,
      freeShipping: false,
      freeShippingAt: personal.freeShippingAt,
      creatorProductKind: 'personal_purchase',
      weightGramsPerUnit: grams,
      weightGramsTotal: grams,
      personalTestSingleUnit: true,
      shippingNote:
        'Pedido de teste (1 un. a R$ 0,50): em dev use UF WT para frete de teste quando habilitado.',
    };
  }

  const goodsTotal = Math.round(personal.unitCost * qty * 100) / 100;
  const platformProfitIncludedTotal = Math.round(personal.platformProfitIncluded * qty * 100) / 100;
  const freeShipping = qty >= Number(personal.freeShippingAt || 999);
  const grams = POD_WEIGHT_GRAMS_PER_UNIT[format] || 300;

  return {
    unitCostBRL: personal.unitCost,
    creatorUnitPriceBRL: personal.unitCost,
    goodsTotalBRL: goodsTotal,
    platformProfitIncludedTotalBRL: platformProfitIncludedTotal,
    amountDueBRL: goodsTotal,
    freeShipping,
    freeShippingAt: personal.freeShippingAt,
    creatorProductKind: 'personal_purchase',
    weightGramsPerUnit: grams,
    weightGramsTotal: Math.round(grams * qty),
    shippingNote: freeShipping
      ? `Frete gratis a partir de ${personal.freeShippingAt} unidades. O prazo abaixo ja considera producao + entrega.`
      : `Frete a parte: abaixo de ${personal.freeShippingAt} unidades o frete e cobrado separadamente.`,
  };
}

export function formatBRL(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
}

function sumWorkMetricsFromCaps(capsVal, workId) {
  let views = 0;
  let likes = 0;
  const wid = String(workId || '').trim();
  if (!wid || !capsVal || typeof capsVal !== 'object') return { views, likes };
  for (const row of Object.values(capsVal)) {
    const cap = row && typeof row === 'object' ? row : {};
    if (String(cap.obraId || cap.workId || '').trim() !== wid) continue;
    views += Number(cap.viewsCount ?? cap.visualizacoes ?? 0);
    likes += Number(cap.likesCount ?? cap.curtidas ?? 0);
  }
  return { views, likes };
}

export function computeStorePromoEligibilityClient({ obra, workId, capsVal, followersCount }) {
  const thresholds = STORE_PROMO_THRESHOLDS;
  const wid = String(workId || '').trim();
  if (!obra || !wid) {
    return {
      ok: false,
      followers: Math.max(0, Number(followersCount) || 0),
      views: 0,
      likes: 0,
      thresholds,
    };
  }
  const caps = sumWorkMetricsFromCaps(capsVal, wid);
  const views = Number(obra.viewsCount ?? obra.visualizacoes ?? 0) + caps.views;
  const likes =
    Number(obra.likesCount ?? obra.curtidas ?? obra.favoritesCount ?? 0) + caps.likes;
  const followers = Math.max(0, Number(followersCount) || 0);
  return {
    ok:
      followers >= thresholds.followers &&
      views >= thresholds.views &&
      likes >= thresholds.likes,
    followers,
    views,
    likes,
    thresholds,
  };
}

export {
  computeFixedZoneShippingParts,
  REGIONAL_FREIGHT_DISCOUNT_CAP_BRL,
  REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY,
  REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL,
  REGIONAL_FREIGHT_DISCOUNT_RATE,
  STORE_PROMO_THRESHOLDS,
};
