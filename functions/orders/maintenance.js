import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getAdminAuthContext, requirePermission } from '../adminRbac.js';
import { normalizeStoreOrderStatusInput } from './storeCommon.js';

function normalizePodStatus(value, fallback = 'pending') {
  const raw = String(value || fallback).trim().toLowerCase().replace(/\s+/g, '_');
  if (!raw) return fallback;
  if (raw === 'pending_payment') return 'pending';
  if (raw === 'processing') return 'in_production';
  if (raw === 'ready_to_ship') return 'in_production';
  if (raw === 'canceled') return 'cancelled';
  return raw;
}

export const adminBackfillCanonicalOrderStatuses = onCall(
  { region: 'us-central1', timeoutSeconds: 300, memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await getAdminAuthContext(request.auth);
    requirePermission(ctx, 'manageOrders');

    const db = getDatabase();
    const [storeSnap, podSnap] = await Promise.all([
      db.ref('loja/pedidos').get(),
      db.ref('loja/printOnDemandOrders').get(),
    ]);

    let storeUpdated = 0;
    let podUpdated = 0;
    const patch = {};

    const storeOrders = storeSnap.exists() ? storeSnap.val() || {} : {};
    for (const [orderId, row] of Object.entries(storeOrders)) {
      const current = String(row?.status || '').trim();
      const canonical = normalizeStoreOrderStatusInput(current);
      if (canonical !== current) {
        patch[`loja/pedidos/${orderId}/status`] = canonical;
        storeUpdated += 1;
      }
    }

    const podOrders = podSnap.exists() ? podSnap.val() || {} : {};
    for (const [orderId, row] of Object.entries(podOrders)) {
      const current = String(row?.status || '').trim();
      const canonical = normalizePodStatus(current);
      if (canonical !== current) {
        patch[`loja/printOnDemandOrders/${orderId}/status`] = canonical;
        podUpdated += 1;
      }
    }

    if (Object.keys(patch).length) {
      await db.ref().update(patch);
    }

    return {
      ok: true,
      storeUpdated,
      podUpdated,
      totalUpdated: storeUpdated + podUpdated,
    };
  }
);
