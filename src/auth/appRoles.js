/**
 * Papeis logicos da aplicacao.
 * O RTDB ainda usa `mangaka` como marcador legado de acesso editorial do creator.
 * Isso nao significa monetizacao financeira ativa.
 * Admin = painel da equipe sem papel creator ativo.
 */

import { hasAnyAdminWorkspaceAccess } from './adminPermissions';
import { resolveCanonicalPublicHandle } from '../utils/canonicalIdentity';


export const APP_ROLE = {
  ADMIN: 'admin',
  CREATOR: 'creator',
  USER: 'user',
};

/** @param {import('./adminAccess').AdminAccessState} adminAccess */
export function isStaffEquipeWithoutCreator(adminAccess) {
  if (!hasAnyAdminWorkspaceAccess(adminAccess)) return false;
  if (adminAccess.isMangaka === true) return false;
  return true;
}

export function rtdbRoleIsCreator(perfilRow) {
  return String(perfilRow?.role || '').trim().toLowerCase() === 'mangaka';
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeRoleLike(value) {
  return String(value || '').trim().toLowerCase();
}

function hasWriterIdentityFields(perfilRow) {
  const row = asObject(perfilRow);
  const publicProfile = asObject(row.publicProfile);
  const creator = asObject(row.creator);
  const creatorProfile = asObject(publicProfile.creatorProfile);
  const privateCreatorProfile = asObject(creator.profile);

  const handle = resolveCanonicalPublicHandle({
    ...row,
    publicProfile,
    creator: {
      ...creator,
      profile: {
        ...privateCreatorProfile,
      },
    },
  });

  const displayName = String(
    privateCreatorProfile.displayName ||
      creatorProfile.displayName ||
      row.creatorDisplayName ||
      publicProfile.creatorDisplayName ||
      row.userName ||
      publicProfile.userName ||
      ''
  ).trim();

  return Boolean(handle || displayName);
}

export function perfilCanOwnWorks(perfilRow, { creatorsRow = null } = {}) {
  const row = asObject(perfilRow);
  const publicProfile = asObject(row.publicProfile);
  const creator = asObject(row.creator);
  const creatorProfile = asObject(publicProfile.creatorProfile);
  const creatorNode = asObject(creatorsRow);

  const signupIntent = normalizeRoleLike(row.signupIntent || publicProfile.signupIntent);
  const accountType = normalizeRoleLike(row.accountType || publicProfile.accountType);
  const panelRole = normalizeRoleLike(row.panelRole || publicProfile.panelRole);
  const creatorStatus = normalizeRoleLike(row.creatorStatus || publicProfile.creatorStatus);

  if (rtdbRoleIsCreator(row)) return true;
  if (panelRole === 'mangaka') return true;
  if (row.isCreatorProfile === true || publicProfile.isCreatorProfile === true) return true;
  if (creator.isCreator === true || creatorProfile.isCreator === true) return true;
  if (creator.onboardingCompleted === true || row.creatorOnboardingCompleted === true) return true;
  if (creatorStatus === 'active' || creatorStatus === 'onboarding') return true;
  if (signupIntent === 'creator' || accountType === 'writer' || accountType === 'creator') {
    return hasWriterIdentityFields(row) || Object.keys(creatorNode).length > 0;
  }
  if (Object.keys(creatorNode).length > 0) return true;
  return hasWriterIdentityFields(row) && (Boolean(creator.profile) || Boolean(publicProfile.creatorProfile));
}

export function perfilHasCreatorAccess(perfilRow) {
  return perfilCanOwnWorks(perfilRow);
}

export function resolveCreatorRoleBootstrap(perfilRow, adminAccess) {
  if (hasAnyAdminWorkspaceAccess(adminAccess)) return false;
  if (adminAccess?.isMangaka === true) return true;
  return perfilHasCreatorAccess(perfilRow);
}

/**
 * @param {import('./adminAccess').AdminAccessState} adminAccess
 * @param {boolean} isMangakaEffective mesmo cÃ¡lculo que App.jsx (perfil + token)
 */
export function resolveAppRole(perfilRow, adminAccess, isMangakaEffective) {
  if (isStaffEquipeWithoutCreator(adminAccess)) return APP_ROLE.ADMIN;
  if (isMangakaEffective || resolveCreatorRoleBootstrap(perfilRow, adminAccess)) return APP_ROLE.CREATOR;
  return APP_ROLE.USER;
}

export function resolveAppRoleContext(perfilRow, adminAccess, { profileLoaded = true } = {}) {
  const creatorBootstrap = Boolean(profileLoaded) && resolveCreatorRoleBootstrap(perfilRow, adminAccess);
  const appRole = resolveAppRole(perfilRow, adminAccess, creatorBootstrap);
  const isCreator = appRole === APP_ROLE.CREATOR;
  const isAdmin = appRole === APP_ROLE.ADMIN;

  return {
    appRole,
    creatorBootstrap,
    isCreator,
    isAdmin,
    isUser: appRole === APP_ROLE.USER,
    accessForCreatorRouting: isCreator
      ? { ...adminAccess, isMangaka: true, canAccessAdmin: false, panelRole: 'mangaka' }
      : { ...adminAccess, isMangaka: false },
  };
}

