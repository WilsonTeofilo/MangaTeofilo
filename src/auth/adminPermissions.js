import { isStaffEquipeWithoutCreator } from './appRoles';

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
  '/admin/loja',
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
  return Boolean(access?.superAdmin || access?.legacyAdmin);
}

function hasCreatorScopeAccess(access) {
  if (access?.isMangaka) return true;
  if (!access?.canAccessAdmin) return false;
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
  if (pathname.startsWith('/admin/store/settings')) {
    if (access?.isMangaka) return false;
    return perm.canAccessLojaAdmin === true;
  }
  if (pathname.startsWith('/admin/products') || pathname.startsWith('/admin/loja')) {
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
  /** Onboarding só para contas que não são equipe sem creator. */
  if (p.startsWith('/creator/onboarding')) {
    if (isStaffEquipeWithoutCreator(access)) return false;
    return true;
  }
  if (!hasCreatorScopeAccess(access)) return false;
  /** Equipe: só ferramentas operacionais; sem monetização, missões, analytics nem dashboard creator. */
  if (isStaffEquipeWithoutCreator(access)) {
    if (
      p.startsWith('/creator/monetizacao') ||
      p.startsWith('/creator/missoes') ||
      p.startsWith('/creator/dashboard') ||
      p.startsWith('/creator/audience') ||
      p.startsWith('/creator/print') ||
      (p.startsWith('/print-on-demand') && p.includes('ctx=creator'))
    ) {
      return false;
    }
  }
  if (p === '/creator' || p === '/creator/') {
    if (isStaffEquipeWithoutCreator(access)) {
      return canAccessAdminPath('/admin/obras', access) || canAccessAdminPath('/admin/capitulos', access);
    }
    return true;
  }
  /** Hub de conta: equipe usa como leitor; não é painel creator. */
  if (p === '/perfil') {
    return true;
  }
  if (p.startsWith('/creator/monetizacao')) {
    return access?.isMangaka === true;
  }
  if (p.startsWith('/creator/missoes')) {
    return access?.isMangaka === true;
  }
  if (p.startsWith('/creator/dashboard')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/dashboard', access) || canAccessAdminPath('/admin/financeiro', access);
  }
  if (p.startsWith('/creator/audience')) {
    return access?.isMangaka === true;
  }
  if (p.startsWith('/creator/obras')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/obras', access);
  }
  if (p.startsWith('/creator/capitulos')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/capitulos', access);
  }
  if (p.startsWith('/creator/editor')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/manga', access) || canAccessAdminPath('/admin/capitulos', access);
  }
  if (p.startsWith('/creator/promocoes')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/financeiro', access);
  }
  if (p.startsWith('/creator/loja')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/loja', access) || canAccessAdminPath('/admin/pedidos', access);
  }
  if (p.startsWith('/creator/print')) {
    if (access?.isMangaka) return true;
    return canAccessAdminPath('/admin/loja', access) || canAccessAdminPath('/admin/pedidos', access);
  }
  if (p.startsWith('/print-on-demand') && p.includes('ctx=creator')) {
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
  '/admin/products',
  '/admin/loja',
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
  if (isStaffEquipeWithoutCreator(access)) {
    const prefer = ['/creator/obras', '/creator/capitulos', '/admin/obras', '/admin/capitulos'];
    for (const path of prefer) {
      if (path.startsWith('/admin')) {
        if (canAccessAdminPath(path, access)) return path;
      } else if (canAccessCreatorPath(path, access)) {
        return path;
      }
    }
    return getDefaultAdminRedirect(access);
  }
  for (const path of CREATOR_HOME_CANDIDATES) {
    if (canAccessCreatorPath(path, access)) return path;
  }
  return '/';
}
