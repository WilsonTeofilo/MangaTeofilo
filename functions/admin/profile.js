import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { assertTrustedAppRequest } from '../appCheckGuard.js';
import { getAdminAuthContext, ADMIN_REGISTRY_PATH, isCreatorAccountAuth } from '../adminRbac.js';
import { panelRoleFromAdminContext } from '../claimsConsistency.js';

async function reconcileStaffRtdbRoleFromMangaka(uid, ctx) {
  const db = getDatabase();
  let staff = ctx.super === true;
  if (!staff) {
    const reg = (await db.ref(`${ADMIN_REGISTRY_PATH}/${uid}`).get()).val();
    staff = reg && reg.role === 'admin';
  }
  if (!staff) return false;
  const uSnap = await db.ref(`usuarios/${uid}`).get();
  if (!uSnap.exists()) return false;
  const role = String(uSnap.val()?.role || '').toLowerCase();
  if (role !== 'mangaka') return false;
  await db.ref().update({
    [`usuarios/${uid}/role`]: 'user',
    [`usuarios/${uid}/signupIntent`]: 'reader',
  });
  return true;
}

export const adminGetMyAdminProfile = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    return { ok: true, admin: false };
  }
  const ctx = await getAdminAuthContext(request.auth);
  const creatorOnly = !ctx && (await isCreatorAccountAuth(request.auth));
  if (ctx) {
    try {
      await reconcileStaffRtdbRoleFromMangaka(request.auth.uid, ctx);
    } catch (e) {
      logger.warn('reconcileStaffRtdbRoleFromMangaka failed', {
        uid: request.auth.uid,
        err: String(e?.message || e),
      });
    }
  }
  const panelRole = creatorOnly ? 'mangaka' : panelRoleFromAdminContext(ctx);

  let claimsSynced = false;
  try {
    const authUser = await getAuth().getUser(request.auth.uid);
    const prevClaims = { ...(authUser.customClaims || {}) };
    const nextClaims = { ...prevClaims };
    if (panelRole) nextClaims.panelRole = panelRole;
    else delete nextClaims.panelRole;
    if (!ctx) delete nextClaims.admin;
    const prevPanelRole = prevClaims.panelRole ?? null;
    const nextPanelRole = nextClaims.panelRole ?? null;
    const prevAdmin = prevClaims.admin === true;
    const nextAdmin = nextClaims.admin === true;
    if (prevPanelRole !== nextPanelRole || prevAdmin !== nextAdmin) {
      await getAuth().setCustomUserClaims(
        request.auth.uid,
        Object.keys(nextClaims).length ? nextClaims : null
      );
      claimsSynced = true;
    }
  } catch (e) {
    logger.warn('adminGetMyAdminProfile panelRole sync failed', {
      uid: request.auth.uid,
      err: String(e?.message || e),
    });
  }

  return {
    ok: true,
    admin: Boolean(ctx),
    creator: creatorOnly,
    super: ctx?.super === true,
    mangaka: creatorOnly,
    panelRole,
    permissions: ctx?.permissions || {},
    claimsSynced,
  };
});
