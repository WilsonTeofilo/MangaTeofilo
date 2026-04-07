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
  readCreatorStatsFromDb,
  resolveCreatorMonetizationPreferenceFromDb,
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

function resolveCreatorMonetizationPreference(row, app = null) {
  return resolveCreatorMonetizationPreferenceFromDb(row, app?.monetizationPreference || 'publish_only');
}

function maskPixKeyForAdminSnapshot(rawPixKey) {
  const value = String(rawPixKey || '').trim();
  if (!value) return null;
  if (value.length <= 6) return value;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function buildPublicCreatorProfileDoc({
  uid,
  currentPublicProfile = null,
  displayName,
  bioShort,
  bioFull = '',
  avatarUrl,
  instagramUrl,
  youtubeUrl,
  monetizationPreference,
  monetizationStatus,
  status,
  createdAt,
  now,
}) {
  const current =
    currentPublicProfile && typeof currentPublicProfile === 'object' ? currentPublicProfile : {};
  return {
    creatorId: uid,
    userId: uid,
    displayName,
    username: current.username || '',
    bioShort,
    bioFull: String(bioFull || '').trim(),
    avatarUrl: avatarUrl || '',
    bannerUrl: String(current.bannerUrl || '').trim(),
    socialLinks: {
      instagramUrl: instagramUrl || null,
      youtubeUrl: youtubeUrl || null,
    },
    monetizationPreference,
    monetizationStatus,
    monetizationEnabled: monetizationStatus === 'active',
    isMonetizationActive: monetizationStatus === 'active',
    isApproved: monetizationStatus === 'active' || current.isApproved === true,
    ageVerified: current.ageVerified === true || current.ageVerified === false ? current.ageVerified : null,
    status,
    createdAt,
    updatedAt: now,
  };
}

async function buildCreatorApplicationRow(uid, row, creatorDataRow = null, creatorStatsRow = null) {
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
  const approvalGate = evaluateCreatorApplicationApprovalGate({
    ...row,
    creatorStats: readCreatorStatsFromDb(row, creatorStatsRow),
  });
  const creatorData = creatorDataRow && typeof creatorDataRow === 'object' ? creatorDataRow : {};
  const balance = creatorData?.balance && typeof creatorData.balance === 'object' ? creatorData.balance : null;
  const payoutsRaw = creatorData?.payouts && typeof creatorData.payouts === 'object' ? creatorData.payouts : null;
  const recentPayouts = payoutsRaw
    ? Object.entries(payoutsRaw)
        .map(([payoutId, payoutRow]) => ({ payoutId, ...(payoutRow || {}) }))
        .sort((a, b) => Number(b.paidAt || b.createdAt || 0) - Number(a.paidAt || a.createdAt || 0))
        .slice(0, 3)
    : [];
  const creatorProfile =
    row?.creator?.profile && typeof row.creator.profile === 'object' ? row.creator.profile : {};
  const creatorSocial =
    row?.creator?.social && typeof row.creator.social === 'object' ? row.creator.social : {};
  return {
    uid,
    email,
    userName: String(row?.userName || ''),
    userAvatar: String(row?.userAvatar || ''),
    creatorDisplayName: String(creatorProfile.displayName || app.displayName || row?.userName || ''),
    creatorBio: String(creatorProfile.bio || ''),
    creatorBioShort: String(app.bioShort || ''),
    creatorInstagramUrl: String(creatorSocial.instagram || app?.socialLinks?.instagramUrl || ''),
    creatorYoutubeUrl: String(creatorSocial.youtube || app?.socialLinks?.youtubeUrl || ''),
    creatorApplication: app,
    creatorStatus: String(row?.creatorStatus || ''),
    creatorOnboardingCompleted: row?.creatorOnboardingCompleted === true,
    creatorMonetizationPreference: resolveCreatorMonetizationPreference(row, app),
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
          isMonetizationActive: m.isMonetizationActive === true || m.enabled === true,
          approved: m.approved === true,
          isApproved: m.isApproved === true || m.approved === true,
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
  const creatorProfileRow =
    row?.creator?.profile && typeof row.creator.profile === 'object' ? row.creator.profile : {};
  const creatorSocialRow =
    row?.creator?.social && typeof row.creator.social === 'object' ? row.creator.social : {};
  const displayName =
    String(creatorProfileRow.displayName || application.displayName || row?.userName || '').trim() || 'Criador';
  const currentUserAvatar = String(row?.userAvatar || '').trim();
  const approvedCreatorAvatar = String(
    application.profileImageUrl || row?.creatorPendingProfileImageUrl || row?.userAvatar || ''
  ).trim();
  const bioShort = String(creatorProfileRow.bio || application.bioShort || '').trim();
  const instagramUrl = String(creatorSocialRow.instagram || application?.socialLinks?.instagramUrl || '').trim();
  const youtubeUrl = String(creatorSocialRow.youtube || application?.socialLinks?.youtubeUrl || '').trim();
  const monetizationPreference = resolveCreatorMonetizationPreference(row, application);
  const age = resolveCreatorAgeYears(row);
  const isUnderage = age != null && age < 18;
  const monetizationStatus =
    monetizationPreference === 'monetize'
      ? isUnderage
        ? 'blocked_underage'
        : 'active'
      : 'disabled';
  const creatorUsername = slugifyCreatorUsername(displayName, uid);
  const creatorStatusNext = row?.creatorOnboardingCompleted === true ? 'active' : 'onboarding';
  const [currentPublicProfileSnap, creatorStatsSnap] = await Promise.all([
    db.ref(`usuarios/${uid}/publicProfile/creatorProfile`).get(),
    db.ref(`creators/${uid}/stats`).get(),
  ]);
  const creatorStats = readCreatorStatsFromDb(
    row,
    creatorStatsSnap.exists() ? creatorStatsSnap.val() || {} : {}
  );
  const publicCreatorProfile = buildPublicCreatorProfileDoc({
    uid,
    currentPublicProfile: currentPublicProfileSnap.exists() ? currentPublicProfileSnap.val() || {} : null,
    displayName,
    bioShort,
    bioFull: String(creatorProfileRow.bio || '').trim(),
    avatarUrl: approvedCreatorAvatar || currentUserAvatar || '',
    instagramUrl,
    youtubeUrl,
    monetizationPreference,
    monetizationStatus,
    status: creatorStatusNext,
    createdAt: Number(row?.creator?.meta?.createdAt || now),
    now,
  });
  publicCreatorProfile.username = creatorUsername;
  publicCreatorProfile.ageVerified = age != null;

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
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: null,
    [`usuarios/${uid}/creatorBannerUrl`]: null,
    [`usuarios/${uid}/creatorStatus`]: creatorStatusNext,
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios/${uid}/publicProfile/signupIntent`]: 'creator',
    [`usuarios/${uid}/publicProfile/userAvatar`]: approvedCreatorAvatar || currentUserAvatar || null,
    [`usuarios/${uid}/publicProfile/creatorDisplayName`]: displayName,
    [`usuarios/${uid}/publicProfile/creatorUsername`]: creatorUsername,
    [`usuarios/${uid}/publicProfile/creatorBio`]: bioShort,
    [`usuarios/${uid}/publicProfile/creatorBannerUrl`]: null,
    [`usuarios/${uid}/publicProfile/instagramUrl`]: instagramUrl || null,
    [`usuarios/${uid}/publicProfile/youtubeUrl`]: youtubeUrl || null,
    [`usuarios/${uid}/publicProfile/creatorStatus`]: creatorStatusNext,
    [`usuarios/${uid}/publicProfile/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/publicProfile/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/publicProfile/creatorDonationSuggestedBRL`]: null,
    [`usuarios/${uid}/publicProfile/creatorProfile`]: publicCreatorProfile,
    [`usuarios/${uid}/publicProfile/userName`]: displayName,
    [`usuarios/${uid}/publicProfile/accountType`]: String(row?.accountType || 'comum'),
    [`usuarios/${uid}/publicProfile/updatedAt`]: now,
    [`creators/${uid}/stats/followersCount`]: creatorStats.followersCount,
    [`creators/${uid}/stats/likesTotal`]: creatorStats.likesTotal,
    [`creators/${uid}/stats/totalViews`]: creatorStats.totalViews,
    [`creators/${uid}/stats/commentsTotal`]: creatorStats.commentsTotal,
    [`creators/${uid}/stats/membersCount`]: creatorStats.membersCount,
    [`creators/${uid}/stats/revenueTotal`]: creatorStats.revenueTotal,
    [`creators/${uid}/stats/uniqueReaders`]: creatorStats.uniqueReaders,
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
  await requireSuperAdmin(request.auth);
  const db = getDatabase();
  const [snap, creatorDataSnap, creatorStatsSnap] = await Promise.all([
    db.ref('usuarios').get(),
    db.ref('creatorData').get(),
    db.ref('creators').get(),
  ]);
  const users = snap.val() || {};
  const creatorDataByUid = creatorDataSnap.exists() ? creatorDataSnap.val() || {} : {};
  const creatorStatsByUid = creatorStatsSnap.exists() ? creatorStatsSnap.val() || {} : {};
  const rows = await Promise.all(
    Object.entries(users)
      .filter(([, row]) => String(row?.signupIntent || '') === 'creator')
      .map(([uid, row]) =>
        buildCreatorApplicationRow(
          uid,
          row,
          creatorDataByUid?.[uid] || null,
          creatorStatsByUid?.[uid]?.stats || null
        )
      )
  );
  rows.sort((a, b) => {
    const queueScore = (r) => {
      const s = String(r?.creatorApplicationStatus || '').trim().toLowerCase();
      const mon = resolveCreatorMonetizationStatusFromDb(r);
      const role = String(r?.role || '').trim().toLowerCase();
      if (s === 'requested') return 2;
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
  await requireSuperAdmin(request.auth);
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
  if (await isTargetSuperAdmin({ uid, email: targetEmail })) {
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
    const creatorStatsSnap = await db.ref(`creators/${uid}/stats`).get();
    const gate = evaluateCreatorApplicationApprovalGate({
      ...row,
      creatorStats: readCreatorStatsFromDb(
        row,
        creatorStatsSnap.exists() ? creatorStatsSnap.val() || {} : {}
      ),
    });
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
  await requireSuperAdmin(request.auth);
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
  const creatorDocRejected = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: String(row?.birthDate || '').trim(),
    displayName: String(row?.creator?.profile?.displayName || row?.userName || '').trim(),
    bio: String(row?.creator?.profile?.bio || '').trim(),
    instagramUrl: row?.creator?.social?.instagram,
    youtubeUrl: row?.creator?.social?.youtube,
    monetizationPreference: resolveCreatorMonetizationPreference(row, row?.creatorApplication),
    creatorMonetizationStatus: 'disabled',
    compliance: row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null,
    now,
  });
  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocRejected,
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
    [`usuarios/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: null,
    [`usuarios/${uid}/status`]: banUser ? 'banido' : null,
    [`usuarios/${uid}/banReason`]: banUser ? reason : null,
    [`usuarios/${uid}/publicProfile/creatorStatus`]: banUser ? 'banned' : 'rejected',
    [`usuarios/${uid}/publicProfile/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/publicProfile/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/publicProfile/creatorDonationSuggestedBRL`]: null,
    [`usuarios/${uid}/publicProfile/status`]: banUser ? 'banido' : null,
    [`usuarios/${uid}/publicProfile/updatedAt`]: now,
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
  await requireSuperAdmin(request.auth);
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
    displayName: String(row?.creator?.profile?.displayName || row?.userName || '').trim(),
    bio: String(row?.creator?.profile?.bio || '').trim(),
    instagramUrl: row?.creator?.social?.instagram,
    youtubeUrl: row?.creator?.social?.youtube,
    monetizationPreference: 'monetize',
    creatorMonetizationStatus: monetizationStatus,
    compliance: row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null,
    now,
  });

  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocMonApprove,
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios/${uid}/publicProfile/creatorMembershipEnabled`]: canPublishMembership,
    [`usuarios/${uid}/publicProfile/creatorMembershipPriceBRL`]: membershipPricePub,
    [`usuarios/${uid}/publicProfile/creatorDonationSuggestedBRL`]: donationSuggestedPub,
    [`usuarios/${uid}/publicProfile/updatedAt`]: now,
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
  await requireSuperAdmin(request.auth);
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
  const monetizationPreference = resolveCreatorMonetizationPreference(row);

  const creatorDocMonReject = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: String(row?.birthDate || '').trim(),
    displayName: String(row?.creator?.profile?.displayName || row?.userName || '').trim(),
    bio: String(row?.creator?.profile?.bio || '').trim(),
    instagramUrl: row?.creator?.social?.instagram,
    youtubeUrl: row?.creator?.social?.youtube,
    monetizationPreference,
    creatorMonetizationStatus: 'disabled',
    compliance: row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null,
    now,
  });

  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocMonReject,
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: reason,
    [`usuarios/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios/${uid}/publicProfile/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/publicProfile/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/publicProfile/creatorDonationSuggestedBRL`]: null,
    [`usuarios/${uid}/publicProfile/updatedAt`]: now,
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
  await requireSuperAdmin(request.auth);
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

