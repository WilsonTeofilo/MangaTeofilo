/**
 * Perfil público de leitor (RTDB): espelho em usuarios_publicos com favoritos denormalizados.
 */

import { get, ref, remove, update } from 'firebase/database';

/**
 * Criadores com conta ativa ou em onboarding têm perfil de leitor sempre visível (sem opt-out).
 * @param {Record<string, unknown>|null|undefined} row - `usuarios/*` ou `usuarios_publicos/*`
 */
export function isReaderPublicProfileEffective(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.readerProfilePublic === true) return true;
  const cs = String(row.creatorStatus || '').trim().toLowerCase();
  return cs === 'active' || cs === 'onboarding';
}

/** Espelha chaves de workFavorites.js sem import circular. */
const WORK_FAVORITES_LEGACY_KEY = 'favoritosObras';
const WORK_FAVORITES_CANON_KEY = 'favorites';
const WORK_LIKED_CANON_KEY = 'likedWorks';

function mergeWorkMaps(...maps) {
  return maps.reduce((acc, current) => {
    if (!current || typeof current !== 'object') return acc;
    return { ...acc, ...current };
  }, {});
}

function buildPublicFavoritesMap(privFavoritesMerged) {
  const out = {};
  if (!privFavoritesMerged || typeof privFavoritesMerged !== 'object') return out;
  for (const [wid, row] of Object.entries(privFavoritesMerged)) {
    if (!wid || typeof row !== 'object' || row == null) continue;
    const title = String(row.titulo || row.title || wid).trim().slice(0, 120) || wid;
    const coverUrl = String(row.coverUrl || row.capaUrl || '').trim().slice(0, 2048);
    const slug = String(row.slug || '').trim().slice(0, 40);
    const addedAt = Number(row.savedAt || row.addedAt || row.likedAt || row.lastLikedAt || Date.now());
    out[wid] = {
      workId: wid,
      title,
      coverUrl,
      ...(slug ? { slug } : {}),
      addedAt: Number.isFinite(addedAt) ? addedAt : Date.now(),
    };
  }
  return out;
}

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

  const merged = mergeWorkMaps(
    priv[WORK_LIKED_CANON_KEY],
    priv[WORK_FAVORITES_CANON_KEY],
    priv[WORK_FAVORITES_LEGACY_KEY]
  );
  const readerFavorites = buildPublicFavoritesMap(merged);
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
