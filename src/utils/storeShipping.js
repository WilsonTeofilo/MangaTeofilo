/**
 * Frete da loja: tabela por região + peso (PAC/SEDEX). Não é integração contratual com a API dos Correios;
 * o desenho permite plugar cotação oficial ou contrato depois sem mudar o fluxo do checkout.
 */
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

function weightUnits(weightGrams) {
  const weight = Math.max(0, Number(weightGrams || 0));
  return Math.max(1, Math.ceil(weight / 1000));
}

function regionalBaseFromProduct(product, regionKey, serviceCode, normalizedRegions) {
  const regional = product?.regionalShipping && typeof product.regionalShipping === 'object' ? product.regionalShipping : {};
  const pacBase = Number(regional[regionKey]);
  if (Number.isFinite(pacBase) && pacBase >= 0) {
    return serviceCode === 'SEDEX' ? pacBase * 1.35 : pacBase;
  }
  const region = normalizedRegions[regionKey] || normalizedRegions.sudeste;
  return serviceCode === 'SEDEX' ? region.sedexBase : region.pacBase;
}

function lineShippingCost(product, quantity, regionKey, serviceCode, config, normalizedRegions) {
  const region = normalizedRegions[regionKey] || normalizedRegions.sudeste;
  const shippingMode = String(product?.shippingMode || 'fixed').toLowerCase();
  const weightGrams = Math.max(1, Number(product?.weightGrams || 450)) * Math.max(1, Number(quantity || 1));
  const units = weightUnits(weightGrams);

  if (shippingMode === 'region') {
    const base = regionalBaseFromProduct(product, regionKey, serviceCode, normalizedRegions);
    return {
      priceBrl: round2(base + Math.max(0, units - 1) * (serviceCode === 'SEDEX' ? 4.5 : 3.25)),
      deliveryDays: serviceCode === 'SEDEX' ? region.sedexDays : region.pacDays,
      weightGrams,
    };
  }

  if (shippingMode === 'api') {
    const base = serviceCode === 'SEDEX' ? region.sedexBase : region.pacBase;
    const perKg = serviceCode === 'SEDEX' ? region.sedexPerKg : region.pacPerKg;
    return {
      priceBrl: round2(base + Math.max(0, units - 1) * perKg),
      deliveryDays: serviceCode === 'SEDEX' ? region.sedexDays : region.pacDays,
      weightGrams,
    };
  }

  const fixed = Math.max(0, Number(config?.fixedShippingBrl || 0));
  return {
    priceBrl: round2((serviceCode === 'SEDEX' ? fixed * 1.4 : fixed) + Math.max(0, units - 1) * (serviceCode === 'SEDEX' ? 5 : 3.5)),
    deliveryDays: serviceCode === 'SEDEX' ? Math.max(2, region.sedexDays) : Math.max(4, region.pacDays),
    weightGrams,
  };
}

export function buildStoreShippingQuote({ items, productsById, config, buyerProfile, subtotal }) {
  const normalizedRegions = normalizeShippingRegions(config?.shippingRegions);
  const regionKey = detectShippingRegionFromState(buyerProfile?.state);
  const region = normalizedRegions[regionKey] || normalizedRegions.sudeste;
  const options = Object.keys(STORE_SHIPPING_SERVICES).map((serviceCode) => {
    let originalPriceBrl = 0;
    let totalWeightGrams = 0;
    let maxDays = 0;

    for (const item of items || []) {
      const product = productsById?.[item.productId];
      if (!product) continue;
      const line = lineShippingCost(product, item.quantity, regionKey, serviceCode, config, normalizedRegions);
      originalPriceBrl += line.priceBrl;
      totalWeightGrams += line.weightGrams;
      maxDays = Math.max(maxDays, line.deliveryDays);
    }

    const freeThreshold = Math.max(0, Number(config?.freeShippingThresholdBrl || 0));
    const discountBrl = Number(subtotal || 0) >= freeThreshold ? round2(originalPriceBrl) : 0;
    return {
      serviceCode,
      label: STORE_SHIPPING_SERVICES[serviceCode].label,
      regionKey,
      regionLabel: region.label,
      totalWeightGrams,
      originalPriceBrl: round2(originalPriceBrl),
      discountBrl,
      priceBrl: round2(Math.max(0, originalPriceBrl - discountBrl)),
      internalCostBrl: round2(originalPriceBrl),
      deliveryDays: maxDays || (serviceCode === 'SEDEX' ? region.sedexDays : region.pacDays),
    };
  });

  return {
    regionKey,
    regionLabel: region.label,
    options,
    defaultServiceCode: options[0]?.serviceCode || 'PAC',
  };
}
