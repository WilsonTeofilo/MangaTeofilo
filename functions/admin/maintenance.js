import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  isTargetSuperAdmin,
  requireAdminAuth,
  requirePermission,
  requireSuperAdmin,
  resolveTargetUidByEmail,
} from '../adminRbac.js';
import { resolveCreatorMonetizationPreferenceFromDb } from '../creatorRecord.js';
import { sanitizeCreatorId, recordCreatorManualPixPayout } from '../creatorDataLedger.js';
import { buildUserEntitlementsPatch } from '../userEntitlements.js';
import { buildPublicProfileFromUsuarioRow } from '../shared/publicUserProfile.js';

const USER_AVATAR_FALLBACK = '/assets/avatares/ava1.webp';
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
    if (!creatorId) continue;
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

export const adminBackfillUserProfileSchema = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'migrateUsers');

    const db = getDatabase();
    const usuariosSnap = await db.ref('usuarios').get();
    const usuarios = usuariosSnap.val() || {};
    const allUids = new Set(Object.keys(usuarios));
    let usuariosComPatch = 0;
    let publicProfilesComPatch = 0;

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
        usuarios[uid]?.publicProfile || {},
        { ...(usuarios[uid] || {}), ...userPatch },
        authUser
      );
      if (Object.keys(publicPatch).length) {
        await db.ref(`usuarios/${uid}/publicProfile`).update(publicPatch);
        publicProfilesComPatch += 1;
      }
    }

    logger.info('adminBackfillUserProfileSchema', {
      usuariosComPatch,
      publicProfilesComPatch,
      total: allUids.size,
    });

    return {
      ok: true,
      total: allUids.size,
      usuariosComPatch,
      publicProfilesComPatch,
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
    const usuariosSnap = await db.ref('usuarios').get();
    const usuarios = usuariosSnap.val() || {};
    const allUids = new Set(Object.keys(usuarios));
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
  await requireSuperAdmin(request.auth);
  const db = getDatabase();
  const [worksSnap, chaptersSnap, creatorsSnap] = await Promise.all([
    db.ref('obras').get(),
    db.ref('capitulos').get(),
    db.ref('creators').get(),
  ]);
  const works = worksSnap.val() || {};
  const chapters = chaptersSnap.val() || {};
  const creators = creatorsSnap.val() || {};
  const creatorIds = new Set(Object.keys(creators).map((id) => sanitizeCreatorId(id)).filter(Boolean));
  const chaptersByWork = new Map();
  for (const [chapterId, chapterRow] of Object.entries(chapters)) {
    const workId = normalizeAdminWorkId(chapterRow?.workId || chapterRow?.obraId || chapterRow?.mangaId || '');
    if (!workId) continue;
    const list = chaptersByWork.get(workId) || [];
    list.push({ chapterId, ...(chapterRow || {}) });
    chaptersByWork.set(workId, list);
  }
  const snap = await db.ref('obras').get();
  let updated = 0;
  let skippedWithoutSafeInference = 0;
  for (const [id, row] of Object.entries(snap.val() || {})) {
    if (row && !row.creatorId && id) {
      const normalizedId = normalizeAdminWorkId(id);
      const dominantCreatorId = sanitizeCreatorId(
        dominantCreatorIdFromChaptersAdmin(chaptersByWork.get(normalizedId) || [])
      );
      if (!dominantCreatorId || !creatorIds.has(dominantCreatorId)) {
        skippedWithoutSafeInference += 1;
        continue;
      }
      await db.ref(`obras/${id}/creatorId`).set(dominantCreatorId);
      updated += 1;
    }
  }
  logger.info('adminBackfillObraCreatorIds', { updated, skippedWithoutSafeInference });
  return { ok: true, updated, skippedWithoutSafeInference };
});

export const adminDiagnosticarObrasAutorInconsistente = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'migrateUsers');

  const db = getDatabase();
  const [worksSnap, chaptersSnap, usuariosSnap] = await Promise.all([
    db.ref('obras').get(),
    db.ref('capitulos').get(),
    db.ref('usuarios').get(),
  ]);

  const works = worksSnap.exists() ? worksSnap.val() || {} : {};
  const chapters = chaptersSnap.exists() ? chaptersSnap.val() || {} : {};
  const publicProfiles = usuariosSnap.exists()
    ? Object.fromEntries(
        Object.entries(usuariosSnap.val() || {}).map(([uid, row]) => [
          uid,
          buildPublicProfileFromUsuarioRow(row, uid),
        ])
      )
    : {};
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
      workCreatorId !== dominantChapterCreatorId
    ) {
      issueCodes.push('work_creator_differs_from_chapters');
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
      },
      sample: issues.slice(0, 100),
    };
});

export const adminBackfillCanonicalCreatorMonetization = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'migrateUsers');

    const dryRun = request.data?.dryRun !== false;
    const db = getDatabase();
    const usuariosSnap = await db.ref('usuarios').get();
    const usuarios = usuariosSnap.exists() ? usuariosSnap.val() || {} : {};
    const patch = {};
    const sample = [];
    let updated = 0;

    for (const [uid, row] of Object.entries(usuarios)) {
      const current = row && typeof row === 'object' ? row : {};
      const approved =
        current?.creator?.monetization?.approved === true ||
        current?.creator?.monetization?.isApproved === true;
      const active =
        current?.creator?.monetization?.enabled === true ||
        current?.creator?.monetization?.isMonetizationActive === true;
      const nextRequested =
        current?.creator?.monetization?.requested === true ||
        resolveCreatorMonetizationPreferenceFromDb(current) === 'monetize';

      const needsCreatorDoc =
        current?.creator?.monetization?.isApproved !== approved ||
        current?.creator?.monetization?.approved !== approved ||
        current?.creator?.monetization?.isMonetizationActive !== active ||
        current?.creator?.monetization?.enabled !== active ||
        current?.creator?.monetization?.requested !== nextRequested;
      const hasLegacyFields =
        String(current?.creatorMonetizationPreference || '').trim().length > 0 ||
        current?.creatorMonetizationApprovedOnce != null ||
        String(current?.creatorMonetizationStatus || '').trim().length > 0 ||
        current?.creatorMonetizationReviewRequestedAt != null ||
        String(current?.creatorMonetizationReviewReason || '').trim().length > 0;

      if (!needsCreatorDoc && !hasLegacyFields) continue;

      if (needsCreatorDoc) {
        patch[`usuarios/${uid}/creator/monetization/approved`] = approved;
        patch[`usuarios/${uid}/creator/monetization/isApproved`] = approved;
        patch[`usuarios/${uid}/creator/monetization/enabled`] = active;
        patch[`usuarios/${uid}/creator/monetization/isMonetizationActive`] = active;
        patch[`usuarios/${uid}/creator/monetization/requested`] = nextRequested;
      }
      if (hasLegacyFields) {
        patch[`usuarios/${uid}/creatorMonetizationPreference`] = null;
        patch[`usuarios/${uid}/creatorMonetizationApprovedOnce`] = null;
        patch[`usuarios/${uid}/creatorMonetizationStatus`] = null;
        patch[`usuarios/${uid}/creatorMonetizationReviewRequestedAt`] = null;
        patch[`usuarios/${uid}/creatorMonetizationReviewReason`] = null;
      }
      updated += 1;
      if (sample.length < 100) {
        sample.push({ uid, approved, active, clearedLegacyFields: hasLegacyFields });
      }
    }

    if (!dryRun && Object.keys(patch).length) {
      await db.ref().update(patch);
    }

    return { ok: true, dryRun, updated, sample };
  }
);

export const adminDiagnosticarConsistenciaIdentificadores = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'migrateUsers');

    const db = getDatabase();
    const [worksSnap, chaptersSnap, productsSnap, storeOrdersSnap, creatorsSnap] = await Promise.all([
      db.ref('obras').get(),
      db.ref('capitulos').get(),
      db.ref('loja/produtos').get(),
      db.ref('loja/pedidos').get(),
      db.ref('creators').get(),
    ]);

    const works = worksSnap.exists() ? worksSnap.val() || {} : {};
    const chapters = chaptersSnap.exists() ? chaptersSnap.val() || {} : {};
    const products = productsSnap.exists() ? productsSnap.val() || {} : {};
    const storeOrders = storeOrdersSnap.exists() ? storeOrdersSnap.val() || {} : {};
    const creators = creatorsSnap.exists() ? creatorsSnap.val() || {} : {};

    const workIds = new Set(Object.keys(works).map((id) => normalizeAdminWorkId(id)).filter(Boolean));
    const creatorIds = new Set(Object.keys(creators).map((id) => sanitizeCreatorId(id)).filter(Boolean));
    const issues = [];

    for (const [workIdRaw, row] of Object.entries(works)) {
      const workId = normalizeAdminWorkId(workIdRaw);
      const creatorId = sanitizeCreatorId(row?.creatorId);
      const issueCodes = [];
      if (!workId) issueCodes.push('invalid_work_id');
      if (!creatorId) issueCodes.push('missing_creator_id');
      if (creatorId && !creatorIds.has(creatorId)) issueCodes.push('creator_not_found');
      if (issueCodes.length) {
        issues.push({
          entity: 'obra',
          id: String(workIdRaw || ''),
          issueCodes,
          creatorId: creatorId || null,
        });
      }
    }

    for (const [chapterId, row] of Object.entries(chapters)) {
      const workId = normalizeAdminWorkId(row?.workId || row?.obraId || row?.mangaId);
      const creatorId = sanitizeCreatorId(row?.creatorId);
      const issueCodes = [];
      if (!workId) issueCodes.push('missing_work_id');
      if (workId && !workIds.has(workId)) issueCodes.push('work_id_not_found');
      if (!creatorId) issueCodes.push('missing_creator_id');
      if (creatorId && !creatorIds.has(creatorId)) issueCodes.push('creator_not_found');
      if (issueCodes.length) {
        issues.push({
          entity: 'capitulo',
          id: String(chapterId || ''),
          issueCodes,
          workId: workId || null,
          creatorId: creatorId || null,
        });
      }
    }

    for (const [productId, row] of Object.entries(products)) {
      const creatorId = sanitizeCreatorId(row?.creatorId);
      const workId = normalizeAdminWorkId(row?.workId || row?.obraId || row?.obra);
      const issueCodes = [];
      if (!creatorId) issueCodes.push('missing_creator_id');
      if (creatorId && !creatorIds.has(creatorId)) issueCodes.push('creator_not_found');
      if (workId && !workIds.has(workId)) issueCodes.push('referenced_work_not_found');
      if (issueCodes.length) {
        issues.push({
          entity: 'produto_loja',
          id: String(productId || ''),
          issueCodes,
          workId: workId || null,
          creatorId: creatorId || null,
        });
      }
    }

    for (const [orderId, row] of Object.entries(storeOrders)) {
      const items = Array.isArray(row?.items) ? row.items : [];
      const missingCreatorItems = items.filter((item) => !sanitizeCreatorId(item?.creatorId)).length;
      const missingProductItems = items.filter((item) => !String(item?.productId || '').trim()).length;
      const badProductRefs = items.filter((item) => {
        const productId = String(item?.productId || '').trim();
        return productId && !products[productId];
      }).length;
      const issueCodes = [];
      if (missingCreatorItems > 0) issueCodes.push('items_missing_creator_id');
      if (missingProductItems > 0) issueCodes.push('items_missing_product_id');
      if (badProductRefs > 0) issueCodes.push('items_product_not_found');
      if (issueCodes.length) {
        issues.push({
          entity: 'pedido_loja',
          id: String(orderId || ''),
          issueCodes,
          missingCreatorItems,
          missingProductItems,
          badProductRefs,
        });
      }
    }

    return {
      ok: true,
      totals: {
        obras: Object.keys(works).length,
        capitulos: Object.keys(chapters).length,
        produtosLoja: Object.keys(products).length,
        pedidosLoja: Object.keys(storeOrders).length,
      },
      issueSummary: {
        obras: issues.filter((item) => item.entity === 'obra').length,
        capitulos: issues.filter((item) => item.entity === 'capitulo').length,
        produtosLoja: issues.filter((item) => item.entity === 'produto_loja').length,
        pedidosLoja: issues.filter((item) => item.entity === 'pedido_loja').length,
      },
      findingsCount: issues.length,
      sample: issues.slice(0, 200),
    };
  }
);

export const adminBackfillCanonicalIdentifiers = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'migrateUsers');

    const dryRun = request.data?.dryRun !== false;
    const db = getDatabase();
    const [worksSnap, chaptersSnap, productsSnap, storeOrdersSnap, creatorsSnap] = await Promise.all([
      db.ref('obras').get(),
      db.ref('capitulos').get(),
      db.ref('loja/produtos').get(),
      db.ref('loja/pedidos').get(),
      db.ref('creators').get(),
    ]);

    const works = worksSnap.exists() ? worksSnap.val() || {} : {};
    const chapters = chaptersSnap.exists() ? chaptersSnap.val() || {} : {};
    const products = productsSnap.exists() ? productsSnap.val() || {} : {};
    const storeOrders = storeOrdersSnap.exists() ? storeOrdersSnap.val() || {} : {};
    const creators = creatorsSnap.exists() ? creatorsSnap.val() || {} : {};

    const creatorIds = new Set(Object.keys(creators).map((id) => sanitizeCreatorId(id)).filter(Boolean));
    const patch = {};
    const sample = [];
    let updates = 0;

    const normalizedWorkById = new Map();
    for (const [workIdRaw, row] of Object.entries(works)) {
      const workId = normalizeAdminWorkId(workIdRaw);
      if (!workId) continue;
      normalizedWorkById.set(workId, { id: workIdRaw, row: row || {} });
    }

    const dominantChapterCreatorByWork = new Map();
    const chapterRowsByWork = new Map();
    for (const [chapterId, row] of Object.entries(chapters)) {
      const chapter = row && typeof row === 'object' ? row : {};
      const workId = normalizeAdminWorkId(chapter.workId || chapter.obraId || chapter.mangaId);
      if (!workId) continue;
      const list = chapterRowsByWork.get(workId) || [];
      list.push({ chapterId, ...chapter });
      chapterRowsByWork.set(workId, list);
    }
    for (const [workId, list] of chapterRowsByWork.entries()) {
      dominantChapterCreatorByWork.set(workId, dominantCreatorIdFromChaptersAdmin(list));
    }

    for (const [workIdRaw, row] of Object.entries(works)) {
      const workId = normalizeAdminWorkId(workIdRaw);
      if (!workId) continue;
      const creatorId = sanitizeCreatorId(row?.creatorId);
      if (!creatorId) {
        const inferred = sanitizeCreatorId(dominantChapterCreatorByWork.get(workId));
        if (inferred && creatorIds.has(inferred)) {
          patch[`obras/${workIdRaw}/creatorId`] = inferred;
          updates += 1;
          if (sample.length < 100) sample.push({ entity: 'obra', id: workIdRaw, field: 'creatorId', value: inferred });
        }
      }
    }

    for (const [chapterId, row] of Object.entries(chapters)) {
      const chapter = row && typeof row === 'object' ? row : {};
      const workId = normalizeAdminWorkId(chapter.workId || chapter.obraId || chapter.mangaId);
      if (!String(chapter.workId || '').trim() && workId && normalizedWorkById.has(workId)) {
        patch[`capitulos/${chapterId}/workId`] = workId;
        updates += 1;
        if (sample.length < 100) sample.push({ entity: 'capitulo', id: chapterId, field: 'workId', value: workId });
      }
      const creatorId = sanitizeCreatorId(chapter.creatorId);
      if (!creatorId && workId && normalizedWorkById.has(workId)) {
        const inferred = sanitizeCreatorId(normalizedWorkById.get(workId)?.row?.creatorId);
        if (inferred && creatorIds.has(inferred)) {
          patch[`capitulos/${chapterId}/creatorId`] = inferred;
          updates += 1;
          if (sample.length < 100) sample.push({ entity: 'capitulo', id: chapterId, field: 'creatorId', value: inferred });
        }
      }
    }

    for (const [productId, row] of Object.entries(products)) {
      const product = row && typeof row === 'object' ? row : {};
      const workId = normalizeAdminWorkId(product.workId || product.obraId || product.obra);
      if (!String(product.workId || '').trim() && workId && normalizedWorkById.has(workId)) {
        patch[`loja/produtos/${productId}/workId`] = workId;
        updates += 1;
        if (sample.length < 100) sample.push({ entity: 'produto_loja', id: productId, field: 'workId', value: workId });
      }
      const creatorId = sanitizeCreatorId(product.creatorId);
      if (!creatorId && workId && normalizedWorkById.has(workId)) {
        const inferred = sanitizeCreatorId(normalizedWorkById.get(workId)?.row?.creatorId);
        if (inferred && creatorIds.has(inferred)) {
          patch[`loja/produtos/${productId}/creatorId`] = inferred;
          updates += 1;
          if (sample.length < 100) sample.push({ entity: 'produto_loja', id: productId, field: 'creatorId', value: inferred });
        }
      }
    }

    for (const [orderId, row] of Object.entries(storeOrders)) {
      const items = Array.isArray(row?.items) ? row.items : [];
      items.forEach((item, index) => {
        const productId = String(item?.productId || '').trim();
        if (!productId || !products[productId]) return;
        const product = products[productId] || {};
        const creatorId = sanitizeCreatorId(item?.creatorId);
        if (!creatorId) {
          const inferred = sanitizeCreatorId(product.creatorId);
          if (inferred && creatorIds.has(inferred)) {
            patch[`loja/pedidos/${orderId}/items/${index}/creatorId`] = inferred;
            updates += 1;
            if (sample.length < 100) sample.push({ entity: 'pedido_loja', id: orderId, field: `items[${index}].creatorId`, value: inferred });
          }
        }
      });
    }

    if (!dryRun && Object.keys(patch).length) {
      await db.ref().update(patch);
    }

    return {
      ok: true,
      dryRun,
      updates,
      sample,
    };
  }
);

export const adminBackfillChapterCreatorIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  await requireSuperAdmin(request.auth);
  const db = getDatabase();
  const [capsSnap, obrasSnap] = await Promise.all([db.ref('capitulos').get(), db.ref('obras').get()]);
  const obras = obrasSnap.val() || {};
  let updated = 0;
  let skippedWithoutWork = 0;
  let skippedWithoutCreator = 0;
  for (const [id, cap] of Object.entries(capsSnap.val() || {})) {
    if (!cap || cap.creatorId || !id) continue;
    const raw = String(cap.workId || cap.obraId || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40);
    if (!raw) {
      skippedWithoutWork += 1;
      continue;
    }
    const obra = obras[raw] || {};
    const creatorId = sanitizeCreatorId(obra.creatorId);
    if (!creatorId) {
      skippedWithoutCreator += 1;
      continue;
    }
    await db.ref(`capitulos/${id}/creatorId`).set(String(creatorId));
    updated += 1;
  }
  logger.info('adminBackfillChapterCreatorIds', { updated, skippedWithoutWork, skippedWithoutCreator });
  return { ok: true, updated, skippedWithoutWork, skippedWithoutCreator };
});

export const adminBackfillChapterWorkIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  await requireSuperAdmin(request.auth);
  const db = getDatabase();
  const snap = await db.ref('capitulos').get();
  const caps = snap.val() || {};
  let updated = 0;
  let skippedWithoutHint = 0;
  for (const [id, cap] of Object.entries(caps)) {
    if (!cap || !id || String(cap.workId || '').trim()) continue;
    const workId = String(cap?.obraId || cap?.workId || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40);
    if (!workId) {
      skippedWithoutHint += 1;
      continue;
    }
    await db.ref(`capitulos/${id}/workId`).set(workId);
    updated += 1;
  }
  logger.info('adminBackfillChapterWorkIds', { updated, skippedWithoutHint });
  return { ok: true, updated, skippedWithoutHint };
});

export const adminBackfillStoreProductCreatorIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  await requireSuperAdmin(request.auth);
  const db = getDatabase();
  const [productsSnap, obrasSnap] = await Promise.all([db.ref('loja/produtos').get(), db.ref('obras').get()]);
  const products = productsSnap.val() || {};
  const obras = obrasSnap.val() || {};
  let updated = 0;
  let skippedWithoutHint = 0;
  let skippedWithoutCreator = 0;
  for (const [id, row] of Object.entries(products)) {
    if (!row || row.creatorId || !id) continue;
    const obraHint = String(row.obra || row.workId || row.obraId || '').trim().toLowerCase();
    if (!obraHint) {
      skippedWithoutHint += 1;
      continue;
    }
    const obra = obras[obraHint] || null;
    const creatorId = sanitizeCreatorId(obra?.creatorId);
    if (!creatorId) {
      skippedWithoutCreator += 1;
      continue;
    }
    await db.ref(`loja/produtos/${id}/creatorId`).set(creatorId);
    updated += 1;
  }
  logger.info('adminBackfillStoreProductCreatorIds', { updated, skippedWithoutHint, skippedWithoutCreator });
  return {
    ok: true,
    updated,
    skippedWithoutHint,
    skippedWithoutCreator,
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

