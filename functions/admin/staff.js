import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ADMIN_REGISTRY_PATH,
  isTargetSuperAdmin,
  listStaffRegistryRows,
  normalizePermissionsForRegistry,
  requireSuperAdmin,
  resolveTargetUidByEmail,
} from '../adminRbac.js';
import { creatorAccessIsApprovedFromDb } from '../creatorRecord.js';

export const adminListStaff = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  await requireSuperAdmin(request.auth);
  const db = getDatabase();
  const registryRowsOnly = await listStaffRegistryRows();
  const registryRows = await Promise.all(
    registryRowsOnly.map(async (row) => {
      const uid = String(row.uid || '').trim();
        let email = null;
        let name = '';
        try {
          const user = await getAuth().getUser(uid);
          email = user.email || null;
          name = String(user.displayName || '').trim();
        } catch {
          email = null;
        }
        if (!name) {
          const userSnap = await db.ref(`usuarios/${uid}`).get();
          const userRow = userSnap.val() || {};
          name = String(userRow?.userName || userRow?.creatorDisplayName || '').trim();
        }
        return {
          uid,
          email,
          name: name || null,
          role: row.role,
          permissions: normalizePermissionsForRegistry(row.permissions),
          updatedAt: Number(row.updatedAt || 0),
          updatedBy: String(row.updatedBy || ''),
        };
      })
  );
  const seen = new Set();
  const staff = [...registryRows].filter((row) => {
    if (!row?.uid || seen.has(row.uid)) return false;
    seen.add(row.uid);
    return true;
  });
  staff.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'super_admin' ? -1 : 1;
    const labelA = String(a.name || a.email || a.uid || '').toLowerCase();
    const labelB = String(b.name || b.email || b.uid || '').toLowerCase();
    return labelA.localeCompare(labelB, 'pt-BR');
  });
  return { ok: true, staff };
});

export const adminUpsertStaff = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  await requireSuperAdmin(request.auth);
  const data = request.data || {};
  const email = String(data.email || '').trim();
  if (!email) {
    throw new HttpsError('invalid-argument', 'Email obrigatorio.');
  }
  const targetUid = await resolveTargetUidByEmail(email);
  if (!targetUid) {
    throw new HttpsError('not-found', 'Usuario nao encontrado com este email.');
  }
  let targetEmailLower = email.toLowerCase();
  try {
    const targetUser = await getAuth().getUser(targetUid);
    if (targetUser.email) targetEmailLower = targetUser.email.toLowerCase();
  } catch {
    /* ignore */
  }
  if (await isTargetSuperAdmin({ uid: targetUid, email: targetEmailLower })) {
    throw new HttpsError('permission-denied', 'Nao e permitido alterar admin chefe.');
  }
  const permissions = normalizePermissionsForRegistry(data.permissions);
  const updatedAt = Date.now();
  const updatedBy = request.auth.uid;
  await getDatabase().ref(`${ADMIN_REGISTRY_PATH}/${targetUid}`).set({
    role: 'admin',
    permissions,
    updatedAt,
    updatedBy,
  });
  const userRecord = await getAuth().getUser(targetUid);
  const prevClaims = { ...(userRecord.customClaims || {}) };
  prevClaims.panelRole = 'admin';
  await getAuth().setCustomUserClaims(targetUid, prevClaims);
  const userSnap = await getDatabase().ref(`usuarios/${targetUid}`).get();
  const userRow = userSnap.exists() ? userSnap.val() || {} : {};
  const nextUserRole = creatorAccessIsApprovedFromDb(userRow) ? 'mangaka' : 'user';
  await getDatabase().ref(`usuarios/${targetUid}/role`).set(nextUserRole);
  return { ok: true, uid: targetUid, role: 'admin' };
});

export const adminRemoveStaff = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  await requireSuperAdmin(request.auth);
  const data = request.data || {};
  let targetUid = String(data.uid || '').trim();
  if (!targetUid && data.email) {
    targetUid = (await resolveTargetUidByEmail(String(data.email).trim())) || '';
  }
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Informe uid ou email.');
  }
  let targetEmailLower = '';
  try {
    const targetUser = await getAuth().getUser(targetUid);
    if (targetUser.email) targetEmailLower = targetUser.email.toLowerCase();
  } catch (e) {
    if (e?.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'Usuario nao encontrado.');
    }
    throw e;
  }
  if (await isTargetSuperAdmin({ uid: targetUid, email: targetEmailLower })) {
    throw new HttpsError('permission-denied', 'Nao e permitido remover admin chefe.');
  }
  const regSnap = await getDatabase().ref(`${ADMIN_REGISTRY_PATH}/${targetUid}`).get();
  const regRole = regSnap.val()?.role;
  if (!regSnap.exists() || regRole !== 'admin') {
    throw new HttpsError('failed-precondition', 'So admins do registro podem ser removidos aqui.');
  }
  await getDatabase().ref(`${ADMIN_REGISTRY_PATH}/${targetUid}`).remove();
  const userRecord = await getAuth().getUser(targetUid);
  const prevClaims = { ...(userRecord.customClaims || {}) };
  delete prevClaims.admin;
  delete prevClaims.panelRole;
  await getAuth().setCustomUserClaims(targetUid, Object.keys(prevClaims).length ? prevClaims : null);
  await getDatabase().ref(`usuarios/${targetUid}/role`).set('user');
  return { ok: true };
});
