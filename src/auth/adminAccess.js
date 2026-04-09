import { getIdTokenResult } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../services/firebase';

/** @typedef {{ byClaim: boolean, canAccessAdmin: boolean, claimChecked: boolean, profileLoaded: boolean, superAdmin: boolean, isChiefAdmin: boolean, isMangaka: boolean, panelRole: string | null, permissions: Record<string, boolean> | null }} AdminAccessState */

const ADMIN_ACCESS_CACHE_TTL_MS = 60 * 1000;
const memoryCache = new Map();
const pendingRequests = new Map();
const adminGetMyAdminProfile = httpsCallable(functions, 'adminGetMyAdminProfile');

/** @returns {AdminAccessState} */
export function emptyAdminAccess() {
  return {
    byClaim: false,
    canAccessAdmin: false,
    claimChecked: false,
    profileLoaded: false,
    superAdmin: false,
    isChiefAdmin: false,
    isMangaka: false,
    panelRole: null,
    permissions: null,
  };
}

function cloneAccess(value) {
  return {
    ...value,
    permissions: value?.permissions && typeof value.permissions === 'object'
      ? { ...value.permissions }
      : value?.permissions ?? null,
  };
}

function readCachedAccess(uid) {
  const memoryEntry = memoryCache.get(uid);
  if (memoryEntry?.expiresAt > Date.now() && memoryEntry?.value) {
    return cloneAccess(memoryEntry.value);
  }
  if (memoryEntry) {
    memoryCache.delete(uid);
  }
  return null;
}

function writeCachedAccess(uid, value) {
  const cloned = cloneAccess(value);
  memoryCache.set(uid, {
    expiresAt: Date.now() + ADMIN_ACCESS_CACHE_TTL_MS,
    value: cloned,
  });
  return cloneAccess(cloned);
}

export function clearAdminAccessCache(uid) {
  if (uid) {
    memoryCache.delete(uid);
    pendingRequests.delete(uid);
    return;
  }
  memoryCache.clear();
  pendingRequests.clear();
}

/**
 * Resolve acesso admin pelo backend em `admins/registry` + claims assinadas.
 * Usa cache curto para evitar martelar a callable a cada mudanca irrelevante do app shell.
 */
export async function resolveAdminAccess(user, { force = false } = {}) {
  if (!user?.uid) return emptyAdminAccess();

  const uid = String(user.uid).trim();
  if (!uid) return emptyAdminAccess();

  if (force) {
    clearAdminAccessCache(uid);
  } else {
    const cached = readCachedAccess(uid);
    if (cached) return cached;
    if (pendingRequests.has(uid)) {
      return pendingRequests.get(uid).then((value) => cloneAccess(value));
    }
  }

  let tokenResult = null;
  let claimChecked = false;

  try {
    tokenResult = await getIdTokenResult(user, false);
    claimChecked = Boolean(tokenResult);
  } catch {
    claimChecked = false;
  }

  const panelRoleFromClaim = String(tokenResult?.claims?.panelRole || '').trim().toLowerCase();
  const byClaim =
    tokenResult?.claims?.admin === true ||
    panelRoleFromClaim === 'admin' ||
    panelRoleFromClaim === 'super_admin';
  const claimSuperAdmin = panelRoleFromClaim === 'super_admin';

  const base = {
    byClaim,
    canAccessAdmin: false,
    claimChecked,
    profileLoaded: false,
    superAdmin: claimSuperAdmin,
    isChiefAdmin: claimSuperAdmin,
    isMangaka: false,
    panelRole: panelRoleFromClaim || null,
    permissions: null,
  };

  const pending = (async () => {
    try {
      const { data } = await adminGetMyAdminProfile();
      let result;

      if (!data?.ok) {
        result = {
          ...base,
          profileLoaded: true,
          canAccessAdmin: false,
          permissions: {},
        };
        return writeCachedAccess(uid, result);
      }

      if (data.panelRole && data.panelRole !== panelRoleFromClaim) {
        try {
          await user.getIdToken(true);
        } catch {
          // no-op
        }
      }

      if (data.mangaka === true) {
        result = {
          byClaim,
          canAccessAdmin: false,
          claimChecked,
          profileLoaded: true,
          superAdmin: false,
          isChiefAdmin: false,
          isMangaka: true,
          panelRole: data.panelRole || 'mangaka',
          permissions: {},
        };
        return writeCachedAccess(uid, result);
      }

      if (!data.admin) {
        result = {
          ...base,
          profileLoaded: true,
          canAccessAdmin: false,
          permissions: {},
        };
        return writeCachedAccess(uid, result);
      }

      result = {
        byClaim,
        canAccessAdmin: true,
        claimChecked,
        profileLoaded: true,
        superAdmin: data.super === true,
        isChiefAdmin: data.super === true,
        isMangaka: false,
        panelRole: data.panelRole || (data.super === true ? 'super_admin' : 'admin'),
        permissions: data.permissions && typeof data.permissions === 'object' ? { ...data.permissions } : {},
      };
      return writeCachedAccess(uid, result);
    } catch {
      return writeCachedAccess(uid, {
        ...base,
        profileLoaded: true,
        canAccessAdmin: false,
        superAdmin: false,
        isChiefAdmin: false,
        permissions: {},
      });
    } finally {
      pendingRequests.delete(uid);
    }
  })();
  pendingRequests.set(uid, pending);
  return pending.then((value) => cloneAccess(value));
}
