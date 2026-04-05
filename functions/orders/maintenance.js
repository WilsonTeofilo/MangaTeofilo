import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getAdminAuthContext, requirePermission } from '../adminRbac.js';
import { normalizeStoreOrderStatusInput, releaseStoreInventoryReservation } from './storeCommon.js';

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

export const adminAuditStoreFinancialIntegrity = onCall(
  { region: 'us-central1', timeoutSeconds: 300, memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await getAdminAuthContext(request.auth);
    requirePermission(ctx, 'manageOrders');

    const db = getDatabase();
    const [storeSnap, podSnap, mpSnap] = await Promise.all([
      db.ref('loja/pedidos').get(),
      db.ref('loja/printOnDemandOrders').get(),
      db.ref('financas/mp_webhook_payments').get(),
    ]);

    const storeOrders = storeSnap.exists() ? storeSnap.val() || {} : {};
    const podOrders = podSnap.exists() ? podSnap.val() || {} : {};
    const mpPayments = mpSnap.exists() ? mpSnap.val() || {} : {};
    const findings = [];

    for (const [orderId, row] of Object.entries(storeOrders)) {
      const status = normalizeStoreOrderStatusInput(String(row?.status || ''), '');
      const paymentId = String(row?.paymentId || '').trim();
      const total = Number(row?.total || 0);
      const payment = paymentId ? mpPayments[paymentId] || null : null;
      const finalMpStatus = String(payment?.status || payment?.lastStatus || '').trim().toLowerCase();
      const finalizedAt = Number(payment?.finalizedAt || 0);
      const expAt = Number(row?.expiresAt || 0);
      const reserved = row?.inventoryReserved === true;
      const releasedAt = Number(row?.inventoryReleasedAt || 0);

      if (['paid', 'in_production', 'shipped', 'delivered'].includes(status) && (!paymentId || finalizedAt <= 0)) {
        findings.push({ type: 'store_paid_without_finalized_webhook', orderId, paymentId: paymentId || null, status });
      }
      if (paymentId && finalizedAt > 0 && ['paid', 'in_production', 'shipped', 'delivered'].includes(status) && finalMpStatus !== 'approved') {
        findings.push({ type: 'store_paid_with_non_approved_payment', orderId, paymentId, status, mpStatus: finalMpStatus || null });
      }
      if (status === 'cancelled' && reserved && releasedAt <= 0) {
        findings.push({ type: 'store_cancelled_without_inventory_release', orderId, paymentId: paymentId || null });
      }
      if (status === 'pending' && expAt > 0 && expAt < Date.now()) {
        findings.push({ type: 'store_pending_but_expired', orderId, paymentId: paymentId || null, expiresAt: expAt });
      }
      if (paymentId && finalizedAt > 0 && Number.isFinite(total) && total > 0 && Number.isFinite(Number(payment?.amount)) && Math.abs(Number(payment.amount) - total) > 0.05) {
        findings.push({
          type: 'store_amount_mismatch',
          orderId,
          paymentId,
          orderTotal: total,
          webhookAmount: Number(payment.amount),
        });
      }
    }

    for (const [orderId, row] of Object.entries(podOrders)) {
      const status = normalizeStoreOrderStatusInput(String(row?.status || ''), '');
      const paymentId = String(row?.paymentId || '').trim();
      const expected = Number(row?.expectedPayBRL || row?.snapshot?.amountDueBRL || 0);
      const payment = paymentId ? mpPayments[paymentId] || null : null;
      const finalMpStatus = String(payment?.status || payment?.lastStatus || '').trim().toLowerCase();
      const finalizedAt = Number(payment?.finalizedAt || 0);
      if (['paid', 'in_production', 'shipped', 'delivered'].includes(status) && (!paymentId || finalizedAt <= 0)) {
        findings.push({ type: 'pod_paid_without_finalized_webhook', orderId, paymentId: paymentId || null, status });
      }
      if (paymentId && finalizedAt > 0 && ['paid', 'in_production', 'shipped', 'delivered'].includes(status) && finalMpStatus !== 'approved') {
        findings.push({ type: 'pod_paid_with_non_approved_payment', orderId, paymentId, status, mpStatus: finalMpStatus || null });
      }
      if (paymentId && finalizedAt > 0 && Number.isFinite(expected) && expected > 0 && Number.isFinite(Number(payment?.amount)) && Math.abs(Number(payment.amount) - expected) > 0.05) {
        findings.push({
          type: 'pod_amount_mismatch',
          orderId,
          paymentId,
          expectedAmount: expected,
          webhookAmount: Number(payment.amount),
        });
      }
    }

    return {
      ok: true,
      storeOrders: Object.keys(storeOrders).length,
      podOrders: Object.keys(podOrders).length,
      webhookPayments: Object.keys(mpPayments).length,
      findingsCount: findings.length,
      findings: findings.slice(0, 200),
    };
  }
);

export const adminReconcileStoreFinancialIntegrity = onCall(
  { region: 'us-central1', timeoutSeconds: 300, memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await getAdminAuthContext(request.auth);
    requirePermission(ctx, 'manageOrders');

    const dryRun = request.data?.dryRun !== false;
    const db = getDatabase();
    const [storeSnap, podSnap, mpSnap] = await Promise.all([
      db.ref('loja/pedidos').get(),
      db.ref('loja/printOnDemandOrders').get(),
      db.ref('financas/mp_webhook_payments').get(),
    ]);

    const storeOrders = storeSnap.exists() ? storeSnap.val() || {} : {};
    const podOrders = podSnap.exists() ? podSnap.val() || {} : {};
    const mpPayments = mpSnap.exists() ? mpSnap.val() || {} : {};
    const changes = [];
    let storeFixed = 0;
    let podFixed = 0;

    for (const [orderId, row] of Object.entries(storeOrders)) {
      const status = normalizeStoreOrderStatusInput(String(row?.status || ''), '');
      const paymentId = String(row?.paymentId || '').trim();
      const payment = paymentId ? mpPayments[paymentId] || null : null;
      const finalMpStatus = String(payment?.status || payment?.lastStatus || '').trim().toLowerCase();
      const finalizedAt = Number(payment?.finalizedAt || 0);
      const expAt = Number(row?.expiresAt || 0);
      const reserved = row?.inventoryReserved === true;
      const releasedAt = Number(row?.inventoryReleasedAt || 0);

      if (status === 'pending' && expAt > 0 && expAt < Date.now()) {
        if (!dryRun) {
          const orderRef = db.ref(`loja/pedidos/${orderId}`);
          if (reserved && releasedAt <= 0) {
            await releaseStoreInventoryReservation(db, { id: orderId, ...row });
          }
          await orderRef.update({
            status: 'cancelled',
            paymentStatus: 'expired',
            updatedAt: Date.now(),
            inventoryReleasedAt: Date.now(),
          });
        }
        changes.push({ entity: 'store', orderId, action: 'expire_pending_order' });
        storeFixed += 1;
        continue;
      }

      if (status === 'cancelled' && reserved && releasedAt <= 0) {
        if (!dryRun) {
          await releaseStoreInventoryReservation(db, { id: orderId, ...row });
          await db.ref(`loja/pedidos/${orderId}`).update({
            updatedAt: Date.now(),
            inventoryReleasedAt: Date.now(),
          });
        }
        changes.push({ entity: 'store', orderId, action: 'release_cancelled_inventory' });
        storeFixed += 1;
        continue;
      }

      if (
        paymentId &&
        finalizedAt > 0 &&
        ['paid', 'in_production', 'shipped', 'delivered'].includes(status) &&
        finalMpStatus &&
        finalMpStatus !== 'approved'
      ) {
        if (!dryRun) {
          const patch = {
            status: finalMpStatus === 'refunded' || finalMpStatus === 'charged_back' ? 'cancelled' : 'pending',
            paymentStatus: finalMpStatus,
            updatedAt: Date.now(),
          };
          if (reserved && releasedAt <= 0) {
            await releaseStoreInventoryReservation(db, { id: orderId, ...row });
            patch.inventoryReleasedAt = Date.now();
          }
          await db.ref(`loja/pedidos/${orderId}`).update(patch);
        }
        changes.push({ entity: 'store', orderId, action: 'normalize_non_approved_paid_order', paymentId, mpStatus: finalMpStatus });
        storeFixed += 1;
      }
    }

    for (const [orderId, row] of Object.entries(podOrders)) {
      const status = normalizePodStatus(String(row?.status || ''), '');
      const paymentId = String(row?.paymentId || '').trim();
      const payment = paymentId ? mpPayments[paymentId] || null : null;
      const finalMpStatus = String(payment?.status || payment?.lastStatus || '').trim().toLowerCase();
      const finalizedAt = Number(payment?.finalizedAt || 0);

      if (
        paymentId &&
        finalizedAt > 0 &&
        ['paid', 'in_production', 'shipped', 'delivered'].includes(status) &&
        finalMpStatus &&
        finalMpStatus !== 'approved'
      ) {
        if (!dryRun) {
          await db.ref(`loja/printOnDemandOrders/${orderId}`).update({
            status: finalMpStatus === 'refunded' || finalMpStatus === 'charged_back' ? 'cancelled' : 'pending',
            paymentStatus: finalMpStatus,
            updatedAt: Date.now(),
          });
        }
        changes.push({ entity: 'pod', orderId, action: 'normalize_non_approved_paid_order', paymentId, mpStatus: finalMpStatus });
        podFixed += 1;
      }
    }

    return {
      ok: true,
      dryRun,
      storeFixed,
      podFixed,
      totalFixed: storeFixed + podFixed,
      sample: changes.slice(0, 200),
    };
  }
);
