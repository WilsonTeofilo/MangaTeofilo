/**
 * Campos de permissao alinhados a `functions/adminRbac.js` (normalizePermissionsForRegistry).
 * A UI de equipe agrupa apenas permissoes operacionais de staff.
 */
export const STAFF_PERMISSION_FIELDS = [
  { field: 'canAccessCapitulos', label: 'Capitulos', category: 'Conteudo' },
  { field: 'canAccessObras', label: 'Obras', category: 'Conteudo' },
  { field: 'canAccessLojaAdmin', label: 'Loja fisica', category: 'Loja' },
  { field: 'canAccessPedidos', label: 'Pedidos', category: 'Loja' },
  { field: 'canAccessDashboard', label: 'Dashboard', category: 'Financeiro' },
  { field: 'canAccessFinanceiro', label: 'Promocoes', category: 'Financeiro' },
  { field: 'canRevokeUserSessions', label: 'Revogar sessoes', category: 'Sistema' },
];

export function adminHasFullPanel(access) {
  if (access?.isMangaka) return false;
  return Boolean(access?.superAdmin || access?.legacyAdmin);
}

function hasCreatorScopeAccess(access) {
  if (!access?.canAccessAdmin) return false;
  if (access?.isMangaka) return true;
  if (adminHasFullPanel(access)) return true;
  const perm = access.permissions || {};
  return Boolean(
    perm.canAccessCapitulos ||
    perm.canAccessObras ||
    perm.canAccessDashboard ||
    perm.canAccessFinanceiro ||
    perm.canAccessLojaAdmin ||
    perm.canAccessPedidos
  );
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
    if (pathname.startsWith('/admin/loja') || pathname.startsWith('/admin/pedidos')) return true;
    if (pathname.startsWith('/admin/financeiro')) return true;
    if (pathname.startsWith('/admin/capitulos')) return true;
    if (pathname.startsWith('/admin/manga')) return true;
    if (pathname.startsWith('/admin/obras')) return true;
  }
  if (adminHasFullPanel(access)) return true;
  const perm = access.permissions || {};
  if (pathname === '/admin') return true;
  if (pathname.startsWith('/admin/equipe')) {
    return access.isChiefAdmin === true;
  }
  if (pathname.startsWith('/admin/criadores')) {
    return access.isChiefAdmin === true;
  }
  if (pathname.startsWith('/admin/sessoes')) {
    return access.isChiefAdmin === true || access.permissions?.canRevokeUserSessions === true;
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
    return perm.canAccessPedidos === true || perm.canAccessLojaAdmin === true;
  }
  if (pathname.startsWith('/admin/producao-fisica') || pathname.startsWith('/admin/orders')) {
    return perm.canAccessLojaAdmin === true;
  }
  return false;
}

export function canAccessCreatorPath(pathname, access) {
  if (!hasCreatorScopeAccess(access)) return false;
  if (pathname === '/creator' || pathname === '/creator/') return true;
  if (pathname.startsWith('/creator/perfil')) {
    return true;
  }
  if (pathname.startsWith('/creator/dashboard')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/dashboard', access) || canAccessAdminPath('/admin/financeiro', access);
  }
  if (pathname.startsWith('/creator/audience')) {
    return access?.isMangaka === true;
  }
  if (pathname.startsWith('/creator/obras')) {
    return canAccessAdminPath('/admin/obras', access);
  }
  if (pathname.startsWith('/creator/capitulos')) {
    return canAccessAdminPath('/admin/capitulos', access);
  }
  if (pathname.startsWith('/creator/editor')) {
    return canAccessAdminPath('/admin/manga', access) || canAccessAdminPath('/admin/capitulos', access);
  }
if (pathname.startsWith('/creator/promocoes')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/financeiro', access);
  }
  if (pathname.startsWith('/creator/loja')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/loja', access) || canAccessAdminPath('/admin/pedidos', access);
  }
  if (pathname.startsWith('/creator/print')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/loja', access) || canAccessAdminPath('/admin/pedidos', access);
  }
  if (pathname.startsWith('/print-on-demand') && pathname.includes('ctx=creator')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/loja', access) || canAccessAdminPath('/admin/pedidos', access);
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
  '/admin/orders',
  '/admin/producao-fisica',
  '/admin/pedidos',
  '/admin/sessoes',
  '/admin/equipe',
  '/admin/criadores',
];

/** Primeira rota admin que o perfil permite (para redirect de `/admin`). */
export function getDefaultAdminRedirect(access) {
  for (const path of ADMIN_HOME_CANDIDATES) {
    if (canAccessAdminPath(path, access)) return path;
  }
  return '/';
}

const CREATOR_HOME_CANDIDATES = [
  '/creator/dashboard',
  '/creator/audience',
  '/creator/perfil',
  '/creator/obras',
  '/creator/capitulos',
  '/creator/promocoes',
  '/creator/loja',
  '/print-on-demand?ctx=creator',
];

export function getDefaultCreatorRedirect(access) {
  for (const path of CREATOR_HOME_CANDIDATES) {
    if (canAccessCreatorPath(path, access)) return path;
  }
  return '/';
}
