import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { sanitizeCreatorId } from '../creatorDataLedger.js';

function creatorAudienceDateKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

async function incrementCreatorAudienceDaily(db, creatorId, field, amount, timestamp = Date.now()) {
  if (!creatorId || !field || !Number.isFinite(Number(amount)) || Number(amount) === 0) return;
  const key = creatorAudienceDateKey(timestamp);
  await db.ref(`creatorStatsDaily/${creatorId}/${key}/${field}`).transaction((current) => {
    const next = Number(current || 0) + Number(amount);
    return next < 0 ? 0 : next;
  });
  await db.ref(`creatorStatsDaily/${creatorId}/${key}/updatedAt`).set(Date.now());
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
    db.ref(`usuarios/${creatorId}/publicProfile`).get(),
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
  const followerRef = db.ref(`usuarios/${creatorId}/publicProfile/followers/${followerUid}`);
  const currentSnap = await followingRef.get();
  const isFollowing = currentSnap.exists();
  const now = Date.now();

  if (isFollowing) {
    await Promise.all([
      followingRef.remove(),
      followerRef.remove(),
      db.ref(`creators/${creatorId}/stats/followersCount`).transaction((curr) => Math.max(0, Number(curr || 0) - 1)),
    ]);
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
  await incrementCreatorAudienceDaily(db, creatorId, 'followersAdded', 1, now);

  return { ok: true, isFollowing: true };
});

