import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { sanitizeCreatorId } from '../creatorDataLedger.js';
import { assertTrustedAppRequest } from '../appCheckGuard.js';
import {
  buildPublicProfileFromUsuarioRow,
  isCreatorPublicProfile,
  resolvePublicProfileAvatarUrl,
  resolvePublicProfileDisplayName,
} from '../shared/publicUserProfile.js';

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
  assertTrustedAppRequest(request);
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
  const [targetSnap, followerSnap] = await Promise.all([db.ref(`usuarios/${creatorId}`).get(), db.ref(`usuarios/${followerUid}`).get()]);

  if (!targetSnap.exists()) {
    throw new HttpsError('not-found', 'Criador nao encontrado.');
  }
  const targetRow = targetSnap.val() || {};
  const targetProfile = buildPublicProfileFromUsuarioRow(targetRow, creatorId);
  if (!isCreatorPublicProfile(targetProfile)) {
    throw new HttpsError('failed-precondition', 'Este perfil nao pertence a um escritor publico.');
  }

  const followerRow = followerSnap.exists() ? followerSnap.val() || {} : {};
  const followerProfile = buildPublicProfileFromUsuarioRow(followerRow, followerUid);
  const followerIsCreator = isCreatorPublicProfile(followerProfile);

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

export const getCreatorFollowers = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  const creatorId = sanitizeCreatorId(request.data?.creatorId);
  if (!creatorId) {
    throw new HttpsError('invalid-argument', 'creatorId obrigatorio.');
  }

  const db = getDatabase();
  const [creatorSnap, followersSnap] = await Promise.all([
    db.ref(`usuarios/${creatorId}`).get(),
    db.ref(`usuarios/${creatorId}/publicProfile/followers`).get(),
  ]);

  if (!creatorSnap.exists()) {
    throw new HttpsError('not-found', 'Criador nao encontrado.');
  }

  const creatorProfile = buildPublicProfileFromUsuarioRow(creatorSnap.val() || {}, creatorId);
  if (!isCreatorPublicProfile(creatorProfile)) {
    throw new HttpsError('failed-precondition', 'Este perfil nao pertence a um escritor publico.');
  }

  const followersMap =
    followersSnap.exists() && followersSnap.val() && typeof followersSnap.val() === 'object'
      ? followersSnap.val()
      : {};
  const followerIds = Object.keys(followersMap)
    .map((uid) => String(uid || '').trim())
    .filter(Boolean)
    .slice(0, 100);

  if (!followerIds.length) {
    return { ok: true, followers: [] };
  }

  const followerSnapshots = await Promise.all(followerIds.map((uid) => db.ref(`usuarios/${uid}`).get()));
  const followers = followerSnapshots
    .map((snap, index) => {
      const uid = followerIds[index];
      const followerRow = snap.exists() ? snap.val() || {} : {};
      const relation =
        followersMap?.[uid] && typeof followersMap[uid] === 'object' ? followersMap[uid] : {};
      const profile = buildPublicProfileFromUsuarioRow(followerRow, uid);
      const isWriter = isCreatorPublicProfile(profile);
      const isReaderPublic = profile?.readerProfilePublic === true;
      return {
        uid,
        followedAt: Number(relation?.followedAt || 0) || 0,
        displayName: resolvePublicProfileDisplayName(profile, 'Leitor'),
        userHandle: String(profile?.userHandle || '').trim().toLowerCase(),
        avatarUrl: resolvePublicProfileAvatarUrl(profile, {
          mode: isWriter ? 'creator' : 'reader',
          fallback: '/assets/avatares/ava1.webp',
        }),
        isCreatorProfile: isWriter,
        isProfilePublic: isWriter || isReaderPublic,
        profileTab: isWriter ? 'works' : 'likes',
      };
    })
    .sort((a, b) => Number(b.followedAt || 0) - Number(a.followedAt || 0));

  return { ok: true, followers };
});

