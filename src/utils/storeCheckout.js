import { httpsCallable } from 'firebase/functions';

/** @param {unknown} functions - instancia de `getFunctions` */
export async function openStoreCheckout(functions, items, shippingService) {
  const call = httpsCallable(functions, 'criarCheckoutLoja');
  const res = await call({ items, shippingService });
  const data = res?.data || {};
  if (!data.ok || !data.url) {
    throw new Error(data?.message || 'Falha ao abrir checkout.');
  }
  return data.url;
}
