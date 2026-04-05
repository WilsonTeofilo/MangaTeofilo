import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ADMIN_REGISTRY_PATH,
  isTargetSuperAdmin,
  requireSuperAdmin,
} from '../adminRbac.js';
import { evaluateCreatorApplicationApprovalGate } from '../creatorApplicationGate.js';
import {
  CREATOR_MEMBERSHIP_PRICE_MAX_BRL,
  CREATOR_MEMBERSHIP_PRICE_MIN_BRL,
  hasPublicCreatorMembershipOffer,
} from '../creatorMembershipPricing.js';
import { recordCreatorManualPixPayout } from '../creatorDataLedger.js';
import { requireMonetizationComplianceOrThrow } from '../monetizationComplianceAdmin.js';
import { APP_BASE_URL } from '../payments/config.js';
import { round2 } from '../orders/storeCommon.js';
import { notifyUserByPreference } from '../notifications/delivery.js';
import { resolveCreatorAgeYears } from '../creatorCompliance.js';
import {
  assembleCreatorRecordForRtdb,
  resolveCreatorMonetizationStatusFromDb,
} from '../creatorRecord.js';

function resolveCreatorRequestedAtMs(row, app) {
  const top = Number(row?.creatorRequestedAt || 0);
  if (Number.isFinite(top) && top > 0) return top;
  const c1 = Number(app?.createdAt || 0);
  if (Number.isFinite(c1) && c1 > 0) return c1;
  const c2 = Number(app?.updatedAt || 0);
  if (Number.isFinite(c2) && c2 > 0) return c2;
  return 0;
}

function slugifyCreatorUsername(input, uid) {
  const base = String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = String(uid || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  return `${base || 'criador'}${suffix ? `-${suffix}` : ''}`;
}

function buildCreatorLifecycleEmail(base, payload) {
  const profilePath = `${base}/perfil`;
  return {
    subject: String(payload?.subject || 'Atualizacao da sua conta').trim() || 'Atualizacao da sua conta',
    text: `${String(payload?.message || '').trim()}\n\nAbra seu perfil: ${profilePath}`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#f2f2f2;padding:28px;border-radius:10px;">
        <h2 style="margin:0 0 12px;color:#ffcc00;">${String(payload?.title || 'Atualizacao')}</h2>
        <p style="margin:0 0 18px;color:#d0d0d0;">${String(payload?.message || '').trim()}</p>
        <a href="${profilePath}" style="display:inline-block;background:#ffcc00;color:#000;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">
          Abrir meu perfil
        </a>
      </div>
    `,
  };
}

function normalizeReviewReason(raw, fallback = '') {
  return String(raw || fallback || '').trim().slice(0, 500);
}

function maskPixKeyForAdminSnapshot(rawPixKey) {
  const value = String(rawPixKey || '').trim();
  if (!value) return null;
  if (value.length <= 6) return value;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

async function buildCreatorApplicationRow(uid, row, creatorDataRow = null) {
  let email = null;
  try {
    const user = await getAuth().getUser(uid);
    email = user.email || null;
  } catch {
    email = null;
  }
  const app =
    row?.creatorApplication && typeof row.creatorApplication === 'object'
      ? row.creatorApplication
      : {};
  const approvalGate = evaluateCreatorApplicationApprovalGate(row);
  const creatorData = creatorDataRow && typeof creatorDataRow === 'object' ? creatorDataRow : {};
  const balance = creatorData?.balance && typeof creatorData.balance === 'object' ? creatorData.balance : null;
  const payoutsRaw = creatorData?.payouts && typeof creatorData.payouts === 'object' ? creatorData.payouts : null;
  const recentPayouts = payoutsRaw
    ? Object.entries(payoutsRaw)
        .map(([payoutId, payoutRow]) => ({ payoutId, ...(payoutRow || {}) }))
        .sort((a, b) => Number(b.paidAt || b.createdAt || 0) - Number(a.paidAt || a.createdAt || 0))
        .slice(0, 3)
    : [];
  return {
    uid,
    email,
    userName: String(row?.userName || ''),
    userAvatar: String(row?.userAvatar || ''),
    creatorDisplayName: String(row?.creatorDisplayName || app.displayName || ''),
    creatorBio: String(row?.creatorBio || ''),
    creatorBioShort: String(app.bioShort || ''),
    creatorInstagramUrl: String(row?.instagramUrl || app?.socialLinks?.instagramUrl || ''),
    creatorYoutubeUrl: String(row?.youtubeUrl || app?.socialLinks?.youtubeUrl || ''),
    creatorApplication: app,
    creatorStatus: String(row?.creatorStatus || ''),
    creatorOnboardingCompleted: row?.creatorOnboardingCompleted === true,
    creatorMonetizationPreference: String(
      row?.creatorMonetizationPreference || app?.monetizationPreference || ''
    ),
    creatorMonetizationStatus: resolveCreatorMonetizationStatusFromDb(row),
    birthYear: Number(row?.birthYear || 0) || null,
    birthDate: String(row?.birthDate || '').trim() || null,
    creatorComplianceSummary: (() => {
      const c = row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null;
      if (!c) return null;
      const tax = String(c.taxId || '');
      const last4 = tax.length >= 4 ? tax.slice(-4) : '';
      return {
        legalFullName: String(c.legalFullName || '').trim() || null,
        taxIdLast4: last4 || null,
        hasPayoutInstructions: String(c.payoutInstructions || '').trim().length >= 1,
      };
    })(),
    creatorComplianceAdmin: (() => {
      const c = row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null;
      if (!c) return null;
      const taxDigits = String(c.taxId || '').replace(/\D/g, '');
      return {
        legalFullName: String(c.legalFullName || '').trim() || null,
        taxIdDigits: taxDigits.length === 11 ? taxDigits : taxDigits || null,
        payoutPixType: String(c.payoutPixType || '').trim().toLowerCase() || null,
        payoutKey: String(c.payoutInstructions || '').trim() || null,
      };
    })(),
    creatorBannerUrl: String(row?.creatorBannerUrl || '').trim() || null,
    creatorMonetizationV2: (() => {
      const m = row?.creator?.monetization;
      if (m && typeof m === 'object') {
        return {
          requested: m.requested === true,
          enabled: m.enabled === true,
          approved: m.approved === true,
          hasLegal: Boolean(m.legal?.fullName && m.legal?.cpf),
          hasPixKey: Boolean(m.payout?.type === 'pix' && String(m.payout?.key || '').trim()),
        };
      }
      return null;
    })(),
    signupIntent: String(row?.signupIntent || ''),
    creatorApplicationStatus: String(row?.creatorApplicationStatus || ''),
    creatorRequestedAt: resolveCreatorRequestedAtMs(row, app),
    creatorApprovalMetrics: approvalGate.metrics,
    creatorApprovalThresholds: approvalGate.thresholds,
    creatorApprovalMetricsOk: approvalGate.ok,
    creatorApprovalShortfalls: approvalGate.shortfalls,
    creatorApprovalSurplus: approvalGate.surplus,
    creatorApprovedAt: Number(row?.creatorApprovedAt || 0),
    creatorRejectedAt: Number(row?.creatorRejectedAt || 0),
    creatorReviewedBy: String(row?.creatorReviewedBy || ''),
    creatorReviewReason: String(row?.creatorReviewReason || app?.reviewReason || ''),
    creatorModerationAction: String(row?.creatorModerationAction || ''),
    creatorModerationBy: String(row?.creatorModerationBy || ''),
    creatorModeratedAt: Number(row?.creatorModeratedAt || 0),
    creatorMonetizationReviewReason: String(row?.creatorMonetizationReviewReason || ''),
    creatorMonetizationReviewRequestedAt: Number(row?.creatorMonetizationReviewRequestedAt || 0),
    creatorBalanceAdmin: balance
      ? {
          availableBRL: round2(Number(balance.availableBRL || 0)),
          pendingPayoutBRL: round2(Number(balance.pendingPayoutBRL || 0)),
          lifetimeNetBRL: round2(Number(balance.lifetimeNetBRL || 0)),
          paidOutBRL: round2(Number(balance.paidOutBRL || 0)),
          updatedAt: Number(balance.updatedAt || 0) || null,
          lastPayoutAt: Number(balance.lastPayoutAt || 0) || null,
        }
      : null,
    creatorRecentPayoutsAdmin: recentPayouts.map((p) => ({
      payoutId: String(p.payoutId || ''),
      amount: round2(Number(p.amount || 0)),
      status: String(p.status || ''),
      paidAt: Number(p.paidAt || 0) || null,
      pixType: String(p.pixType || ''),
      pixKeyMasked: String(p.pixKeyMasked || ''),
      paidByUid: String(p.paidByUid || ''),
      notes: String(p.notes || ''),
    })),
    role: String(row?.role || 'user'),
    accountStatus: String(row?.status || ''),
  };
}

export async function finalizeCreatorApplicationApproval(db, uid, row, reviewedByUid, options = {}) {
  const isAutoPublishOnly = options?.isAutoPublishOnly === true;
  const effectiveBy = isAutoPublishOnly
    ? '__auto_publish_only__'
    : String(reviewedByUid || '').trim() || 'unknown';
  const now = Date.now();
  const application =
    row?.creatorApplication && typeof row.creatorApplication === 'object'
      ? row.creatorApplication
      : {};
  const displayName =
    String(row?.creatorDisplayName || application.displayName || row?.userName || '').trim() || 'Criador';
  const currentUserAvatar = String(row?.userAvatar || '').trim();
  const approvedCreatorAvatar = String(
    application.profileImageUrl || row?.creatorPendingProfileImageUrl || row?.userAvatar || ''
  ).trim();
  const bioShort = String(row?.creatorBio || application.bioShort || '').trim();
  const instagramUrl = String(row?.instagramUrl || application?.socialLinks?.instagramUrl || '').trim();
  const youtubeUrl = String(row?.youtubeUrl || application?.socialLinks?.youtubeUrl || '').trim();
  const monetizationPreference =
    String(row?.creatorMonetizationPreference || application?.monetizationPreference || 'publish_only')
      .trim()
      .toLowerCase() === 'monetize'
      ? 'monetize'
      : 'publish_only';
  const age = resolveCreatorAgeYears(row);
  const isUnderage = age != null && age < 18;
  const monetizationStatus =
    monetizationPreference === 'monetize'
      ? isUnderage
        ? 'blocked_underage'
        : 'active'
      : 'disabled';
  const creatorUsername = slugifyCreatorUsername(displayName, uid);
  const creatorProfile = {
    creatorId: uid,
    displayName,
    username: creatorUsername,
    bioShort,
    bioFull: String(row?.creatorBio || '').trim(),
    avatarUrl: approvedCreatorAvatar || '',
    bannerUrl: '',
    socialLinks: {
      instagramUrl: instagramUrl || null,
      youtubeUrl: youtubeUrl || null,
    },
    monetizationEnabled: monetizationStatus === 'active',
    monetizationPreference,
    monetizationStatus,
    ageVerified: age != null,
    status: row?.creatorOnboardingCompleted === true ? 'active' : 'onboarding',
    createdAt: row?.creatorProfile?.createdAt || now,
    updatedAt: now,
  };

  await db.ref(`${ADMIN_REGISTRY_PATH}/${uid}`).remove();

  const authUser = await getAuth().getUser(uid);
  const prevClaims = { ...(authUser.customClaims || {}) };
  delete prevClaims.admin;
  prevClaims.panelRole = 'mangaka';
  await getAuth().setCustomUserClaims(uid, prevClaims);
  if (approvedCreatorAvatar && approvedCreatorAvatar !== authUser.photoURL) {
    await getAuth().updateUser(uid, { photoURL: approvedCreatorAvatar });
  }

  const creatorDocApproved = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: String(row?.birthDate || '').trim(),
    displayName,
    bio: bioShort,
    instagramUrl,
    youtubeUrl,
    monetizationPreference,
    creatorMonetizationStatus: monetizationStatus,
    compliance: row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null,
    now,
  });

  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocApproved,
    [`usuarios/${uid}/role`]: 'mangaka',
    [`usuarios/${uid}/signupIntent`]: 'creator',
    [`usuarios/${uid}/creatorApplicationStatus`]: 'approved',
    [`usuarios/${uid}/creatorApplication/status`]: 'approved',
    [`usuarios/${uid}/creatorApplication/updatedAt`]: now,
    [`usuarios/${uid}/creatorApprovedAt`]: now,
    [`usuarios/${uid}/creatorRejectedAt`]: null,
    [`usuarios/${uid}/creatorReviewedBy`]: effectiveBy,
    [`usuarios/${uid}/creatorReviewReason`]: null,
    [`usuarios/${uid}/creatorModerationAction`]: 'approved',
    [`usuarios/${uid}/creatorModerationBy`]: effectiveBy,
    [`usuarios/${uid}/creatorModeratedAt`]: now,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios/${uid}/creatorOnboardingStartedAt`]: row?.creatorOnboardingStartedAt || now,
    [`usuarios/${uid}/creatorOnboardingCompleted`]: row?.creatorOnboardingCompleted === true,
    [`usuarios/${uid}/userAvatar`]: approvedCreatorAvatar || currentUserAvatar || null,
    [`usuarios/${uid}/creatorProfile`]: creatorProfile,
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: null,
    [`usuarios/${uid}/creatorBannerUrl`]: null,
    [`usuarios/${uid}/creatorStatus`]:
      row?.creatorOnboardingCompleted === true ? 'active' : 'onboarding',
    [`usuarios/${uid}/creatorMonetizationPreference`]: monetizationPreference,
    [`usuarios/${uid}/creatorMonetizationStatus`]: monetizationStatus,
    [`usuarios/${uid}/creatorMonetizationApprovedOnce`]: monetizationPreference === 'monetize' && monetizationStatus === 'active',
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios_publicos/${uid}/signupIntent`]: 'creator',
    [`usuarios_publicos/${uid}/userAvatar`]: approvedCreatorAvatar || currentUserAvatar || null,
    [`usuarios_publicos/${uid}/creatorDisplayName`]: displayName,
    [`usuarios_publicos/${uid}/creatorUsername`]: creatorUsername,
    [`usuarios_publicos/${uid}/creatorBio`]: bioShort,
    [`usuarios_publicos/${uid}/creatorBannerUrl`]: null,
    [`usuarios_publicos/${uid}/instagramUrl`]: instagramUrl || null,
    [`usuarios_publicos/${uid}/youtubeUrl`]: youtubeUrl || null,
    [`usuarios_publicos/${uid}/creatorStatus`]:
      row?.creatorOnboardingCompleted === true ? 'active' : 'onboarding',
    [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: monetizationStatus,
    [`usuarios_publicos/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios_publicos/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios_publicos/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios_publicos/${uid}/creatorProfile`]: {
      creatorId: uid,
      userId: uid,
      displayName,
      username: creatorUsername,
      bioShort,
      bioFull: String(row?.creatorBio || '').trim(),
      avatarUrl: approvedCreatorAvatar || currentUserAvatar || '',
      bannerUrl: '',
      socialLinks: {
        instagramUrl: instagramUrl || null,
        youtubeUrl: youtubeUrl || null,
      },
      stats: {
        followersCount: Number(row?.creatorProfile?.stats?.followersCount || 0),
        totalLikes: Number(row?.creatorProfile?.stats?.totalLikes || 0),
        totalViews: Number(row?.creatorProfile?.stats?.totalViews || 0),
        totalComments: Number(row?.creatorProfile?.stats?.totalComments || 0),
      },
      createdAt: row?.creatorProfile?.createdAt || now,
      updatedAt: now,
    },
    [`usuarios_publicos/${uid}/stats`]: {
      followersCount: Number(row?.creatorProfile?.stats?.followersCount || 0),
      totalLikes: Number(row?.creatorProfile?.stats?.totalLikes || 0),
      totalViews: Number(row?.creatorProfile?.stats?.totalViews || 0),
      totalComments: Number(row?.creatorProfile?.stats?.totalComments || 0),
    },
    [`usuarios_publicos/${uid}/followersCount`]: Number(row?.creatorProfile?.stats?.followersCount || 0),
    [`usuarios_publicos/${uid}/userName`]: displayName,
    [`usuarios_publicos/${uid}/accountType`]: String(row?.accountType || 'comum'),
    [`usuarios_publicos/${uid}/updatedAt`]: now,
    [`creators/${uid}/stats/followersCount`]: Number(row?.creatorProfile?.stats?.followersCount || 0),
    [`creators/${uid}/stats/likesTotal`]: Number(row?.creatorProfile?.stats?.totalLikes || 0),
    [`creators/${uid}/stats/totalViews`]: Number(row?.creatorProfile?.stats?.totalViews || 0),
    [`creators/${uid}/stats/commentsTotal`]: Number(row?.creatorProfile?.stats?.totalComments || 0),
    [`creators/${uid}/stats/membersCount`]: Number(row?.creatorProfile?.stats?.membersCount || 0),
    [`creators/${uid}/stats/revenueTotal`]: Number(row?.creatorProfile?.stats?.revenueTotal || 0),
    [`creators/${uid}/stats/uniqueReaders`]: Number(row?.creatorProfile?.stats?.uniqueReaders || 0),
    [`creators/${uid}/stats/updatedAt`]: now,
  });

  const approvalMessage = isAutoPublishOnly
    ? 'Voce ja pode publicar como criador. Se o painel nao aparecer, recarregue a pagina ou faca login de novo.'
    : monetizationStatus === 'blocked_underage'
      ? 'Voce foi aprovado para publicar, mas a monetizacao ficou bloqueada por idade. Sua conta esta liberada apenas para publicacao.'
      : monetizationStatus === 'active'
        ? 'Voce foi aprovado como criador e sua monetizacao foi ativada.'
        : monetizationPreference === 'monetize'
          ? 'Voce foi aprovado como criador e ja pode ativar ou desativar sua monetizacao livremente no perfil.'
          : 'Voce foi aprovado como criador para publicar na plataforma.';
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: 'creator_application',
      title: isAutoPublishOnly ? 'Acesso de criador liberado' : 'Solicitacao aprovada',
      message: approvalMessage,
      dedupeKey: `creator_lifecycle:application_approved:${uid}:${now}`,
      dedupeWindowMs: 0,
      allowGrouping: false,
      data: {
        status: 'approved',
        creatorStatus: row?.creatorOnboardingCompleted === true ? 'active' : 'onboarding',
        monetizationStatus,
        monetizationPreference,
        readPath: '/perfil',
        autoApproved: isAutoPublishOnly,
      },
    },
    email: buildCreatorLifecycleEmail(APP_BASE_URL.value().replace(/\/$/, ''), {
      title: isAutoPublishOnly ? 'Acesso de criador liberado' : 'Solicitacao aprovada',
      subject: isAutoPublishOnly
        ? 'Voce ja pode publicar na plataforma'
        : 'Sua solicitacao de criador foi aprovada',
      message: approvalMessage,
    }),
  });

  return { ok: true, uid, status: 'approved', monetizationStatus, monetizationPreference };
}

export const adminListCreatorApplications = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const [snap, creatorDataSnap] = await Promise.all([
    db.ref('usuarios').get(),
    db.ref('creatorData').get(),
  ]);
  const users = snap.val() || {};
  const creatorDataByUid = creatorDataSnap.exists() ? creatorDataSnap.val() || {} : {};
  const rows = await Promise.all(
    Object.entries(users)
      .filter(([, row]) => String(row?.signupIntent || '') === 'creator')
      .map(([uid, row]) => buildCreatorApplicationRow(uid, row, creatorDataByUid?.[uid] || null))
  );
  rows.sort((a, b) => {
    const queueScore = (r) => {
      const s = String(r?.creatorApplicationStatus || '').trim().toLowerCase();
      const mon = String(r?.creatorMonetizationStatus || '').trim().toLowerCase();
      const role = String(r?.role || '').trim().toLowerCase();
      if (s === 'requested') return 2;
      if (s === 'approved' && mon !== 'active' && role === 'mangaka' && Number(r?.creatorMonetizationReviewRequestedAt || 0) > 0) return 1;
      return 0;
    };
    const diff = queueScore(b) - queueScore(a);
    if (diff !== 0) return diff;
    return Number(b.creatorRequestedAt || 0) - Number(a.creatorRequestedAt || 0);
  });
  return { ok: true, applications: rows };
});

export const adminApproveCreatorApplication = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid obrigatorio.');
  }
  const db = getDatabase();
  const userRef = db.ref(`usuarios/${uid}`);
  const snap = await userRef.get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Usuario nao encontrado.');
  }
  const row = snap.val() || {};
  const role = String(row?.role || '').trim().toLowerCase();
  const appStatus = String(row?.creatorApplicationStatus || '').trim().toLowerCase();

  let targetEmail = '';
  try {
    const tu = await getAuth().getUser(uid);
    targetEmail = tu.email || '';
  } catch {
    throw new HttpsError('not-found', 'Usuario alvo nao encontrado no Auth.');
  }
  if (isTargetSuperAdmin({ uid, email: targetEmail })) {
    throw new HttpsError('failed-precondition', 'Nao e possivel aprovar administradores chefes como creator.');
  }
  const regSnap = await db.ref(`${ADMIN_REGISTRY_PATH}/${uid}`).get();
  const regRow = regSnap.val();
  if (regRow && regRow.role === 'admin') {
    throw new HttpsError(
      'failed-precondition',
      'Este usuario ja e da equipe (admin). Remova o acesso administrativo antes de aprovar como creator.'
    );
  }

  if (appStatus === 'approved' && role === 'mangaka') {
    return { ok: true, uid, status: 'approved', alreadyApproved: true };
  }
  if (appStatus === 'requested') {
    const gate = evaluateCreatorApplicationApprovalGate(row);
    if (!gate.ok) {
      throw new HttpsError(
        'failed-precondition',
        `Aprovacao bloqueada: metas do Nivel 1 nao atingidas (seguidores ${gate.metrics.followers}/${gate.thresholds.followers}, views ${gate.metrics.views}/${gate.thresholds.views}, likes ${gate.metrics.likes}/${gate.thresholds.likes}).`
      );
    }
  }
  await finalizeCreatorApplicationApproval(db, uid, row, request.auth.uid, { isAutoPublishOnly: false });
  return { ok: true, uid, status: 'approved' };
});

export const adminRejectCreatorApplication = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid obrigatorio.');
  }
  const reason = normalizeReviewReason(request.data?.reason);
  if (reason.length < 8) {
    throw new HttpsError('invalid-argument', 'Informe um motivo de reprovacao com pelo menos 8 caracteres.');
  }
  const banUser = request.data?.banUser === true;
  const db = getDatabase();
  const userSnap = await db.ref(`usuarios/${uid}`).get();
  const row = userSnap.exists() ? userSnap.val() || {} : {};
  const now = Date.now();
  await db.ref().update({
    [`usuarios/${uid}/creatorApplicationStatus`]: 'rejected',
    [`usuarios/${uid}/creatorApplication/status`]: 'rejected',
    [`usuarios/${uid}/creatorApplication/updatedAt`]: now,
    [`usuarios/${uid}/creatorApplication/reviewReason`]: reason,
    [`usuarios/${uid}/creatorRejectedAt`]: now,
    [`usuarios/${uid}/creatorReviewedBy`]: request.auth.uid,
    [`usuarios/${uid}/role`]: 'user',
    [`usuarios/${uid}/creatorStatus`]: banUser ? 'banned' : 'rejected',
    [`usuarios/${uid}/creatorReviewReason`]: reason,
    [`usuarios/${uid}/creatorModerationAction`]: banUser ? 'banned' : 'rejected',
    [`usuarios/${uid}/creatorModerationBy`]: request.auth.uid,
    [`usuarios/${uid}/creatorModeratedAt`]: now,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios/${uid}/creatorMonetizationStatus`]: 'disabled',
    [`usuarios/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: null,
    [`usuarios/${uid}/status`]: banUser ? 'banido' : null,
    [`usuarios/${uid}/banReason`]: banUser ? reason : null,
    [`usuarios_publicos/${uid}/creatorStatus`]: banUser ? 'banned' : 'rejected',
    [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: 'disabled',
    [`usuarios_publicos/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios_publicos/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios_publicos/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios_publicos/${uid}/status`]: banUser ? 'banido' : null,
    [`usuarios_publicos/${uid}/updatedAt`]: now,
  });
  const rejectMessage = banUser
    ? `Sua conta foi bloqueada pela equipe. Motivo: ${reason}`
    : `Sua solicitacao de criador nao foi aprovada agora. Motivo: ${reason}`;
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: banUser ? 'account_moderation' : 'creator_application',
      title: banUser ? 'Conta bloqueada' : 'Solicitacao rejeitada',
      message: rejectMessage,
      dedupeKey: `creator_lifecycle:application_rejected:${uid}:${now}`,
      dedupeWindowMs: 0,
      allowGrouping: false,
      data: { status: 'rejected', reason, banUser, readPath: '/perfil' },
    },
    email: buildCreatorLifecycleEmail(APP_BASE_URL.value().replace(/\/$/, ''), {
      title: banUser ? 'Conta bloqueada' : 'Solicitacao rejeitada',
      subject: banUser ? 'Sua conta foi bloqueada' : 'Sua solicitacao de criador foi rejeitada',
      message: rejectMessage,
    }),
  });
  return { ok: true, uid, status: 'rejected', banUser };
});

export const adminApproveCreatorMonetization = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid obrigatorio.');
  }
  const db = getDatabase();
  const snap = await db.ref(`usuarios/${uid}`).get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Usuario nao encontrado.');
  }
  const row = snap.val() || {};
  if (String(row?.role || '').trim().toLowerCase() !== 'mangaka') {
    throw new HttpsError('failed-precondition', 'A monetizacao so pode ser aprovada para criadores.');
  }
  const complianceRow =
    row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null;
  requireMonetizationComplianceOrThrow(complianceRow);
  const age = resolveCreatorAgeYears(row);
  const isUnderage = age != null && age < 18;
  const now = Date.now();
  const monetizationStatus = isUnderage ? 'blocked_underage' : 'active';
  const canPublishMembership = monetizationStatus === 'active' && hasPublicCreatorMembershipOffer(row);
  const membershipPricePub = canPublishMembership ? Number(row.creatorMembershipPriceBRL) : null;
  const donationSuggestedPub = canPublishMembership ? Number(row.creatorDonationSuggestedBRL) : null;

  const creatorDocMonApprove = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: String(row?.birthDate || '').trim(),
    displayName: String(row?.creatorDisplayName || row?.userName || '').trim(),
    bio: String(row?.creatorBio || '').trim(),
    instagramUrl: row?.instagramUrl,
    youtubeUrl: row?.youtubeUrl,
    monetizationPreference: 'monetize',
    creatorMonetizationStatus: monetizationStatus,
    compliance: row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null,
    now,
  });

  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocMonApprove,
    [`usuarios/${uid}/creatorMonetizationPreference`]: 'monetize',
    [`usuarios/${uid}/creatorMonetizationStatus`]: monetizationStatus,
    [`usuarios/${uid}/creatorMonetizationApprovedOnce`]: monetizationStatus === 'active',
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios/${uid}/creatorProfile/monetizationPreference`]: 'monetize',
    [`usuarios/${uid}/creatorProfile/monetizationStatus`]: monetizationStatus,
    [`usuarios/${uid}/creatorProfile/monetizationEnabled`]: monetizationStatus === 'active',
    [`usuarios/${uid}/creatorProfile/ageVerified`]: age != null,
    [`usuarios/${uid}/creatorProfile/updatedAt`]: now,
    [`usuarios_publicos/${uid}/creatorMembershipEnabled`]: canPublishMembership,
    [`usuarios_publicos/${uid}/creatorMembershipPriceBRL`]: membershipPricePub,
    [`usuarios_publicos/${uid}/creatorDonationSuggestedBRL`]: donationSuggestedPub,
    [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: monetizationStatus,
    [`usuarios_publicos/${uid}/updatedAt`]: now,
  });

  const monetizationApprovalMessage =
    monetizationStatus === 'active'
      ? canPublishMembership
        ? 'Sua monetizacao foi aprovada. Assinaturas na sua pagina publica ja podem usar os valores que voce configurou.'
        : `Sua monetizacao foi aprovada. No perfil, ative a membership e defina valor da membership e doacao sugerida entre R$ ${CREATOR_MEMBERSHIP_PRICE_MIN_BRL} e R$ ${CREATOR_MEMBERSHIP_PRICE_MAX_BRL} para liberar assinatura com acesso antecipado as suas obras.`
      : 'Sua conta segue liberada para publicar, mas a monetizacao permanece bloqueada por idade.';
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: 'creator_monetization',
      title: monetizationStatus === 'active' ? 'Monetizacao liberada' : 'Monetizacao bloqueada',
      message: monetizationApprovalMessage,
      dedupeKey: `creator_lifecycle:monetization_approved:${uid}:${now}`,
      dedupeWindowMs: 0,
      allowGrouping: false,
      data: { monetizationStatus, readPath: '/perfil' },
    },
    email: buildCreatorLifecycleEmail(APP_BASE_URL.value().replace(/\/$/, ''), {
      title: monetizationStatus === 'active' ? 'Monetizacao liberada' : 'Monetizacao bloqueada',
      subject: monetizationStatus === 'active' ? 'Sua monetizacao foi liberada' : 'Sua monetizacao segue bloqueada',
      message: monetizationApprovalMessage,
    }),
  });

  return { ok: true, uid, monetizationStatus };
});

export const adminRejectCreatorMonetization = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid obrigatorio.');
  }
  const db = getDatabase();
  const snap = await db.ref(`usuarios/${uid}`).get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Usuario nao encontrado.');
  }
  const row = snap.val() || {};
  if (String(row?.role || '').trim().toLowerCase() !== 'mangaka') {
    throw new HttpsError('failed-precondition', 'A monetizacao so pode ser ajustada para criadores.');
  }
  const reason = normalizeReviewReason(request.data?.reason);
  if (reason.length < 8) {
    throw new HttpsError(
      'invalid-argument',
      'Informe um motivo com pelo menos 8 caracteres para manter so publicacao.'
    );
  }
  const now = Date.now();

  const creatorDocMonReject = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: String(row?.birthDate || '').trim(),
    displayName: String(row?.creatorDisplayName || row?.userName || '').trim(),
    bio: String(row?.creatorBio || '').trim(),
    instagramUrl: row?.instagramUrl,
    youtubeUrl: row?.youtubeUrl,
    monetizationPreference: 'publish_only',
    creatorMonetizationStatus: 'disabled',
    compliance: null,
    now,
  });

  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocMonReject,
    [`usuarios/${uid}/creatorMonetizationPreference`]: 'publish_only',
    [`usuarios/${uid}/creatorMonetizationStatus`]: 'disabled',
    [`usuarios/${uid}/creatorMonetizationApprovedOnce`]: false,
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: reason,
    [`usuarios/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios/${uid}/creatorProfile/monetizationPreference`]: 'publish_only',
    [`usuarios/${uid}/creatorProfile/monetizationStatus`]: 'disabled',
    [`usuarios/${uid}/creatorProfile/monetizationEnabled`]: false,
    [`usuarios/${uid}/creatorProfile/updatedAt`]: now,
    [`usuarios_publicos/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios_publicos/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios_publicos/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: 'disabled',
    [`usuarios_publicos/${uid}/updatedAt`]: now,
  });

  const monetizationRejectMessage = `Sua conta segue habilitada para publicar, mas a monetizacao nao foi liberada agora. Motivo: ${reason}`;
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: 'creator_monetization',
      title: 'Monetizacao nao aprovada',
      message: monetizationRejectMessage,
      dedupeKey: `creator_lifecycle:monetization_rejected:${uid}:${now}`,
      dedupeWindowMs: 0,
      allowGrouping: false,
      data: { monetizationStatus: 'disabled', reason, readPath: '/perfil' },
    },
    email: buildCreatorLifecycleEmail(APP_BASE_URL.value().replace(/\/$/, ''), {
      title: 'Monetizacao nao aprovada',
      subject: 'Sua monetizacao nao foi liberada',
      message: monetizationRejectMessage,
    }),
  });

  return { ok: true, uid, monetizationStatus: 'disabled' };
});

export const adminRecordCreatorPixPayout = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid obrigatorio.');
  }
  const db = getDatabase();
  const [userSnap, balanceSnap] = await Promise.all([
    db.ref(`usuarios/${uid}`).get(),
    db.ref(`creatorData/${uid}/balance`).get(),
  ]);
  if (!userSnap.exists()) {
    throw new HttpsError('not-found', 'Criador nao encontrado.');
  }
  const row = userSnap.val() || {};
  if (String(row?.role || '').trim().toLowerCase() !== 'mangaka') {
    throw new HttpsError('failed-precondition', 'Este usuario ainda nao e um criador aprovado.');
  }
  const balance = balanceSnap.exists() ? balanceSnap.val() || {} : {};
  const available = round2(Number(balance?.availableBRL || 0));
  if (!available || available <= 0) {
    throw new HttpsError('failed-precondition', 'Este criador nao possui saldo disponivel para repasse.');
  }
  const requestedAmount =
    request.data?.amount == null ? available : round2(Number(request.data.amount));
  if (!requestedAmount || requestedAmount <= 0) {
    throw new HttpsError('invalid-argument', 'amount invalido.');
  }
  if (requestedAmount - available > 0.009) {
    throw new HttpsError('failed-precondition', 'O valor informado excede o saldo disponivel do criador.');
  }
  const compliance =
    row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null;
  requireMonetizationComplianceOrThrow(compliance);
  const payoutId = await recordCreatorManualPixPayout(db, {
    creatorId: uid,
    amount: requestedAmount,
    currency: 'BRL',
    pixType: String(compliance?.payoutPixType || '').trim().toLowerCase() || null,
    pixKeyMasked: maskPixKeyForAdminSnapshot(compliance?.payoutInstructions),
    paidByUid: request.auth.uid,
    externalTransferId: request.data?.externalTransferId
      ? String(request.data.externalTransferId)
      : null,
    notes: request.data?.notes ? String(request.data.notes) : null,
    paidAt: Date.now(),
  });
  if (!payoutId) {
    throw new HttpsError('internal', 'Nao foi possivel registrar o repasse manual.');
  }
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: 'creator_payout',
      title: 'Repasse PIX registrado',
      message: `Um repasse manual de ${requestedAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} foi marcado pela equipe.`,
      data: {
        payoutId,
        amount: requestedAmount,
        readPath: '/perfil',
      },
    },
  });
  return {
    ok: true,
    uid,
    payoutId,
    amount: requestedAmount,
    remainingAvailableBRL: round2(Math.max(0, available - requestedAmount)),
  };
});
