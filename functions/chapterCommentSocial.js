/**
 * NotificaÃ§Ãµes de resposta a comentÃ¡rio e marcos de curtidas (estilo Facebook: 1, 5, 10, 20, 40, 60, 120).
 */
import { getDatabase } from 'firebase-admin/database';
import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions';
import { pushUserNotification } from './notificationPush.js';

const LIKE_MILESTONES = [1, 5, 10, 20, 40, 60, 120];

function likerKeys(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj).filter(Boolean);
}

function normalizeHandleFromProfile(p) {
  const row = p && typeof p === 'object' ? p : {};
  const raw = String(
    row.userHandle || row.creator?.profile?.username || row.creatorUsername || row.username || ''
  )
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
  if (!raw) return '';
  if (/^[A-Za-z0-9]{20,40}$/.test(raw)) return '';
  if (/^[a-z][a-z0-9_]*[_-][a-z0-9]{5,8}$/.test(raw)) return '';
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(raw)) return '';
  if (raw.endsWith('_') || /__/.test(raw)) return '';
  return raw;
}

function firstNonPlaceholderName(p) {
  const row = p && typeof p === 'object' ? p : {};
  const cands = [
    row.creator?.profile?.displayName,
    row.creatorDisplayName,
    typeof row.displayName === 'string' ? row.displayName : null,
    row.userName,
  ];
  for (const c of cands) {
    const v = String(c ?? '').trim();
    if (v.length >= 2) return v;
  }
  return '';
}

/** RÃ³tulo tipo Â«Nome (@handle)Â» para notificaÃ§Ãµes (espelha a polÃ­tica do cliente). */
async function actorLabelFromUid(db, uid) {
  const snap = await db.ref(`usuarios/${uid}`).get();
  const p = snap.exists() ? snap.val() || {} : {};
  const handle = normalizeHandleFromProfile(p);
  const name = firstNonPlaceholderName(p);
  if (handle) {
    if (name && name.toLowerCase() !== handle.toLowerCase()) return `${name} (@${handle})`;
    return `@${handle}`;
  }
  return name || 'Alguem';
}

function commentSocialEnabled(profile) {
  const prefs = profile?.notificationPrefs && typeof profile.notificationPrefs === 'object'
    ? profile.notificationPrefs
    : {};
  if (prefs.commentSocialInApp === false) return false;
  return true;
}

function obraIdFromChapter(cap) {
  const c = cap && typeof cap === 'object' ? cap : {};
  const w = String(c.workId || '').trim();
  if (w) return w.toLowerCase();
  return String(c.obraId || '').trim().toLowerCase();
}

function chapterTitle(cap) {
  const c = cap && typeof cap === 'object' ? cap : {};
  return String(c.titulo || c.title || '').trim().slice(0, 100);
}

function chapterCreatorUid(cap) {
  const c = cap && typeof cap === 'object' ? cap : {};
  return String(c.creatorId || '').trim();
}

/** Uma vez por resposta do autor do capÃ­tulo â€” espelha missÃµes de ciclo (evita duplicar com cliente). */
async function bumpCreatorReplyEngagement(db, creatorUid) {
  const uid = String(creatorUid || '').trim();
  if (!uid) return;
  const cycleRef = db.ref(`usuarios/${uid}/engagementCycle`);
  const snap = await cycleRef.get();
  if (!snap.exists()) return;
  await db.ref(`usuarios/${uid}/engagementCycle/repliesInCycle`).transaction((cur) => {
    const n = Number(cur);
    const base = Number.isFinite(n) ? n : 0;
    return Math.min(500, base + 1);
  });
}

function likeMilestoneCopy(n, capTitulo) {
  const em = capTitulo ? ` em Â«${capTitulo}Â»` : '';
  if (n === 1) return `Seu comentario recebeu a primeira curtida${em}.`;
  return `Seu comentario atingiu ${n} curtidas${em}.`;
}

async function maybePushCommentSocial(db, recipientUid, payload) {
  if (!recipientUid) return;
  const uSnap = await db.ref(`usuarios/${recipientUid}`).get();
  const profile = uSnap.exists() ? uSnap.val() || {} : {};
  if (!commentSocialEnabled(profile)) return;
  await pushUserNotification(db, recipientUid, {
    ...payload,
    allowGrouping: false,
  });
}

export const onChapterCommentSocialWritten = onValueWritten(
  {
    ref: '/capitulos/{capId}/comentarios/{commentId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const capId = String(event.params.capId || '').trim();
    const commentId = String(event.params.commentId || '').trim();
    if (!capId || !commentId) return;

    const before = event.data?.before?.exists() ? event.data.before.val() || {} : null;
    const after = event.data?.after?.exists() ? event.data.after.val() || {} : null;
    if (!after) return;

    const db = getDatabase();

    const capSnap = await db.ref(`capitulos/${capId}`).get();
    const cap = capSnap.exists() ? capSnap.val() || {} : {};
    const workId = obraIdFromChapter(cap);
    const capTitulo = chapterTitle(cap);
    const targetPath = `/ler/${encodeURIComponent(capId)}?comment=${encodeURIComponent(commentId)}`;

    const isCreate = !event.data.before.exists();

    if (isCreate) {
      const texto = String(after.texto || '').trim();
      const actorUid = String(after.userId || '').trim();
      const parentId = String(after.parentId || '').trim();
      if (!texto || !actorUid) return;

      const capCreator = chapterCreatorUid(cap);
      if (
        parentId &&
        parentId !== commentId &&
        capCreator &&
        actorUid === capCreator
      ) {
        try {
          await bumpCreatorReplyEngagement(db, actorUid);
        } catch (err) {
          logger.warn('creator repliesInCycle bump failed', { capId, commentId, err: err?.message });
        }
      }

      if (!parentId || parentId === commentId) return;

      const parentSnap = await db.ref(`capitulos/${capId}/comentarios/${parentId}`).get();
      if (!parentSnap.exists()) return;
      const parent = parentSnap.val() || {};
      const recipientUid = String(parent.userId || '').trim();
      if (!recipientUid || recipientUid === actorUid) return;

      const actorLabel = await actorLabelFromUid(db, actorUid);
      const title = 'Resposta ao seu comentario';
      const message = `${actorLabel} respondeu seu comentario${capTitulo ? ` em Â«${capTitulo}Â»` : ''}.`;

      try {
        await maybePushCommentSocial(db, recipientUid, {
          type: 'comment_reply',
          title,
          message,
          targetPath,
          chapterId: capId,
          workId: workId || null,
          creatorId: actorUid,
          dedupeKey: `comment_reply:${capId}:${parentId}:${commentId}`,
          data: {
            commentId,
            parentCommentId: parentId,
            chapterId: capId,
            workId: workId || null,
            actorUid,
            readPath: targetPath,
          },
        });
      } catch (err) {
        logger.error('comment_reply notification failed', { capId, commentId, err: err?.message });
      }
      return;
    }

    if (!before) return;

    const oldLikes = Number(before.likes || 0);
    const newLikes = Number(after.likes || 0);
    if (newLikes <= oldLikes) return;

    const ownerUid = String(after.userId || '').trim();
    if (!ownerUid) return;

    const beforeLikers = new Set(likerKeys(before.usuariosQueCurtiram));
    const afterLikers = likerKeys(after.usuariosQueCurtiram);
    const addedLikers = afterLikers.filter((k) => !beforeLikers.has(k));
    const newLikerUid = addedLikers.length === 1 ? addedLikers[0] : '';

    if (newLikerUid && newLikerUid === ownerUid) return;

    for (const m of LIKE_MILESTONES) {
      if (oldLikes < m && newLikes >= m) {
        try {
          await maybePushCommentSocial(db, ownerUid, {
            type: 'comment_like_milestone',
            title: m === 1 ? 'Primeira curtida no seu comentario' : `${m} curtidas no seu comentario`,
            message: likeMilestoneCopy(m, capTitulo),
            targetPath,
            chapterId: capId,
            workId: workId || null,
            dedupeKey: `comment_like_milestone:${capId}:${commentId}:${m}`,
            data: {
              commentId,
              chapterId: capId,
              workId: workId || null,
              milestone: m,
              readPath: targetPath,
            },
          });
        } catch (err) {
          logger.error('comment_like_milestone notification failed', {
            capId,
            commentId,
            m,
            err: err?.message,
          });
        }
      }
    }
  }
);

