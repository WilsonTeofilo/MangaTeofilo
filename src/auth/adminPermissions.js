/**
 * Campos de permissao alinhados a `functions/adminRbac.js` (normalizePermissionsForRegistry).
 * A UI de equipe agrupa apenas permissoes operacionais de staff.
 *
 * Rotas admin (`src/App.jsx`): ao criar `/admin/...` nova, estender `canAccessAdminPath` abaixo
 * e manter esta lista como índice (grep no repositório por cada prefixo).
 */
export const ADMIN_ROUTE_PREFIXES = [
  '/admin/capitulos',
  '/admin/manga',
  '/admin/obras',
  '/admin/avatares',
  '/admin/dashboard',
  '/admin/financeiro',
  '/admin/store/settings',
  '/admin/products',
  '/admin/pedidos',
  '/admin/producao-fisica',
  '/admin/orders',
  '/admin/sessoes',
  '/admin/equipe',
  '/admin/criadores',
];

/** Atalhos creator espelhados em `App.jsx` — dependem de `canAccessCreatorPath`. */
export const CREATOR_ROUTE_PREFIXES = [
  '/creator/monetizacao',
  '/creator/missoes',
  '/creator/dashboard',
  '/creator/audience',
  '/creator/obras',
  '/creator/capitulos',
  '/creator/editor',
  '/creator/promocoes',
  '/creator/loja',
  '/creator/print',
  '/print-on-demand',
];

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
  return access?.superAdmin === true;
}

function hasCreatorScopeAccess(access) {
  return access?.isMangaka === true && access?.canAccessAdmin !== true;
}

/**
 * @param {string} pathname
 * @param {import('./adminAccess').AdminAccessState} access
 */
export function canAccessAdminPath(pathname, access) {
  if (!access?.canAccessAdmin) return false;
  if (access?.isMangaka) return false;
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
    return perm.canAccessCapitulos === true;
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
  if (pathname.startsWith('/admin/store/settings')) {
    return perm.canAccessLojaAdmin === true;
  }
  if (pathname.startsWith('/admin/products')) {
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
  const p = String(pathname || '');
  if (p.startsWith('/creator/onboarding')) {
    return true;
  }
  if (!hasCreatorScopeAccess(access)) return false;
  return (
    p === '/creator' ||
    p === '/creator/' ||
    p === '/perfil' ||
    p.startsWith('/creator/monetizacao') ||
    p.startsWith('/creator/missoes') ||
    p.startsWith('/creator/dashboard') ||
    p.startsWith('/creator/audience') ||
    p.startsWith('/creator/obras') ||
    p.startsWith('/creator/capitulos') ||
    p.startsWith('/creator/editor') ||
    p.startsWith('/creator/promocoes') ||
    p.startsWith('/creator/loja') ||
    p.startsWith('/creator/print') ||
    (p.startsWith('/print-on-demand') && p.includes('ctx=creator'))
  );
}

const ADMIN_HOME_CANDIDATES = [
  '/admin/capitulos',
  '/admin/obras',
  '/admin/avatares',
  '/admin/dashboard',
  '/admin/financeiro',
  '/admin/products',
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
  '/perfil',
  '/creator/monetizacao',
  '/creator/missoes',
  '/creator/dashboard',
  '/creator/audience',
  '/creator/obras',
  '/creator/capitulos',
  '/creator/promocoes',
  '/creator/loja',
  '/creator/print',
  '/print-on-demand?ctx=creator',
];

export function getDefaultCreatorRedirect(access) {
  for (const path of CREATOR_HOME_CANDIDATES) {
    if (canAccessCreatorPath(path, access)) return path;
  }
  return '/';
}
