import {
  normalizeProductCategory,
  STORE_CATEGORY_KEYS,
  STORE_TYPE_KEYS,
} from '../../config/store';

export const SHIPPING_MODE = {
  FIXED: 'fixed',
  REGION: 'region',
  API: 'api',
};

export const INVENTORY_MODE = {
  ON_DEMAND: 'on_demand',
  FIXED: 'fixed',
};

export const EMPTY_PRODUCT = {
  title: '',
  description: '',
  price: 0,
  costPrice: 0,
  weightGrams: 450,
  stock: 0,
  imagesText: '',
  isActive: true,
  isOnSale: false,
  promoPrice: 0,
  isVIPDiscountEnabled: true,
  type: STORE_TYPE_KEYS.MANGA,
  category: STORE_CATEGORY_KEYS.MANGA,
  obra: '',
  collection: '',
  dropLabel: '',
  creatorId: '',
  sizesText: '',
  isNew: false,
  shippingMode: SHIPPING_MODE.API,
  freeShippingThresholdBrl: 150,
  regionShippingText: 'sudeste: 25\nsul: 30\ncentro-oeste: 35\nnordeste: 45\nnorte: 60',
  inventoryMode: INVENTORY_MODE.ON_DEMAND,
  mioloPdfUrl: '',
  coverSourceUrl: '',
};

export function parseImages(text) {
  return String(text || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseSizes(text) {
  return String(text || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseRegionShipping(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((acc, line) => {
      const [regionRaw, valueRaw = ''] = line.split(':');
      const region = String(regionRaw || '').trim().toLowerCase();
      const value = Number(String(valueRaw || '').replace(',', '.').trim());
      if (!region || !Number.isFinite(value) || value < 0) return acc;
      acc[region] = Math.round(value * 100) / 100;
      return acc;
    }, {});
}

export function regionShippingToText(regionalShipping) {
  return Object.entries(regionalShipping || {})
    .map(([region, value]) => `${region}: ${Number(value || 0).toFixed(2)}`)
    .join('\n');
}

export function formatBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function orderBelongsToCreator(order, creatorUid) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.some((item) => String(item?.creatorId || '').trim() === creatorUid);
}

export function creatorOrderTotal(order, creatorUid) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.reduce((sum, item) => {
    if (String(item?.creatorId || '').trim() !== creatorUid) return sum;
    return sum + Number(item?.lineTotal || 0);
  }, 0);
}

export function buildProductPayload(form, { isMangaka, creatorUid, config }) {
  const now = Date.now();
  const images = parseImages(form.imagesText);
  const sizes = parseSizes(form.sizesText);
  const type = String(form.type || STORE_TYPE_KEYS.MANGA).toLowerCase();
  const category = normalizeProductCategory({ category: form.category });
  const regionalShipping = parseRegionShipping(form.regionShippingText);

  return {
    title: String(form.title || '').trim(),
    description: String(form.description || '').trim(),
    price: Number(form.price || 0),
    costPrice: Math.max(0, Number(form.costPrice || 0)),
    weightGrams: Math.max(0, Number(form.weightGrams || 0)),
    stock:
      form.inventoryMode === INVENTORY_MODE.ON_DEMAND
        ? 9999
        : Math.max(0, Number(form.stock || 0)),
    images,
    isActive: form.isActive === true,
    isOnSale: form.isOnSale === true,
    promoPrice: Number(form.promoPrice || 0),
    isVIPDiscountEnabled: form.isVIPDiscountEnabled === true,
    type: type === STORE_TYPE_KEYS.ROUPA ? STORE_TYPE_KEYS.ROUPA : STORE_TYPE_KEYS.MANGA,
    category,
    obra: String(form.obra || '').trim(),
    collection: String(form.collection || '').trim(),
    dropLabel: String(form.dropLabel || '').trim(),
    creatorId: isMangaka ? creatorUid : String(form.creatorId || '').trim() || null,
    sizes: type === STORE_TYPE_KEYS.ROUPA ? sizes : [],
    isNew: form.isNew === true,
    shippingMode: Object.values(SHIPPING_MODE).includes(form.shippingMode)
      ? form.shippingMode
      : SHIPPING_MODE.API,
    freeShippingThresholdBrl: Math.max(
      0,
      Number(form.freeShippingThresholdBrl || config?.freeShippingThresholdBrl || 150)
    ),
    regionalShipping,
    inventoryMode:
      form.inventoryMode === INVENTORY_MODE.FIXED ? INVENTORY_MODE.FIXED : INVENTORY_MODE.ON_DEMAND,
    internalFiles: {
      mioloPdfUrl: String(form.mioloPdfUrl || '').trim(),
      coverSourceUrl: String(form.coverSourceUrl || '').trim(),
    },
    updatedAt: now,
  };
}

export function productToFormState(p, config, { isMangaka, creatorUid }) {
  return {
    title: p.title || '',
    description: p.description || '',
    price: Number(p.price || 0),
    costPrice: Number(p.costPrice || 0),
    weightGrams: Number(p.weightGrams || 450),
    stock: Number(p.stock || 0),
    imagesText: Array.isArray(p.images) ? p.images.join('\n') : '',
    isActive: p.isActive !== false,
    isOnSale: p.isOnSale === true,
    promoPrice: Number(p.promoPrice || 0),
    isVIPDiscountEnabled: p.isVIPDiscountEnabled !== false,
    type:
      String(p.type || STORE_TYPE_KEYS.MANGA).toLowerCase() === STORE_TYPE_KEYS.ROUPA
        ? STORE_TYPE_KEYS.ROUPA
        : STORE_TYPE_KEYS.MANGA,
    category: normalizeProductCategory(p),
    obra: String(p.obra || ''),
    collection: String(p.collection || ''),
    dropLabel: String(p.dropLabel || ''),
    creatorId: isMangaka ? creatorUid : String(p.creatorId || ''),
    sizesText: Array.isArray(p.sizes) ? p.sizes.join(', ') : '',
    isNew: p.isNew === true,
    shippingMode: Object.values(SHIPPING_MODE).includes(p.shippingMode) ? p.shippingMode : SHIPPING_MODE.API,
    freeShippingThresholdBrl: Number(p.freeShippingThresholdBrl || config?.freeShippingThresholdBrl || 150),
    regionShippingText: regionShippingToText(p.regionalShipping),
    inventoryMode:
      String(p.inventoryMode || '').toLowerCase() === INVENTORY_MODE.FIXED
        ? INVENTORY_MODE.FIXED
        : INVENTORY_MODE.ON_DEMAND,
    mioloPdfUrl: String(p.internalFiles?.mioloPdfUrl || ''),
    coverSourceUrl: String(p.internalFiles?.coverSourceUrl || ''),
  };
}
