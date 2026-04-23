import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertTrustedAppRequest } from '../appCheckGuard.js';
import {
  ADMIN_REGISTRY_PATH,
  isTargetSuperAdmin,
  requireSuperAdmin,
  resolveTargetUidByEmail,
} from '../adminRbac.js';
import { creatorAccessIsApprovedFromDb } from '../creatorRecord.js';
import { pushUserNotification } from '../notificationPush.js';
import { resolveCanonicalPublicHandle } from '../shared/canonicalIdentity.js';
import {
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_USER,
  getSmtpFrom,
  getTransporter,
} from '../notifications/delivery.js';
import { APP_BASE_URL } from '../payments/config.js';

const DELETED_USERS_ARCHIVE_PATH = 'admins/userModeration/deletedUsers';
const BAN_DURATIONS_BY_LEVEL = {
  1: 10 * 60 * 60 * 1000,
  2: 24 * 60 * 60 * 1000,
  3: 4 * 24 * 60 * 60 * 1000,
};

function normalizeReason(value, fieldLabel = 'motivo') {
  const reason = String(value || '').trim();
  if (reason.length < 5) {
    throw new HttpsError('invalid-argument', `Informe um ${fieldLabel} com pelo menos 5 caracteres.`);
  }
  return reason;
}

function normalizeDisplayName(row, authUser) {
  return (
    String(
      row?.publicProfile?.userName ||
      row?.publicProfile?.creatorDisplayName ||
      row?.userName ||
      row?.creatorDisplayName ||
      authUser?.displayName ||
      ''
    ).trim() || null
  );
}

function normalizeUsername(row) {
  return resolveCanonicalPublicHandle(row) || null;
}

function normalizeAvatar(row) {
  return (
    String(
      row?.publicProfile?.userAvatar ||
      row?.publicProfile?.readerProfileAvatarUrl ||
      row?.publicProfile?.creatorProfile?.avatarUrl ||
      row?.userAvatar ||
      row?.readerProfileAvatarUrl ||
      row?.creatorProfile?.avatarUrl ||
      ''
    ).trim() || null
  );
}

function rowCanOwnWorks(row) {
  const source = row && typeof row === 'object' ? row : {};
  const publicProfile =
    source?.publicProfile && typeof source.publicProfile === 'object' ? source.publicProfile : {};
  const creator = source?.creator && typeof source.creator === 'object' ? source.creator : {};
  const creatorProfile =
    publicProfile?.creatorProfile && typeof publicProfile.creatorProfile === 'object'
      ? publicProfile.creatorProfile
      : {};

  const signupIntent = String(source?.signupIntent || publicProfile?.signupIntent || '').trim().toLowerCase();
  const accountType = String(source?.accountType || publicProfile?.accountType || '').trim().toLowerCase();
  const panelRole = String(source?.panelRole || publicProfile?.panelRole || '').trim().toLowerCase();
  const creatorStatus = String(source?.creatorStatus || publicProfile?.creatorStatus || '').trim().toLowerCase();
  const role = String(source?.role || publicProfile?.role || '').trim().toLowerCase();
  const handle = resolveCanonicalPublicHandle(source);
  const displayName = String(
    creator?.profile?.displayName ||
      creatorProfile?.displayName ||
      source?.creatorDisplayName ||
      publicProfile?.creatorDisplayName ||
      source?.userName ||
      publicProfile?.userName ||
      ''
  ).trim();
  const hasWriterIdentity = Boolean(handle || displayName);

  if (role === 'mangaka') return true;
  if (panelRole === 'mangaka') return true;
  if (source?.isCreatorProfile === true || publicProfile?.isCreatorProfile === true) return true;
  if (creator?.isCreator === true || creatorProfile?.isCreator === true) return true;
  if (creator?.onboardingCompleted === true || source?.creatorOnboardingCompleted === true) return true;
  if (creatorStatus === 'active' || creatorStatus === 'onboarding') return true;
  if (creatorAccessIsApprovedFromDb(source)) return true;
  if (signupIntent === 'creator' || accountType === 'writer' || accountType === 'creator') {
    return hasWriterIdentity;
  }
  return false;
}

function formatDeletionReason(trigger, reason) {
  const normalized = String(reason || '').trim();
  if (trigger === 'ban_threshold') {
    return normalized || 'Voce infringiu 4/4 bans por nao respeitar as politicas da plataforma.';
  }
  return normalized || 'Sua conta foi removida pela equipe da plataforma.';
}

function buildDeletionEmail(authUser, reason) {
  const displayName = String(authUser?.displayName || '').trim() || 'usuario';
  const base = APP_BASE_URL.value().replace(/\/$/, '');
  const subject = 'Sua conta foi excluida da MangaTeofilo';
  const text = `${displayName}, sua conta foi excluida permanentemente da MangaTeofilo.\n\nMotivo: ${reason}\n\nSe voce acredita que isso foi um engano, entre em contato com a equipe: ${base}/sobre`;
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#f2f2f2;padding:28px;border-radius:10px;">
      <h2 style="margin:0 0 12px;color:#ffcc00;">Conta excluida permanentemente</h2>
      <p style="margin:0 0 16px;color:#d0d0d0;">Ola, ${displayName}.</p>
      <p style="margin:0 0 16px;color:#d0d0d0;">Sua conta foi excluida permanentemente da MangaTeofilo.</p>
      <p style="margin:0 0 8px;color:#ffcc00;font-weight:700;">Motivo</p>
      <p style="margin:0 0 18px;color:#f2f2f2;">${reason}</p>
      <p style="margin:0;color:#b8b8b8;">Se voce acredita que isso aconteceu por engano, fale com a equipe da plataforma.</p>
    </div>
  `;
  return { subject, text, html };
}

async function sendDeletionEmail(authUser, reason) {
  const to = String(authUser?.email || '').trim();
  if (!to) return false;
  try {
    const mail = buildDeletionEmail(authUser, reason);
    await getTransporter().sendMail({
      from: getSmtpFrom(),
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return true;
  } catch (err) {
    logger.error('Falha ao enviar email de exclusao de conta', {
      uid: authUser?.uid || null,
      email: to,
      error: err?.message || String(err),
    });
    return false;
  }
}

async function collectUsernameKeysForUid(db, uid) {
  const usernamesSnap = await db.ref('usernames').get();
  if (!usernamesSnap.exists()) return [];
  const rows = usernamesSnap.val() || {};
  return Object.entries(rows)
    .filter(([, value]) => String(value || '').trim() === String(uid || '').trim())
    .map(([key]) => String(key || '').trim().toLowerCase())
    .filter(Boolean);
}

function readModerationHistory(row) {
  return Object.entries(row?.moderation?.history || {})
    .map(([id, item]) => ({
      id,
      ...(item || {}),
      active: item?.active === true,
      createdAt: Number(item?.createdAt || 0),
      revertedAt: Number(item?.revertedAt || 0),
      expiresAt: Number(item?.expiresAt || 0),
    }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function isBanHistoryItemActive(item, now = Date.now()) {
  if (!item || item.type !== 'ban' || item.active !== true) return false;
  const expiresAt = Number(item.expiresAt || 0);
  if (expiresAt > 0 && expiresAt <= now) return false;
  return true;
}

function computeModerationSummary(row) {
  const now = Date.now();
  const history = readModerationHistory(row);
  const activeBans = history.filter((item) => isBanHistoryItemActive(item, now));
  const latestBan = history.find((item) => item.type === 'ban') || null;
  return {
    history,
    activeBanCount: activeBans.length,
    totalBanCount: history.filter((item) => item.type === 'ban').length,
    lastBanReason: activeBans[0]?.reason || latestBan?.reason || null,
    currentBanExpiresAt: Number(activeBans[0]?.expiresAt || 0) || null,
    isBanned: activeBans.length > 0,
  };
}

function getBanDurationMs(totalBanCount) {
  return BAN_DURATIONS_BY_LEVEL[Number(totalBanCount || 0)] || 0;
}

function formatBanDurationLabel(totalBanCount) {
  const count = Number(totalBanCount || 0);
  if (count === 1) return '10 horas';
  if (count === 2) return '24 horas';
  if (count === 3) return '4 dias';
  return 'permanente';
}

async function ensureTargetIsModeratable({ uid, authUser }) {
  if (!uid) {
    throw new HttpsError('invalid-argument', 'Uid obrigatorio.');
  }
  const email = String(authUser?.email || '').trim().toLowerCase();
  if (await isTargetSuperAdmin({ uid, email })) {
    throw new HttpsError('permission-denied', 'Nao e permitido moderar admin chefe.');
  }
  const regSnap = await getDatabase().ref(`${ADMIN_REGISTRY_PATH}/${uid}`).get();
  if (regSnap.exists()) {
    throw new HttpsError('permission-denied', 'Remova o acesso de staff antes de moderar esta conta.');
  }
}

async function archiveAndDeleteUser({ uid, authUser, row, reason, actorUid, trigger = 'manual_delete' }) {
  const db = getDatabase();
  const username = normalizeUsername(row);
  const moderation = computeModerationSummary(row);
  const archiveRef = db.ref(`${DELETED_USERS_ARCHIVE_PATH}/${uid}`);
  const usernameKey = username ? username.replace(/^@/, '').trim().toLowerCase() : '';
  const usernameKeys = await collectUsernameKeysForUid(db, uid);
  if (usernameKey && !usernameKeys.includes(usernameKey)) {
    usernameKeys.unshift(usernameKey);
  }
  const creatorSnap = await db.ref(`creators/${uid}`).get();
  const deletionReason = formatDeletionReason(trigger, reason);
  const emailSent = await sendDeletionEmail(authUser, deletionReason);

  await archiveRef.set({
    uid,
    email: authUser?.email || null,
    displayName: normalizeDisplayName(row, authUser),
    username: usernameKey || null,
    usernameKeys,
    creatorApproved: creatorAccessIsApprovedFromDb(row),
    reason: deletionReason,
    trigger,
    deletedAt: Date.now(),
    deletedBy: actorUid,
    emailSent,
      moderation: {
        activeBanCount: moderation.activeBanCount,
        totalBanCount: moderation.totalBanCount,
        currentBanExpiresAt: moderation.currentBanExpiresAt,
        history: moderation.history,
      },
    snapshot: {
      status: row?.status || null,
      publicProfile: row?.publicProfile || null,
      creator: creatorSnap.exists() ? creatorSnap.val() || null : null,
    },
  });

  const updates = {
    [`usuarios/${uid}`]: null,
    [`usuarios_publicos/${uid}`]: null,
    [`creators/${uid}`]: null,
  };
  usernameKeys.forEach((key) => {
    updates[`usernames/${key}`] = null;
  });
  await db.ref().update(updates);
  await getAuth().deleteUser(uid);

  return {
    ok: true,
    deleted: true,
    uid,
    email: authUser?.email || null,
    trigger,
  };
}

export const adminListUsers = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  await requireSuperAdmin(request.auth);

  const db = getDatabase();
  const [authPage, usersSnap, registrySnap] = await Promise.all([
    getAuth().listUsers(1000),
    db.ref('usuarios').get(),
    db.ref(ADMIN_REGISTRY_PATH).get(),
  ]);

  const usersRows = usersSnap.exists() ? usersSnap.val() || {} : {};
  const staffRegistry = registrySnap.exists() ? registrySnap.val() || {} : {};

  const users = authPage.users
    .map((authUser) => {
      const uid = String(authUser.uid || '').trim();
      const row = usersRows?.[uid] || {};
      const moderation = computeModerationSummary(row);
      const creatorApproved = creatorAccessIsApprovedFromDb(row);
      const canOwnWorks = rowCanOwnWorks(row);
      const staffRole = staffRegistry?.[uid]?.role || null;
      const accountKind = staffRole
        ? 'staff'
        : canOwnWorks
          ? 'writer'
          : 'reader';

      return {
        uid,
        email: authUser.email || null,
        displayName: normalizeDisplayName(row, authUser),
        username: normalizeUsername(row),
        avatarUrl: normalizeAvatar(row),
        accountKind,
        creatorApproved,
        protected: staffRole === 'super_admin' || staffRole === 'admin',
        staffRole: staffRole || null,
        status: String(row?.status || '').trim().toLowerCase() === 'banido' ? 'banido' : 'ativo',
        moderation: {
          activeBanCount: moderation.activeBanCount,
          totalBanCount: moderation.totalBanCount,
          isBanned: moderation.isBanned,
          lastBanReason: moderation.lastBanReason,
          currentBanExpiresAt: moderation.currentBanExpiresAt,
          history: moderation.history.slice(0, 12),
        },
      };
    })
    .sort((a, b) => {
      const kindOrder = { staff: 0, writer: 1, reader: 2 };
      const diff = (kindOrder[a.accountKind] ?? 9) - (kindOrder[b.accountKind] ?? 9);
      if (diff !== 0) return diff;
      const labelA = String(a.displayName || a.username || a.email || a.uid).toLowerCase();
      const labelB = String(b.displayName || b.username || b.email || b.uid).toLowerCase();
      return labelA.localeCompare(labelB, 'pt-BR');
    });

  return { ok: true, users };
});

export const adminModerateUser = onCall({
  region: 'us-central1',
  secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
}, async (request) => {
  assertTrustedAppRequest(request);
  await requireSuperAdmin(request.auth);

  const action = String(request.data?.action || '').trim().toLowerCase();
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'Uid obrigatorio.');
  }

  const authUser = await getAuth().getUser(uid);
  await ensureTargetIsModeratable({ uid, authUser });

  const db = getDatabase();
  const userRef = db.ref(`usuarios/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists()) {
    throw new HttpsError('not-found', 'Usuario nao encontrado na base principal.');
  }
  const row = userSnap.val() || {};
  const moderation = computeModerationSummary(row);
  const actorUid = request.auth.uid;

  if (action === 'ban') {
    const reason = normalizeReason(request.data?.reason, 'motivo do ban');
    const nextTotalBanCount = moderation.totalBanCount + 1;
    const banDurationMs = getBanDurationMs(nextTotalBanCount);
    const banExpiresAt = banDurationMs > 0 ? Date.now() + banDurationMs : 0;
    const bansRemaining = Math.max(0, 4 - nextTotalBanCount);
    const durationLabel = formatBanDurationLabel(nextTotalBanCount);
    const historyRef = userRef.child('moderation/history').push();
    if (nextTotalBanCount >= 4) {
      await historyRef.set({
        type: 'ban',
        active: true,
        reason,
        createdAt: Date.now(),
        createdBy: actorUid,
      });
      return archiveAndDeleteUser({
        uid,
        authUser,
        row: {
          ...row,
          status: 'banido',
          banReason: reason,
          moderation: {
            ...(row?.moderation || {}),
            activeBanCount: moderation.activeBanCount + 1,
            totalBanCount: nextTotalBanCount,
            lastBanReason: reason,
            history: {
              ...(row?.moderation?.history || {}),
              [historyRef.key]: {
                type: 'ban',
                active: true,
                reason,
                createdAt: Date.now(),
                createdBy: actorUid,
              },
            },
          },
        },
        reason: 'Voce infringiu 4/4 bans por nao respeitar as politicas da plataforma.',
        actorUid,
        trigger: 'ban_threshold',
      });
    }

    await userRef.update({
      status: 'banido',
      banReason: reason,
      moderation: {
        ...(row?.moderation || {}),
        isBanned: true,
        activeBanCount: moderation.activeBanCount + 1,
        totalBanCount: nextTotalBanCount,
        lastBanReason: reason,
        currentBanExpiresAt: banExpiresAt || null,
        updatedAt: Date.now(),
      },
    });
    await historyRef.set({
      type: 'ban',
      active: true,
      reason,
      createdAt: Date.now(),
      createdBy: actorUid,
      expiresAt: banExpiresAt || null,
      durationMs: banDurationMs || null,
    });
    const _BAN_MESSAGE =
      `Sua conta recebeu o ${nextTotalBanCount}o ban. Motivo: ${reason}. ` +
      `Duracao desta punicao: ${durationLabel}. ` +
      (bansRemaining > 0
        ? `Se houver reincidencia, faltam ${bansRemaining} ban(s) para exclusao permanente da conta.`
        : 'Este ban aciona a exclusao permanente da conta.');
    await pushUserNotification(db, uid, {
      type: 'account_moderation',
      title: 'Conta bloqueada',
      message: _BAN_MESSAGE, /*
      message:
        `Sua conta recebeu o ${nextTotalBanCount}º ban. Motivo: ${reason}. ` +
        `Duração desta punição: ${durationLabel}. ` +
        (bansRemaining > 0
          ? `Se houver reincidência, faltam ${bansRemaining} ban(s) para exclusão permanente da conta.`
          : 'Este ban aciona a exclusão permanente da conta.'),
      */
      targetPath: '/perfil',
      data: {
        reason,
        action: 'ban',
        readPath: '/perfil',
        banExpiresAt: banExpiresAt || null,
        totalBanCount: nextTotalBanCount,
        bansRemaining,
        durationLabel,
      },
    });

    return {
      ok: true,
      uid,
      action: 'ban',
      banExpiresAt: banExpiresAt || null,
      totalBanCount: nextTotalBanCount,
      bansRemaining,
      durationLabel,
    };
  }

  if (action === 'revert_ban') {
    const historyId = String(request.data?.historyId || '').trim();
    const revertReason = normalizeReason(request.data?.reason, 'motivo da reversao');
    if (!historyId) {
      throw new HttpsError('invalid-argument', 'Informe o ban que sera revertido.');
    }
    const historyRef = userRef.child(`moderation/history/${historyId}`);
    const historySnap = await historyRef.get();
    if (!historySnap.exists()) {
      throw new HttpsError('not-found', 'Historico de ban nao encontrado.');
    }
    const historyItem = historySnap.val() || {};
    if (historyItem.type !== 'ban' || historyItem.active !== true) {
      throw new HttpsError('failed-precondition', 'Este ban ja foi revertido ou nao esta ativo.');
    }

    const nextActiveBanCount = Math.max(0, moderation.activeBanCount - 1);
    const nextTotalBanCount = Math.max(0, moderation.totalBanCount - 1);
    const remainingHistory = moderation.history.filter((item) => item.id !== historyId);
    const activeReasons = remainingHistory
      .filter((item) => item.type === 'ban' && item.active === true)
      .map((item) => String(item.reason || '').trim())
      .filter(Boolean);
    const nextActiveBan = remainingHistory.find((item) => isBanHistoryItemActive(item)) || null;

    await historyRef.update({
      active: false,
      revertedAt: Date.now(),
      revertedBy: actorUid,
      revertReason,
    });
    await userRef.update({
      status: nextActiveBanCount > 0 ? 'banido' : 'ativo',
      banReason: activeReasons[0] || null,
      moderation: {
        ...(row?.moderation || {}),
        isBanned: nextActiveBanCount > 0,
        activeBanCount: nextActiveBanCount,
        totalBanCount: nextTotalBanCount,
        lastBanReason: activeReasons[0] || null,
        currentBanExpiresAt: Number(nextActiveBan?.expiresAt || 0) || null,
        updatedAt: Date.now(),
      },
    });

    await pushUserNotification(db, uid, {
      type: 'account_moderation',
      title: 'Conta reativada',
      message:
        `Um ban anterior foi removido pela equipe. Motivo: ${revertReason}. ` +
        `Agora sua conta tem ${nextTotalBanCount} ban(s) acumulado(s).`,
      targetPath: '/perfil',
      data: {
        reason: revertReason,
        action: 'unban',
        readPath: '/perfil',
        totalBanCount: nextTotalBanCount,
        bansRemaining: Math.max(0, 4 - nextTotalBanCount),
      },
    });

    return {
      ok: true,
      uid,
      action: 'revert_ban',
      totalBanCount: nextTotalBanCount,
      bansRemaining: Math.max(0, 4 - nextTotalBanCount),
    };
  }

  throw new HttpsError('invalid-argument', 'Acao de moderacao desconhecida.');
});

export const adminDeleteUserByEmail = onCall({
  region: 'us-central1',
  secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
}, async (request) => {
  assertTrustedAppRequest(request);
  await requireSuperAdmin(request.auth);

  const email = String(request.data?.email || '').trim().toLowerCase();
  const reason = normalizeReason(request.data?.reason, 'motivo da exclusao');
  if (!email) {
    throw new HttpsError('invalid-argument', 'Informe o e-mail da conta.');
  }

  const uid = await resolveTargetUidByEmail(email);
  if (!uid) {
    throw new HttpsError('not-found', 'Usuario nao encontrado com este e-mail.');
  }

  const authUser = await getAuth().getUser(uid);
  await ensureTargetIsModeratable({ uid, authUser });

  const userSnap = await getDatabase().ref(`usuarios/${uid}`).get();
  const row = userSnap.exists() ? userSnap.val() || {} : {};

  return archiveAndDeleteUser({
    uid,
    authUser,
    row,
    reason,
    actorUid: request.auth.uid,
    trigger: 'manual_delete',
  });
});

export const adminDeleteUserByUid = onCall({
  region: 'us-central1',
  secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
}, async (request) => {
  assertTrustedAppRequest(request);
  await requireSuperAdmin(request.auth);

  const uid = String(request.data?.uid || '').trim();
  const reason = normalizeReason(request.data?.reason, 'motivo da exclusao');
  if (!uid) {
    throw new HttpsError('invalid-argument', 'Informe o UID da conta.');
  }

  const authUser = await getAuth().getUser(uid);
  await ensureTargetIsModeratable({ uid, authUser });

  const db = getDatabase();
  const userSnap = await db.ref(`usuarios/${uid}`).get();
  const row = userSnap.exists() ? userSnap.val() || {} : {};

  return archiveAndDeleteUser({
    uid,
    authUser,
    row,
    reason,
    actorUid: request.auth.uid,
    trigger: 'manual_delete',
  });
});
