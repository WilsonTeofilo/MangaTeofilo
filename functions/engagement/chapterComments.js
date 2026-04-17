import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { getAdminAuthContext } from '../adminRbac.js';

const REGION = 'us-central1';

function workIdFromChapter(capitulo = {}) {
  const workId = String(capitulo?.workId || '').trim();
  if (workId) return workId;
  return String(capitulo?.obraId || '').trim();
}

async function incrementPathTx(ref, amount) {
  await ref.transaction((current) => Math.max(0, Number(current || 0) + amount));
}

function collectCommentBranchIds(commentsMap = {}, rootCommentId) {
  const normalizedRootId = String(rootCommentId || '').trim();
  if (!normalizedRootId) return [];
  const comments = commentsMap && typeof commentsMap === 'object' ? commentsMap : {};
  const childrenByParent = new Map();

  Object.entries(comments).forEach(([commentId, row]) => {
    const parentId = String(row?.parentId || '').trim();
    if (!parentId) return;
    const bucket = childrenByParent.get(parentId) || [];
    bucket.push(String(commentId || '').trim());
    childrenByParent.set(parentId, bucket);
  });

  const visited = new Set();
  const stack = [normalizedRootId];
  while (stack.length) {
    const currentId = stack.pop();
    if (!currentId || visited.has(currentId) || !comments[currentId]) continue;
    visited.add(currentId);
    const children = childrenByParent.get(currentId) || [];
    children.forEach((childId) => {
      if (!visited.has(childId)) stack.push(childId);
    });
  }

  return [...visited];
}

export const deleteChapterComment = onCall({ region: REGION }, async (request) => {
  const uid = String(request.auth?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Faca login para excluir comentarios.');
  }

  const chapterId = String(request.data?.chapterId || '').trim();
  const commentId = String(request.data?.commentId || '').trim();
  if (!chapterId || !commentId) {
    throw new HttpsError('invalid-argument', 'chapterId e commentId sao obrigatorios.');
  }

  const db = getDatabase();
  const [chapterSnap, commentsSnap, adminCtx] = await Promise.all([
    db.ref(`capitulos/${chapterId}`).get(),
    db.ref(`capitulos/${chapterId}/comentarios`).get(),
    getAdminAuthContext(request.auth),
  ]);

  if (!chapterSnap.exists()) {
    throw new HttpsError('not-found', 'Capitulo nao encontrado.');
  }

  const chapterRow = chapterSnap.val() || {};
  const commentsMap = commentsSnap.exists() ? commentsSnap.val() || {} : {};
  const commentRow = commentsMap?.[commentId];
  if (!commentRow || typeof commentRow !== 'object') {
    throw new HttpsError('not-found', 'Comentario nao encontrado.');
  }

  const workId = workIdFromChapter(chapterRow);
  let creatorUid = String(chapterRow?.creatorId || '').trim();
  if (workId) {
    const obraSnap = await db.ref(`obras/${workId}`).get();
    if (obraSnap.exists()) {
      creatorUid = String(obraSnap.val()?.creatorId || '').trim() || creatorUid;
    }
  }

  const canDeleteOwn = String(commentRow.userId || '').trim() === uid;
  const canDeleteAsCreator = Boolean(creatorUid) && creatorUid === uid;
  const canDeleteAsAdmin = Boolean(adminCtx);
  if (!canDeleteOwn && !canDeleteAsCreator && !canDeleteAsAdmin) {
    throw new HttpsError('permission-denied', 'Sem permissao para excluir este comentario.');
  }

  const branchIds = collectCommentBranchIds(commentsMap, commentId);
  if (!branchIds.length) {
    throw new HttpsError('not-found', 'Comentario nao encontrado.');
  }

  const patch = {};
  branchIds.forEach((id) => {
    patch[`capitulos/${chapterId}/comentarios/${id}`] = null;
  });
  await db.ref().update(patch);

  const removedCount = branchIds.length;
  const updates = [
    incrementPathTx(db.ref(`capitulos/${chapterId}/commentsCount`), -removedCount),
  ];
  if (workId) {
    updates.push(incrementPathTx(db.ref(`obras/${workId}/commentsCount`), -removedCount));
  }
  if (creatorUid) {
    updates.push(incrementPathTx(db.ref(`creators/${creatorUid}/stats/commentsTotal`), -removedCount));
  }
  await Promise.all(updates);

  return {
    ok: true,
    deletedCount: removedCount,
  };
});
