/**
 * Push de notificações in-app (`usuarios/{uid}/notifications`).
 * Extraído de `index.js` para reutilização (ex.: triggers RTDB de comentários).
 */

function notificationPriorityFromType(type) {
  switch (String(type || '').trim().toLowerCase()) {
    case 'account_moderation':
      return 3;
    case 'creator_application':
    case 'creator_monetization':
    case 'membership_update':
    case 'system':
    case 'comment_reply':
    case 'comment_like_milestone':
      return 2;
    case 'promotion':
    case 'new_work':
    case 'chapter_release':
      return 1;
    default:
      return 0;
  }
}

function notificationDedupeWindowMs(type) {
  switch (String(type || '').trim().toLowerCase()) {
    case 'promotion':
      return 6 * 60 * 60 * 1000;
    case 'new_work':
    case 'chapter_release':
      return 60 * 60 * 1000;
    case 'comment_reply':
      return 90 * 1000;
    case 'comment_like_milestone':
      return 0;
    default:
      return 15 * 60 * 1000;
  }
}

function notificationAggregateWindowMs(type) {
  switch (String(type || '').trim().toLowerCase()) {
    case 'chapter_release':
      return 12 * 60 * 60 * 1000;
    case 'promotion':
      return 24 * 60 * 60 * 1000;
    case 'new_work':
      return 12 * 60 * 60 * 1000;
    default:
      return 0;
  }
}

function buildGroupedNotificationCopy({ type, title, message, count, data, fallbackTitle, fallbackMessage }) {
  const workTitle = String(data?.workTitle || '').trim();
  const creatorName = String(data?.creatorName || '').trim();
  switch (String(type || '').trim().toLowerCase()) {
    case 'chapter_release':
      if (workTitle) {
        return {
          title: `${workTitle} tem ${count} atualizacoes novas`,
          message: 'Os capitulos mais recentes ja estao disponiveis no seu sino.',
        };
      }
      return {
        title: `Voce recebeu ${count} avisos de capitulos`,
        message: 'Ha capitulos novos esperando leitura.',
      };
    case 'new_work':
      return {
        title: creatorName ? `${creatorName} publicou novidades` : `Voce recebeu ${count} avisos de obras`,
        message: 'Tem obra nova publicada entre os criadores que voce acompanha.',
      };
    case 'promotion':
      return {
        title: `Promocoes atualizadas (${count})`,
        message: 'Existem campanhas novas ou recentes para voce conferir.',
      };
    default:
      return {
        title: fallbackTitle || title,
        message: fallbackMessage || message,
      };
  }
}

export async function pushUserNotification(db, uid, payload) {
  if (!uid || !payload || typeof payload !== 'object') return { ok: false, reason: 'invalid_payload' };
  const now = Date.now();
  const type = String(payload.type || 'system').trim().toLowerCase() || 'system';
  const title = String(payload.title || 'Atualizacao').trim() || 'Atualizacao';
  const message = String(payload.message || '').trim();
  const data = payload.data && typeof payload.data === 'object' ? { ...payload.data } : {};
  const creatorId = String(payload.creatorId || data.creatorId || '').trim() || null;
  const workId = String(payload.workId || data.workId || '').trim() || null;
  const chapterId = String(payload.chapterId || data.chapterId || '').trim() || null;
  const subjectId = String(
    payload.subjectId ||
      data.promoId ||
      data.status ||
      data.monetizationStatus ||
      chapterId ||
      workId ||
      creatorId ||
      ''
  ).trim();
  const targetPath =
    String(payload.targetPath || data.readPath || data.creatorPath || '').trim() || '/perfil';
  const dedupeKey = String(
    payload.dedupeKey || [type, subjectId || 'none', targetPath].join(':')
  ).trim();
  const groupKey = String(
    payload.groupKey ||
      [type, creatorId || 'none', workId || 'none', payload.groupScope || 'default'].join(':')
  ).trim();
  const priority = Number.isFinite(Number(payload.priority))
    ? Number(payload.priority)
    : notificationPriorityFromType(type);
  const dedupeWindowMs =
    payload.dedupeWindowMs === 0
      ? 0
      : Number(payload.dedupeWindowMs) > 0
        ? Number(payload.dedupeWindowMs)
        : notificationDedupeWindowMs(type);
  const aggregateWindowMs =
    payload.allowGrouping === false
      ? 0
      : Number(payload.aggregateWindowMs) > 0
        ? Number(payload.aggregateWindowMs)
        : notificationAggregateWindowMs(type);

  const notificationsRef = db.ref(`usuarios/${uid}/notifications`);
  const snap = await notificationsRef.get();
  const rows = snap.exists()
    ? Object.entries(snap.val() || {}).map(([id, value]) => ({ id, ...(value || {}) }))
    : [];

  const duplicate = rows.find((item) => {
    if (String(item?.dedupeKey || '') !== dedupeKey) return false;
    return now - Number(item?.createdAt || item?.updatedAt || 0) <= dedupeWindowMs;
  });
  if (duplicate) {
    return { ok: true, deduped: true, notificationId: duplicate.id };
  }

  if (aggregateWindowMs > 0) {
    const grouped = rows
      .filter((item) => {
        if (String(item?.groupKey || '') !== groupKey) return false;
        if (item?.read === true) return false;
        return now - Number(item?.updatedAt || item?.createdAt || 0) <= aggregateWindowMs;
      })
      .sort((a, b) => Number(b?.updatedAt || b?.createdAt || 0) - Number(a?.updatedAt || a?.createdAt || 0))[0];

    if (grouped?.id) {
      const nextCount = Math.max(2, Number(grouped?.aggregate?.count || 1) + 1);
      const groupedCopy = buildGroupedNotificationCopy({
        type,
        title,
        message,
        count: nextCount,
        data,
        fallbackTitle: grouped?.title,
        fallbackMessage: grouped?.message,
      });
      await notificationsRef.child(grouped.id).update({
        type,
        title: groupedCopy.title,
        message: groupedCopy.message,
        read: false,
        priority: Math.max(Number(grouped?.priority || 0), priority),
        updatedAt: now,
        targetPath,
        creatorId,
        workId,
        chapterId,
        groupKey,
        dedupeKey,
        data: {
          ...(grouped?.data && typeof grouped.data === 'object' ? grouped.data : {}),
          ...data,
          readPath: targetPath,
        },
        aggregate: {
          count: nextCount,
          lastTitle: title,
          lastMessage: message,
          lastCreatedAt: now,
          lastChapterId: chapterId,
        },
      });
      return { ok: true, grouped: true, notificationId: grouped.id };
    }
  }

  const created = await notificationsRef.push({
    type,
    title,
    message,
    read: false,
    priority,
    createdAt: now,
    updatedAt: now,
    targetPath,
    creatorId,
    workId,
    chapterId,
    groupKey,
    dedupeKey,
    aggregate: {
      count: 1,
      lastTitle: title,
      lastMessage: message,
      lastCreatedAt: now,
      lastChapterId: chapterId,
    },
    data: {
      ...data,
      readPath: targetPath,
      creatorId,
      workId,
      chapterId,
    },
  });
  return { ok: true, notificationId: created.key };
}
