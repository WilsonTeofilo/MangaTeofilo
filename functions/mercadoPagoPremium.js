/**
 * Checkout Pro — assinatura premium (30 dias corridos), Mercado Pago.
 */

/** Mesmo valor que PREMIUM_PRECO_BRL em src/config/premiumAssinatura.js — produção: 23 */
export const PREMIUM_PRICE_BRL = 23;
export const PREMIUM_D_MS = 30 * 24 * 60 * 60 * 1000;
export const PREMIUM_PLAN_ID = 'premium_mensal_23';

/** Prefixo em external_reference (sem caracteres especiais problemáticos). */
export const PREMIUM_EXTERNAL_PREFIX = 'SHITO_PREMIUM|';

export function buildPremiumExternalRef(uid) {
  return `${PREMIUM_EXTERNAL_PREFIX}${uid}`;
}

export function parsePremiumExternalRef(ref) {
  if (ref == null || typeof ref !== 'string') return null;
  if (!ref.startsWith(PREMIUM_EXTERNAL_PREFIX)) return null;
  const uid = ref.slice(PREMIUM_EXTERNAL_PREFIX.length).trim();
  return uid || null;
}

/**
 * Preferência Checkout Pro só para premium (usuário logado).
 * @param {string} notificationUrl - URL pública da Cloud Function webhook (opcional)
 */
export async function criarPreferenciaPremium(
  accessToken,
  uid,
  appBaseUrl,
  notificationUrl,
  unitPrice = PREMIUM_PRICE_BRL,
  promoMeta = null,
  attributionMeta = null
) {
  const base = String(appBaseUrl || '').replace(/\/$/, '');
  const price = Number(unitPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Preco premium invalido para checkout.');
  }
  const body = {
    items: [
      {
        title: 'Shito — Membro Premium (30 dias)',
        description: 'Acesso antecipado a capítulos, sem anúncios e regalias no site.',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: price,
      },
    ],
    external_reference: buildPremiumExternalRef(uid),
    metadata: {
      uid: String(uid),
      product: 'premium_30d',
      expectedAmount: price,
      promoId: promoMeta?.promoId ? String(promoMeta.promoId) : null,
      promoName: promoMeta?.promoName ? String(promoMeta.promoName) : null,
      trafficSource: attributionMeta?.source ? String(attributionMeta.source) : null,
      trafficCampaign: attributionMeta?.campaignId ? String(attributionMeta.campaignId) : null,
      trafficClickId: attributionMeta?.clickId ? String(attributionMeta.clickId) : null,
      attributionCreatorId: attributionMeta?.creatorId ? String(attributionMeta.creatorId).trim() : null,
    },
    back_urls: {
      success: `${base}/apoie?mp=ok&tipo=premium`,
      failure: `${base}/apoie?mp=erro`,
      pending: `${base}/apoie?mp=pending`,
    },
    auto_return: 'approved',
    statement_descriptor: 'SHITO PREMIUM',
  };

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
