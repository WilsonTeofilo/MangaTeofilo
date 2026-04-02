import { ref, get, set, update } from 'firebase/database';
import { getIdToken, reload } from 'firebase/auth';
import { db } from './services/firebase';
import { AVATAR_FALLBACK, isAdminUser } from './constants';
import {
  USUARIOS_DEPRECATED_KEYS,
  USUARIOS_PUBLICOS_DEPRECATED_KEYS,
} from './config/userDeprecatedFields';
import {
  buildUsuarioBaseRecord,
  buildUsuarioMissingFieldsPatch,
  buildUsuarioPublicoPatch,
} from './config/userProfileSchema';

export async function refreshAuthUser(user) {
  await reload(user);
  await getIdToken(user, true);
}

export async function cleanupDeprecatedUsuarioFields(uid) {
  const hasPriv = USUARIOS_DEPRECATED_KEYS.length > 0;
  const hasPub = USUARIOS_PUBLICOS_DEPRECATED_KEYS.length > 0;
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

async function sincronizarPublico(uid, userName, userAvatar, accountType, signupIntent = 'reader') {
  const publicoRef = ref(db, `usuarios_publicos/${uid}`);
  const publicoSnap = await get(publicoRef);
  const patch = buildUsuarioPublicoPatch(publicoSnap.exists() ? publicoSnap.val() || {} : {}, {
    uid,
    userName,
    userAvatar,
    accountType,
    signupIntent,
    now: Date.now(),
  });
  if (Object.keys(patch).length) {
    await update(publicoRef, patch);
  }
}

export async function ensureUsuarioRecord(usuario, nome, fotoUrl, listaAvatares, statusInicial = 'pendente') {
  const userRef = ref(db, `usuarios/${usuario.uid}`);
  const snapshot = await get(userRef);
  const agora = Date.now();
  const avatar = fotoUrl || (listaAvatares && listaAvatares[0]) || AVATAR_FALLBACK;
  const status = isAdminUser(usuario) ? 'ativo' : statusInicial;
  const email = String(usuario?.email || '').trim().toLowerCase();

  if (!snapshot.exists()) {
    const record = buildUsuarioBaseRecord({
      uid: usuario.uid,
      email,
      userName: nome || 'Guerreiro',
      userAvatar: avatar,
      status: 'pendente',
      now: agora,
    });
    await set(userRef, record);
    await sincronizarPublico(
      usuario.uid,
      record.userName,
      record.userAvatar,
      record.accountType,
      record.signupIntent
    );

    if (status === 'ativo') {
      await update(userRef, { status: 'ativo', lastLogin: agora });
    }
    return { ...record, status };
  }

  const atual = snapshot.val() || {};
  const patch = buildUsuarioMissingFieldsPatch(atual, {
    uid: usuario.uid,
    email,
    userName: nome?.trim() || atual.userName || 'Guerreiro',
    userAvatar: fotoUrl || avatar,
    status,
    now: agora,
  });

  await update(userRef, patch);

  const nomePub = patch.userName || atual.userName || 'Guerreiro';
  const avatarPub = patch.userAvatar || atual.userAvatar || avatar;
  const accountPub = patch.accountType || atual.accountType || 'comum';
  const signupIntentPub = patch.signupIntent || atual.signupIntent || 'reader';
  await sincronizarPublico(usuario.uid, nomePub, avatarPub, accountPub, signupIntentPub);

  return { ...atual, ...patch };
}

export async function syncAuthenticatedUserProfile(usuario, listaAvatares = []) {
  if (!usuario?.uid) return null;
  const fallbackAvatar = usuario.photoURL || listaAvatares[0] || AVATAR_FALLBACK;
  const perfil = await ensureUsuarioRecord(
    usuario,
    usuario.displayName || 'Guerreiro',
    fallbackAvatar,
    listaAvatares.length ? listaAvatares : [fallbackAvatar],
    'ativo'
  );
  await cleanupDeprecatedUsuarioFields(usuario.uid);
  return perfil;
}

export async function ativarContaUsuario(uid) {
  const userRef = ref(db, `usuarios/${uid}`);
  const statusRef = ref(db, `usuarios/${uid}/status`);
  const snap = await get(statusRef);
  const now = Date.now();

  if (!snap.exists()) {
    await update(userRef, { status: 'pendente', lastLogin: now });
    await update(userRef, { status: 'ativo', lastLogin: now });
    return;
  }

  const status = snap.val();
  if (status === 'ativo') {
    await update(userRef, { lastLogin: now });
    return;
  }
  if (status === 'banido') {
    throw new Error('Conta bloqueada.');
  }
  if (status === 'pendente') {
    await update(userRef, { status: 'ativo', lastLogin: now });
    return;
  }

  await update(userRef, { status: 'pendente', lastLogin: now });
  await update(userRef, { status: 'ativo', lastLogin: now });
}
