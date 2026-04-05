/**
 * Perfil público de leitor (RTDB): espelho em usuarios_publicos com favoritos denormalizados.
 */

import { get, ref, remove, update } from 'firebase/database';
import {
  buildPublicReaderFavoritesMap,
  buildReaderSourceMap,
  isReaderPublicProfileEffective,
} from '../../shared/readerPublicProfile.js';

export { isReaderPublicProfileEffective } from '../../shared/readerPublicProfile.js';

/**
 * Mantém usuarios_publicos alinhado aos favoritos privados quando readerProfilePublic está ativo.
 */
export async function syncReaderPublicFavoritesMirror(db, uid) {
  const u = String(uid || '').trim();
  if (!u) return;

  const privSnap = await get(ref(db, `usuarios/${u}`));
  const priv = privSnap.exists() ? privSnap.val() || {} : {};
  const isPublic = isReaderPublicProfileEffective(priv);

  const pubRef = ref(db, `usuarios_publicos/${u}`);

  if (!isPublic) {
    try {
      await remove(ref(db, `usuarios_publicos/${u}/readerFavorites`));
    } catch {
      /* ignore */
    }
    await update(pubRef, {
      readerProfilePublic: false,
      readerProfileAvatarUrl: null,
      updatedAt: Date.now(),
    });
    return;
  }

  const readerFavorites = buildPublicReaderFavoritesMap(buildReaderSourceMap(priv));
  const readerSince =
    typeof priv.createdAt === 'number' && Number.isFinite(priv.createdAt) ? priv.createdAt : Date.now();
  const readerProfileAvatarUrl = String(priv.readerProfileAvatarUrl || '').trim().slice(0, 2048);

  const patch = {
    readerProfilePublic: true,
    readerFavorites,
    readerSince,
    updatedAt: Date.now(),
  };
  if (readerProfileAvatarUrl) patch.readerProfileAvatarUrl = readerProfileAvatarUrl;
  else patch.readerProfileAvatarUrl = null;

  await update(pubRef, patch);
}

export async function setReaderProfilePublicState(db, uid, enabled, options = {}) {
  const u = String(uid || '').trim();
  if (!u) return;

  const readerProfileAvatarUrl = String(options.readerProfileAvatarUrl || '').trim().slice(0, 2048);
  const privPatch = { readerProfilePublic: Boolean(enabled) };
  if (readerProfileAvatarUrl) privPatch.readerProfileAvatarUrl = readerProfileAvatarUrl;
  else if (!enabled) privPatch.readerProfileAvatarUrl = null;

  await update(ref(db, `usuarios/${u}`), privPatch);

  if (!enabled) {
    try {
      await remove(ref(db, `usuarios_publicos/${u}/readerFavorites`));
    } catch {
      /* ignore */
    }
    await update(ref(db, `usuarios_publicos/${u}`), {
      readerProfilePublic: false,
      readerProfileAvatarUrl: null,
      updatedAt: Date.now(),
    });
    return;
  }

  await syncReaderPublicFavoritesMirror(db, u);
}
