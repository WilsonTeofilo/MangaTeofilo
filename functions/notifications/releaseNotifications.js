import { getDatabase } from 'firebase-admin/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions';
import { sanitizeCreatorId } from '../creatorDataLedger.js';
import { notifyUserByPreference, SMTP_FROM, SMTP_HOST, SMTP_PASS, SMTP_PORT, SMTP_USER } from './delivery.js';

const OBRA_URL_FALLBACK = 'works';

function slugifyObraSlugForWorkUrl(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function obraSegmentoUrlPublicaFn(obra) {
  if (!obra || typeof obra !== 'object') return OBRA_URL_FALLBACK;
  const id = String(obra.id || '').trim().toLowerCase();
  const slugS = slugifyObraSlugForWorkUrl(String(obra.slug || '').trim());
  const titleS = slugifyObraSlugForWorkUrl(String(obra.titulo || obra.title || '').trim());
  if (!id) return titleS || slugS || OBRA_URL_FALLBACK;
  if (slugS && slugS !== id) return slugS;
  return titleS || slugS || id || OBRA_URL_FALLBACK;
}

function chapterPublicReleaseAt(chapter) {
  const releaseAt = Number(chapter?.publicReleaseAt || 0);
  return Number.isFinite(releaseAt) && releaseAt > 0 ? releaseAt : 0;
}

function chapterIsPubliclyReleased(chapter, now = Date.now()) {
  if (!chapter || typeof chapter !== 'object') return false;
  const releaseAt = chapterPublicReleaseAt(chapter);
  return releaseAt <= 0 || releaseAt <= now;
}

async function notifyChapterReleaseAudience(db, capId, capitulo) {
  if (!capId || !capitulo || typeof capitulo !== 'object') return;
  const obraId = String(capitulo?.obraId || capitulo?.workId || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  const obraNome = String(capitulo?.obraTitulo || capitulo?.obraName || 'MangaTeofilo');
  const titulo = capitulo?.titulo || `Capitulo ${capitulo?.numero || ''}`.trim();
  const chapterCreatorId = sanitizeCreatorId(capitulo?.creatorId);
  if (!obraId || !chapterCreatorId) {
    logger.warn('Capitulo sem obraId/creatorId valido; notificacao ignorada.', {
      capId,
      obraId: obraId || null,
      creatorId: chapterCreatorId || null,
    });
    return;
  }
  const chapterCampaignId = `chapter_${obraId}_${capId}`;
  const usuariosSnap = await db.ref('usuarios').get();

  if (!usuariosSnap.exists()) {
    logger.info('Sem usuarios para notificar.', { capId });
    return;
  }

  const usuarios = usuariosSnap.val() || {};
  const candidatos = Object.entries(usuarios)
    .filter(([, profile]) => profile?.status === 'ativo')
    .map(([uid, profile]) => ({ uid, profile: profile || {} }));

  if (candidatos.length === 0) {
    logger.info('Nenhum usuario elegivel para capitulo.', { capId });
    return;
  }

  let enviados = 0;
  let ignorados = 0;
  let falhas = 0;

  for (const candidate of candidatos) {
    const uid = candidate.uid;
    const profile = candidate.profile || {};
    try {
      const creatorSub =
        profile?.followingCreators?.[chapterCreatorId] ||
        profile?.notificationSubscriptions?.creators?.[chapterCreatorId] ||
        null;
      const workSub =
        profile?.subscribedWorks?.[obraId] ||
        profile?.notificationSubscriptions?.works?.[obraId] ||
        null;
      if (!creatorSub && !workSub) {
        ignorados += 1;
        continue;
      }
      await notifyUserByPreference(db, uid, profile || {}, {
        kind: 'chapter',
        notification: {
          type: 'chapter_release',
          title: `Novo capitulo em ${obraNome}`,
          message: `${titulo} acabou de entrar no ar.`,
          creatorId: chapterCreatorId,
          workId: obraId,
          chapterId: String(capId),
          targetPath: `/ler/${encodeURIComponent(String(capId))}`,
          groupKey: `chapter_release:${chapterCreatorId || 'none'}:${obraId}`,
          dedupeKey: `chapter_release:${obraId}:${capId}`,
          aggregateWindowMs: 12 * 60 * 60 * 1000,
          data: {
            chapterId: String(capId),
            workId: obraId,
            creatorId: chapterCreatorId,
            workTitle: obraNome,
            campaignId: chapterCampaignId,
            readPath: `/ler/${encodeURIComponent(String(capId))}`,
            creatorPath: `/criador/${encodeURIComponent(chapterCreatorId)}`,
          },
        },
      });
      enviados += 1;
    } catch (err) {
      falhas += 1;
      logger.error('Falha ao notificar usuario.', { capId, uid, error: err?.message });
    }
  }

  await db.ref(`capitulos/${capId}/releaseNotificationSentAt`).set(Date.now());
  logger.info('Notificacao de capitulo concluida.', {
    capId,
    candidatos: candidatos.length,
    enviados,
    ignorados,
    falhas,
  });
}

export const notifyNewChapter = onValueWritten(
  {
    ref: '/capitulos/{capId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
    secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async (event) => {
    const capId = String(event.params.capId || '').trim();
    const before = event.data?.before?.exists() ? event.data.before.val() || {} : null;
    const after = event.data?.after?.exists() ? event.data.after.val() || {} : null;
    if (!capId || !after) return;
    if (Number(after?.releaseNotificationSentAt || 0) > 0) return;
    const now = Date.now();
    const becamePublic =
      chapterIsPubliclyReleased(after, now) && !chapterIsPubliclyReleased(before, now);
    const createdAlreadyPublic = !before && chapterIsPubliclyReleased(after, now);
    if (!becamePublic && !createdAlreadyPublic) return;
    await notifyChapterReleaseAudience(getDatabase(), capId, after);
  }
);

export const notifyScheduledChapterReleases = onSchedule(
  {
    schedule: 'every 6 minutes',
    timeZone: 'America/Sao_Paulo',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const db = getDatabase();
    const snapshot = await db.ref('capitulos').get();
    if (!snapshot.exists()) return;
    const now = Date.now();
    const chapters = snapshot.val() || {};
    let processed = 0;
    for (const [capId, chapter] of Object.entries(chapters)) {
      if (!chapterIsPubliclyReleased(chapter, now)) continue;
      if (Number(chapter?.releaseNotificationSentAt || 0) > 0) continue;
      await notifyChapterReleaseAudience(db, capId, chapter || {});
      processed += 1;
    }
    logger.info('Varredura de capitulos agendados concluida.', { processed });
  }
);

export const notifyNewWorkPublished = onValueWritten(
  {
    ref: '/obras/{obraId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    const obraId = String(event.params.obraId || '').trim().toLowerCase();
    const before = event.data?.before?.exists() ? event.data.before.val() || {} : null;
    const obra = event.data?.after?.exists() ? event.data.after.val() || {} : null;
    if (!obraId || !obra || obra?.isPublished !== true) {
      return;
    }
    if (before?.isPublished === true || Number(obra?.publishNotificationSentAt || 0) > 0) {
      return;
    }
    const creatorId = sanitizeCreatorId(obra?.creatorId || obra?.userId || obra?.authorId);
    if (!creatorId) {
      logger.info('Obra criada sem creatorId valido para notificacao.', { obraId });
      return;
    }
    const db = getDatabase();
    const title = String(obra?.titulo || obra?.title || 'Nova obra').trim() || 'Nova obra';
    const workSeg = obraSegmentoUrlPublicaFn({ id: obraId, ...obra });
    const usersSnap = await db.ref('usuarios').get();
    if (!usersSnap.exists()) return;
    const usuarios = usersSnap.val() || {};
    let enviados = 0;
    let ignorados = 0;
    let falhas = 0;
    for (const [uid, profile] of Object.entries(usuarios)) {
      if (profile?.status !== 'ativo') {
        ignorados += 1;
        continue;
      }
      const isFollowing = Boolean(
        profile?.followingCreators?.[creatorId] ||
          profile?.notificationSubscriptions?.creators?.[creatorId]
      );
      if (!isFollowing) {
        ignorados += 1;
        continue;
      }
      try {
        await notifyUserByPreference(db, uid, profile || {}, {
          kind: 'system',
          notification: {
            type: 'new_work',
            title: 'Nova obra publicada',
            message: `${title} acabou de entrar no catalogo.`,
            creatorId,
            workId: obraId,
            targetPath: `/work/${encodeURIComponent(workSeg)}`,
            groupKey: `new_work:${creatorId}`,
            dedupeKey: `new_work:${obraId}`,
            aggregateWindowMs: 12 * 60 * 60 * 1000,
            data: {
              creatorId,
              workId: obraId,
              workTitle: title,
              readPath: `/work/${encodeURIComponent(workSeg)}`,
              creatorPath: `/criador/${encodeURIComponent(creatorId)}`,
            },
          },
        });
        enviados += 1;
      } catch (error) {
        falhas += 1;
        logger.error('Falha ao notificar nova obra.', { obraId, uid, error: error?.message });
      }
    }
    await db.ref(`obras/${obraId}/publishNotificationSentAt`).set(Date.now());
    logger.info('Notificacao de nova obra concluida.', { obraId, enviados, ignorados, falhas });
  }
);
