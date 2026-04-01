/**
 * Favoritos no nível da obra (work).
 * Legado: usuarios/{uid}/favoritosObras/{workId}
 * Canônico (plataforma): usuarios/{uid}/favorites/{workId}
 */

import { ref, remove, set } from 'firebase/database';

export const WORK_FAVORITES_LEGACY_KEY = 'favoritosObras';
export const WORK_FAVORITES_CANON_KEY = 'favorites';

export function mergeWorkFavoriteMaps(legacyVal, modernVal) {
  const a = legacyVal && typeof legacyVal === 'object' ? legacyVal : {};
  const b = modernVal && typeof modernVal === 'object' ? modernVal : {};
  return { ...b, ...a };
}

export async function saveWorkFavoriteBoth(db, uid, workId, payload) {
  const base = `usuarios/${uid}`;
  await set(ref(db, `${base}/${WORK_FAVORITES_LEGACY_KEY}/${workId}`), payload);
  await set(ref(db, `${base}/${WORK_FAVORITES_CANON_KEY}/${workId}`), payload);
}

export async function removeWorkFavoriteBoth(db, uid, workId) {
  const base = `usuarios/${uid}`;
  await remove(ref(db, `${base}/${WORK_FAVORITES_LEGACY_KEY}/${workId}`));
  await remove(ref(db, `${base}/${WORK_FAVORITES_CANON_KEY}/${workId}`));
}
