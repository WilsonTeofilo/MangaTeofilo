import { httpsCallable } from 'firebase/functions';

/** @param {unknown} functions - instância de `getFunctions` */
export async function openStoreCheckout(functions, items) {
  const call = httpsCallable(functions, 'criarCheckoutLoja');
  const res = await call({ items });
  const data = res?.data || {};
  if (!data.ok || !data.url) {
    throw new Error(data?.message || 'Falha ao abrir checkout.');
  }
  return data.url;
}
