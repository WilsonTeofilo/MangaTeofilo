/**
 * Papéis lógicos da aplicação (RTDB continua usando `mangaka` para creator aprovado).
 * Admin = painel da equipe sem papel creator ativo.
 */

export const APP_ROLE = {
  ADMIN: 'admin',
  CREATOR: 'creator',
  USER: 'user',
};

/** @param {import('./adminAccess').AdminAccessState} adminAccess */
export function isStaffEquipeWithoutCreator(adminAccess) {
  if (!adminAccess?.canAccessAdmin) return false;
  if (adminAccess.isMangaka === true) return false;
  return adminAccess.superAdmin === true || adminAccess.profileLoaded === true;
}

export function rtdbRoleIsCreator(perfilRow) {
  return String(perfilRow?.role || '').trim().toLowerCase() === 'mangaka';
}

export function resolveCreatorRoleBootstrap(perfilRow, adminAccess) {
  if (adminAccess?.canAccessAdmin === true) return false;
  if (adminAccess?.isMangaka === true) return true;
  return rtdbRoleIsCreator(perfilRow);
}

/**
 * @param {import('./adminAccess').AdminAccessState} adminAccess
 * @param {boolean} isMangakaEffective mesmo cálculo que App.jsx (perfil + token)
 */
export function resolveAppRole(perfilRow, adminAccess, isMangakaEffective) {
  if (isStaffEquipeWithoutCreator(adminAccess)) return APP_ROLE.ADMIN;
  if (isMangakaEffective || resolveCreatorRoleBootstrap(perfilRow, adminAccess)) return APP_ROLE.CREATOR;
  return APP_ROLE.USER;
}
