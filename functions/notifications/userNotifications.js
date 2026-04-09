import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertTrustedAppRequest } from '../appCheckGuard.js';

function assertNotificationId(notificationId) {
  const id = String(notificationId || '').trim();
  if (!id) {
    throw new HttpsError('invalid-argument', 'notificationId obrigatorio.');
  }
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(id)) {
    throw new HttpsError('invalid-argument', 'notificationId invalido.');
  }
  return id;
}

export const markUserNotificationRead = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const markAll = request.data?.markAll === true;
  const db = getDatabase();

  if (markAll) {
    const snap = await db.ref(`usuarios/${uid}/notifications`).get();
    const notifications = snap.val() || {};
    const now = Date.now();
    const patch = {};
    for (const [id] of Object.entries(notifications)) {
      patch[`usuarios/${uid}/notifications/${id}/read`] = true;
      patch[`usuarios/${uid}/notifications/${id}/readAt`] = now;
    }
    if (Object.keys(patch).length) {
      await db.ref().update(patch);
    }
    return { ok: true, marked: Object.keys(notifications).length };
  }

  const notificationId = assertNotificationId(request.data?.notificationId);
  const notificationRef = db.ref(`usuarios/${uid}/notifications/${notificationId}`);
  const notificationSnap = await notificationRef.get();
  if (!notificationSnap.exists()) {
    throw new HttpsError('not-found', 'Notificacao nao encontrada.');
  }

  await notificationRef.update({
    read: true,
    readAt: Date.now(),
  });
  return { ok: true, notificationId };
});

export const deleteUserNotification = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const deleteAll = request.data?.deleteAll === true;
  const db = getDatabase();

  if (deleteAll) {
    const notificationsRef = db.ref(`usuarios/${uid}/notifications`);
    const snap = await notificationsRef.get();
    const notifications = snap.val() || {};
    await notificationsRef.remove();
    return { ok: true, deleted: Object.keys(notifications).length };
  }

  const notificationId = assertNotificationId(request.data?.notificationId);
  const notificationRef = db.ref(`usuarios/${uid}/notifications/${notificationId}`);
  const notificationSnap = await notificationRef.get();
  if (!notificationSnap.exists()) {
    throw new HttpsError('not-found', 'Notificacao nao encontrada.');
  }

  await notificationRef.remove();
  return { ok: true, notificationId };
});

export const upsertNotificationSubscription = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = String(request.auth.uid || '').trim();
  const type = String(request.data?.type || '').trim().toLowerCase();
  const targetId = String(request.data?.targetId || '').trim();
  if (!['creator', 'work'].includes(type) || !targetId) {
    throw new HttpsError('invalid-argument', 'Envie type valido e targetId.');
  }
  const enabled = request.data?.enabled !== false;
  const db = getDatabase();
  const normalizedTargetId =
    type === 'creator' ? targetId.replace(/[^A-Za-z0-9_-]/g, '').trim() : targetId;
  if (!normalizedTargetId) {
    throw new HttpsError('invalid-argument', 'targetId invalido.');
  }
  const basePath =
    type === 'creator'
      ? `usuarios/${uid}/followingCreators/${normalizedTargetId}`
      : `usuarios/${uid}/subscribedWorks/${normalizedTargetId}`;

  if (!enabled) {
    await db.ref(basePath).remove();
    return { ok: true, enabled: false };
  }

  await db.ref(basePath).set({
    targetId: normalizedTargetId,
    type,
    subscribedAt: Date.now(),
    updatedAt: Date.now(),
  });
  return { ok: true, enabled: true };
});
