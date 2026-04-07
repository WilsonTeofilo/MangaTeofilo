import { getIdTokenResult } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../services/firebase';

/** @typedef {{ byClaim: boolean, canAccessAdmin: boolean, claimChecked: boolean, profileLoaded: boolean, superAdmin: boolean, isChiefAdmin: boolean, isMangaka: boolean, panelRole: string | null, permissions: Record<string, boolean> | null }} AdminAccessState */

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

const adminGetMyAdminProfile = httpsCallable(functions, 'adminGetMyAdminProfile');

/**
 * Resolve acesso admin pelo backend em `admins/registry` + claims assinadas.
 */
export async function resolveAdminAccess(user) {
  if (!user) return emptyAdminAccess();

  try {
    await user.getIdToken(true);
  } catch {
    /* token refresh opcional */
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
    canAccessAdmin: byClaim,
    claimChecked,
    profileLoaded: false,
    superAdmin: claimSuperAdmin,
    isChiefAdmin: claimSuperAdmin,
    isMangaka: false,
    panelRole: panelRoleFromClaim || null,
    permissions: null,
  };

  try {
    const { data } = await adminGetMyAdminProfile();
    if (!data?.ok) {
      return {
        ...base,
        profileLoaded: true,
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
    }
    if (!data.admin) {
      return {
        ...base,
        profileLoaded: true,
        permissions: {},
      };
    }
    const isStaffSuper = data.super === true;
    const panelRole = data.panelRole || (isStaffSuper ? 'super_admin' : 'admin');
    return {
      byClaim,
      canAccessAdmin: true,
      claimChecked,
      profileLoaded: true,
      superAdmin: isStaffSuper,
      isChiefAdmin: isStaffSuper,
      isMangaka: false,
      panelRole,
      permissions: data.permissions && typeof data.permissions === 'object' ? data.permissions : {},
    };
  } catch {
    return {
      ...base,
      profileLoaded: true,
      permissions: {},
    };
  }
}
