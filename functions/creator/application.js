import { getAdminAuthContext, ADMIN_REGISTRY_PATH, SUPER_ADMIN_UIDS } from '../adminRbac.js';
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
  legalFullNameHasMinThreeWords,
  legalFullNameHasNoDigits,
  resolveCreatorMonetizationStatusFromDb,
} from '../creatorRecord.js';
import { coercePayoutPixType, normalizePixPayoutKey, validatePixPayout } from '../pixKey.js';
import { finalizeCreatorApplicationApproval } from './admin.js';

async function notifyCreatorRequestAdmins(
  db,
  { applicantUid, displayName, monetizationPreference, monetizationOnly = false }
) {
  const registrySnap = await db.ref(ADMIN_REGISTRY_PATH).get();
  const superAdminIds = (() => {
    if (SUPER_ADMIN_UIDS instanceof Set) return [...SUPER_ADMIN_UIDS];
    if (Array.isArray(SUPER_ADMIN_UIDS)) return SUPER_ADMIN_UIDS;
    if (SUPER_ADMIN_UIDS && typeof SUPER_ADMIN_UIDS[Symbol.iterator] === 'function') {
      return [...SUPER_ADMIN_UIDS];
    }
    return [];
  })();
  const adminIds = new Set(superAdminIds);
  if (registrySnap.exists()) {
    for (const [uid, row] of Object.entries(registrySnap.val() || {})) {
      const role = String(row?.role || '').trim().toLowerCase();
      if (role && role !== 'mangaka') adminIds.add(uid);
    }
  }

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
  const snap = await userRef.get();
  if (!snap.exists()) {
    throw new HttpsError('failed-precondition', 'Perfil do usuario nao encontrado.');
  }
  const row = snap.val() || {};
  const now = Date.now();
  const statusAtual = String(row?.creatorApplicationStatus || '').trim().toLowerCase();
  if (statusAtual === 'requested') {
    return { ok: true, status: 'requested', alreadyPending: true };
  }

  const payload = request.data && typeof request.data === 'object' ? request.data : {};
  const displayName = String(payload.displayName || row?.creatorDisplayName || row?.userName || '').trim();
  const bioShort = String(payload.bioShort || row?.creatorBio || '').trim();
  const instagramRaw = String(payload.instagramUrl || row?.instagramUrl || '').trim();
  const youtubeRaw = String(payload.youtubeUrl || row?.youtubeUrl || '').trim();
  const instagramUrl = normalizeCreatorSocialUrl(instagramRaw, ['instagram.com']);
  const youtubeUrl = normalizeCreatorSocialUrl(youtubeRaw, ['youtube.com', 'youtu.be']);
  let profileImageUrl = String(payload.profileImageUrl || row?.creatorApplication?.profileImageUrl || '').trim();
  if (
    !profileImageUrl ||
    profileImageUrl.length < 12 ||
    !/^https:\/\//i.test(profileImageUrl) ||
    profileImageUrl.length > 2048
  ) {
    const avatar = String(row?.userAvatar || '').trim();
    if (/^https:\/\//i.test(avatar) && avatar.length >= 12 && avatar.length <= 2048) {
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
  const monetizationRequested =
    String(payload.monetizationPreference || '').trim().toLowerCase() === 'monetize';
  const monetizationPreference = monetizationRequested && isAdult ? 'monetize' : 'publish_only';

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
  if (
    profileImageUrl.length < 12 ||
    !/^https:\/\//i.test(profileImageUrl) ||
    profileImageUrl.length > 2048
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Envie a foto de perfil do creator antes de solicitar acesso de criador.'
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

  if (String(row?.role || '').trim().toLowerCase() === 'mangaka') {
    if (monetizationPreference !== 'monetize') {
      return { ok: true, status: 'approved', alreadyMangaka: true };
    }
    const monStatus = resolveCreatorMonetizationStatusFromDb(row);
    if (monStatus === 'active') {
      return { ok: true, status: 'approved', alreadyMangaka: true, monetizationAlreadyActive: true };
    }
    const alreadyApprovedOnce =
      row?.creator?.monetization?.approved === true ||
      row?.creator?.monetization?.isApproved === true;
    if (alreadyApprovedOnce) {
      const nextMonetizationStatus = isAdult ? 'active' : 'blocked_underage';
      const creatorDocM = assembleCreatorRecordForRtdb({
        row,
        birthDateIso: birthDateRaw,
        displayName,
        bio: bioShort,
        instagramUrl,
        youtubeUrl,
        monetizationPreference: 'monetize',
        creatorMonetizationStatus: nextMonetizationStatus,
        compliance,
        now,
      });
      await db.ref().update({
        [`usuarios/${uid}/creator`]: creatorDocM,
        [`usuarios/${uid}/creatorDisplayName`]: displayName,
        [`usuarios/${uid}/creatorBio`]: bioShort,
        [`usuarios/${uid}/creatorMonetizationPreference`]: 'monetize',
        [`usuarios/${uid}/creatorMonetizationStatus`]: nextMonetizationStatus,
        [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
        [`usuarios/${uid}/creatorCompliance`]: compliance,
        [`usuarios/${uid}/instagramUrl`]: instagramUrl || null,
        [`usuarios/${uid}/youtubeUrl`]: youtubeUrl || null,
        [`usuarios/${uid}/creatorPendingProfileImageUrl`]: profileImageUrl,
        [`usuarios/${uid}/creatorPendingProfileImageCrop`]: profileImageCrop,
        [`usuarios/${uid}/creatorProfile/monetizationPreference`]: 'monetize',
        [`usuarios/${uid}/creatorProfile/monetizationStatus`]: nextMonetizationStatus,
        [`usuarios/${uid}/creatorProfile/monetizationEnabled`]: nextMonetizationStatus === 'active',
        [`usuarios/${uid}/creatorProfile/isMonetizationActive`]: nextMonetizationStatus === 'active',
        [`usuarios/${uid}/creatorProfile/isApproved`]: true,
        [`usuarios/${uid}/creatorProfile/updatedAt`]: now,
        [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: nextMonetizationStatus,
        [`usuarios_publicos/${uid}/updatedAt`]: now,
      });
      return {
        ok: true,
        status: 'approved',
        alreadyMangaka: true,
        monetizationReactivated: nextMonetizationStatus === 'active',
        monetizationStatus: nextMonetizationStatus,
      };
    }
    const nextMonetizationStatus = isAdult ? 'active' : 'blocked_underage';
    const creatorDocM = assembleCreatorRecordForRtdb({
      row,
      birthDateIso: birthDateRaw,
      displayName,
      bio: bioShort,
      instagramUrl,
      youtubeUrl,
      monetizationPreference: 'monetize',
      creatorMonetizationStatus: nextMonetizationStatus,
      compliance,
      now,
    });
    const monetizationPatch = {
      [`usuarios/${uid}/creator`]: creatorDocM,
      [`usuarios/${uid}/creatorDisplayName`]: displayName,
      [`usuarios/${uid}/creatorBio`]: bioShort,
      [`usuarios/${uid}/creatorMonetizationPreference`]: 'monetize',
      [`usuarios/${uid}/creatorMonetizationStatus`]: nextMonetizationStatus,
      [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
      [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
      [`usuarios/${uid}/creatorCompliance`]: compliance,
      [`usuarios/${uid}/instagramUrl`]: instagramUrl || null,
      [`usuarios/${uid}/youtubeUrl`]: youtubeUrl || null,
      [`usuarios/${uid}/creatorPendingProfileImageUrl`]: profileImageUrl,
      [`usuarios/${uid}/creatorPendingProfileImageCrop`]: profileImageCrop,
      [`usuarios/${uid}/creatorProfile/monetizationPreference`]: 'monetize',
      [`usuarios/${uid}/creatorProfile/monetizationStatus`]: nextMonetizationStatus,
      [`usuarios/${uid}/creatorProfile/monetizationEnabled`]: nextMonetizationStatus === 'active',
      [`usuarios/${uid}/creatorProfile/isMonetizationActive`]: nextMonetizationStatus === 'active',
      [`usuarios/${uid}/creatorProfile/isApproved`]: nextMonetizationStatus === 'active',
      [`usuarios/${uid}/creatorProfile/updatedAt`]: now,
      [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: nextMonetizationStatus,
      [`usuarios_publicos/${uid}/updatedAt`]: now,
    };
    if (!Number(row?.creatorRequestedAt || 0)) {
      monetizationPatch[`usuarios/${uid}/creatorRequestedAt`] = now;
    }
    await db.ref().update(monetizationPatch);
    await pushUserNotification(db, uid, {
      type: 'creator_monetization',
      title: nextMonetizationStatus === 'active' ? 'Monetizacao ativada' : 'Monetizacao bloqueada por idade',
      message:
        nextMonetizationStatus === 'active'
          ? 'Seus dados financeiros foram validados e a monetizacao foi ativada. Agora voce pode ligar ou desligar no perfil quando quiser.'
          : 'Sua conta continua liberada para publicar, mas a monetizacao segue bloqueada por idade.',
      data: { monetizationStatus: nextMonetizationStatus, readPath: '/perfil' },
    });
    return {
      ok: true,
      status: 'approved',
      alreadyMangaka: true,
      monetizationReactivated: nextMonetizationStatus === 'active',
      monetizationStatus: nextMonetizationStatus,
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
    status: 'pending',
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

  if (monetizationPreference === 'monetize') {
    const approvalGate = evaluateCreatorApplicationApprovalGate(row);
    if (!approvalGate.ok) {
      throw new HttpsError(
        'failed-precondition',
        `Para enviar candidatura com monetizacao, atinja as metas do Nivel 1: ${approvalGate.metrics.followers}/${approvalGate.thresholds.followers} seguidores, ${approvalGate.metrics.views}/${approvalGate.thresholds.views} views, ${approvalGate.metrics.likes}/${approvalGate.thresholds.likes} likes.`
      );
    }
  }

  if (monetizationPreference === 'publish_only') {
    const prePatch = {
      [`usuarios/${uid}/creator`]: creatorDocSubmit,
      [`usuarios/${uid}/signupIntent`]: 'creator',
      [`usuarios/${uid}/creatorApplication`]: creatorApplication,
      [`usuarios/${uid}/creatorDisplayName`]: displayName,
      [`usuarios/${uid}/creatorBio`]: bioShort,
      [`usuarios/${uid}/creatorMonetizationPreference`]: monetizationPreference,
      [`usuarios/${uid}/creatorMonetizationStatus`]: 'disabled',
      [`usuarios/${uid}/instagramUrl`]: instagramUrl || null,
      [`usuarios/${uid}/youtubeUrl`]: youtubeUrl || null,
      [`usuarios/${uid}/creatorPendingProfileImageUrl`]: profileImageUrl,
      [`usuarios/${uid}/creatorPendingProfileImageCrop`]: profileImageCrop,
      [`usuarios/${uid}/creatorBannerUrl`]: null,
      [`usuarios_publicos/${uid}/creatorBannerUrl`]: null,
      [`usuarios/${uid}/birthDate`]: birthDateRaw,
      [`usuarios/${uid}/birthYear`]: Number.isInteger(birthYearFromDate) ? birthYearFromDate : null,
      [`usuarios_publicos/${uid}/signupIntent`]: 'creator',
      [`usuarios_publicos/${uid}/updatedAt`]: now,
      [`usuarios/${uid}/creatorTermsAccepted`]: true,
      [`usuarios/${uid}/creatorCompliance`]: null,
    };
    await db.ref().update(prePatch);
    const snapAfter = await userRef.get();
    const rowAfter = snapAfter.val() || {};
    await finalizeCreatorApplicationApproval(db, uid, rowAfter, uid, { isAutoPublishOnly: true });
    return {
      ok: true,
      status: 'approved',
      autoApproved: true,
      application: creatorApplication,
      monetizationPreference,
      monetizationRequested,
      isAdult,
    };
  }

  const patch = {
    [`usuarios/${uid}/creator`]: creatorDocSubmit,
    [`usuarios/${uid}/signupIntent`]: 'creator',
    [`usuarios/${uid}/creatorApplicationStatus`]: 'requested',
    [`usuarios/${uid}/creatorApplication`]: creatorApplication,
    [`usuarios/${uid}/creatorDisplayName`]: displayName,
    [`usuarios/${uid}/creatorBio`]: bioShort,
    [`usuarios/${uid}/creatorMonetizationPreference`]: monetizationPreference,
    [`usuarios/${uid}/creatorMonetizationStatus`]: 'disabled',
    [`usuarios/${uid}/creatorMonetizationReviewRequestedAt`]: null,
    [`usuarios/${uid}/instagramUrl`]: instagramUrl || null,
    [`usuarios/${uid}/youtubeUrl`]: youtubeUrl || null,
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: profileImageUrl,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: profileImageCrop,
    [`usuarios/${uid}/creatorBannerUrl`]: null,
    [`usuarios_publicos/${uid}/creatorBannerUrl`]: null,
    [`usuarios/${uid}/birthDate`]: birthDateRaw,
    [`usuarios/${uid}/birthYear`]: Number.isInteger(birthYearFromDate) ? birthYearFromDate : null,
    [`usuarios/${uid}/creatorRequestedAt`]: now,
    [`usuarios/${uid}/creatorRejectedAt`]: null,
    [`usuarios/${uid}/creatorApprovedAt`]: null,
    [`usuarios/${uid}/creatorReviewedBy`]: null,
    [`usuarios/${uid}/creatorReviewReason`]: null,
    [`usuarios/${uid}/creatorModerationAction`]: null,
    [`usuarios/${uid}/creatorModerationBy`]: null,
    [`usuarios/${uid}/creatorModeratedAt`]: null,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios_publicos/${uid}/signupIntent`]: 'creator',
    [`usuarios_publicos/${uid}/updatedAt`]: now,
    [`usuarios/${uid}/creatorTermsAccepted`]: true,
    [`usuarios/${uid}/creatorCompliance`]: compliance || null,
  };
  await db.ref().update(patch);

  await pushUserNotification(db, uid, {
    type: 'creator_application',
    title: 'Solicitacao enviada',
    message:
      monetizationPreference === 'monetize'
        ? 'Seu pedido de criador com monetizacao foi enviado. Se aprovado como creator, a monetizacao ja nasce pronta para uso.'
        : 'Seu pedido de criador foi enviado para analise.',
    data: { status: 'requested', monetizationPreference, monetizationRequested, isAdult },
  });
  await notifyCreatorRequestAdmins(db, {
    applicantUid: uid,
    displayName,
    monetizationPreference,
  });
  return { ok: true, status: 'requested', application: creatorApplication };
});
