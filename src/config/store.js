export const STORE_DEFAULT_CONFIG = {
  storeEnabled: false,
  storeVisibleToUsers: false,
  acceptingOrders: false,
  vipDiscountPct: 10,
  updatedAt: Date.now(),
};

export function normalizeStoreConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    storeEnabled: c.storeEnabled === true,
    storeVisibleToUsers: c.storeVisibleToUsers === true,
    acceptingOrders: c.acceptingOrders === true,
    vipDiscountPct: Number.isFinite(Number(c.vipDiscountPct)) ? Number(c.vipDiscountPct) : 10,
    updatedAt: Number.isFinite(Number(c.updatedAt)) ? Number(c.updatedAt) : Date.now(),
  };
}

export function productIsVisible(product) {
  if (!product || typeof product !== 'object') return false;
  if (product.isActive === false) return false;
  const stock = Number(product.stock || 0);
  return stock > 0;
}

export function applyVipDiscount(price, product, vipDiscountPct, canUseVip) {
  const base = Number(price || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!canUseVip || product?.isVIPDiscountEnabled !== true) return base;
  const pct = Math.max(0, Math.min(90, Number(vipDiscountPct || 10)));
  return Math.round(base * (1 - pct / 100) * 100) / 100;
}

