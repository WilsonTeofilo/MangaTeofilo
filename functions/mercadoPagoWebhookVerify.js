/**
 * Validação opcional de webhooks Mercado Pago (header x-signature).
 * @see https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 */

import crypto from 'crypto';

/**
 * @param {import('firebase-functions').https.Request} req
 * @param {string} resourceId - mesmo id usado na API GET /v1/payments/{id}
 * @param {string} secretTrimmed - segredo configurado no painel MP (integração > Webhooks)
 * @returns {{ ok: boolean, reason?: string, skipped?: boolean }}
 */
export function verifyMercadoPagoWebhookSignature(req, resourceId, secretTrimmed) {
  const secret = String(secretTrimmed || '').trim();
  if (!secret) {
    return { ok: true, skipped: true };
  }
  const sigRaw = req.headers['x-signature'] || req.headers['X-Signature'];
  const requestId = req.headers['x-request-id'] || req.headers['X-Request-Id'];
  if (!sigRaw || !requestId) {
    return { ok: false, reason: 'missing_signature_headers' };
  }
  let ts;
  let v1;
  for (const part of String(sigRaw).split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 'ts') ts = v;
    if (k === 'v1') v1 = v;
  }
  const id = String(resourceId || '').trim();
  if (!ts || !v1 || !id) {
    return { ok: false, reason: 'invalid_signature_payload' };
  }
  const manifest = `id:${id};request-id:${String(requestId).trim()};ts:${ts};`;
  const hmacHex = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try {
    const a = Buffer.from(hmacHex, 'hex');
    const b = Buffer.from(String(v1).trim().toLowerCase(), 'hex');
    if (a.length !== b.length || a.length === 0) {
      return { ok: false, reason: 'signature_mismatch' };
    }
    if (!crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'signature_mismatch' };
    }
  } catch {
    return { ok: false, reason: 'signature_compare_error' };
  }
  return { ok: true };
}
