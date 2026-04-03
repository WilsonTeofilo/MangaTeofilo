const KEY = 'mangateofilo_cart_v1';

export const CART_CHANGED_EVENT = 'mangateofilo:cart';

function notifyCartChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT));
}

function lineKey(productId, size) {
  return `${String(productId || '')}::${String(size || '')}`;
}

function parseStored(raw) {
  try {
    const data = JSON.parse(raw || '[]');
    if (!Array.isArray(data)) return [];
    return data
      .map((item) => ({
        productId: String(item?.productId || ''),
        quantity: Math.max(1, Number(item?.quantity || 1)),
        size: item?.size != null ? String(item.size).trim() : '',
      }))
      .filter((item) => item.productId);
  } catch {
    return [];
  }
}

export function getCartItems() {
  return parseStored(localStorage.getItem(KEY));
}

export function setCartItems(items) {
  localStorage.setItem(KEY, JSON.stringify(items || []));
  notifyCartChanged();
}

/**
 * @param {string} productId
 * @param {number} [quantity]
 * @param {{ size?: string }} [opts]
 */
export function addToCart(productId, quantity = 1, opts = {}) {
  const q = Math.max(1, Number(quantity || 1));
  const size = opts?.size != null ? String(opts.size).trim() : '';
  const items = getCartItems();
  const idx = items.findIndex((i) => lineKey(i.productId, i.size) === lineKey(productId, size));
  if (idx >= 0) {
    items[idx] = { ...items[idx], quantity: items[idx].quantity + q };
  } else {
    items.push({ productId, quantity: q, size });
  }
  setCartItems(items);
  return items;
}

export function removeFromCart(productId, size = '') {
  const items = getCartItems().filter((i) => lineKey(i.productId, i.size) !== lineKey(productId, size));
  setCartItems(items);
  return items;
}

export function updateCartQuantity(productId, quantity, size = '') {
  const q = Math.max(1, Number(quantity || 1));
  const items = getCartItems().map((i) =>
    lineKey(i.productId, i.size) === lineKey(productId, size) ? { ...i, quantity: q } : i
  );
  setCartItems(items);
  return items;
}

export function clearCart() {
  setCartItems([]);
}

export function cartCount(items) {
  return (items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
}
