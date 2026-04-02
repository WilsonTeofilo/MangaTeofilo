/** Chaves de categoria na loja (UI + RTDB `product.category`) */
export const STORE_CATEGORY_KEYS = {
  MANGA: 'manga',
  VESTUARIO: 'vestuario',
  EXTRAS: 'extras',
};

export const STORE_CATEGORY_LABELS = {
  [STORE_CATEGORY_KEYS.MANGA]: 'Mangás',
  [STORE_CATEGORY_KEYS.VESTUARIO]: 'Vestuário',
  [STORE_CATEGORY_KEYS.EXTRAS]: 'Extras',
};

/** Rótulos da vitrine (ícones discretos). Admin continua usando STORE_CATEGORY_LABELS. */
export const STORE_CATEGORY_TAB_LABELS = {
  all: 'Todos',
  [STORE_CATEGORY_KEYS.MANGA]: '📚 Mangás',
  [STORE_CATEGORY_KEYS.VESTUARIO]: '👕 Vestuário',
  [STORE_CATEGORY_KEYS.EXTRAS]: '🎁 Extras',
};

export const STORE_TYPE_KEYS = {
  MANGA: 'manga',
  ROUPA: 'roupa',
};

export const STORE_DEFAULT_CONFIG = {
  storeEnabled: false,
  storeVisibleToUsers: false,
  acceptingOrders: false,
  vipDiscountPct: 10,
  /** Frete fixo em BRL (fase 1). */
  fixedShippingBrl: 0,
  /** Texto opcional exibido após compra (ex.: benefício no site). */
  postPurchaseThanks: '',
  /** Hero da loja (vitrine marca). */
  heroEyebrow: 'MangaTeofilo · Loja do universo',
  heroTitle: 'KOKUIN COLLECTION',
  heroSubtitle: 'Peças e edições do universo — streetwear, minimal e identidade de marca.',
  updatedAt: Date.now(),
};

export function normalizeStoreConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    storeEnabled: c.storeEnabled === true,
    storeVisibleToUsers: c.storeVisibleToUsers === true,
    acceptingOrders: c.acceptingOrders === true,
    vipDiscountPct: Number.isFinite(Number(c.vipDiscountPct)) ? Number(c.vipDiscountPct) : 10,
    fixedShippingBrl: Number.isFinite(Number(c.fixedShippingBrl))
      ? Math.max(0, Number(c.fixedShippingBrl))
      : 0,
    postPurchaseThanks: typeof c.postPurchaseThanks === 'string' ? c.postPurchaseThanks : '',
    heroEyebrow:
      typeof c.heroEyebrow === 'string' && c.heroEyebrow.trim()
        ? c.heroEyebrow.trim()
        : STORE_DEFAULT_CONFIG.heroEyebrow,
    heroTitle:
      typeof c.heroTitle === 'string' && c.heroTitle.trim()
        ? c.heroTitle.trim()
        : STORE_DEFAULT_CONFIG.heroTitle,
    heroSubtitle:
      typeof c.heroSubtitle === 'string' && c.heroSubtitle.trim()
        ? c.heroSubtitle.trim()
        : STORE_DEFAULT_CONFIG.heroSubtitle,
    updatedAt: Number.isFinite(Number(c.updatedAt)) ? Number(c.updatedAt) : Date.now(),
  };
}

export function productIsVisible(product) {
  if (!product || typeof product !== 'object') return false;
  if (product.isActive === false) return false;
  const stock = Number(product.stock || 0);
  return stock > 0;
}

export function normalizeProductCategory(product) {
  const c = String(product?.category || '').toLowerCase();
  if (c === STORE_CATEGORY_KEYS.VESTUARIO || c === 'roupa') return STORE_CATEGORY_KEYS.VESTUARIO;
  if (c === STORE_CATEGORY_KEYS.EXTRAS) return STORE_CATEGORY_KEYS.EXTRAS;
  return STORE_CATEGORY_KEYS.MANGA;
}

export function applyVipDiscount(price, product, vipDiscountPct, canUseVip) {
  const base = Number(price || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!canUseVip || product?.isVIPDiscountEnabled !== true) return base;
  const pct = Math.max(0, Math.min(90, Number(vipDiscountPct || 10)));
  return Math.round(base * (1 - pct / 100) * 100) / 100;
}

const NEW_BADGE_MS = 14 * 86400000;

/**
 * Badges para card: { key, label }[]
 */
/** Chave de agrupamento na vitrine — só `collection` (ex.: "DROP 01 — TEMPESTUA"). */
export function getProductCollectionKey(product) {
  return String(product?.collection || '').trim();
}

/** Selo opcional no card (ex.: "Limited edition"); não define grupo. */
export function getProductDropLabel(product) {
  return String(product?.dropLabel || '').trim();
}

/**
 * Agrupa produtos por coleção. Sem coleção → grupo "Essenciais".
 * @returns {Array<[string, typeof product[]]>}
 */
export function groupStoreProductsByCollection(products) {
  const map = new Map();
  for (const p of products) {
    const raw = getProductCollectionKey(p);
    const key = raw || '__essenciais';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  const entries = [...map.entries()];
  entries.sort((a, b) => {
    if (a[0] === '__essenciais') return 1;
    if (b[0] === '__essenciais') return -1;
    return a[0].localeCompare(b[0], 'pt');
  });
  return entries;
}

export function getStoreProductBadges(product, now = Date.now()) {
  const badges = [];
  if (!product) return badges;
  if (product.isStoreDemo === true) {
    badges.push({ key: 'demo', label: 'Demo' });
  }
  if (product.isOnSale === true && Number(product.promoPrice) > 0) {
    badges.push({ key: 'promo', label: 'Promo' });
  }
  if (product.isVIPDiscountEnabled === true) {
    badges.push({ key: 'vip', label: 'VIP' });
  }
  const created = Number(product.createdAt || 0);
  if (product.isNew === true || (created > 0 && now - created < NEW_BADGE_MS)) {
    badges.push({ key: 'novo', label: 'Novo' });
  }
  return badges;
}

/** Status do pedido para o leitor (envio manual / Correios). */
export function formatLojaOrderStatusPt(status) {
  const v = String(status || '').toLowerCase();
  if (v === 'pending') return 'Aguardando pagamento';
  if (v === 'paid') return 'Confirmado';
  if (v === 'processing') return 'Preparando envio';
  if (v === 'shipped') return 'Enviado · em trânsito';
  if (v === 'delivered') return 'Entregue';
  if (v === 'cancelled') return 'Cancelado';
  return 'Em andamento';
}

/** URL oficial de rastreio dos Correios (código sem espaços). */
export function correiosRastreamentoUrl(codigo) {
  const c = String(codigo || '').replace(/\s/g, '');
  if (!c) return '';
  return `https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(c)}`;
}
