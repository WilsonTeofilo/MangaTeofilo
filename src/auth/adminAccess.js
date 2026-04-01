import { getIdTokenResult } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { isAdminUser } from '../constants';
import { functions } from '../services/firebase';

/** @typedef {{ byClaim: boolean, byAllowlist: boolean, canAccessAdmin: boolean, claimChecked: boolean, profileLoaded: boolean, superAdmin: boolean, legacyAdmin: boolean, isChiefAdmin: boolean, isMangaka: boolean, panelRole: string | null, permissions: Record<string, boolean> | null }} AdminAccessState */

/** @returns {AdminAccessState} */
export function emptyAdminAccess() {
  return {
    byClaim: false,
    byAllowlist: false,
    canAccessAdmin: false,
    claimChecked: false,
    profileLoaded: false,
    superAdmin: false,
    legacyAdmin: false,
    isChiefAdmin: false,
    isMangaka: false,
    panelRole: null,
    permissions: null,
  };
}

const adminGetMyAdminProfile = httpsCallable(functions, 'adminGetMyAdminProfile');

/**
 * Resolve acesso admin: allowlist (chefes), claim JWT, depois perfil no backend (permissões).
 */
export async function resolveAdminAccess(user) {
  if (!user) return emptyAdminAccess();

  try {
    await user.getIdToken(true);
  } catch {
    /* token refresh opcional */
  }

  const byAllowlist = isAdminUser(user);
  let byClaim = false;
  let claimChecked = false;
  let panelRoleFromToken = null;

  try {
    const tokenResult = await getIdTokenResult(user, false);
    byClaim = tokenResult?.claims?.admin === true;
    panelRoleFromToken = tokenResult?.claims?.panelRole || null;
    claimChecked = true;
  } catch {
    claimChecked = false;
  }

  const isMangakaToken = panelRoleFromToken === 'mangaka';
  const canAccessAdmin = byAllowlist || byClaim || isMangakaToken;

  const base = {
    byClaim,
    byAllowlist,
    canAccessAdmin,
    claimChecked,
    profileLoaded: false,
    superAdmin: byAllowlist,
    legacyAdmin: false,
    isChiefAdmin: byAllowlist,
    isMangaka: isMangakaToken,
    panelRole: panelRoleFromToken,
    permissions: byAllowlist ? null : null,
  };

  if (!canAccessAdmin) {
    return { ...base, profileLoaded: true };
  }

  try {
    const { data } = await adminGetMyAdminProfile();
    if (!data?.ok || !data.admin) {
      return {
        ...base,
        profileLoaded: true,
        superAdmin: byAllowlist,
        legacyAdmin: false,
        isChiefAdmin: byAllowlist,
        isMangaka: false,
        panelRole: byAllowlist ? 'super_admin' : null,
        permissions: null,
      };
    }
    const isMangaka = data.mangaka === true || isMangakaToken;
    const panelRole =
      data.panelRole || panelRoleFromToken || (byAllowlist ? 'super_admin' : data.super ? 'super_admin' : 'admin');
    return {
      byClaim,
      byAllowlist,
      canAccessAdmin: true,
      claimChecked,
      profileLoaded: true,
      superAdmin: byAllowlist || data.super === true,
      legacyAdmin: data.legacy === true && !isMangaka,
      isChiefAdmin: (byAllowlist || data.super === true) && !isMangaka,
      isMangaka,
      panelRole,
      permissions: data.permissions && typeof data.permissions === 'object' ? data.permissions : {},
    };
  } catch {
    return {
      ...base,
      profileLoaded: true,
      superAdmin: byAllowlist,
      /** Sem perfil: claim sem allowlist herda painel cheio (comportamento legado). */
      legacyAdmin: byClaim && !byAllowlist && !isMangakaToken,
      isChiefAdmin: byAllowlist,
      isMangaka: isMangakaToken,
      panelRole: panelRoleFromToken,
      permissions: {},
    };
  }
}
