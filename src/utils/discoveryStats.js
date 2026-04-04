import { get, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../services/firebase';

let recordDiscoveryCreatorMetricsCallable = null;
function getRecordDiscoveryCallable() {
  if (!recordDiscoveryCreatorMetricsCallable) {
    recordDiscoveryCreatorMetricsCallable = httpsCallable(functions, 'recordDiscoveryCreatorMetrics');
  }
  return recordDiscoveryCreatorMetricsCallable;
}

/**
 * Métricas agregadas do criador (creators/*, creatorStatsDaily/*, espelhos) — só no servidor.
 */
async function recordCreatorMetricsServer(payload) {
  try {
    await getRecordDiscoveryCallable()(payload);
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[recordDiscoveryCreatorMetrics]', e?.code || e?.message || e);
    }
  }
}

export async function applyWorkFavoriteDelta(db, { workId, creatorId: _creatorId, amount }) {
  const delta = Number(amount || 0);
  if (!workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  await recordCreatorMetricsServer({ action: 'work_favorite', workId, delta: sign });
}

export async function applyChapterReadDelta(db, {
  chapterId,
  workId,
  creatorId: _creatorId,
  amount = 1,
  viewerUid = '',
  chapterNumber = 0,
  chapterTitle = '',
}) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  const vu = String(viewerUid || '').trim();
  await recordCreatorMetricsServer({
    action: 'chapter_read',
    workId,
    chapterId,
    viewerUid: vu,
    chapterNumber,
    chapterTitle,
    delta: sign,
  });
}

export async function applyChapterCommentDelta(db, { chapterId, workId, creatorId: _creatorId, amount = 1 }) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  await recordCreatorMetricsServer({ action: 'chapter_comment', workId, chapterId, delta: sign });
}

/**
 * Propaga o delta de like do capítulo para obra e agregados do criador.
 * O contador `capitulos/{chapterId}/likesCount` já deve ter sido ajustado
 * no mesmo fluxo (ex.: runTransaction no nó do capítulo) — não duplicar aqui.
 */
export async function applyChapterLikeDelta(db, { chapterId, workId, creatorId: _creatorId, amount = 1 }) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  await recordCreatorMetricsServer({ action: 'chapter_like', workId, chapterId, delta: sign });
}

export async function alreadyFavorited(db, uid, workId) {
  if (!uid || !workId) return false;
  const [legacy, canon] = await Promise.all([
    get(ref(db, `usuarios/${uid}/favoritosObras/${workId}`)),
    get(ref(db, `usuarios/${uid}/favorites/${workId}`)),
  ]);
  return legacy.exists() || canon.exists();
}
