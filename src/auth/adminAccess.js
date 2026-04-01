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
 * Resolve acesso admin: allowlist (chefes) + perfil no backend em `admins/registry`.
 */
export async function resolveAdminAccess(user) {
  if (!user) return emptyAdminAccess();

  try {
    await user.getIdToken(true);
  } catch {
    /* token refresh opcional */
  }

  const byAllowlist = isAdminUser(user);
  let claimChecked = false;

  try {
    claimChecked = Boolean(await getIdTokenResult(user, false));
  } catch {
    claimChecked = false;
  }

  const base = {
    byClaim: false,
    byAllowlist,
    canAccessAdmin: byAllowlist,
    claimChecked,
    profileLoaded: false,
    superAdmin: byAllowlist,
    legacyAdmin: false,
    isChiefAdmin: byAllowlist,
    isMangaka: false,
    panelRole: byAllowlist ? 'super_admin' : null,
    permissions: null,
  };

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
    const isMangaka = data.mangaka === true;
    const panelRole = data.panelRole || (byAllowlist ? 'super_admin' : data.super ? 'super_admin' : 'admin');
    return {
      byClaim: false,
      byAllowlist,
      canAccessAdmin: true,
      claimChecked,
      profileLoaded: true,
      superAdmin: byAllowlist || data.super === true,
      legacyAdmin: false,
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
      legacyAdmin: false,
      isChiefAdmin: byAllowlist,
      isMangaka: false,
      panelRole: byAllowlist ? 'super_admin' : null,
      permissions: {},
    };
  }
}
