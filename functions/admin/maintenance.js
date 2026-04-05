import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  SUPER_ADMIN_UIDS,
  isTargetSuperAdmin,
  requireAdminAuth,
  requirePermission,
  requireSuperAdmin,
  resolveTargetUidByEmail,
} from '../adminRbac.js';
import { sanitizeCreatorId, recordCreatorManualPixPayout } from '../creatorDataLedger.js';
import { USUARIOS_DEPRECATED_KEYS, USUARIOS_PUBLICOS_DEPRECATED_KEYS } from '../deprecatedUserFields.js';
import { buildUserEntitlementsPatch } from '../userEntitlements.js';

const USER_AVATAR_FALLBACK = '/assets/avatares/ava1.webp';
const PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS = Array.from(SUPER_ADMIN_UIDS)[0] || null;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeAdminWorkId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
}

function dominantCreatorIdFromChaptersAdmin(chapters = []) {
  const counts = new Map();
  for (const chapter of chapters) {
    const creatorId = sanitizeCreatorId(chapter?.creatorId);
    if (!creatorId || creatorId === PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS) continue;
    counts.set(creatorId, (counts.get(creatorId) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [creatorId, count] of counts.entries()) {
    if (count > bestCount) {
      best = creatorId;
      bestCount = count;
    }
  }
  return best;
}

function normalizeLegacyMonetizationStatusForAdmin(row = {}) {
  const current = String(row?.creatorMonetizationStatus || '').trim().toLowerCase();
  if (current !== 'pending_review') return current || '';
  const approvedOnce =
    row?.creatorMonetizationApprovedOnce === true ||
    row?.creator?.monetization?.approved === true;
  return approvedOnce ? 'active' : 'disabled';
}

function buildAdminUserSchemaPatch(uid, row = {}, authUser = null) {
  const now = Date.now();
  const patch = {};
  const current = row && typeof row === 'object' ? row : {};
  const authEmail = normalizeEmail(authUser?.email || '');
  const authName = String(authUser?.displayName || '').trim();
  const authAvatar = String(authUser?.photoURL || '').trim();

  if (!current.uid) patch.uid = uid;
  if (!String(current.email || '').trim() && authEmail) patch.email = authEmail;
  if (!String(current.userName || '').trim()) patch.userName = authName || 'Leitor';
  if (!String(current.userAvatar || '').trim()) patch.userAvatar = authAvatar || USER_AVATAR_FALLBACK;
  if (!String(current.role || '').trim()) patch.role = 'user';
  if (!String(current.accountType || '').trim()) patch.accountType = 'comum';
  if (!String(current.gender || '').trim()) patch.gender = 'nao_informado';
  if (!String(current.status || '').trim()) patch.status = 'pendente';
  if (!String(current.membershipStatus || '').trim()) patch.membershipStatus = 'inativo';
  if (!String(current.sourceAcquisition || '').trim()) patch.sourceAcquisition = 'organico';
  if (!String(current.signupIntent || '').trim()) patch.signupIntent = 'reader';
  if (!Object.prototype.hasOwnProperty.call(current, 'creatorApplicationStatus')) patch.creatorApplicationStatus = null;
  if (!Object.prototype.hasOwnProperty.call(current, 'creatorRequestedAt')) patch.creatorRequestedAt = null;
  if (typeof current.birthYear !== 'number' && current.birthYear !== null) patch.birthYear = null;
  if (typeof current.notifyNewChapter !== 'boolean') patch.notifyNewChapter = false;
  if (typeof current.notifyPromotions !== 'boolean') patch.notifyPromotions = false;
  if (typeof current.marketingOptIn !== 'boolean') patch.marketingOptIn = false;
  if (typeof current.marketingOptInAt !== 'number' && current.marketingOptInAt !== null) patch.marketingOptInAt = null;
  if (typeof current.memberUntil !== 'number' && current.memberUntil !== null) patch.memberUntil = null;
  if (typeof current.currentPlanId !== 'string' && current.currentPlanId !== null) patch.currentPlanId = null;
  if (typeof current.lastPaymentAt !== 'number' && current.lastPaymentAt !== null) patch.lastPaymentAt = null;
  if (typeof current.premium5dNotifiedForUntil !== 'number' && current.premium5dNotifiedForUntil !== null) {
    patch.premium5dNotifiedForUntil = null;
  }
  if (Object.prototype.hasOwnProperty.call(current, 'creatorMemberships') && current.creatorMemberships != null) {
    patch.creatorMemberships = null;
  }
  if (typeof current.createdAt !== 'number') patch.createdAt = now;
  if (typeof current.lastLogin !== 'number') patch.lastLogin = now;

  if (!current.userEntitlements || typeof current.userEntitlements !== 'object') {
    patch.userEntitlements = buildUserEntitlementsPatch(current).userEntitlements;
  } else {
    const global = current.userEntitlements.global || {};
    const creators =
      current.userEntitlements.creators && typeof current.userEntitlements.creators === 'object'
        ? current.userEntitlements.creators
        : null;
    if (
      typeof global.isPremium !== 'boolean' ||
      !String(global.status || '').trim() ||
      (typeof global.memberUntil !== 'number' && global.memberUntil !== null) ||
      !creators ||
      typeof current.userEntitlements.updatedAt !== 'number'
    ) {
      patch.userEntitlements = buildUserEntitlementsPatch(current).userEntitlements;
    }
  }

  return patch;
}

function buildAdminPublicUserSchemaPatch(uid, row = {}, privateRow = {}, authUser = null) {
  const now = Date.now();
  const patch = { updatedAt: now };
  const current = row && typeof row === 'object' ? row : {};
  const source = privateRow && typeof privateRow === 'object' ? privateRow : {};
  const authName = String(authUser?.displayName || '').trim();
  const authAvatar = String(authUser?.photoURL || '').trim();

  if (!current.uid) patch.uid = uid;
  if (!String(current.userName || '').trim()) {
    patch.userName = String(source.userName || authName || 'Leitor').trim() || 'Leitor';
  }
  if (!String(current.userAvatar || '').trim()) {
    patch.userAvatar = String(source.userAvatar || authAvatar || USER_AVATAR_FALLBACK).trim() || USER_AVATAR_FALLBACK;
  }
  if (!String(current.accountType || '').trim()) {
    patch.accountType = String(source.accountType || 'comum').trim() || 'comum';
  }
  if (!String(current.signupIntent || '').trim()) {
    patch.signupIntent = String(source.signupIntent || 'reader').trim() || 'reader';
  }
  return patch;
}

export const adminMigrateDeprecatedUserFields = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'migrateUsers');

  const hasPriv = USUARIOS_DEPRECATED_KEYS.length > 0;
  const hasPub = USUARIOS_PUBLICOS_DEPRECATED_KEYS.length > 0;
  if (!hasPriv && !hasPub) {
    return {
      ok: true,
      message: 'Nenhuma chave obsoleta configurada em functions/deprecatedUserFields.js',
      usuariosComPatch: 0,
      publicosComPatch: 0,
    };
  }

  const db = getDatabase();
  let usuariosComPatch = 0;
  let publicosComPatch = 0;

  if (hasPriv) {
    const snap = await db.ref('usuarios').get();
    if (snap.exists()) {
      const data = snap.val() || {};
      for (const uid of Object.keys(data)) {
        const row = data[uid] || {};
        const patch = {};
        for (const key of USUARIOS_DEPRECATED_KEYS) {
          if (Object.prototype.hasOwnProperty.call(row, key)) patch[key] = null;
        }
        if (Object.keys(patch).length) {
          await db.ref(`usuarios/${uid}`).update(patch);
          usuariosComPatch += 1;
        }
      }
    }
  }

  if (hasPub) {
    const snap = await db.ref('usuarios_publicos').get();
    if (snap.exists()) {
      const data = snap.val() || {};
      for (const uid of Object.keys(data)) {
        const row = data[uid] || {};
        const patch = {};
        for (const key of USUARIOS_PUBLICOS_DEPRECATED_KEYS) {
          if (Object.prototype.hasOwnProperty.call(row, key)) patch[key] = null;
        }
        if (Object.keys(patch).length) {
          await db.ref(`usuarios_publicos/${uid}`).update(patch);
          publicosComPatch += 1;
        }
      }
    }
  }

  return { ok: true, usuariosComPatch, publicosComPatch };
});

export const adminBackfillUserProfileSchema = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'migrateUsers');

    const db = getDatabase();
    const [usuariosSnap, publicosSnap] = await Promise.all([
      db.ref('usuarios').get(),
      db.ref('usuarios_publicos').get(),
    ]);
    const usuarios = usuariosSnap.val() || {};
    const publicos = publicosSnap.val() || {};
    const allUids = new Set([...Object.keys(usuarios), ...Object.keys(publicos)]);
    let usuariosComPatch = 0;
    let publicosComPatch = 0;

    for (const uid of allUids) {
      let authUser = null;
      try {
        authUser = await getAuth().getUser(uid);
      } catch (err) {
        if (err?.code !== 'auth/user-not-found') throw err;
      }

      const userPatch = buildAdminUserSchemaPatch(uid, usuarios[uid] || {}, authUser);
      if (Object.keys(userPatch).length) {
        await db.ref(`usuarios/${uid}`).update(userPatch);
        usuariosComPatch += 1;
      }

      const publicPatch = buildAdminPublicUserSchemaPatch(
        uid,
        publicos[uid] || {},
        { ...(usuarios[uid] || {}), ...userPatch },
        authUser
      );
      if (Object.keys(publicPatch).length) {
        await db.ref(`usuarios_publicos/${uid}`).update(publicPatch);
        publicosComPatch += 1;
      }
    }

    logger.info('adminBackfillUserProfileSchema', {
      usuariosComPatch,
      publicosComPatch,
      total: allUids.size,
    });

    return {
      ok: true,
      total: allUids.size,
      usuariosComPatch,
      publicosComPatch,
    };
  }
);

export const adminCleanupOrphanUserProfiles = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'migrateUsers');

    const dryRun = request.data?.dryRun !== false;
    const db = getDatabase();
    const [usuariosSnap, publicosSnap] = await Promise.all([
      db.ref('usuarios').get(),
      db.ref('usuarios_publicos').get(),
    ]);
    const usuarios = usuariosSnap.val() || {};
    const publicos = publicosSnap.val() || {};
    const allUids = new Set([...Object.keys(usuarios), ...Object.keys(publicos)]);
    const orphanUids = [];

    for (const uid of allUids) {
      try {
        await getAuth().getUser(uid);
      } catch (err) {
        if (err?.code === 'auth/user-not-found') {
          orphanUids.push(uid);
          continue;
        }
        throw err;
      }
    }

    if (!dryRun) {
      for (const uid of orphanUids) {
        await db.ref(`usuarios/${uid}`).remove();
        await db.ref(`usuarios_publicos/${uid}`).remove();
      }
    }

    logger.info('adminCleanupOrphanUserProfiles', {
      dryRun,
      orphanCount: orphanUids.length,
    });

    return {
      ok: true,
      dryRun,
      orphanCount: orphanUids.length,
      orphanUids: orphanUids.slice(0, 100),
    };
  }
);

export const adminBackfillObraCreatorIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const legacy = Array.from(SUPER_ADMIN_UIDS)[0];
  const snap = await db.ref('obras').get();
  let updated = 0;
  for (const [id, row] of Object.entries(snap.val() || {})) {
    if (row && !row.creatorId && id) {
      await db.ref(`obras/${id}/creatorId`).set(legacy);
      updated += 1;
    }
  }
  logger.info('adminBackfillObraCreatorIds', { updated });
  return { ok: true, updated };
});

export const adminDiagnosticarObrasAutorInconsistente = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'migrateUsers');

  const db = getDatabase();
  const [worksSnap, chaptersSnap, publicProfilesSnap] = await Promise.all([
    db.ref('obras').get(),
    db.ref('capitulos').get(),
    db.ref('usuarios_publicos').get(),
  ]);

  const works = worksSnap.exists() ? worksSnap.val() || {} : {};
  const chapters = chaptersSnap.exists() ? chaptersSnap.val() || {} : {};
  const publicProfiles = publicProfilesSnap.exists() ? publicProfilesSnap.val() || {} : {};
  const chaptersByWork = new Map();

  for (const [chapterId, row] of Object.entries(chapters)) {
    if (!row || typeof row !== 'object') continue;
    const workId = normalizeAdminWorkId(row.workId || row.obraId || row.mangaId);
    if (!workId) continue;
    const list = chaptersByWork.get(workId) || [];
    list.push({ chapterId, ...(row || {}) });
    chaptersByWork.set(workId, list);
  }

  const issues = [];
  for (const [workIdRaw, workRow] of Object.entries(works)) {
    if (!workRow || typeof workRow !== 'object') continue;
    const workId = normalizeAdminWorkId(workIdRaw);
    const workCreatorId = sanitizeCreatorId(workRow.creatorId);
    const workChapters = chaptersByWork.get(workId) || [];
    const dominantChapterCreatorId = dominantCreatorIdFromChaptersAdmin(workChapters);
    const publicProfile =
      workCreatorId && publicProfiles[workCreatorId] && typeof publicProfiles[workCreatorId] === 'object'
        ? publicProfiles[workCreatorId]
        : null;

    const issueCodes = [];
    if (!workCreatorId) issueCodes.push('missing_work_creator_id');
    if (workCreatorId && !publicProfile) issueCodes.push('missing_public_profile');
    if (
      workCreatorId &&
      dominantChapterCreatorId &&
      workCreatorId !== dominantChapterCreatorId &&
      workCreatorId !== PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS
    ) {
      issueCodes.push('work_creator_differs_from_chapters');
    }
    if (
      workCreatorId === PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS &&
      dominantChapterCreatorId &&
      dominantChapterCreatorId !== PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS
    ) {
      issueCodes.push('legacy_work_creator_should_be_replaced');
    }
    if (!issueCodes.length) continue;

    issues.push({
      workId,
      title: String(workRow.titulo || workRow.title || workId),
      creatorId: workCreatorId || null,
      dominantChapterCreatorId: dominantChapterCreatorId || null,
      chaptersCount: workChapters.length,
      issueCodes,
      isPublished: workRow.isPublished === true,
    });
  }

  return {
    ok: true,
    totalWorks: Object.keys(works).length,
    inconsistentWorks: issues.length,
    issueSummary: {
      missingWorkCreatorId: issues.filter((item) => item.issueCodes.includes('missing_work_creator_id')).length,
      missingPublicProfile: issues.filter((item) => item.issueCodes.includes('missing_public_profile')).length,
      creatorMismatch: issues.filter((item) => item.issueCodes.includes('work_creator_differs_from_chapters')).length,
      legacyShouldBeReplaced: issues.filter((item) => item.issueCodes.includes('legacy_work_creator_should_be_replaced')).length,
    },
    sample: issues.slice(0, 100),
  };
});

export const adminNormalizeLegacyCreatorMonetizationStates = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'migrateUsers');

    const dryRun = request.data?.dryRun !== false;
    const db = getDatabase();
    const [usuariosSnap, publicosSnap] = await Promise.all([
      db.ref('usuarios').get(),
      db.ref('usuarios_publicos').get(),
    ]);
    const usuarios = usuariosSnap.exists() ? usuariosSnap.val() || {} : {};
    const publicos = publicosSnap.exists() ? publicosSnap.val() || {} : {};
    const allUids = new Set([...Object.keys(usuarios), ...Object.keys(publicos)]);
    const sample = [];
    let scanned = 0;
    let normalizedUsers = 0;
    let normalizedPublic = 0;

    for (const uid of allUids) {
      scanned += 1;
      const userRow = usuarios[uid] || {};
      const publicRow = publicos[uid] || {};
      const nextUserStatus = normalizeLegacyMonetizationStatusForAdmin(userRow);
      const nextPublicStatus = normalizeLegacyMonetizationStatusForAdmin({
        ...publicRow,
        creatorMonetizationApprovedOnce: userRow?.creatorMonetizationApprovedOnce,
        creator: userRow?.creator,
      });
      const userNeedsPatch =
        String(userRow?.creatorMonetizationStatus || '').trim().toLowerCase() === 'pending_review' &&
        nextUserStatus &&
        nextUserStatus !== 'pending_review';
      const publicNeedsPatch =
        String(publicRow?.creatorMonetizationStatus || '').trim().toLowerCase() === 'pending_review' &&
        nextPublicStatus &&
        nextPublicStatus !== 'pending_review';

      if (!userNeedsPatch && !publicNeedsPatch) continue;

      if (sample.length < 100) {
        sample.push({
          uid,
          fromUserStatus: String(userRow?.creatorMonetizationStatus || '').trim().toLowerCase() || null,
          toUserStatus: userNeedsPatch ? nextUserStatus : null,
          fromPublicStatus: String(publicRow?.creatorMonetizationStatus || '').trim().toLowerCase() || null,
          toPublicStatus: publicNeedsPatch ? nextPublicStatus : null,
          approvedOnce: userRow?.creatorMonetizationApprovedOnce === true || userRow?.creator?.monetization?.approved === true,
        });
      }

      if (!dryRun) {
        const patch = {};
        if (userNeedsPatch) {
          patch[`usuarios/${uid}/creatorMonetizationStatus`] = nextUserStatus;
          normalizedUsers += 1;
        }
        if (publicNeedsPatch) {
          patch[`usuarios_publicos/${uid}/creatorMonetizationStatus`] = nextPublicStatus;
          normalizedPublic += 1;
        }
        if (Object.keys(patch).length) {
          await db.ref().update(patch);
        }
      }
    }

    logger.info('adminNormalizeLegacyCreatorMonetizationStates', {
      dryRun,
      scanned,
      normalizedUsers,
      normalizedPublic,
      sampleCount: sample.length,
    });

    return {
      ok: true,
      dryRun,
      scanned,
      normalizedUsers,
      normalizedPublic,
      sample,
    };
  }
);

export const adminBackfillChapterCreatorIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const legacy = Array.from(SUPER_ADMIN_UIDS)[0];
  const [capsSnap, obrasSnap] = await Promise.all([db.ref('capitulos').get(), db.ref('obras').get()]);
  const obras = obrasSnap.val() || {};
  let updated = 0;
  for (const [id, cap] of Object.entries(capsSnap.val() || {})) {
    if (!cap || cap.creatorId || !id) continue;
    const raw = String(cap.workId || cap.obraId || 'shito')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40);
    const obra = obras[raw || 'shito'] || {};
    const creatorId = obra.creatorId || legacy;
    await db.ref(`capitulos/${id}/creatorId`).set(String(creatorId));
    updated += 1;
  }
  logger.info('adminBackfillChapterCreatorIds', { updated });
  return { ok: true, updated };
});

export const adminBackfillChapterWorkIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const snap = await db.ref('capitulos').get();
  const caps = snap.val() || {};
  let updated = 0;
  for (const [id, cap] of Object.entries(caps)) {
    if (!cap || !id || String(cap.workId || '').trim()) continue;
    const workId = String(cap?.obraId || cap?.workId || 'shito')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40) || 'shito';
    await db.ref(`capitulos/${id}/workId`).set(workId);
    updated += 1;
  }
  logger.info('adminBackfillChapterWorkIds', { updated });
  return { ok: true, updated };
});

export const adminBackfillStoreProductCreatorIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const [productsSnap, obrasSnap] = await Promise.all([db.ref('loja/produtos').get(), db.ref('obras').get()]);
  const products = productsSnap.val() || {};
  const obras = obrasSnap.val() || {};
  let updated = 0;
  let legacyFallback = 0;
  let skippedWithoutHint = 0;
  for (const [id, row] of Object.entries(products)) {
    if (!row || row.creatorId || !id) continue;
    const obraHint = String(row.obra || row.workId || row.obraId || '').trim().toLowerCase();
    if (!obraHint) {
      skippedWithoutHint += 1;
      continue;
    }
    const obra = obras[obraHint] || null;
    const creatorId = sanitizeCreatorId(obra?.creatorId) || PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS;
    if (!creatorId) continue;
    if (!sanitizeCreatorId(obra?.creatorId)) legacyFallback += 1;
    await db.ref(`loja/produtos/${id}/creatorId`).set(creatorId);
    updated += 1;
  }
  logger.info('adminBackfillStoreProductCreatorIds', { updated, legacyFallback, skippedWithoutHint });
  return {
    ok: true,
    updated,
    legacyFallback,
    skippedWithoutHint,
    legacyCreatorUid: PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS,
  };
});

export const adminAuditarPedidosLojaSemAtribuicao = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'loja');
  const snap = await getDatabase().ref('loja/pedidos').get();
  const orders = snap.val() || {};
  let total = 0;
  let withMissingCreatorItems = 0;
  let legacyOnly = 0;
  const sample = [];
  for (const [orderId, row] of Object.entries(orders)) {
    total += 1;
    const items = Array.isArray(row?.items) ? row.items : [];
    const missing = items.filter((item) => !sanitizeCreatorId(item?.creatorId));
    if (!missing.length) continue;
    withMissingCreatorItems += 1;
    if (items.every((item) => !sanitizeCreatorId(item?.creatorId))) legacyOnly += 1;
    if (sample.length < 20) {
      sample.push({
        orderId,
        createdAt: Number(row?.createdAt || 0),
        status: String(row?.status || ''),
        uid: String(row?.uid || ''),
        total: Number(row?.total || 0),
        missingItems: missing.length,
        totalItems: items.length,
      });
    }
  }
  return {
    ok: true,
    total,
    withMissingCreatorItems,
    legacyOnly,
    note: 'Pedidos antigos sem creatorId continuam como historico valido; sem regra forte de retroatribuicao automatica.',
    sample,
  };
});

export const adminRecordCreatorPixPayout = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'financeiro');
  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const creatorId = sanitizeCreatorId(body.creatorId);
  const amount = Number(body.amount);
  if (!creatorId) throw new HttpsError('invalid-argument', 'creatorId invalido.');
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpsError('invalid-argument', 'amount invalido.');

  const payoutId = await recordCreatorManualPixPayout(getDatabase(), {
    creatorId,
    amount,
    currency: String(body.currency || 'BRL'),
    pixType: body.pixType ? String(body.pixType) : null,
    pixKeyMasked: body.pixKeyMasked ? String(body.pixKeyMasked) : null,
    paidAt: Number(body.paidAt || Date.now()),
    paidByUid: request.auth.uid,
    externalTransferId: body.externalTransferId ? String(body.externalTransferId) : null,
    notes: body.notes ? String(body.notes) : null,
  });
  if (!payoutId) throw new HttpsError('internal', 'Falha ao registrar payout manual.');
  return { ok: true, payoutId };
});

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
  if (!ctx.super && !ctx.legacy && isTargetSuperAdmin({ uid: targetUid, email: targetEmailLower })) {
    throw new HttpsError('permission-denied', 'Sem permissao para revogar sessoes deste usuario.');
  }
  await getAuth().revokeRefreshTokens(targetUid);
  return { ok: true };
});

export const adminRevokeAllSessions = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    requireSuperAdmin(request.auth);
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
