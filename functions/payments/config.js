import { defineSecret, defineString } from 'firebase-functions/params';

export const APP_BASE_URL = defineString('APP_BASE_URL', {
  default: 'https://shitoproject-ed649.web.app',
});

export const MP_ACCESS_TOKEN = defineSecret('MP_ACCESS_TOKEN');
export const MP_WEBHOOK_SECRET = defineString('MP_WEBHOOK_SECRET', { default: '' });
export const FUNCTIONS_PUBLIC_URL = defineString('FUNCTIONS_PUBLIC_URL', {
  default: 'https://us-central1-shitoproject-ed649.cloudfunctions.net',
});

export function getFunctionsPublicWebhookUrl(path) {
  const base = FUNCTIONS_PUBLIC_URL.value().replace(/\/$/, '');
  return `${base}/${String(path || '').replace(/^\/+/, '')}`;
}

export function getAppBaseUrl() {
  return APP_BASE_URL.value();
}

export function getMercadoPagoAccessTokenOrThrow() {
  let token;
  try {
    token = String(MP_ACCESS_TOKEN.value()).trim();
  } catch {
    throw new Error('Mercado Pago nao configurado (secret MP_ACCESS_TOKEN).');
  }
  if (!token) {
    throw new Error('Token Mercado Pago vazio.');
  }
  return token;
}
