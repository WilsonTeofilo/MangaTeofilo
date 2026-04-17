/**
 * Papeis logicos da aplicacao.
 * O RTDB ainda usa `mangaka` como marcador legado de acesso editorial do creator.
 * Isso nao significa monetizacao financeira ativa.
 * Admin = painel da equipe sem papel creator ativo.
 */

import { hasAnyAdminWorkspaceAccess } from './adminPermissions';


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

export function perfilHasCreatorAccess(perfilRow) {
  const creatorApplicationStatus = String(perfilRow?.creatorApplicationStatus || '').trim().toLowerCase();
  const creatorStatus = String(perfilRow?.creatorStatus || '').trim().toLowerCase();
  const creatorRoot = perfilRow?.creator && typeof perfilRow.creator === 'object' ? perfilRow.creator : {};

  if (creatorApplicationStatus === 'approved') return true;
  if (creatorStatus === 'active' || creatorStatus === 'onboarding') return true;
  if (creatorRoot.onboardingCompleted === true) return true;
  if (creatorRoot.isCreator === true) return true;

  return false;
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

