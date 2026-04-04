export const STORE_EXTERNAL_PREFIX = 'SHITO_STORE|';

/** Pagamento único por pedido print-on-demand (Mercado Pago). */
export const POD_EXTERNAL_PREFIX = 'SHITO_POD|';

export function buildPodExternalRef(orderId, uid) {
  return `${POD_EXTERNAL_PREFIX}${String(orderId || '').trim()}|${String(uid || '').trim()}`;
}

export function parsePodExternalRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(POD_EXTERNAL_PREFIX)) return null;
  const rest = ref.slice(POD_EXTERNAL_PREFIX.length);
  const [orderIdRaw, uidRaw] = String(rest || '').split('|');
  const orderId = String(orderIdRaw || '').trim();
  const uid = String(uidRaw || '').trim();
  if (!orderId || !uid) return null;
  return { orderId, uid };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Checkout único: um item MP = valor total do lote POD.
 */
export async function criarPreferenciaPrintOnDemand(
  accessToken,
  { orderId, uid, title, description, amountBRL, appBaseUrl, notificationUrl }
) {
  const base = String(appBaseUrl || '').replace(/\/$/, '');
  const unit = round2(amountBRL);
  if (!Number.isFinite(unit) || unit <= 0) throw new Error('Valor POD invalido.');
  const body = {
    items: [
      {
        title: String(title || 'Manga fisico — producao').slice(0, 120),
        description: String(description || '').slice(0, 200),
        quantity: 1,
        currency_id: 'BRL',
        unit_price: unit,
      },
    ],
    external_reference: buildPodExternalRef(orderId, uid),
    metadata: {
      uid: String(uid),
      orderId: String(orderId),
      tipo: 'pod_order',
      expectedAmount: unit,
    },
    back_urls: {
      success: `${base}/pedidos/fisico/${encodeURIComponent(orderId)}?mp=ok`,
      failure: `${base}/print-on-demand/checkout?mp=erro`,
      pending: `${base}/pedidos/fisico/${encodeURIComponent(orderId)}?mp=pending`,
    },
    auto_return: 'approved',
    statement_descriptor: 'MANGAPOD',
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
      success: `${base}/pedidos?tab=compras&mp=ok`,
      failure: `${base}/loja?mp=erro`,
      pending: `${base}/pedidos?tab=compras&mp=pending`,
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

