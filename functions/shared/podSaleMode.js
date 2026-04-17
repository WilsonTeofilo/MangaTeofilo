export const POD_SALE_MODEL_SCOPE = Object.freeze({
  PLATFORM: 'platform',
  PERSONAL: 'personal',
  STORE_PROMO: 'store_promo',
});

export function normalizePodSaleMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === POD_SALE_MODEL_SCOPE.PLATFORM) return POD_SALE_MODEL_SCOPE.PLATFORM;
  if (raw === POD_SALE_MODEL_SCOPE.STORE_PROMO) return POD_SALE_MODEL_SCOPE.STORE_PROMO;
  return POD_SALE_MODEL_SCOPE.PERSONAL;
}

export function buildPodSaleModeOperation(mode) {
  const saleModel = normalizePodSaleMode(mode);
  if (saleModel === POD_SALE_MODEL_SCOPE.PLATFORM) {
    return {
      saleModel,
      touchesCatalog: true,
      touchesProduction: true,
      touchesFinance: true,
      requiresCreatorMonetization: true,
      requiresShippingAddress: false,
      creatorGetsProfit: true,
      financeScope: 'creator_profit',
      catalogScope: 'creator_store_listing',
      productionScope: 'admin_review_then_store_sale',
    };
  }
  if (saleModel === POD_SALE_MODEL_SCOPE.STORE_PROMO) {
    return {
      saleModel,
      touchesCatalog: true,
      touchesProduction: true,
      touchesFinance: true,
      requiresCreatorMonetization: false,
      requiresShippingAddress: false,
      creatorGetsProfit: false,
      financeScope: 'platform_only',
      catalogScope: 'promo_store_listing',
      productionScope: 'admin_review_then_store_sale',
    };
  }
  return {
    saleModel,
    touchesCatalog: false,
    touchesProduction: true,
    touchesFinance: true,
    requiresCreatorMonetization: false,
    requiresShippingAddress: true,
    creatorGetsProfit: false,
    financeScope: 'buyer_only',
    catalogScope: 'none',
    productionScope: 'direct_batch_production',
  };
}
