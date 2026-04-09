/**
 * RBAC Shito: staff resolvido por admins/registry e claims assinadas.
 * Validacao sempre no backend; claims servem como cache assinado para cliente e rules.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

export const ADMIN_REGISTRY_PATH = 'admins/registry';

/** Chaves logicas -> campo em permissions no registry. */
export const PERM = {
  capitulos: 'canAccessCapitulos',
  obras: 'canAccessObras',
  avatares: 'canAccessAvatares',
  dashboard: 'canAccessDashboard',
  financeiro: 'canAccessFinanceiro',
  loja: 'canAccessLojaAdmin',
  pedidos: 'canAccessPedidos',
  migrateUsers: 'canRunUserMigration',
  revokeSessions: 'canRevokeUserSessions',
};

const ALL_PERM_KEYS = Object.values(PERM);

function defaultPermissionsAllFalse() {
  const permissions = {};
  ALL_PERM_KEYS.forEach((key) => {
    permissions[key] = false;
  });
  return permissions;
}

export function defaultPermissionsAllTrue() {
  const permissions = {};
  ALL_PERM_KEYS.forEach((key) => {
    permissions[key] = true;
  });
  return permissions;
}

/** Permissoes do painel para mangaka (escopo de dados filtrado no front + RTDB). */
export function defaultMangakaPermissions() {
  const base = defaultPermissionsAllFalse();
  base[PERM.capitulos] = true;
  base[PERM.obras] = true;
  base[PERM.financeiro] = true;
  return base;
}

function normalizeStaffRole(raw) {
  const role = String(raw || '').trim().toLowerCase();
  return role === 'admin' || role === 'super_admin' ? role : '';
}

function claimPanelRole(auth) {
  return String(auth?.token?.panelRole || '').trim().toLowerCase();
}

function permissionsGrantFullControl(permissions) {
  return ALL_PERM_KEYS.every((key) => permissions?.[key] === true);
}

export function normalizePermissionsForRegistry(raw) {
  const base = defaultPermissionsAllFalse();
  if (!raw || typeof raw !== 'object') return base;
  ALL_PERM_KEYS.forEach((key) => {
    if (raw[key] === true) base[key] = true;
  });
  return base;
}

async function readStaffRegistryRow(uid) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) return null;
  const snap = await getDatabase().ref(`${ADMIN_REGISTRY_PATH}/${normalizedUid}`).get();
  if (!snap.exists()) return null;
  const row = snap.val() || {};
  const role = normalizeStaffRole(row.role);
  if (!role) return null;
  return {
    uid: normalizedUid,
    role,
    permissions: normalizePermissionsForRegistry(row.permissions),
    updatedAt: Number(row.updatedAt || 0),
    updatedBy: String(row.updatedBy || ''),
  };
}

export async function listStaffRegistryRows() {
  const snap = await getDatabase().ref(ADMIN_REGISTRY_PATH).get();
  if (!snap.exists()) return [];
  return Object.entries(snap.val() || {})
    .map(([uid, row]) => {
      const role = normalizeStaffRole(row?.role);
      if (!role) return null;
      return {
        uid,
        role,
        permissions: normalizePermissionsForRegistry(row?.permissions),
        updatedAt: Number(row?.updatedAt || 0),
        updatedBy: String(row?.updatedBy || ''),
      };
    })
    .filter(Boolean);
}

export async function listStaffUids() {
  const rows = await listStaffRegistryRows();
  return rows.map((row) => String(row.uid || '').trim()).filter(Boolean);
}

export async function isTargetSuperAdmin({ uid, email }) {
  let targetUid = String(uid || '').trim();
  if (!targetUid && email) {
    targetUid = (await resolveTargetUidByEmail(email)) || '';
  }
  if (!targetUid) return false;
  const row = await readStaffRegistryRow(targetUid);
  if (!row) return false;
  return row.role === 'super_admin' || permissionsGrantFullControl(row.permissions);
}

/**
 * @param {import('firebase-functions/v2/https').CallableRequest['auth']} auth
 */
export async function getAdminAuthContext(auth) {
  if (!auth?.uid) return null;

  const row = await readStaffRegistryRow(auth.uid);
  if (row) {
    const fullControl = row.role === 'super_admin' || permissionsGrantFullControl(row.permissions);
    return {
      uid: auth.uid,
      role: fullControl ? 'super_admin' : 'admin',
      super: fullControl,
      mangaka: false,
      permissions: fullControl ? defaultPermissionsAllTrue() : row.permissions,
    };
  }

  const panelRole = claimPanelRole(auth);
  if (panelRole === 'super_admin') {
    return {
      uid: auth.uid,
      role: 'super_admin',
      super: true,
      mangaka: false,
      permissions: defaultPermissionsAllTrue(),
    };
  }

  if (panelRole === 'admin' || auth.token?.admin === true) {
    return {
      uid: auth.uid,
      role: 'admin',
      super: false,
      mangaka: false,
      permissions: defaultPermissionsAllTrue(),
    };
  }

  return null;
}

export async function isCreatorAccountAuth(auth) {
  if (!auth?.uid) return false;
  return claimPanelRole(auth) === 'mangaka';
}

export async function requireAdminAuth(auth) {
  const ctx = await getAdminAuthContext(auth);
  if (!ctx) {
    throw new HttpsError('permission-denied', 'Apenas administradores.');
  }
  if (ctx.mangaka) {
    throw new HttpsError('permission-denied', 'Apenas equipe da plataforma.');
  }
  return ctx;
}

/**
 * @param {Awaited<ReturnType<typeof getAdminAuthContext>>} ctx
 * @param {keyof typeof PERM} key
 */
export function requirePermission(ctx, key) {
  const field = PERM[key];
  if (!field) {
    throw new HttpsError('internal', 'Permissao desconhecida.');
  }
  if (ctx.super || ctx.permissions[field] === true) return;
  throw new HttpsError('permission-denied', 'Sem permissao para esta acao.');
}

export async function requireSuperAdmin(auth) {
  const ctx = await requireAdminAuth(auth);
  if (!ctx.super) {
    throw new HttpsError('permission-denied', 'Apenas admin chefe pode fazer isso.');
  }
  return ctx;
}

export async function resolveTargetUidByEmail(email) {
  const norm = String(email || '').trim().toLowerCase();
  if (!norm) return null;
  try {
    const user = await getAuth().getUserByEmail(norm);
    return user.uid;
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
}
