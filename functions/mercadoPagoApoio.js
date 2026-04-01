/**
 * Planos de apoio — valores em BRL (Checkout Pro / Preferences API).
 * fallbackLink: usado no site se a Cloud Function não tiver token configurado.
 */
export const APOIO_PLANOS_MP = {
  cafe: {
    title: 'Shito — Café do autor',
    unit_price: 7.99,
    fallbackLink: 'https://mpago.la/18VvCLv',
  },
  marmita: {
    title: 'Shito — Marmita do guerreiro',
    unit_price: 19,
    fallbackLink: 'https://mpago.la/1XLszaM',
  },
  lendario: {
    title: 'Shito — O lendário mortal',
    unit_price: 35,
    fallbackLink: 'https://mpago.la/16nmTHk',
  },
};

/** Prefixo em external_reference para vincular doacao a um UID logado. */
export const APOIO_EXTERNAL_PREFIX = 'SHITO_APOIO|';

export function buildApoioExternalRef(uid) {
  return `${APOIO_EXTERNAL_PREFIX}${uid}`;
}

export function parseApoioExternalRef(ref) {
  if (ref == null || typeof ref !== 'string') return null;
  if (!ref.startsWith(APOIO_EXTERNAL_PREFIX)) return null;
  const uid = ref.slice(APOIO_EXTERNAL_PREFIX.length).trim();
  return uid || null;
}

/**
 * Cria preferência de checkout e retorna init_point (URL de pagamento).
 * @param {string} accessToken - Access Token de produção ou teste (Mercado Pago)
 * @param {string} planId - chave de APOIO_PLANOS_MP
 * @param {string} appBaseUrl - origem do site (back_urls)
 */
export async function criarPreferenciaApoio(
  accessToken,
  planId,
  appBaseUrl,
  uid,
  notificationUrl,
  attributionCreatorId = null,
  options = {}
) {
  const plan = APOIO_PLANOS_MP[planId];
  if (!plan) throw new Error(`Plano desconhecido: ${planId}`);

  const base = String(appBaseUrl || '').replace(/\/$/, '');
  const body = {
    items: [
      {
        title: plan.title,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: plan.unit_price,
      },
    ],
    back_urls: {
      success: `${base}/apoie?mp=ok&planId=${encodeURIComponent(planId)}`,
      failure: `${base}/apoie?mp=erro`,
      pending: `${base}/apoie?mp=pending`,
    },
    auto_return: 'approved',
    statement_descriptor: 'SHITO APOIO',
  };

  if (uid) {
    body.external_reference = buildApoioExternalRef(uid);
    body.metadata = {
      uid: String(uid),
      tipo: 'apoio',
      planId: String(planId),
      attributionCreatorId: attributionCreatorId ? String(attributionCreatorId).trim() : null,
      ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
    };
  }
  if (options.backUrlQuery) {
    const q = String(options.backUrlQuery || '');
    body.back_urls = {
      success: `${base}/apoie?mp=ok&${q}`,
      failure: `${base}/apoie?mp=erro`,
      pending: `${base}/apoie?mp=pending`,
    };
  }
  if (notificationUrl) {
    body.notification_url = notificationUrl;
  }

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

const VALOR_MIN = 1;
const VALOR_MAX = 5000;

function arredondarBrl(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Checkout com valor livre (mín. R$ 1). Retorna init_point.
 */
export async function criarPreferenciaApoioValorLivre(
  accessToken,
  valorBruto,
  appBaseUrl,
  uid,
  notificationUrl,
  attributionCreatorId = null,
  options = {}
) {
  const v = arredondarBrl(Number(valorBruto));
  if (!Number.isFinite(v) || v < VALOR_MIN || v > VALOR_MAX) {
    throw new Error(`Valor deve ser entre ${VALOR_MIN} e ${VALOR_MAX} BRL`);
  }

  const base = String(appBaseUrl || '').replace(/\/$/, '');
  const vEnc = encodeURIComponent(String(v));
  const body = {
    items: [
      {
        title: 'Shito — Doação livre',
        description: 'Apoio ao mangá Fragmentos da Tempestade',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: v,
      },
    ],
    back_urls: {
      success: `${base}/apoie?mp=ok&tipo=custom&v=${vEnc}`,
      failure: `${base}/apoie?mp=erro`,
      pending: `${base}/apoie?mp=pending`,
    },
    auto_return: 'approved',
    statement_descriptor: 'SHITO APOIO',
  };

  if (uid) {
    body.external_reference = buildApoioExternalRef(uid);
    body.metadata = {
      uid: String(uid),
      tipo: 'apoio_custom',
      customAmount: v,
      attributionCreatorId: attributionCreatorId ? String(attributionCreatorId).trim() : null,
      ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
    };
  }
  if (options.backUrlQuery) {
    const q = String(options.backUrlQuery || '');
    body.back_urls = {
      success: `${base}/apoie?mp=ok&${q}`,
      failure: `${base}/apoie?mp=erro`,
      pending: `${base}/apoie?mp=pending`,
    };
  }
  if (notificationUrl) {
    body.notification_url = notificationUrl;
  }

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
