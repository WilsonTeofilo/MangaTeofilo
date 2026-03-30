const KEY = 'mangateofilo_cart_v1';

function parseStored(raw) {
  try {
    const data = JSON.parse(raw || '[]');
    if (!Array.isArray(data)) return [];
    return data
      .map((item) => ({
        productId: String(item?.productId || ''),
        quantity: Math.max(1, Number(item?.quantity || 1)),
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
}

export function addToCart(productId, quantity = 1) {
  const q = Math.max(1, Number(quantity || 1));
  const items = getCartItems();
  const idx = items.findIndex((i) => i.productId === productId);
  if (idx >= 0) {
    items[idx] = { ...items[idx], quantity: items[idx].quantity + q };
  } else {
    items.push({ productId, quantity: q });
  }
  setCartItems(items);
  return items;
}

export function removeFromCart(productId) {
  const items = getCartItems().filter((i) => i.productId !== productId);
  setCartItems(items);
  return items;
}

export function updateCartQuantity(productId, quantity) {
  const q = Math.max(1, Number(quantity || 1));
  const items = getCartItems().map((i) => (i.productId === productId ? { ...i, quantity: q } : i));
  setCartItems(items);
  return items;
}

export function clearCart() {
  setCartItems([]);
}

export function cartCount(items) {
  return (items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
}

