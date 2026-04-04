/**
 * Favoritos no nível da obra (work).
 * Legado: usuarios/{uid}/favoritosObras/{workId}
 * Canônico (plataforma): usuarios/{uid}/favorites/{workId}
 */

import { ref, remove, set } from 'firebase/database';
import { alreadyFavorited, applyWorkFavoriteDelta } from './discoveryStats';
import { syncReaderPublicFavoritesMirror } from './readerPublicProfile';

export const WORK_FAVORITES_LEGACY_KEY = 'favoritosObras';
export const WORK_FAVORITES_CANON_KEY = 'favorites';

export function mergeWorkFavoriteMaps(legacyVal, modernVal) {
  const a = legacyVal && typeof legacyVal === 'object' ? legacyVal : {};
  const b = modernVal && typeof modernVal === 'object' ? modernVal : {};
  return { ...b, ...a };
}

export async function saveWorkFavoriteBoth(db, uid, workId, payload) {
  const base = `usuarios/${uid}`;
  const existed = await alreadyFavorited(db, uid, workId);
  await set(ref(db, `${base}/${WORK_FAVORITES_CANON_KEY}/${workId}`), payload);
  await remove(ref(db, `${base}/${WORK_FAVORITES_LEGACY_KEY}/${workId}`)).catch(() => {});
  if (!existed) {
    await applyWorkFavoriteDelta(db, {
      workId,
      creatorId: String(payload?.creatorId || '').trim(),
      amount: 1,
    });
  }
  void syncReaderPublicFavoritesMirror(db, uid).catch(() => {});
}

export async function removeWorkFavoriteBoth(db, uid, workId) {
  const base = `usuarios/${uid}`;
  const existed = await alreadyFavorited(db, uid, workId);
  await Promise.all([
    remove(ref(db, `${base}/${WORK_FAVORITES_LEGACY_KEY}/${workId}`)).catch(() => {}),
    remove(ref(db, `${base}/${WORK_FAVORITES_CANON_KEY}/${workId}`)),
  ]);
  if (existed) {
    await applyWorkFavoriteDelta(db, { workId, amount: -1 });
  }
  void syncReaderPublicFavoritesMirror(db, uid).catch(() => {});
}
