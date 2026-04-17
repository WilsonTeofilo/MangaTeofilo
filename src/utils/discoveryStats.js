import { get, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { WORK_FAVORITES_CANON_KEY } from '../../functions/shared/readerPublicProfile.js';

import { functions } from '../services/firebase';

let recordDiscoveryCreatorMetricsCallable = null;
function getRecordDiscoveryCallable() {
  if (!recordDiscoveryCreatorMetricsCallable) {
    recordDiscoveryCreatorMetricsCallable = httpsCallable(functions, 'recordDiscoveryCreatorMetrics');
  }
  return recordDiscoveryCreatorMetricsCallable;
}

/**
 * MÃ©tricas agregadas do criador (creators/*, creatorStatsDaily/*, espelhos) â€” sÃ³ no servidor.
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

export async function applyWorkFavoriteDelta(db, { workId, amount }) {
  const delta = Number(amount || 0);
  if (!workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  await recordCreatorMetricsServer({ action: 'work_favorite', workId, delta: sign });
}

export async function applyChapterReadDelta(db, {
  chapterId,
  workId,
  amount = 1,
  viewerUid = '',
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
    delta: sign,
  });
}

export async function applyChapterCommentDelta(db, { chapterId, workId, amount = 1 }) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  await recordCreatorMetricsServer({ action: 'chapter_comment', workId, chapterId, delta: sign });
}

/**
 * Propaga o delta de like do capÃ­tulo para obra e agregados do criador.
 * O contador `capitulos/{chapterId}/likesCount` jÃ¡ deve ter sido ajustado
 * no mesmo fluxo (ex.: runTransaction no nÃ³ do capÃ­tulo) â€” nÃ£o duplicar aqui.
 */
export async function applyChapterLikeDelta(db, { chapterId, workId, amount = 1 }) {
  const delta = Number(amount || 0);
  if (!chapterId || !workId || !delta) return;
  const sign = delta > 0 ? 1 : -1;
  await recordCreatorMetricsServer({ action: 'chapter_like', workId, chapterId, delta: sign });
}

export async function alreadyFavorited(db, uid, workId) {
  if (!uid || !workId) return false;
  const canon = await get(ref(db, `usuarios/${uid}/${WORK_FAVORITES_CANON_KEY}/${workId}`));
  return canon.exists();
}


