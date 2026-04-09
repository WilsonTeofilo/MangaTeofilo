import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertTrustedAppRequest } from '../appCheckGuard.js';
import { syncReaderLikedWorkStateForUser } from './readerProfiles.js';

function safeWorkIdFromChapter(chapter) {
  return String(chapter?.obraId || chapter?.mangaId || '').trim();
}

export const toggleChapterLike = onCall({ region: 'us-central1' }, async (request) => {
  assertTrustedAppRequest(request);
  const uid = String(request.auth?.uid || '').trim();
  if (!uid) throw new HttpsError('unauthenticated', 'Faca login.');

  const chapterId = String(request.data?.chapterId || '').trim();
  if (!chapterId) throw new HttpsError('invalid-argument', 'chapterId obrigatorio.');

  const db = getDatabase();
  const chapterRef = db.ref(`capitulos/${chapterId}`);
  const snap = await chapterRef.get();
  if (!snap.exists()) throw new HttpsError('not-found', 'Capitulo nao encontrado.');

  const chapter = snap.val() || {};
  const workId = safeWorkIdFromChapter(chapter);
  if (!workId) throw new HttpsError('failed-precondition', 'Capitulo sem obra vinculada.');

  const tx = await chapterRef.transaction((current) => {
    const row = current && typeof current === 'object' ? { ...current } : null;
    if (!row) return row;
    const likerMap =
      row.usuariosQueCurtiram && typeof row.usuariosQueCurtiram === 'object'
        ? { ...row.usuariosQueCurtiram }
        : {};
    const alreadyLiked = likerMap[uid] === true;
    const currentLikes = Number(row.likesCount || 0);
    if (alreadyLiked) {
      delete likerMap[uid];
      row.likesCount = Math.max(0, currentLikes - 1);
    } else {
      likerMap[uid] = true;
      row.likesCount = currentLikes + 1;
    }
    row.usuariosQueCurtiram = likerMap;
    row.updatedAt = Date.now();
    return row;
  });

  if (!tx.committed || !tx.snapshot?.exists()) {
    throw new HttpsError('aborted', 'Nao foi possivel atualizar o like.');
  }

  const after = tx.snapshot.val() || {};
  const liked = Boolean(after.usuariosQueCurtiram?.[uid]);
  const likesCount = Number(after.likesCount || 0);
  const delta = liked ? 1 : -1;
  const creatorId = String(after.creatorId || '').trim();

  await db.ref(`obras/${workId}/likesCount`).transaction((current) => {
    const next = Number(current || 0) + delta;
    return next < 0 ? 0 : next;
  });

  if (creatorId) {
    const dateKey = new Date().toISOString().slice(0, 10);
    await Promise.all([
      db.ref(`creators/${creatorId}/stats/likesTotal`).transaction((current) => {
        const next = Number(current || 0) + delta;
        return next < 0 ? 0 : next;
      }),
      db.ref(`creatorStatsDaily/${creatorId}/${dateKey}/likesTotal`).transaction((current) => {
        const next = Number(current || 0) + delta;
        return next < 0 ? 0 : next;
      }),
      db.ref(`creatorStatsDaily/${creatorId}/${dateKey}/updatedAt`).set(Date.now()),
    ]);
  }

  await syncReaderLikedWorkStateForUser(db, uid, workId);

  return { ok: true, liked, likesCount };
});
