import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getAdminAuthContext, isCreatorAccountAuth } from '../adminRbac.js';
import { sanitizeCreatorId } from '../creatorDataLedger.js';

function creatorAudienceDateKey(timestamp = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(timestamp));
}

export async function incrementCreatorAudienceDaily(db, creatorId, field, amount, timestamp = Date.now()) {
  if (!creatorId || !field || !Number.isFinite(Number(amount)) || Number(amount) === 0) return;
  const key = creatorAudienceDateKey(timestamp);
  await db.ref(`creatorStatsDaily/${creatorId}/${key}/${field}`).transaction((current) => {
    const next = Number(current || 0) + Number(amount);
    return next < 0 ? 0 : next;
  });
  await db.ref(`creatorStatsDaily/${creatorId}/${key}/updatedAt`).set(Date.now());
}

export async function syncCreatorStatsMirrorsFromCanonical(db, creatorId) {
  const cid = sanitizeCreatorId(creatorId);
  if (!cid) return;
  const statsSnap = await db.ref(`creators/${cid}/stats`).get();
  const stats = statsSnap.exists() ? statsSnap.val() || {} : {};
  const followersCount = Math.max(0, Number(stats?.followersCount || 0));
  const totalViews = Math.max(0, Number(stats?.totalViews || 0));
  const likesTotal = Math.max(0, Number(stats?.likesTotal || 0));
  const commentsTotal = Math.max(0, Number(stats?.commentsTotal || 0));
  const membersCount = Math.max(0, Number(stats?.membersCount || 0));
  const revenueTotal = Math.round(Math.max(0, Number(stats?.revenueTotal || 0)) * 100) / 100;
  const uniqueReaders = Math.max(0, Number(stats?.uniqueReaders || 0));
  const updatedAt = Number(stats?.updatedAt || Date.now());
  await db.ref().update({
    [`usuarios_publicos/${cid}/stats/followersCount`]: followersCount,
    [`usuarios_publicos/${cid}/stats/totalViews`]: totalViews,
    [`usuarios_publicos/${cid}/stats/totalLikes`]: likesTotal,
    [`usuarios_publicos/${cid}/stats/totalComments`]: commentsTotal,
    [`usuarios_publicos/${cid}/followersCount`]: followersCount,
    [`usuarios/${cid}/creatorProfile/stats/followersCount`]: followersCount,
    [`usuarios/${cid}/creatorProfile/stats/totalViews`]: totalViews,
    [`usuarios/${cid}/creatorProfile/stats/totalLikes`]: likesTotal,
    [`usuarios/${cid}/creatorProfile/stats/totalComments`]: commentsTotal,
    [`usuarios/${cid}/creatorProfile/stats/membersCount`]: membersCount,
    [`usuarios/${cid}/creatorProfile/stats/revenueTotal`]: revenueTotal,
    [`usuarios/${cid}/creatorProfile/stats/uniqueReaders`]: uniqueReaders,
    [`usuarios/${cid}/creatorProfile/stats/updatedAt`]: updatedAt,
    [`usuarios_publicos/${cid}/updatedAt`]: Date.now(),
  });
}

export async function rebuildCreatorAudienceBackfill(db, creatorId) {
  const cid = sanitizeCreatorId(creatorId);
  if (!cid) {
    throw new HttpsError('invalid-argument', 'creatorId invalido.');
  }

  const [
    creatorUserSnap,
    creatorPublicSnap,
    worksSnap,
    chaptersSnap,
    paymentsSnap,
    subscriptionsSnap,
    existingRetentionSnap,
  ] = await Promise.all([
    db.ref(`usuarios/${cid}`).get(),
    db.ref(`usuarios_publicos/${cid}`).get(),
    db.ref('obras').get(),
    db.ref('capitulos').get(),
    db.ref(`creatorData/${cid}/payments`).get(),
    db.ref(`creatorData/${cid}/subscriptions`).get(),
    db.ref('workRetention').get(),
  ]);

  if (!creatorUserSnap.exists()) {
    throw new HttpsError('not-found', 'Criador nao encontrado.');
  }

  const creatorUser = creatorUserSnap.val() || {};
  const creatorPublic = creatorPublicSnap.exists() ? creatorPublicSnap.val() || {} : {};
  const worksMap = worksSnap.exists() ? worksSnap.val() || {} : {};
  const chaptersMap = chaptersSnap.exists() ? chaptersSnap.val() || {} : {};
  const paymentsMap = paymentsSnap.exists() ? paymentsSnap.val() || {} : {};
  const subscriptionsMap = subscriptionsSnap.exists() ? subscriptionsSnap.val() || {} : {};
  const existingRetention = existingRetentionSnap.exists() ? existingRetentionSnap.val() || {} : {};
  const followersMap =
    creatorPublic?.followers && typeof creatorPublic.followers === 'object' ? creatorPublic.followers : {};

  const creatorWorks = Object.entries(worksMap)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .filter((work) => sanitizeCreatorId(work?.creatorId) === cid);
  const creatorWorkIds = new Set(creatorWorks.map((work) => String(work.id || '').trim().toLowerCase()));
  const creatorChapters = Object.entries(chaptersMap)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .filter((chapter) => {
      if (sanitizeCreatorId(chapter?.creatorId) === cid) return true;
      const workId = String(chapter?.obraId || chapter?.mangaId || '').trim().toLowerCase();
      return creatorWorkIds.has(workId);
    });

  const likesTotal = creatorWorks.reduce(
    (sum, work) => sum + Number(work?.likesCount || work?.favoritesCount || work?.curtidas || 0),
    0
  );
  const commentsTotal =
    creatorWorks.reduce((sum, work) => sum + Number(work?.commentsCount || 0), 0) +
    creatorChapters.reduce((sum, chapter) => sum + Number(chapter?.commentsCount || 0), 0);
  const totalViews =
    creatorWorks.reduce((sum, work) => sum + Number(work?.viewsCount || work?.visualizacoes || 0), 0) +
    creatorChapters.reduce((sum, chapter) => sum + Number(chapter?.viewsCount || chapter?.visualizacoes || 0), 0);
  const followersCount = Object.keys(followersMap).length;
  const revenueTotal = Object.values(paymentsMap).reduce((sum, row) => sum + Number(row?.amount || 0), 0);

  const memberIndex = {};
  let membersCount = 0;
  for (const row of Object.values(subscriptionsMap)) {
    const userId = String(row?.userId || '').trim();
    if (!userId) continue;
    const memberUntil = Number(row?.memberUntil || 0);
    const current = memberIndex[userId] || {
      userId,
      memberUntil: 0,
      lifetimeValue: 0,
      updatedAt: 0,
    };
    current.memberUntil = Math.max(current.memberUntil, memberUntil);
    current.lifetimeValue = Number(current.lifetimeValue || 0) + Number(row?.amount || 0);
    current.updatedAt = Math.max(current.updatedAt, Number(row?.createdAt || 0));
    memberIndex[userId] = current;
  }
  for (const row of Object.values(memberIndex)) {
    if (Number(row?.memberUntil || 0) > Date.now()) membersCount += 1;
  }

  const daily = {};
  const pushDaily = (timestamp, field, amount) => {
    const ts = Number(timestamp || 0);
    const delta = Number(amount || 0);
    if (!ts || !delta) return;
    const key = creatorAudienceDateKey(ts);
    daily[key] = daily[key] || {};
    daily[key][field] = Number(daily[key][field] || 0) + delta;
    daily[key].updatedAt = Date.now();
  };

  for (const row of Object.values(followersMap)) {
    pushDaily(row?.followedAt, 'followersAdded', 1);
  }
  for (const row of Object.values(paymentsMap)) {
    pushDaily(row?.createdAt, 'revenueTotal', Number(row?.amount || 0));
  }
  for (const row of Object.values(subscriptionsMap)) {
    pushDaily(row?.createdAt, 'membersAdded', 1);
  }

  const retentionPatch = {};
  for (const work of creatorWorks) {
    const workId = String(work.id || '').trim().toLowerCase();
    const existing =
      existingRetention?.[workId] && typeof existingRetention[workId] === 'object'
        ? existingRetention[workId]
        : {};
    const chaptersForWork = creatorChapters
      .filter((chapter) => String(chapter?.obraId || chapter?.mangaId || '').trim().toLowerCase() === workId)
      .sort((a, b) => Number(a?.numero || 0) - Number(b?.numero || 0));
    const chapterEntries = {};
    for (const chapter of chaptersForWork) {
      chapterEntries[chapter.id] = {
        ...(existing?.chapters?.[chapter.id] && typeof existing.chapters[chapter.id] === 'object'
          ? existing.chapters[chapter.id]
          : {}),
        chapterId: chapter.id,
        chapterNumber: Number(chapter?.numero || 0),
        chapterTitle: String(chapter?.titulo || `Capitulo ${chapter?.numero || ''}`).trim(),
        readersCount: Number(
          existing?.chapters?.[chapter.id]?.readersCount ||
            chapter?.viewsCount ||
            chapter?.visualizacoes ||
            0
        ),
      };
    }
    retentionPatch[workId] = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      chapters: chapterEntries,
      updatedAt: Date.now(),
    };
  }

  const updatePatch = {
    [`creators/${cid}/stats`]: {
      followersCount,
      totalViews,
      uniqueReaders: Number(creatorUser?.creatorProfile?.stats?.uniqueReaders || 0),
      likesTotal,
      commentsTotal,
      membersCount,
      revenueTotal: Math.round(revenueTotal * 100) / 100,
      updatedAt: Date.now(),
      backfilledAt: Date.now(),
    },
    [`creatorStatsDaily/${cid}`]: daily,
    [`creators/${cid}/membersIndex`]: memberIndex,
    [`usuarios_publicos/${cid}/stats/followersCount`]: followersCount,
    [`usuarios_publicos/${cid}/stats/totalViews`]: totalViews,
    [`usuarios_publicos/${cid}/stats/totalLikes`]: likesTotal,
    [`usuarios_publicos/${cid}/stats/totalComments`]: commentsTotal,
    [`usuarios/${cid}/creatorProfile/stats/followersCount`]: followersCount,
    [`usuarios/${cid}/creatorProfile/stats/totalViews`]: totalViews,
    [`usuarios/${cid}/creatorProfile/stats/totalLikes`]: likesTotal,
    [`usuarios/${cid}/creatorProfile/stats/totalComments`]: commentsTotal,
    [`usuarios/${cid}/creatorProfile/stats/membersCount`]: membersCount,
    [`usuarios/${cid}/creatorProfile/stats/revenueTotal`]: Math.round(revenueTotal * 100) / 100,
  };

  const freshRetentionSnap = await db.ref('workRetention').get();
  const freshRetention = freshRetentionSnap.exists() ? freshRetentionSnap.val() || {} : {};
  for (const [workId, payload] of Object.entries(retentionPatch)) {
    const freshW =
      freshRetention[workId] && typeof freshRetention[workId] === 'object' ? freshRetention[workId] : {};
    const freshChapters = freshW.chapters && typeof freshW.chapters === 'object' ? freshW.chapters : {};
    for (const [chapterId, centry] of Object.entries(payload.chapters || {})) {
      if (!chapterId) continue;
      const base = `workRetention/${workId}/chapters/${chapterId}`;
      const live =
        freshChapters[chapterId] && typeof freshChapters[chapterId] === 'object'
          ? freshChapters[chapterId]
          : {};
      const liveRc = Number(live.readersCount || 0);
      const proposed = Number(centry.readersCount || 0);
      updatePatch[`${base}/chapterId`] = centry.chapterId;
      updatePatch[`${base}/chapterNumber`] = centry.chapterNumber;
      updatePatch[`${base}/chapterTitle`] = centry.chapterTitle;
      updatePatch[`${base}/readersCount`] = Math.max(liveRc, proposed);
    }
    updatePatch[`workRetention/${workId}/updatedAt`] = Date.now();
  }

  await db.ref().update(updatePatch);

  return {
    ok: true,
    creatorId: cid,
    worksCount: creatorWorks.length,
    chaptersCount: creatorChapters.length,
    followersCount,
    totalViews,
    likesTotal,
    commentsTotal,
    membersCount,
    revenueTotal: Math.round(revenueTotal * 100) / 100,
    dailyRows: Object.keys(daily).length,
  };
}

export const toggleCreatorFollow = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const followerUid = String(request.auth.uid || '').trim();
  const creatorId = sanitizeCreatorId(request.data?.creatorId);
  if (!creatorId) {
    throw new HttpsError('invalid-argument', 'creatorId obrigatorio.');
  }
  if (creatorId === followerUid) {
    throw new HttpsError('failed-precondition', 'Voce nao pode seguir o proprio perfil.');
  }

  const db = getDatabase();
  const [targetSnap, followerSnap] = await Promise.all([
    db.ref(`usuarios_publicos/${creatorId}`).get(),
    db.ref(`usuarios/${followerUid}`).get(),
  ]);

  if (!targetSnap.exists()) {
    throw new HttpsError('not-found', 'Criador nao encontrado.');
  }
  const target = targetSnap.val() || {};
  const creatorStatus = String(target?.creatorStatus || '').trim().toLowerCase();
  if (creatorStatus && creatorStatus !== 'active') {
    throw new HttpsError('failed-precondition', 'Este perfil de criador ainda nao esta publico.');
  }

  const followerRow = followerSnap.exists() ? followerSnap.val() || {} : {};
  const followerIsCreator = String(followerRow?.role || '').trim().toLowerCase() === 'mangaka';

  const followingRef = db.ref(`usuarios/${followerUid}/followingCreators/${creatorId}`);
  const followerRef = db.ref(`usuarios_publicos/${creatorId}/followers/${followerUid}`);
  const currentSnap = await followingRef.get();
  const isFollowing = currentSnap.exists();
  const now = Date.now();

  if (isFollowing) {
    await Promise.all([
      followingRef.remove(),
      followerRef.remove(),
      db.ref(`creators/${creatorId}/stats/followersCount`).transaction((curr) => Math.max(0, Number(curr || 0) - 1)),
    ]);
    await syncCreatorStatsMirrorsFromCanonical(db, creatorId);
    return { ok: true, isFollowing: false };
  }

  await Promise.all([
    followingRef.set({
      creatorId,
      followedAt: now,
    }),
    followerRef.set({
      followerUserId: followerUid,
      followerCreatorId: followerIsCreator ? followerUid : null,
      followedAt: now,
    }),
    db.ref(`creators/${creatorId}/stats/followersCount`).transaction((curr) => Number(curr || 0) + 1),
  ]);
  await syncCreatorStatsMirrorsFromCanonical(db, creatorId);
  await incrementCreatorAudienceDaily(db, creatorId, 'followersAdded', 1, now);

  return { ok: true, isFollowing: true };
});

export const creatorAudienceBackfill = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const ctx = await getAdminAuthContext(request.auth);
  const isCreator = ctx ? false : await isCreatorAccountAuth(request.auth);
  if (!ctx && !isCreator) {
    throw new HttpsError('permission-denied', 'Apenas admins ou o proprio creator podem reconstruir audiencia.');
  }
  const requestedCreatorId = sanitizeCreatorId(request.data?.creatorId || request.auth.uid);
  const creatorId = ctx ? requestedCreatorId : request.auth.uid;
  return rebuildCreatorAudienceBackfill(getDatabase(), creatorId);
});
