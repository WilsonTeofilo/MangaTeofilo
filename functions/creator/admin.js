import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ADMIN_REGISTRY_PATH,
  isCreatorAccountAuth,
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
  buildCreatorLifecycleEmail,
  buildCreatorPayoutRequestsAdmin,
  buildPublicCreatorProfileDoc,
  maskPixKeyForAdminSnapshot,
  normalizeReviewReason,
  resolveCreatorMonetizationPreference,
  resolveCreatorRequestedAtMs,
} from './adminShared.js';
import {
  assembleCreatorRecordForRtdb,
  creatorAccessIsApprovedFromDb,
  readCreatorSupportOfferFromDb,
  readCreatorStatsFromDb,
  resolveCreatorFinancialStatusFromDb,
  resolveCreatorMonetizationApplicationStatusFromDb,
  resolveCreatorMonetizationStatusFromDb,
} from '../creatorRecord.js';
import { resolveCanonicalPublicHandle } from '../shared/canonicalIdentity.js';

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
  const approvalGate = evaluateCreatorApplicationApprovalGate(row, creatorStatsRow);
  const creatorData = creatorDataRow && typeof creatorDataRow === 'object' ? creatorDataRow : {};
  const balance = creatorData?.balance && typeof creatorData.balance === 'object' ? creatorData.balance : null;
  const payoutsRaw = creatorData?.payouts && typeof creatorData.payouts === 'object' ? creatorData.payouts : null;
  const recentPayouts = payoutsRaw
    ? Object.entries(payoutsRaw)
        .map(([payoutId, payoutRow]) => ({ payoutId, ...(payoutRow || {}) }))
        .sort((a, b) => Number(b.paidAt || b.createdAt || 0) - Number(a.paidAt || a.createdAt || 0))
        .slice(0, 3)
    : [];
  const payoutRequestsAdmin = buildCreatorPayoutRequestsAdmin(creatorData?.payoutRequests);
  const pendingPayoutRequestsAdmin = payoutRequestsAdmin.filter((row) => row.status === 'pending');
  const creatorProfile =
    row?.creator?.profile && typeof row.creator.profile === 'object' ? row.creator.profile : {};
  const creatorSocial =
    row?.creator?.social && typeof row.creator.social === 'object' ? row.creator.social : {};
  const creatorSupportOffer = readCreatorSupportOfferFromDb(row);
  const creatorMonetizationPreference = resolveCreatorMonetizationPreference(row, app);
  const creatorMonetizationStatus = resolveCreatorMonetizationStatusFromDb(row);
  const creatorMonetizationApplicationStatus = resolveCreatorMonetizationApplicationStatusFromDb(row);
  const creatorFinancialStatus = resolveCreatorFinancialStatusFromDb(row);
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
    creatorMonetizationPreference,
    creatorMonetizationStatus,
    creatorMonetizationApplicationStatus,
    creatorFinancialStatus,
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
    creatorProfile: {
      displayName: String(creatorProfile.displayName || app.displayName || row?.userName || ''),
      bioFull: String(creatorProfile.bio || ''),
      socialLinks: {
        instagramUrl: String(creatorSocial.instagram || app?.socialLinks?.instagramUrl || ''),
        youtubeUrl: String(creatorSocial.youtube || app?.socialLinks?.youtubeUrl || ''),
      },
      monetization: {
        preference: creatorMonetizationPreference,
        applicationStatus: creatorMonetizationApplicationStatus,
        financialStatus: creatorFinancialStatus,
        status: creatorMonetizationStatus,
        requestedAt: Number(row?.creator?.monetization?.application?.requestedAt || 0) || null,
        hasLegal: Boolean(row?.creator?.monetization?.legal?.fullName && row?.creator?.monetization?.legal?.cpf),
        hasPixKey: Boolean(row?.creator?.monetization?.payout?.type === 'pix' && String(row?.creator?.monetization?.payout?.key || '').trim()),
        supportOffer: creatorSupportOffer,
      },
    },
    creatorMonetizationV2: {
      preference: creatorMonetizationPreference,
      applicationStatus: creatorMonetizationApplicationStatus,
      financialStatus: creatorFinancialStatus,
      requestedAt: Number(row?.creator?.monetization?.application?.requestedAt || 0) || null,
      hasLegal: Boolean(row?.creator?.monetization?.legal?.fullName && row?.creator?.monetization?.legal?.cpf),
      hasPixKey: Boolean(row?.creator?.monetization?.payout?.type === 'pix' && String(row?.creator?.monetization?.payout?.key || '').trim()),
      supportOffer: creatorSupportOffer,
    },
    signupIntent: String(row?.signupIntent || ''),
    creatorApplicationStatus: creatorAccessIsApprovedFromDb(row)
      ? 'approved'
      : String(row?.creatorApplicationStatus || ''),
    creatorRequestedAt: resolveCreatorRequestedAtMs(row, app),
    creatorMonetizationReviewRequestedAt:
      Number(row?.creatorMonetizationReviewRequestedAt || row?.creator?.monetization?.application?.requestedAt || 0) || null,
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
    creatorPayoutRequestsAdmin: payoutRequestsAdmin,
    creatorPendingPayoutRequestsAdmin: pendingPayoutRequestsAdmin,
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
  const monetizationPreference = 'publish_only';
  const age = resolveCreatorAgeYears(row);
  const monetizationStatus = 'disabled';
  const creatorStatusNext = row?.creatorOnboardingCompleted === true ? 'active' : 'onboarding';
  const [currentPublicProfileSnap, creatorStatsSnap] = await Promise.all([
    db.ref(`usuarios/${uid}/publicProfile`).get(),
    db.ref(`creators/${uid}/stats`).get(),
  ]);
  const currentPublicProfileRow = currentPublicProfileSnap.exists() ? currentPublicProfileSnap.val() || {} : {};
  const creatorBannerUrl = String(
    row?.creatorBannerUrl || currentPublicProfileRow?.creatorBannerUrl || currentPublicProfileRow?.creatorProfile?.bannerUrl || ''
  ).trim();
  const creatorStats = readCreatorStatsFromDb(
    row,
    creatorStatsSnap.exists() ? creatorStatsSnap.val() || {} : {}
  );
  const canonicalHandle = resolveCanonicalPublicHandle({
    ...row,
    publicProfile: currentPublicProfileRow,
    creator: row?.creator,
  });
  const publicCreatorProfile = buildPublicCreatorProfileDoc({
    uid,
    currentPublicProfile:
      currentPublicProfileRow?.creatorProfile && typeof currentPublicProfileRow.creatorProfile === 'object'
      ? currentPublicProfileRow.creatorProfile
        : null,
    canonicalHandle,
    displayName,
    bioShort,
    bioFull: String(creatorProfileRow.bio || '').trim(),
    avatarUrl: approvedCreatorAvatar || currentUserAvatar || '',
    bannerUrl: creatorBannerUrl,
    instagramUrl,
    youtubeUrl,
    monetizationPreference,
    monetizationStatus,
    monetizationApplicationStatus: 'not_requested',
    monetizationFinancialStatus: 'inactive',
    supportOffer: readCreatorSupportOfferFromDb(row),
    status: creatorStatusNext,
    createdAt: Number(row?.creator?.meta?.createdAt || now),
    now,
  });
  publicCreatorProfile.ageVerified = age != null;

  const publicMirrorDoc = {
    uid,
    status: String(row?.status || 'ativo').trim().toLowerCase() || 'ativo',
    signupIntent: 'creator',
    accountType: 'writer',
    userName: displayName,
    userHandle: canonicalHandle || null,
    userAvatar: approvedCreatorAvatar || currentUserAvatar || null,
    updatedAt: now,
    isCreatorProfile: true,
    creatorDisplayName: displayName,
    creatorStatus: creatorStatusNext,
    creatorProfile: publicCreatorProfile,
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
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: null,
    [`usuarios/${uid}/creatorBannerUrl`]: creatorBannerUrl || null,
    [`usuarios/${uid}/creatorStatus`]: creatorStatusNext,
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/creatorUsername`]: null,
    [`usuarios/${uid}/publicProfile/isCreatorProfile`]: true,
    [`usuarios/${uid}/publicProfile/creatorApplicationStatus`]: 'approved',
    [`usuarios/${uid}/publicProfile/userAvatar`]: approvedCreatorAvatar || currentUserAvatar || null,
    [`usuarios/${uid}/publicProfile/userHandle`]: canonicalHandle || null,
    [`usuarios/${uid}/publicProfile/creatorDisplayName`]: displayName,
    [`usuarios/${uid}/publicProfile/creatorUsername`]: null,
    [`usuarios/${uid}/publicProfile/creatorBio`]: bioShort,
    [`usuarios/${uid}/publicProfile/creatorBannerUrl`]: creatorBannerUrl || null,
    [`usuarios/${uid}/publicProfile/instagramUrl`]: instagramUrl || null,
    [`usuarios/${uid}/publicProfile/youtubeUrl`]: youtubeUrl || null,
    [`usuarios/${uid}/publicProfile/creatorStatus`]: creatorStatusNext,
    [`usuarios/${uid}/publicProfile/creatorProfile`]: publicCreatorProfile,
    [`usuarios/${uid}/publicProfile/userName`]: displayName,
    [`usuarios/${uid}/publicProfile/updatedAt`]: now,
    [`usuarios/${uid}/publicProfile/creatorProfile/username`]: canonicalHandle || null,
    [`usuarios/${uid}/creator/profile/username`]: canonicalHandle || null,
    [`creators/${uid}/profile/username`]: canonicalHandle || null,
    [`usuarios_publicos/${uid}`]: publicMirrorDoc,
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
    : 'Voce foi aprovado como criador para publicar na plataforma. A monetizacao continua separada e so entra depois da analise da equipe.';
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
      .filter(([, row]) => {
        if (creatorAccessIsApprovedFromDb(row)) return true;
        if (String(row?.creatorMonetizationReviewRequestedAt || '').trim()) return true;
        const monetizationApplicationStatus = String(
          row?.creator?.monetization?.application?.status || ''
        ).trim().toLowerCase();
        if (monetizationApplicationStatus === 'pending') return true;
        return String(row?.signupIntent || '').trim().toLowerCase() === 'creator';
      })
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
      if (String(r?.creatorMonetizationApplicationStatus || '').trim().toLowerCase() === 'pending') return 2;
      if (String(r?.creatorStatus || '').trim().toLowerCase() === 'onboarding') return 1;
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
  throw new HttpsError(
    'failed-precondition',
    'Aprovacao manual de escritor foi removida. Quem completa o perfil de escritor ja entra com acesso para publicar; o admin revisa apenas monetizacao.'
  );
});

export const adminRejectCreatorApplication = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  await requireSuperAdmin(request.auth);
  throw new HttpsError(
    'failed-precondition',
    'Rejeicao manual de escritor foi removida. O fluxo de criador agora e automatico; use moderacao de usuarios para punir conta e a revisao de monetizacao para manter o criador em apenas publicar.'
  );
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
  const [snap, currentPublicProfileSnap] = await Promise.all([
    db.ref(`usuarios/${uid}`).get(),
    db.ref(`usuarios/${uid}/publicProfile`).get(),
  ]);
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Usuario nao encontrado.');
  }
  const row = snap.val() || {};
  if (!creatorAccessIsApprovedFromDb(row)) {
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
  const nextSupportOffer = {
    ...readCreatorSupportOfferFromDb(row),
    membershipEnabled: canPublishMembership,
    updatedAt: now,
  };
  const currentPublicProfileRow = currentPublicProfileSnap.exists() ? currentPublicProfileSnap.val() || {} : {};
  const creatorStatus = String(row?.creatorStatus || currentPublicProfileRow?.creatorStatus || 'onboarding').trim() || 'onboarding';
  const creatorBannerUrl = String(
    row?.creatorBannerUrl || currentPublicProfileRow?.creatorBannerUrl || currentPublicProfileRow?.creatorProfile?.bannerUrl || ''
  ).trim();

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
  creatorDocMonApprove.monetization.application = {
    ...(creatorDocMonApprove.monetization.application || {}),
    status: isUnderage ? 'blocked_underage' : 'approved',
    requestedAt:
      creatorDocMonApprove?.monetization?.application?.requestedAt ||
      row?.creator?.monetization?.application?.requestedAt ||
      now,
    reviewedAt: now,
    reviewedBy: request.auth.uid,
    reviewReason: null,
  };
  creatorDocMonApprove.monetization.financial = {
    ...(creatorDocMonApprove.monetization.financial || {}),
    status: isUnderage ? 'inactive' : 'active',
    activatedAt:
      !isUnderage
        ? creatorDocMonApprove?.monetization?.financial?.activatedAt ||
          row?.creator?.monetization?.financial?.activatedAt ||
          now
        : null,
    updatedAt: now,
  };
  creatorDocMonApprove.monetization.offer = nextSupportOffer;
  const publicCreatorProfile = buildPublicCreatorProfileDoc({
    uid,
    currentPublicProfile:
      currentPublicProfileRow?.creatorProfile && typeof currentPublicProfileRow.creatorProfile === 'object'
        ? currentPublicProfileRow.creatorProfile
        : null,
    displayName: String(row?.creator?.profile?.displayName || row?.userName || '').trim(),
    bioShort: String(row?.creator?.profile?.bio || '').trim(),
    bioFull: String(row?.creator?.profile?.bio || '').trim(),
    avatarUrl: String(row?.userAvatar || currentPublicProfileRow?.userAvatar || '').trim(),
    bannerUrl: creatorBannerUrl,
    instagramUrl: row?.creator?.social?.instagram,
    youtubeUrl: row?.creator?.social?.youtube,
    monetizationPreference: 'monetize',
    monetizationStatus,
    monetizationApplicationStatus: isUnderage ? 'blocked_underage' : 'approved',
    monetizationFinancialStatus: isUnderage ? 'inactive' : 'active',
    supportOffer: nextSupportOffer,
    status: creatorStatus,
    createdAt: Number(row?.creator?.meta?.createdAt || currentPublicProfileRow?.creatorProfile?.createdAt || now),
    now,
  });

  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocMonApprove,
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios/${uid}/publicProfile/isCreatorProfile`]: true,
    [`usuarios/${uid}/publicProfile/creatorApplicationStatus`]: 'approved',
    [`usuarios/${uid}/publicProfile/creatorDisplayName`]: publicCreatorProfile.displayName,
    [`usuarios/${uid}/publicProfile/creatorBio`]: publicCreatorProfile.bioShort,
    [`usuarios/${uid}/publicProfile/creatorBannerUrl`]: publicCreatorProfile.bannerUrl || null,
    [`usuarios/${uid}/publicProfile/instagramUrl`]: publicCreatorProfile.socialLinks?.instagramUrl || null,
    [`usuarios/${uid}/publicProfile/youtubeUrl`]: publicCreatorProfile.socialLinks?.youtubeUrl || null,
    [`usuarios/${uid}/publicProfile/creatorStatus`]: creatorStatus,
    [`usuarios/${uid}/publicProfile/creatorProfile`]: publicCreatorProfile,
    [`usuarios/${uid}/publicProfile/updatedAt`]: now,
  });

  const monetizationApprovalMessage =
    monetizationStatus === 'active'
      ? canPublishMembership
        ? 'Sua monetização foi aprovada. Sua assinatura pública já pode usar os valores que você configurou.'
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
  const [snap, currentPublicProfileSnap] = await Promise.all([
    db.ref(`usuarios/${uid}`).get(),
    db.ref(`usuarios/${uid}/publicProfile`).get(),
  ]);
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Usuario nao encontrado.');
  }
  const row = snap.val() || {};
  if (!creatorAccessIsApprovedFromDb(row)) {
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
  const currentPublicProfileRow = currentPublicProfileSnap.exists() ? currentPublicProfileSnap.val() || {} : {};
  const creatorStatus = String(row?.creatorStatus || currentPublicProfileRow?.creatorStatus || 'onboarding').trim() || 'onboarding';
  const creatorBannerUrl = String(
    row?.creatorBannerUrl || currentPublicProfileRow?.creatorBannerUrl || currentPublicProfileRow?.creatorProfile?.bannerUrl || ''
  ).trim();

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
  creatorDocMonReject.monetization.application = {
    ...(creatorDocMonReject.monetization.application || {}),
    status: 'rejected',
    requestedAt:
      creatorDocMonReject?.monetization?.application?.requestedAt ||
      row?.creator?.monetization?.application?.requestedAt ||
      now,
    reviewedAt: now,
    reviewedBy: request.auth.uid,
    reviewReason: reason,
  };
  creatorDocMonReject.monetization.financial = {
    ...(creatorDocMonReject.monetization.financial || {}),
    status: 'inactive',
    activatedAt: null,
    updatedAt: now,
  };
  creatorDocMonReject.monetization.offer = {
    ...readCreatorSupportOfferFromDb(row),
    membershipEnabled: false,
    updatedAt: now,
  };
  const publicCreatorProfile = buildPublicCreatorProfileDoc({
    uid,
    currentPublicProfile:
      currentPublicProfileRow?.creatorProfile && typeof currentPublicProfileRow.creatorProfile === 'object'
        ? currentPublicProfileRow.creatorProfile
        : null,
    displayName: String(row?.creator?.profile?.displayName || row?.userName || '').trim(),
    bioShort: String(row?.creator?.profile?.bio || '').trim(),
    bioFull: String(row?.creator?.profile?.bio || '').trim(),
    avatarUrl: String(row?.userAvatar || currentPublicProfileRow?.userAvatar || '').trim(),
    bannerUrl: creatorBannerUrl,
    instagramUrl: row?.creator?.social?.instagram,
    youtubeUrl: row?.creator?.social?.youtube,
    monetizationPreference,
    monetizationStatus: 'disabled',
    monetizationApplicationStatus: 'rejected',
    monetizationFinancialStatus: 'inactive',
    supportOffer: creatorDocMonReject.monetization.offer,
    status: creatorStatus,
    createdAt: Number(row?.creator?.meta?.createdAt || currentPublicProfileRow?.creatorProfile?.createdAt || now),
    now,
  });

  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocMonReject,
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: reason,
    [`usuarios/${uid}/publicProfile/isCreatorProfile`]: true,
    [`usuarios/${uid}/publicProfile/creatorApplicationStatus`]: 'approved',
    [`usuarios/${uid}/publicProfile/creatorDisplayName`]: publicCreatorProfile.displayName,
    [`usuarios/${uid}/publicProfile/creatorBio`]: publicCreatorProfile.bioShort,
    [`usuarios/${uid}/publicProfile/creatorBannerUrl`]: publicCreatorProfile.bannerUrl || null,
    [`usuarios/${uid}/publicProfile/instagramUrl`]: publicCreatorProfile.socialLinks?.instagramUrl || null,
    [`usuarios/${uid}/publicProfile/youtubeUrl`]: publicCreatorProfile.socialLinks?.youtubeUrl || null,
    [`usuarios/${uid}/publicProfile/creatorStatus`]: creatorStatus,
    [`usuarios/${uid}/publicProfile/creatorProfile`]: publicCreatorProfile,
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

export const creatorRequestPixPayout = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  if (!(await isCreatorAccountAuth(request.auth))) {
    throw new HttpsError('permission-denied', 'Apenas criadores podem solicitar repasse.');
  }
  const uid = String(request.auth.uid || '').trim();
  const db = getDatabase();
  const [userSnap, balanceSnap, payoutRequestsSnap] = await Promise.all([
    db.ref(`usuarios/${uid}`).get(),
    db.ref(`creatorData/${uid}/balance`).get(),
    db.ref(`creatorData/${uid}/payoutRequests`).get(),
  ]);
  if (!userSnap.exists()) {
    throw new HttpsError('not-found', 'Criador nao encontrado.');
  }
  const row = userSnap.val() || {};
  if (!creatorAccessIsApprovedFromDb(row)) {
    throw new HttpsError('failed-precondition', 'Este usuario ainda nao e um criador aprovado.');
  }
  const monetizationApplicationStatus = resolveCreatorMonetizationApplicationStatusFromDb(row);
  const monetizationFinancialStatus = resolveCreatorFinancialStatusFromDb(row);
  if (monetizationApplicationStatus !== 'approved' || monetizationFinancialStatus !== 'active') {
    throw new HttpsError(
      'failed-precondition',
      'Repasse so pode ser solicitado por criador com monetizacao aprovada e ativa.'
    );
  }
  const balance = balanceSnap.exists() ? balanceSnap.val() || {} : {};
  const available = round2(Number(balance?.availableBRL || 0));
  if (!(available > 0)) {
    throw new HttpsError('failed-precondition', 'Nao ha saldo disponivel para solicitar repasse.');
  }
  const existingRequests = buildCreatorPayoutRequestsAdmin(
    payoutRequestsSnap.exists() ? payoutRequestsSnap.val() || {} : {}
  );
  if (existingRequests.some((item) => item.status === 'pending')) {
    throw new HttpsError(
      'failed-precondition',
      'Ja existe uma solicitacao de repasse pendente para este criador.'
    );
  }
  const rawAmount = request.data?.amount == null ? available : round2(Number(request.data.amount));
  if (!rawAmount || rawAmount <= 0) {
    throw new HttpsError('invalid-argument', 'amount invalido.');
  }
  if (rawAmount - available > 0.009) {
    throw new HttpsError('failed-precondition', 'O valor solicitado excede o saldo disponivel.');
  }
  const notes = String(request.data?.notes || '').trim().slice(0, 1000);
  const requestedAt = Date.now();
  const requestRef = db.ref(`creatorData/${uid}/payoutRequests`).push();
  const payoutRequestId = requestRef.key;
  const requestRow = {
    payoutRequestId,
    creatorId: uid,
    amount: rawAmount,
    currency: 'BRL',
    status: 'pending',
    requestedAt,
    requestedByUid: uid,
    availableSnapshotBRL: available,
    pendingPayoutSnapshotBRL: round2(Number(balance?.pendingPayoutBRL || 0)),
    notes: notes || null,
  };
  await db.ref().update({
    [`creatorData/${uid}/payoutRequests/${payoutRequestId}`]: requestRow,
    [`financas/creatorPayoutRequests/${payoutRequestId}`]: requestRow,
  });
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: 'creator_payout_request',
      title: 'Solicitacao de repasse enviada',
      message: `Sua solicitacao de repasse de ${rawAmount.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      })} foi enviada para a equipe.`,
      data: {
        payoutRequestId,
        amount: rawAmount,
        readPath: '/creator/monetizacao',
      },
    },
  });
  return {
    ok: true,
    payoutRequestId,
    amount: rawAmount,
    availableSnapshotBRL: available,
  };
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
  if (!creatorAccessIsApprovedFromDb(row)) {
    throw new HttpsError('failed-precondition', 'Este usuario ainda nao e um criador aprovado.');
  }
  const monetizationApplicationStatus = resolveCreatorMonetizationApplicationStatusFromDb(row);
  const monetizationFinancialStatus = resolveCreatorFinancialStatusFromDb(row);
  if (monetizationApplicationStatus !== 'approved' || monetizationFinancialStatus !== 'active') {
    throw new HttpsError(
      'failed-precondition',
      'Repasse manual so pode ser registrado para criador com monetizacao aprovada e ativa.'
    );
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
  const payoutRequestId = String(request.data?.payoutRequestId || '').trim();
  if (payoutRequestId) {
    const requestPatch = {
      status: 'paid',
      reviewedAt: Date.now(),
      reviewedByUid: request.auth.uid,
      payoutId,
    };
    await db.ref().update({
      [`creatorData/${uid}/payoutRequests/${payoutRequestId}/status`]: requestPatch.status,
      [`creatorData/${uid}/payoutRequests/${payoutRequestId}/reviewedAt`]: requestPatch.reviewedAt,
      [`creatorData/${uid}/payoutRequests/${payoutRequestId}/reviewedByUid`]: requestPatch.reviewedByUid,
      [`creatorData/${uid}/payoutRequests/${payoutRequestId}/payoutId`]: requestPatch.payoutId,
      [`financas/creatorPayoutRequests/${payoutRequestId}/status`]: requestPatch.status,
      [`financas/creatorPayoutRequests/${payoutRequestId}/reviewedAt`]: requestPatch.reviewedAt,
      [`financas/creatorPayoutRequests/${payoutRequestId}/reviewedByUid`]: requestPatch.reviewedByUid,
      [`financas/creatorPayoutRequests/${payoutRequestId}/payoutId`]: requestPatch.payoutId,
    });
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

