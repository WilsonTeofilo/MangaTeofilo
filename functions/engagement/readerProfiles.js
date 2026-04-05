import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { onValueWritten } from 'firebase-functions/v2/database';
import {
  buildPublicReaderFavoritesMap,
  buildReaderSourceMap,
  isReaderPublicProfileEffective,
} from '../shared/readerPublicProfile.js';

async function buildReaderLikedWorkPayload(db, workIdRaw) {
  const workId = String(workIdRaw || '').trim();
  if (!workId) return null;
  const obraSnap = await db.ref(`obras/${workId}`).get();
  const obra = obraSnap.exists() ? obraSnap.val() || {} : {};
  return {
    workId,
    title: String(obra?.titulo || obra?.title || workId).trim().slice(0, 120) || workId,
    coverUrl: String(obra?.capaUrl || obra?.bannerUrl || '').trim().slice(0, 2048),
    slug: String(obra?.slug || '').trim().slice(0, 80),
    likedAt: Date.now(),
  };
}

export async function syncReaderPublicProfileMirrorServer(db, uidRaw) {
  const uid = String(uidRaw || '').trim();
  if (!uid) return;
  const privSnap = await db.ref(`usuarios/${uid}`).get();
  const priv = privSnap.exists() ? privSnap.val() || {} : {};
  const pubRef = db.ref(`usuarios_publicos/${uid}`);
  if (!isReaderPublicProfileEffective(priv)) {
    await pubRef.child('readerFavorites').remove().catch(() => {});
    await pubRef.update({
      readerProfilePublic: false,
      readerProfileAvatarUrl: null,
      updatedAt: Date.now(),
    });
    return;
  }
  const readerProfileAvatarUrl = String(priv.readerProfileAvatarUrl || '').trim().slice(0, 2048);
  await pubRef.update({
    readerProfilePublic: true,
    readerFavorites: buildPublicReaderFavoritesMap(buildReaderSourceMap(priv)),
    readerSince:
      typeof priv.createdAt === 'number' && Number.isFinite(priv.createdAt) ? priv.createdAt : Date.now(),
    readerProfileAvatarUrl: readerProfileAvatarUrl || null,
    updatedAt: Date.now(),
  });
}

export async function syncReaderLikedWorkStateForUser(db, uidRaw, workIdRaw) {
  const uid = String(uidRaw || '').trim();
  const workId = String(workIdRaw || '').trim();
  if (!uid || !workId) return;

  const capsSnap = await db.ref('capitulos').get();
  const caps = capsSnap.exists() ? capsSnap.val() || {} : {};
  let stillLiked = false;

  for (const cap of Object.values(caps)) {
    if (!cap || typeof cap !== 'object') continue;
    const capWorkId = String(cap.obraId || cap.mangaId || '').trim();
    if (capWorkId !== workId) continue;
    if (cap.usuariosQueCurtiram && cap.usuariosQueCurtiram[uid]) {
      stillLiked = true;
      break;
    }
  }

  if (!stillLiked) {
    await db.ref(`usuarios/${uid}/likedWorks/${workId}`).remove().catch(() => {});
    return;
  }

  const payload = await buildReaderLikedWorkPayload(db, workId);
  if (!payload) return;
  await db.ref(`usuarios/${uid}/likedWorks/${workId}`).set(payload);
}

export const onReaderFavoriteCanonWritten = onValueWritten(
  {
    ref: '/usuarios/{uid}/favorites/{workId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    await syncReaderPublicProfileMirrorServer(getDatabase(), event.params?.uid);
  }
);

export const onReaderFavoriteLegacyWritten = onValueWritten(
  {
    ref: '/usuarios/{uid}/favoritosObras/{workId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    await syncReaderPublicProfileMirrorServer(getDatabase(), event.params?.uid);
  }
);

export const onReaderLikedWorkWritten = onValueWritten(
  {
    ref: '/usuarios/{uid}/likedWorks/{workId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    await syncReaderPublicProfileMirrorServer(getDatabase(), event.params?.uid);
  }
);

export const onReaderPublicProfileSettingsWritten = onValueWritten(
  {
    ref: '/usuarios/{uid}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const before = event.data?.before?.exists() ? event.data.before.val() : null;
    const after = event.data?.after?.exists() ? event.data.after.val() : null;
    const beforePublic = Boolean(before?.readerProfilePublic);
    const afterPublic = Boolean(after?.readerProfilePublic);
    const beforeAvatar = String(before?.readerProfileAvatarUrl || '').trim();
    const afterAvatar = String(after?.readerProfileAvatarUrl || '').trim();
    if (beforePublic === afterPublic && beforeAvatar === afterAvatar) return;
    await syncReaderPublicProfileMirrorServer(getDatabase(), event.params?.uid);
  }
);

export const onChapterReaderLikeMirrorWritten = onValueWritten(
  {
    ref: '/capitulos/{chapterId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const after = event.data?.after?.exists() ? event.data.after.val() : null;
    const before = event.data?.before?.exists() ? event.data.before.val() : null;
    const db = getDatabase();
    const beforeLikes =
      before?.usuariosQueCurtiram && typeof before.usuariosQueCurtiram === 'object'
        ? before.usuariosQueCurtiram
        : {};
    const afterLikes =
      after?.usuariosQueCurtiram && typeof after.usuariosQueCurtiram === 'object'
        ? after.usuariosQueCurtiram
        : {};
    const changedUids = new Set([...Object.keys(beforeLikes), ...Object.keys(afterLikes)]);
    if (!changedUids.size) return;

    const workId = String(after?.obraId || after?.mangaId || before?.obraId || before?.mangaId || '').trim();
    if (!workId) return;

    for (const uid of changedUids) {
      if (Boolean(beforeLikes[uid]) === Boolean(afterLikes[uid])) continue;
      try {
        await syncReaderLikedWorkStateForUser(db, uid, workId);
        await syncReaderPublicProfileMirrorServer(db, uid);
      } catch (error) {
        logger.warn('reader likedWorks sync falhou', {
          chapterId: String(event.params?.chapterId || '').trim(),
          uid,
          workId,
          error: error?.message || String(error),
        });
      }
    }
  }
);
