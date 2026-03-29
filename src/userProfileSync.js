// src/userProfileSync.js
import { ref, get, set, update } from 'firebase/database';
import { getIdToken, reload } from 'firebase/auth';
import { db } from './services/firebase';
import { AVATAR_FALLBACK, isAdminUser } from './constants';
import {
  USUARIOS_DEPRECATED_KEYS,
  USUARIOS_PUBLICOS_DEPRECATED_KEYS,
} from './config/userDeprecatedFields';

export async function refreshAuthUser(user) {
  await reload(user);
  await getIdToken(user, true);
}

/**
 * Remove chaves obsoletas do nó do usuário (e do público, se listado).
 * Chamado após login; seguro se os arrays estiverem vazios (no-op).
 */
export async function cleanupDeprecatedUsuarioFields(uid) {
  const hasPriv =
    USUARIOS_DEPRECATED_KEYS.length > 0;
  const hasPub =
    USUARIOS_PUBLICOS_DEPRECATED_KEYS.length > 0;
  if (!uid || (!hasPriv && !hasPub)) return;

  if (hasPriv) {
    const userRef = ref(db, `usuarios/${uid}`);
    const snap = await get(userRef);
    if (snap.exists()) {
      const data = snap.val() || {};
      const patch = {};
      for (const key of USUARIOS_DEPRECATED_KEYS) {
        if (Object.prototype.hasOwnProperty.call(data, key)) patch[key] = null;
      }
      if (Object.keys(patch).length) await update(userRef, patch);
    }
  }

  if (hasPub) {
    const pubRef = ref(db, `usuarios_publicos/${uid}`);
    const pubSnap = await get(pubRef);
    if (pubSnap.exists()) {
      const pubData = pubSnap.val() || {};
      const pubPatch = {};
      for (const key of USUARIOS_PUBLICOS_DEPRECATED_KEYS) {
        if (Object.prototype.hasOwnProperty.call(pubData, key)) pubPatch[key] = null;
      }
      if (Object.keys(pubPatch).length) await update(pubRef, pubPatch);
    }
  }
}

async function sincronizarPublico(uid, userName, userAvatar, accountType) {
  await set(ref(db, `usuarios_publicos/${uid}`), {
    uid,
    userName:    userName    || 'Guerreiro',
    userAvatar:  userAvatar  || AVATAR_FALLBACK,
    accountType: accountType || 'comum',
    updatedAt:   Date.now(),
  });
}

/**
 * Garante nó usuarios/{uid} + usuarios_publicos.
 *
 * statusInicial:
 *   'pendente' → email/senha (precisa clicar no link)
 *   'ativo'    → Google OAuth (já prova email real) ou admin
 *
 * NUNCA sobrescreve status se o nó já existe com status definido.
 * Use ativarContaUsuario() para mudar pendente → ativo.
 */
export async function ensureUsuarioRecord(usuario, nome, fotoUrl, listaAvatares, statusInicial = 'pendente') {
  const userRef  = ref(db, `usuarios/${usuario.uid}`);
  const snapshot = await get(userRef);
  const agora    = Date.now();
  const avatar   = fotoUrl || (listaAvatares && listaAvatares[0]) || AVATAR_FALLBACK;
  const status   = isAdminUser(usuario) ? 'ativo' : statusInicial;

  if (!snapshot.exists()) {
    // Nó não existe — cria completo
    // Para status 'ativo' direto (Google/admin): as rules permitem
    // primeira escrita como 'pendente', então precisamos de dois passos
    // se o status final for 'ativo'.
    const record = {
      uid:               usuario.uid,
      userName:          nome || 'Guerreiro',
      userAvatar:        avatar,
      role:              'user',
      accountType:       'comum',
      gender:            'nao_informado',
      birthYear:         null,
      status:            'pendente', // sempre começa pendente (regra do RTDB)
      notifyNewChapter:  false,
      marketingOptIn:    false,
      marketingOptInAt:  null,
      membershipStatus:  'inativo',
      memberUntil:       null,
      currentPlanId:     null,
      lastPaymentAt:     null,
      sourceAcquisition: 'organico',
      createdAt:         agora,
      lastLogin:         agora,
    };
    await set(userRef, record);
    await sincronizarPublico(usuario.uid, record.userName, record.userAvatar, record.accountType);

    // Se o status final deve ser 'ativo' (Google/admin), faz a transição agora
    if (status === 'ativo') {
      await update(userRef, { status: 'ativo', lastLogin: agora });
    }
    return { ...record, status };
  }

  // Nó já existe — patch só dos campos faltantes + lastLogin
  // NUNCA sobrescreve status aqui
  const atual = snapshot.val() || {};
  const patch  = { lastLogin: agora };

  if (nome?.trim())  patch.userName   = nome.trim();
  if (fotoUrl)       patch.userAvatar = fotoUrl;

  if (!atual.uid)                   patch.uid                = usuario.uid;
  if (!atual.role)                  patch.role               = 'user';
  if (!atual.accountType)           patch.accountType        = 'comum';
  if (!atual.gender)                patch.gender             = 'nao_informado';
  if (!atual.sourceAcquisition)     patch.sourceAcquisition  = 'organico';
  if (!atual.membershipStatus)      patch.membershipStatus   = 'inativo';
  if (!atual.createdAt)             patch.createdAt          = agora;
  if (typeof atual.birthYear !== 'number' && atual.birthYear !== null) patch.birthYear = null;
  if (typeof atual.notifyNewChapter !== 'boolean') patch.notifyNewChapter = false;
  if (typeof atual.marketingOptIn   !== 'boolean') patch.marketingOptIn   = false;
  if (typeof atual.marketingOptInAt !== 'number'  && atual.marketingOptInAt !== null) patch.marketingOptInAt = null;
  if (typeof atual.memberUntil      !== 'number'  && atual.memberUntil      !== null) patch.memberUntil      = null;
  if (typeof atual.currentPlanId    !== 'string'  && atual.currentPlanId    !== null) patch.currentPlanId    = null;
  if (typeof atual.lastPaymentAt    !== 'number'  && atual.lastPaymentAt    !== null) patch.lastPaymentAt    = null;

  await update(userRef, patch);

  const nomePub    = patch.userName    || atual.userName    || 'Guerreiro';
  const avatarPub  = patch.userAvatar  || atual.userAvatar  || avatar;
  const accountPub = patch.accountType || atual.accountType || 'comum';
  await sincronizarPublico(usuario.uid, nomePub, avatarPub, accountPub);

  return { ...atual, ...patch };
}

/**
 * Ativa conta: qualquer status → ativo.
 * Respeita as rules do RTDB que só permitem pendente → ativo pelo próprio usuário.
 * Se já for ativo, só atualiza lastLogin.
 */
export async function ativarContaUsuario(uid) {
  const userRef   = ref(db, `usuarios/${uid}`);
  const statusRef = ref(db, `usuarios/${uid}/status`);
  const snap      = await get(statusRef);
  const now       = Date.now();

  if (!snap.exists()) {
    // Sem nó de status: garante pendente primeiro, depois ativo
    await update(userRef, { status: 'pendente', lastLogin: now });
    await update(userRef, { status: 'ativo',    lastLogin: now });
    return;
  }

  const s = snap.val();
  if (s === 'ativo')    { await update(userRef, { lastLogin: now }); return; }
  if (s === 'banido')   { throw new Error('Conta bloqueada.'); }
  if (s === 'pendente') { await update(userRef, { status: 'ativo', lastLogin: now }); return; }

  // inativo ou desconhecido: dois passos (rules exigem pendente antes de ativo)
  await update(userRef, { status: 'pendente', lastLogin: now });
  await update(userRef, { status: 'ativo',    lastLogin: now });
}