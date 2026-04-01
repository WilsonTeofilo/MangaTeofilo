export const STORE_EXTERNAL_PREFIX = 'SHITO_STORE|';

export function buildStoreExternalRef(orderId, uid) {
  return `${STORE_EXTERNAL_PREFIX}${String(orderId || '').trim()}|${String(uid || '').trim()}`;
}

export function parseStoreExternalRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(STORE_EXTERNAL_PREFIX)) return null;
  const rest = ref.slice(STORE_EXTERNAL_PREFIX.length);
  const [orderIdRaw, uidRaw] = String(rest || '').split('|');
  const orderId = String(orderIdRaw || '').trim();
  const uid = String(uidRaw || '').trim();
  if (!orderId || !uid) return null;
  return { orderId, uid };
}

export async function criarPreferenciaLoja(
  accessToken,
  order,
  appBaseUrl,
  notificationUrl
) {
  const base = String(appBaseUrl || '').replace(/\/$/, '');
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) throw new Error('Pedido sem itens.');

  const body = {
    items: items.map((i) => ({
      title: String(i.title || 'Produto MangaTeofilo'),
      description: String(i.description || ''),
      quantity: Number(i.quantity || 1),
      currency_id: 'BRL',
      unit_price: Number(i.unitPrice || 0),
    })),
    external_reference: buildStoreExternalRef(order.orderId, order.uid),
    metadata: {
      uid: String(order.uid),
      orderId: String(order.orderId),
      tipo: 'store_order',
      expectedAmount: Number(order.total || 0),
    },
    back_urls: {
      success: `${base}/loja/pedidos?mp=ok`,
      failure: `${base}/loja?mp=erro`,
      pending: `${base}/loja/pedidos?mp=pending`,
    },
    auto_return: 'approved',
    statement_descriptor: 'MANGATEOFILO',
  };

  if (notificationUrl) body.notification_url = notificationUrl;

  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText || 'MP API error';
    throw new Error(msg);
  }
  if (!data.init_point) throw new Error('Resposta sem init_point');
  return data.init_point;
}

