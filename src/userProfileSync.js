import { ref, get, set, update } from 'firebase/database';
import { getIdToken, reload } from 'firebase/auth';
import { db } from './services/firebase';
import { AVATAR_FALLBACK, isAdminUser } from './constants';

/** Atualiza claims/cache do Firebase Auth (e-mail verificado, etc.). */
export async function refreshAuthUser(user) {
  await reload(user);
  await getIdToken(user, true);
}

/**
 * Ficha completa de usuarios/ (campos exigidos pelas rules + modelo do produto).
 * status/role/accountType podem ser sobrescritos por admin ou fluxo de ativação.
 */
export function buildUsuarioRecord(uid, {
  userName = 'Guerreiro',
  userAvatar = AVATAR_FALLBACK,
  status = 'pendente',
  role = 'user',
  accountType = 'comum',
  agora = Date.now(),
} = {}) {
  return {
    uid,
    userName,
    userAvatar,
    role,
    accountType,
    gender: 'nao_informado',
    birthYear: null,
    status,
    notifyNewChapter: false,
    marketingOptIn: false,
    marketingOptInAt: null,
    membershipStatus: 'inativo',
    memberUntil: null,
    currentPlanId: null,
    lastPaymentAt: null,
    sourceAcquisition: 'organico',
    createdAt: agora,
    lastLogin: agora,
  };
}

/**
 * Só o que as regras RTDB permitem ao próprio usuário sem ser "admin" no banco.
 * Quem é administrador do site vem de constants (UID/e-mail), não de role/accountType aqui —
 * assim a ficha pode ter accountType comum/membro/premium e role user como todo mundo.
 */
function adminOverrides(usuario) {
  if (!isAdminUser(usuario)) return {};
  return {
    status: 'ativo',
  };
}

/**
 * Garante nó usuarios/{uid} + usuarios_publicos com todos os campos.
 * Recria ficha se o nó sumiu (ex.: apagado no console).
 */
/**
 * Coloca status em ativo respeitando as rules: primeira escrita em `status` só pode ser `pendente`;
 * só então `pendente` → `ativo`. Evita PERMISSION_DENIED e conta presa em pendente.
 */
export async function ativarContaUsuario(uid) {
  const userRef = ref(db, `usuarios/${uid}`);
  const statusSnap = await get(ref(db, `usuarios/${uid}/status`));
  const now = Date.now();

  if (!statusSnap.exists()) {
    await update(userRef, { status: 'pendente', lastLogin: now });
    await update(userRef, { status: 'ativo', lastLogin: Date.now() });
    return;
  }

  const s = statusSnap.val();
  if (s === 'ativo') {
    await update(userRef, { lastLogin: now });
    return;
  }
  if (s === 'pendente') {
    await update(userRef, { status: 'ativo', lastLogin: now });
    return;
  }
  if (s === 'banido') {
    throw new Error('Conta bloqueada.');
  }
  await update(userRef, { status: 'pendente', lastLogin: now });
  await update(userRef, { status: 'ativo', lastLogin: Date.now() });
}

export async function ensureUsuarioRecord(usuario, nome, fotoUrl, listaAvatares) {
  const userRef = ref(db, `usuarios/${usuario.uid}`);
  const snapshot = await get(userRef);
  const agora = Date.now();
  const avatar = fotoUrl || (listaAvatares && listaAvatares[0]) || AVATAR_FALLBACK;
  const adm = adminOverrides(usuario);

  const base = buildUsuarioRecord(usuario.uid, {
    userName: nome || 'Guerreiro',
    userAvatar: avatar,
    status: adm.status || 'pendente',
    role: adm.role || 'user',
    accountType: adm.accountType || 'comum',
    agora,
  });

  if (!snapshot.exists()) {
    const merged = { ...base, ...adm, lastLogin: agora };
    await set(userRef, merged);
    await set(ref(db, `usuarios_publicos/${usuario.uid}`), {
      uid: usuario.uid,
      userName: merged.userName,
      userAvatar: merged.userAvatar,
      accountType: merged.accountType,
      updatedAt: agora,
    });
    return merged;
  }

  const atual = snapshot.val() || {};
  const patch = { lastLogin: agora, ...adm };

  if (nome?.trim()) patch.userName = nome.trim();
  if (fotoUrl) patch.userAvatar = fotoUrl;

  const keys = Object.keys(base);
  for (const k of keys) {
    if (k === 'userName' || k === 'userAvatar') continue;
    if (atual[k] === undefined || atual[k] === null) {
      if (k === 'createdAt' && atual.createdAt) continue;
      patch[k] = base[k];
    }
  }
  if (!atual.uid) patch.uid = usuario.uid;
  if (!patch.userName && !atual.userName) patch.userName = base.userName;
  if (!patch.userAvatar && !atual.userAvatar) patch.userAvatar = avatar;
  if (typeof atual.notifyNewChapter !== 'boolean' && patch.notifyNewChapter === undefined) patch.notifyNewChapter = false;
  if (typeof atual.marketingOptIn !== 'boolean' && patch.marketingOptIn === undefined) patch.marketingOptIn = false;
  if (typeof atual.marketingOptInAt !== 'number' && atual.marketingOptInAt !== null && patch.marketingOptInAt === undefined) patch.marketingOptInAt = null;
  if (!atual.sourceAcquisition && !patch.sourceAcquisition) patch.sourceAcquisition = 'organico';

  await update(userRef, patch);

  const nomePub = patch.userName || atual.userName || base.userName;
  const avatarPub = patch.userAvatar || atual.userAvatar || avatar;
  const tipoPub = patch.accountType || atual.accountType || base.accountType;
  await set(ref(db, `usuarios_publicos/${usuario.uid}`), {
    uid: usuario.uid,
    userName: nomePub,
    userAvatar: avatarPub,
    accountType: tipoPub,
    updatedAt: agora,
  });

  return { ...atual, ...patch };
}
