import { getIdTokenResult } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { isAdminUser } from '../constants';
import { functions } from '../services/firebase';

/** @typedef {{ byClaim: boolean, byAllowlist: boolean, canAccessAdmin: boolean, claimChecked: boolean, profileLoaded: boolean, superAdmin: boolean, isChiefAdmin: boolean, isMangaka: boolean, panelRole: string | null, permissions: Record<string, boolean> | null }} AdminAccessState */

/** @returns {AdminAccessState} */
export function emptyAdminAccess() {
  return {
    byClaim: false,
    byAllowlist: false,
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
    isChiefAdmin: byAllowlist,
    isMangaka: false,
    panelRole: byAllowlist ? 'super_admin' : null,
    permissions: null,
  };

  try {
    const { data } = await adminGetMyAdminProfile();
    if (!data?.ok) {
      return {
        ...base,
        profileLoaded: true,
        superAdmin: byAllowlist,
        isChiefAdmin: byAllowlist,
        isMangaka: false,
        panelRole: byAllowlist ? 'super_admin' : null,
        permissions: null,
      };
    }
    try {
      await user.getIdToken(true);
    } catch {
      /* JWT com panelRole para Storage/RTDB apos adminGetMyAdminProfile (inclui sync de claims no servidor) */
    }
    if (data.mangaka === true) {
      return {
        byClaim: false,
        byAllowlist,
        canAccessAdmin: false,
        claimChecked,
        profileLoaded: true,
        superAdmin: false,
        isChiefAdmin: false,
        isMangaka: true,
        panelRole: data.panelRole || 'mangaka',
        permissions: {},
      };
    }
    if (!data.admin) {
      return {
        ...base,
        profileLoaded: true,
        permissions: {},
      };
    }
    const isStaffSuper = data.super === true;
    const panelRole = data.panelRole || (byAllowlist ? 'super_admin' : isStaffSuper ? 'super_admin' : 'admin');
    return {
      byClaim: false,
      byAllowlist,
      canAccessAdmin: true,
      claimChecked,
      profileLoaded: true,
      superAdmin: byAllowlist || isStaffSuper,
      isChiefAdmin: byAllowlist || isStaffSuper,
      isMangaka: false,
      panelRole,
      permissions: data.permissions && typeof data.permissions === 'object' ? data.permissions : {},
    };
  } catch {
    return {
      ...base,
      profileLoaded: true,
      superAdmin: byAllowlist,
      isChiefAdmin: byAllowlist,
      isMangaka: false,
      panelRole: byAllowlist ? 'super_admin' : null,
      permissions: {},
    };
  }
}
