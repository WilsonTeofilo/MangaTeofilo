/**
 * RBAC Shito: super_admin (cachoroes fixos) + admins com permissoes em admins/registry.
 * Validacao sempre no backend; claims servem apenas para espelhar o papel no cliente.
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

import platformStaffAllowlist from './shared/platformStaffAllowlist.json' with { type: 'json' };

export const ADMIN_REGISTRY_PATH = 'admins/registry';

/** UIDs dos super admins — mesma lista que `shared/platformStaffAllowlist.json` / `src/constants.js`. */
export const SUPER_ADMIN_UIDS = new Set(platformStaffAllowlist.uids);

export const SUPER_ADMIN_EMAILS = new Set(platformStaffAllowlist.emails);

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
  const o = {};
  ALL_PERM_KEYS.forEach((k) => {
    o[k] = false;
  });
  return o;
}

export function defaultPermissionsAllTrue() {
  const o = {};
  ALL_PERM_KEYS.forEach((k) => {
    o[k] = true;
  });
  return o;
}

/** Permissoes do painel para mangaka (escopo de dados filtrado no front + RTDB). */
export function defaultMangakaPermissions() {
  const base = defaultPermissionsAllFalse();
  base[PERM.capitulos] = true;
  base[PERM.obras] = true;
  base[PERM.financeiro] = true;
  return base;
}

export function isSuperAdminAuth(auth) {
  if (!auth?.uid) return false;
  const email = String(auth.token?.email || '').toLowerCase();
  return SUPER_ADMIN_UIDS.has(auth.uid) || SUPER_ADMIN_EMAILS.has(email);
}

export function isTargetSuperAdmin({ uid, email }) {
  const em = String(email || '').toLowerCase();
  return (uid && SUPER_ADMIN_UIDS.has(uid)) || SUPER_ADMIN_EMAILS.has(em);
}

export function normalizePermissionsForRegistry(raw) {
  const base = defaultPermissionsAllFalse();
  if (!raw || typeof raw !== 'object') return base;
  ALL_PERM_KEYS.forEach((k) => {
    if (raw[k] === true) base[k] = true;
  });
  return base;
}

/**
 * @param {import('firebase-functions/v2/https').CallableRequest['auth']} auth
 */
export async function getAdminAuthContext(auth) {
  if (!auth?.uid) return null;
  if (isSuperAdminAuth(auth)) {
    return {
      uid: auth.uid,
      super: true,
      legacy: false,
      mangaka: false,
      permissions: defaultPermissionsAllTrue(),
    };
  }
  const db = getDatabase();
  const snap = await db.ref(`${ADMIN_REGISTRY_PATH}/${auth.uid}`).get();
  const row = snap.val();
  if (row && row.role === 'admin') {
    return {
      uid: auth.uid,
      super: false,
      legacy: false,
      mangaka: false,
      permissions: normalizePermissionsForRegistry(row.permissions),
    };
  }
  return null;
}

export async function isCreatorAccountAuth(auth) {
  if (!auth?.uid) return false;
  if (String(auth.token?.panelRole || '').trim().toLowerCase() === 'mangaka') return true;
  const snap = await getDatabase().ref(`usuarios/${auth.uid}/role`).get();
  return String(snap.val() || '').trim().toLowerCase() === 'mangaka';
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
  if (ctx.super || ctx.legacy) return;
  if (ctx.permissions[field] === true) return;
  throw new HttpsError('permission-denied', 'Sem permissao para esta acao.');
}

export function requireSuperAdmin(auth) {
  if (!isSuperAdminAuth(auth)) {
    throw new HttpsError('permission-denied', 'Apenas admin chefe pode fazer isso.');
  }
}

export async function resolveTargetUidByEmail(email) {
  const norm = String(email || '').trim().toLowerCase();
  if (!norm) return null;
  try {
    const u = await getAuth().getUserByEmail(norm);
    return u.uid;
  } catch (e) {
    if (e?.code === 'auth/user-not-found') return null;
    throw e;
  }
}
