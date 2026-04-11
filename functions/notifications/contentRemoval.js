import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getDatabase } from 'firebase-admin/database';
import { requireAdminAuth, requirePermission, PERM } from '../adminRbac.js';
import { pushUserNotification } from '../notificationPush.js';

function normalizeRemovalPayload(data = {}) {
  const targetUid = String(data.targetUid || '').trim();
  const contentType = String(data.contentType || '').trim().toLowerCase();
  const contentId = String(data.contentId || '').trim();
  const contentTitle = String(data.contentTitle || '').trim();
  const reason = String(data.reason || '').trim();
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid obrigatório.');
  if (!['obra', 'capitulo'].includes(contentType)) {
    throw new HttpsError('invalid-argument', 'contentType inválido.');
  }
  if (!reason) throw new HttpsError('invalid-argument', 'Motivo obrigatório.');
  return { targetUid, contentType, contentId, contentTitle, reason };
}

export const notifyCreatorContentRemoval = onCall(async (request) => {
  const ctx = await requireAdminAuth(request.auth);
  const { targetUid, contentType, contentId, contentTitle, reason } = normalizeRemovalPayload(request.data || {});
  if (contentType === 'obra') {
    requirePermission(ctx, PERM.obras);
  } else {
    requirePermission(ctx, PERM.capitulos);
  }
  const title = contentTitle || (contentType === 'obra' ? 'Obra' : 'Capítulo');
  const notificationTitle = contentType === 'obra' ? 'Obra removida' : 'Capítulo removido';
  const message =
    contentType === 'obra'
      ? `Sua obra "${title}" foi removida pela equipe. Motivo: ${reason}`
      : `Seu capítulo "${title}" foi removido pela equipe. Motivo: ${reason}`;
  const targetPath = contentType === 'obra' ? '/creator/obras' : '/creator/capitulos';
  await pushUserNotification(getDatabase(), targetUid, {
    type: 'account_moderation',
    title: notificationTitle,
    message,
    targetPath,
    workId: contentType === 'obra' ? contentId : null,
    chapterId: contentType === 'capitulo' ? contentId : null,
    data: {
      reason,
      contentType,
      contentId,
      contentTitle: title,
    },
    allowGrouping: false,
  });
  return { ok: true };
});
