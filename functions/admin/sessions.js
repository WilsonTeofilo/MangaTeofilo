import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  isTargetSuperAdmin,
  requireAdminAuth,
  requirePermission,
  requireSuperAdmin,
  resolveTargetUidByEmail,
} from '../adminRbac.js';

export const adminRevokeUserSessions = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'revokeSessions');
  const data = request.data || {};
  let targetUid = String(data.uid || '').trim();
  if (!targetUid && data.email) {
    targetUid = (await resolveTargetUidByEmail(String(data.email).trim())) || '';
  }
  if (!targetUid) throw new HttpsError('invalid-argument', 'Informe uid ou email.');
  let targetEmailLower = '';
  try {
    const targetUser = await getAuth().getUser(targetUid);
    if (targetUser.email) targetEmailLower = targetUser.email.toLowerCase();
  } catch (error) {
    if (error?.code === 'auth/user-not-found') throw new HttpsError('not-found', 'Usuario nao encontrado.');
    throw error;
  }
  if (!ctx.super && (await isTargetSuperAdmin({ uid: targetUid, email: targetEmailLower }))) {
    throw new HttpsError('permission-denied', 'Sem permissao para revogar sessoes deste usuario.');
  }
  await getAuth().revokeRefreshTokens(targetUid);
  return { ok: true };
});

export const adminRevokeAllSessions = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    await requireSuperAdmin(request.auth);
    let nextPageToken;
    let revoked = 0;
    do {
      const page = await getAuth().listUsers(1000, nextPageToken);
      for (const user of page.users) {
        await getAuth().revokeRefreshTokens(user.uid);
        revoked += 1;
      }
      nextPageToken = page.pageToken;
    } while (nextPageToken);
    logger.info('adminRevokeAllSessions ok', { revoked });
    return { ok: true, revoked };
  }
);
