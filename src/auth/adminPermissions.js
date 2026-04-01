/**
 * Campos de permissão alinhados a `functions/adminRbac.js` (normalizePermissionsForRegistry).
 */
export const STAFF_PERMISSION_FIELDS = [
  { field: 'canAccessCapitulos', label: 'Capítulos (hub)' },
  { field: 'canAccessMangaLegacy', label: 'Editor de mangá (legado)' },
  { field: 'canAccessObras', label: 'CRUD de obras' },
  { field: 'canAccessAvatares', label: 'CRUD de avatares' },
  { field: 'canAccessDashboard', label: 'Dashboard' },
  { field: 'canAccessFinanceiro', label: 'Financeiro e promoções' },
  { field: 'canAccessLojaAdmin', label: 'Loja física (admin)' },
  { field: 'canRunUserMigration', label: 'Migração de campos de usuários' },
  { field: 'canRevokeUserSessions', label: 'Revogar sessão de usuários' },
];

export function adminHasFullPanel(access) {
  if (access?.isMangaka) return false;
  return Boolean(access?.superAdmin || access?.legacyAdmin);
}

/**
 * @param {string} pathname
 * @param {import('./adminAccess').AdminAccessState} access
 */
export function canAccessAdminPath(pathname, access) {
  if (!access?.canAccessAdmin) return false;
  if (access?.isMangaka) {
    if (pathname.startsWith('/admin/equipe') || pathname.startsWith('/admin/sessoes')) return false;
    if (pathname.startsWith('/admin/avatares')) return false;
    if (pathname.startsWith('/admin/dashboard')) return false;
    if (pathname.startsWith('/admin/loja') || pathname.startsWith('/admin/pedidos')) return false;
  }
  if (adminHasFullPanel(access)) return true;
  const perm = access.permissions || {};
  if (pathname === '/admin') return true;
  if (pathname.startsWith('/admin/equipe')) {
    return access.isChiefAdmin === true;
  }
  if (pathname.startsWith('/admin/sessoes')) {
    return (
      access.isChiefAdmin === true ||
      access.permissions?.canRevokeUserSessions === true
    );
  }
  if (pathname.startsWith('/admin/capitulos')) {
    return perm.canAccessCapitulos === true;
  }
  if (pathname.startsWith('/admin/manga')) {
    return perm.canAccessCapitulos === true || perm.canAccessMangaLegacy === true;
  }
  if (pathname.startsWith('/admin/obras')) {
    return perm.canAccessObras === true;
  }
  if (pathname.startsWith('/admin/avatares')) {
    return perm.canAccessAvatares === true;
  }
  if (pathname.startsWith('/admin/dashboard')) {
    return perm.canAccessDashboard === true;
  }
  if (pathname.startsWith('/admin/financeiro')) {
    return perm.canAccessFinanceiro === true;
  }
  if (pathname.startsWith('/admin/loja')) {
    return perm.canAccessLojaAdmin === true;
  }
  if (pathname.startsWith('/admin/pedidos')) {
    return perm.canAccessLojaAdmin === true;
  }
  return false;
}

const ADMIN_HOME_CANDIDATES = [
  '/admin/capitulos',
  '/admin/obras',
  '/admin/avatares',
  '/admin/dashboard',
  '/admin/financeiro',
  '/admin/loja',
  '/admin/pedidos',
  '/admin/sessoes',
  '/admin/equipe',
];

/** Primeira rota admin que o perfil permite (para redirect de `/admin`). */
export function getDefaultAdminRedirect(access) {
  for (const path of ADMIN_HOME_CANDIDATES) {
    if (canAccessAdminPath(path, access)) return path;
  }
  return '/';
}
