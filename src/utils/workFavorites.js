/**
 * Favoritos no nivel da obra (work).
 * Canonico: usuarios/{uid}/favorites/{workId}
 */

import { ref, remove, set } from 'firebase/database';
import { WORK_FAVORITES_CANON_KEY } from '../../functions/shared/readerPublicProfile.js';
import { alreadyFavorited, applyWorkFavoriteDelta } from './discoveryStats';

export async function saveWorkFavoriteBoth(db, uid, workId, payload) {
  const base = `usuarios/${uid}`;
  const existed = await alreadyFavorited(db, uid, workId);
  await set(ref(db, `${base}/${WORK_FAVORITES_CANON_KEY}/${workId}`), payload);
  if (!existed) {
    await applyWorkFavoriteDelta(db, {
      workId,
      creatorId: String(payload?.creatorId || '').trim(),
      amount: 1,
    });
  }
}

export async function removeWorkFavoriteBoth(db, uid, workId) {
  const base = `usuarios/${uid}`;
  const existed = await alreadyFavorited(db, uid, workId);
  await remove(ref(db, `${base}/${WORK_FAVORITES_CANON_KEY}/${workId}`));
  if (existed) {
    await applyWorkFavoriteDelta(db, { workId, amount: -1 });
  }
}



