import assert from 'node:assert';
import crypto from 'crypto';
import { describe, it } from 'node:test';
import { verifyMercadoPagoWebhookSignature } from './mercadoPagoWebhookVerify.js';

function expectedV1(secret, resourceId, requestId, ts) {
  const manifest = `id:${resourceId};request-id:${requestId};ts:${ts};`;
  return crypto.createHmac('sha256', secret).update(manifest).digest('hex');
}

function req(headers) {
  return { headers };
}

describe('verifyMercadoPagoWebhookSignature', () => {
  it('skips verification when secret is empty', () => {
    const r = req({
      'x-signature': 'ts=1,v1=ab',
      'x-request-id': 'rid',
    });
    const out = verifyMercadoPagoWebhookSignature(r, 'pay_1', '   ');
    assert.deepStrictEqual(out, { ok: true, skipped: true });
  });

  it('rejects when signature headers are missing', () => {
    const r = req({});
    const out = verifyMercadoPagoWebhookSignature(r, 'pay_1', 'secret');
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.reason, 'missing_signature_headers');
  });

  it('rejects invalid ts/v1/id payload', () => {
    const r = req({
      'x-signature': 'ts=,v1=',
      'x-request-id': 'rid',
    });
    const out = verifyMercadoPagoWebhookSignature(r, '', 'secret');
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.reason, 'invalid_signature_payload');
  });

  it('accepts valid HMAC v1', () => {
    const secret = 'webhook-secret-test';
    const id = '123456789';
    const requestId = 'req-abc';
    const ts = '1700000000';
    const v1 = expectedV1(secret, id, requestId, ts);
    const r = req({
      'x-signature': `ts=${ts},v1=${v1}`,
      'x-request-id': requestId,
    });
    const out = verifyMercadoPagoWebhookSignature(r, id, secret);
    assert.deepStrictEqual(out, { ok: true });
  });

  it('rejects wrong v1', () => {
    const secret = 'webhook-secret-test';
    const id = '123456789';
    const requestId = 'req-abc';
    const ts = '1700000000';
    const bad = '0'.repeat(64);
    const r = req({
      'x-signature': `ts=${ts},v1=${bad}`,
      'x-request-id': requestId,
    });
    const out = verifyMercadoPagoWebhookSignature(r, id, secret);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.reason, 'signature_mismatch');
  });
});
