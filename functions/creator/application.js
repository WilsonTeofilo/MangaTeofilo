import { getAdminAuthContext, listStaffUids } from '../adminRbac.js';
import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { pushUserNotification } from '../notificationPush.js';
import { evaluateCreatorApplicationApprovalGate } from '../creatorApplicationGate.js';
import {
  ageFromBirthDateIso,
  normalizeAndValidateCpf,
  parseBirthDateStrict,
} from '../creatorCompliance.js';
import {
  assembleCreatorRecordForRtdb,
  creatorAccessIsApprovedFromDb,
  legalFullNameHasMinThreeWords,
  legalFullNameHasNoDigits,
  resolveCreatorMonetizationStatusFromDb,
} from '../creatorRecord.js';
import { coercePayoutPixType, normalizePixPayoutKey, validatePixPayout } from '../pixKey.js';
import { finalizeCreatorApplicationApproval } from './admin.js';
import { isTrustedPlatformAssetUrl } from '../trustedAssetUrls.js';
import { assertTrustedAppRequest } from '../appCheckGuard.js';

async function notifyCreatorRequestAdmins(
  db,
  { applicantUid, displayName, monetizationPreference, monetizationOnly = false }
) {
  const adminIds = new Set(await listStaffUids());

  const applicantName = String(displayName || 'Novo creator').trim() || 'Novo creator';
  const wantsMonetize = String(monetizationPreference || '').trim().toLowerCase() === 'monetize';
  const title = monetizationOnly
    ? 'Criador pediu revisao de monetizacao'
    : wantsMonetize
      ? 'Nova solicitacao com monetizacao'
      : 'Nova solicitacao de creator';
  const message = monetizationOnly
    ? `${applicantName} ja publica na plataforma e enviou dados para ativar monetizacao. Revise em Criadores.`
    : wantsMonetize
      ? `${applicantName} pediu acesso de creator e revisao de monetizacao.`
      : `${applicantName} pediu acesso ao programa de creators.`;

  await Promise.all(
    [...adminIds]
      .filter((uid) => uid && uid !== applicantUid)
      .map((uid) =>
        pushUserNotification(db, uid, {
          type: 'admin_creator_queue',
          title,
          message,
          targetPath: '/admin/criadores',
          priority: 2,
          groupKey: 'admin_creator_queue',
          dedupeKey: `admin_creator_queue:${applicantUid}`,
          data: {
            applicantUid,
            readPath: '/admin/criadores',
            monetizationPreference,
            monetizationOnly,
          },
        })
      )
  );
}

async function queueCreatorMonetizationReview(
  db,
  uid,
  row,
  {
    birthDateRaw,
    displayName,
    bioShort,
    instagramUrl,
    youtubeUrl,
    compliance,
    now,
    profileImageUrl,
    profileImageCrop,
  }
) {
  const creatorDocM = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: birthDateRaw,
    displayName,
    bio: bioShort,
    instagramUrl,
    youtubeUrl,
    monetizationPreference: 'monetize',
    creatorMonetizationStatus: 'disabled',
    compliance,
    now,
  });
  creatorDocM.monetization.application = {
    ...(creatorDocM.monetization.application || {}),
    status: 'pending',
    requestedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    reviewReason: null,
  };
  creatorDocM.monetization.financial = {
    ...(creatorDocM.monetization.financial || {}),
    status: 'inactive',
    activatedAt: null,
    updatedAt: now,
  };
  const monetizationPatch = {
    [`usuarios/${uid}/creator`]: creatorDocM,
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: now,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios/${uid}/creatorCompliance`]: compliance,
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: profileImageUrl,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: profileImageCrop,
  };
  if (!Number(row?.creatorRequestedAt || 0)) {
    monetizationPatch[`usuarios/${uid}/creatorRequestedAt`] = now;
  }
  await db.ref().update(monetizationPatch);
}

function normalizeCreatorSocialUrl(raw, allowedHosts = []) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    const host = String(url.hostname || '').trim().toLowerCase();
    const hostOk = allowedHosts.some((item) => host === item || host.endsWith(`.${item}`));
    if (!hostOk) return '';
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export const creatorSubmitApplication = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const db = getDatabase();
  const ctx = await getAdminAuthContext(request.auth);
  if (ctx) {
    throw new HttpsError(
      'failed-precondition',
      'Contas da equipe administrativa nao podem solicitar acesso de creator.'
    );
  }
  const userRef = db.ref(`usuarios/${uid}`);
  const [snap, creatorStatsSnap] = await Promise.all([
    userRef.get(),
    db.ref(`creators/${uid}/stats`).get(),
  ]);
  if (!snap.exists()) {
    throw new HttpsError('failed-precondition', 'Perfil do usuario nao encontrado.');
  }
  const row = snap.val() || {};
  const creatorStatsRow = creatorStatsSnap.exists() ? creatorStatsSnap.val() || {} : {};
  const now = Date.now();
  const statusAtual = String(row?.creatorApplicationStatus || '').trim().toLowerCase();
  const alreadyHasCreatorAccess = creatorAccessIsApprovedFromDb(row);
  if (statusAtual === 'requested' && alreadyHasCreatorAccess) {
    return { ok: true, status: 'requested', alreadyPending: true };
  }

  const payload = request.data && typeof request.data === 'object' ? request.data : {};
  const creatorProfileRow =
    row?.creator?.profile && typeof row.creator.profile === 'object' ? row.creator.profile : {};
  const creatorSocialRow =
    row?.creator?.social && typeof row.creator.social === 'object' ? row.creator.social : {};
  const displayName = String(
    payload.displayName || creatorProfileRow.displayName || row?.userName || ''
  ).trim();
  const bioShort = String(payload.bioShort || creatorProfileRow.bio || '').trim();
  const instagramRaw = String(
    payload.instagramUrl || creatorSocialRow.instagram || ''
  ).trim();
  const youtubeRaw = String(
    payload.youtubeUrl || creatorSocialRow.youtube || ''
  ).trim();
  const instagramUrl = normalizeCreatorSocialUrl(instagramRaw, ['instagram.com']);
  const youtubeUrl = normalizeCreatorSocialUrl(youtubeRaw, ['youtube.com', 'youtu.be']);
  let profileImageUrl = String(payload.profileImageUrl || row?.creatorApplication?.profileImageUrl || '').trim();
  if (!isTrustedPlatformAssetUrl(profileImageUrl, { allowLocalAssets: true })) {
    const avatar = String(row?.userAvatar || '').trim();
    if (isTrustedPlatformAssetUrl(avatar, { allowLocalAssets: true })) {
      profileImageUrl = avatar;
    }
  }
  const profileImageCrop =
    payload.profileImageCrop && typeof payload.profileImageCrop === 'object'
      ? {
          zoom: Number(payload.profileImageCrop.zoom || 1),
          x: Number(payload.profileImageCrop.x || 0),
          y: Number(payload.profileImageCrop.y || 0),
          mode: 'responsive-fit',
        }
      : null;
  const acceptTerms = payload.acceptTerms === true;
  const birthFromPayload = String(payload.birthDate || '').trim();
  const birthFromProfile = String(row?.birthDate || '').trim();
  const birthDateRaw = birthFromPayload || birthFromProfile;
  if (!parseBirthDateStrict(birthDateRaw)) {
    throw new HttpsError('invalid-argument', 'Informe uma data de nascimento valida (AAAA-MM-DD).');
  }
  const age = ageFromBirthDateIso(birthDateRaw);
  if (age == null || age < 0) {
    throw new HttpsError('invalid-argument', 'Data de nascimento invalida.');
  }
  const isAdult = age >= 18;
  const isAlreadyCreator = alreadyHasCreatorAccess;
  const wantsMonetization = String(payload.monetizationPreference || '').trim().toLowerCase() === 'monetize';
  const monetizationRequested = wantsMonetization;
  const monetizationPreference = monetizationRequested ? 'monetize' : 'publish_only';

  const legalFullNameIn = String(payload.legalFullName || '').trim();
  const taxIdIn = String(payload.taxId || '').trim();
  const payoutInstructionsIn = String(payload.payoutInstructions || '').trim();
  const payoutPixTypeDeclared = String(payload.payoutPixType || '').trim().toLowerCase();
  const acceptFinancialTerms = payload.acceptFinancialTerms === true;

  let monetizationPixType = '';
  let monetizationPixKey = '';
  if (monetizationPreference === 'monetize') {
    if (!legalFullNameHasNoDigits(legalFullNameIn)) {
      throw new HttpsError('invalid-argument', 'O nome completo (documento) nao pode conter numeros.');
    }
    if (!legalFullNameHasMinThreeWords(legalFullNameIn)) {
      throw new HttpsError(
        'invalid-argument',
        'Para monetizar, informe seu nome completo legal com pelo menos tres partes (ex.: Nome Sobrenome Filho).'
      );
    }
    const cpfOk = normalizeAndValidateCpf(taxIdIn);
    if (!cpfOk) {
      throw new HttpsError('invalid-argument', 'Para monetizar, informe um CPF valido (11 digitos).');
    }
    monetizationPixType = coercePayoutPixType(payoutPixTypeDeclared, payoutInstructionsIn);
    monetizationPixKey = normalizePixPayoutKey(monetizationPixType, payoutInstructionsIn);
    const pixVal = validatePixPayout(monetizationPixType, monetizationPixKey);
    if (!pixVal.ok) {
      throw new HttpsError('invalid-argument', pixVal.message);
    }
    if (!acceptFinancialTerms) {
      throw new HttpsError(
        'invalid-argument',
        'Para monetizar, aceite os termos financeiros e de repasse.'
      );
    }
  }

  if (displayName.length < 3) {
    throw new HttpsError('invalid-argument', 'Informe um nome artistico com pelo menos 3 caracteres.');
  }
  const bioMin = 24;
  if (bioShort.length < bioMin) {
    throw new HttpsError(
      'invalid-argument',
      monetizationPreference === 'publish_only'
        ? `Escreva uma bio curta com pelo menos ${bioMin} caracteres.`
        : `Escreva uma bio com pelo menos ${bioMin} caracteres.`
    );
  }
  if (bioShort.length > 450) {
    throw new HttpsError('invalid-argument', 'A bio pode ter no maximo 450 caracteres.');
  }
  if (!isTrustedPlatformAssetUrl(profileImageUrl, { allowLocalAssets: true })) {
    throw new HttpsError(
      'invalid-argument',
      'Escolha uma foto valida do seu perfil ou envie uma nova imagem antes de continuar.'
    );
  }
  if (!acceptTerms) {
    throw new HttpsError('invalid-argument', 'Voce precisa aceitar os termos para solicitar acesso de criador.');
  }
  if (instagramRaw && !instagramUrl) {
    throw new HttpsError('invalid-argument', 'Instagram invalido. Use um link real de perfil do Instagram.');
  }
  if (youtubeRaw && !youtubeUrl) {
    throw new HttpsError('invalid-argument', 'YouTube invalido. Use um link real de canal/video do YouTube.');
  }
  if (!instagramUrl && !youtubeUrl) {
    throw new HttpsError(
      'invalid-argument',
      monetizationPreference === 'monetize'
        ? 'Para monetizar, informe pelo menos um link valido de Instagram ou YouTube.'
        : 'Informe pelo menos um link valido de Instagram ou YouTube no seu perfil publico.'
    );
  }

  const birthYearFromDate = Number(birthDateRaw.slice(0, 4));
  const compliance =
    monetizationPreference === 'monetize'
      ? {
          legalFullName: legalFullNameIn.trim(),
          taxId: normalizeAndValidateCpf(taxIdIn),
          payoutInstructions: monetizationPixKey.slice(0, 2000),
          payoutPixType: monetizationPixType,
          financialTermsAcceptedAt: now,
          updatedAt: now,
        }
      : null;

  if (isAlreadyCreator) {
    if (monetizationPreference !== 'monetize') {
      return { ok: true, status: 'approved', alreadyMangaka: true };
    }
    const monStatus = resolveCreatorMonetizationStatusFromDb(row);
    if (monStatus === 'active') {
      return { ok: true, status: 'approved', alreadyMangaka: true, monetizationAlreadyActive: true };
    }
    if (!isAdult) {
      throw new HttpsError(
        'failed-precondition',
        'Criadores menores de idade podem publicar, mas nao podem solicitar monetizacao.'
      );
    }
    const approvalGate = evaluateCreatorApplicationApprovalGate(row, creatorStatsRow);
    if (!approvalGate.ok) {
      throw new HttpsError(
        'failed-precondition',
        `Para solicitar monetizacao, atinja as metas do Nivel 1: ${approvalGate.metrics.followers}/${approvalGate.thresholds.followers} seguidores, ${approvalGate.metrics.views}/${approvalGate.thresholds.views} views, ${approvalGate.metrics.likes}/${approvalGate.thresholds.likes} likes.`
      );
    }
    const alreadyApprovedOnce =
      String(row?.creator?.monetization?.application?.status || '').trim().toLowerCase() === 'approved';
    if (alreadyApprovedOnce) {
      return {
        ok: true,
        status: 'approved',
        alreadyMangaka: true,
        monetizationAlreadyApproved: true,
      };
    }
    await queueCreatorMonetizationReview(db, uid, row, {
      birthDateRaw,
      displayName,
      bioShort,
      instagramUrl,
      youtubeUrl,
      compliance,
      now,
      profileImageUrl,
      profileImageCrop,
    });
    await pushUserNotification(db, uid, {
      type: 'creator_monetization',
      title: 'Solicitacao de monetizacao enviada',
      message:
        'Recebemos seus dados. A equipe vai revisar seus documentos e liberar a monetizacao se estiver tudo certo.',
      data: { monetizationStatus: 'pending', readPath: '/creator/monetizacao' },
    });
    await notifyCreatorRequestAdmins(db, {
      applicantUid: uid,
      displayName,
      monetizationPreference: 'monetize',
      monetizationOnly: true,
    });
    return {
      ok: true,
      status: 'pending',
      alreadyMangaka: true,
      monetizationRequested: true,
      monetizationStatus: 'disabled',
    };
  }

  const creatorMonetizationStatusForRecord =
    monetizationPreference === 'monetize' ? 'disabled' : 'disabled';
  const creatorApplication = {
    userId: uid,
    displayName,
    bioShort,
    profileImageUrl,
    profileImageCrop,
    bannerUrl: null,
    monetizationPreference,
    monetizationRequested,
    birthDate: birthDateRaw,
    isAdult,
    socialLinks: {
      instagramUrl: instagramUrl || null,
      youtubeUrl: youtubeUrl || null,
    },
    status: 'approved',
    acceptTerms: true,
    createdAt: row?.creatorApplication?.createdAt || now,
    updatedAt: now,
  };
  const creatorDocSubmit = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: birthDateRaw,
    displayName,
    bio: bioShort,
    instagramUrl,
    youtubeUrl,
    monetizationPreference,
    creatorMonetizationStatus: creatorMonetizationStatusForRecord,
    compliance,
    now,
  });

  const approvalGate = monetizationPreference === 'monetize'
    ? evaluateCreatorApplicationApprovalGate(row, creatorStatsRow)
    : { ok: false };
  const canQueueMonetizationNow = monetizationPreference === 'monetize' && isAdult && approvalGate.ok;

  const patch = {
    [`usuarios/${uid}/creator`]: creatorDocSubmit,
    [`usuarios/${uid}/signupIntent`]: 'creator',
    [`usuarios/${uid}/creatorApplicationStatus`]: 'approved',
    [`usuarios/${uid}/creatorApplication`]: creatorApplication,
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: profileImageUrl,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: profileImageCrop,
    [`usuarios/${uid}/creatorBannerUrl`]: null,
    [`usuarios/${uid}/publicProfile/creatorBannerUrl`]: null,
    [`usuarios/${uid}/birthDate`]: birthDateRaw,
    [`usuarios/${uid}/birthYear`]: Number.isInteger(birthYearFromDate) ? birthYearFromDate : null,
    [`usuarios/${uid}/creatorRequestedAt`]: now,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios/${uid}/publicProfile/updatedAt`]: now,
    [`usuarios/${uid}/creatorTermsAccepted`]: true,
    [`usuarios/${uid}/creatorCompliance`]: canQueueMonetizationNow ? compliance || null : null,
  };
  await db.ref().update(patch);
  const snapAfter = await userRef.get();
  const rowAfterApproval = snapAfter.val() || {};
  await finalizeCreatorApplicationApproval(db, uid, rowAfterApproval, uid, { isAutoPublishOnly: true });

  if (canQueueMonetizationNow) {
    const rowAfterCreator = (await userRef.get()).val() || {};
    await queueCreatorMonetizationReview(db, uid, rowAfterCreator, {
      birthDateRaw,
      displayName,
      bioShort,
      instagramUrl,
      youtubeUrl,
      compliance,
      now,
      profileImageUrl,
      profileImageCrop,
    });
    await pushUserNotification(db, uid, {
      type: 'creator_monetization',
      title: 'Criador liberado e monetizacao enviada',
      message:
        'Seu perfil de escritor ja esta liberado para publicar. A revisao de monetizacao foi enviada para a equipe.',
      data: { status: 'approved', monetizationStatus: 'pending', readPath: '/creator/monetizacao' },
    });
    await notifyCreatorRequestAdmins(db, {
      applicantUid: uid,
      displayName,
      monetizationPreference: 'monetize',
      monetizationOnly: true,
    });
    return {
      ok: true,
      status: 'approved',
      autoApproved: true,
      application: creatorApplication,
      monetizationPreference: 'monetize',
      monetizationRequested: true,
      monetizationStatus: 'disabled',
      isAdult,
    };
  }

  await pushUserNotification(db, uid, {
    type: 'creator_application',
    title: 'Acesso de escritor liberado',
    message:
      monetizationPreference === 'monetize'
        ? 'Seu perfil de escritor ja esta liberado para publicar. A monetizacao continua bloqueada ate voce cumprir os requisitos e solicitar revisao.'
        : 'Seu perfil de escritor ja esta liberado para publicar.',
    data: {
      status: 'approved',
      monetizationPreference: monetizationPreference === 'monetize' ? 'publish_only' : monetizationPreference,
      monetizationRequested: false,
      isAdult,
      readPath: '/perfil',
    },
  });
  return {
    ok: true,
    status: 'approved',
    autoApproved: true,
    application: creatorApplication,
    monetizationPreference: canQueueMonetizationNow ? 'monetize' : 'publish_only',
    monetizationRequested: canQueueMonetizationNow,
    monetizationDeferred: monetizationPreference === 'monetize' && !canQueueMonetizationNow,
    isAdult,
  };
});

