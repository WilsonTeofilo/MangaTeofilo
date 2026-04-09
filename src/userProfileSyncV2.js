import { ref, get, set, update } from 'firebase/database';
import { getIdToken, reload } from 'firebase/auth';
import { db } from './services/firebase';
import { AVATAR_FALLBACK, DEFAULT_USER_DISPLAY_NAME } from './constants';
import {
  buildUsuarioBaseRecord,
  buildUsuarioMissingFieldsPatch,
  buildUsuarioPublicProfileRecord,
} from './config/userProfileSchema';

async function syncPublicProfileIdentity(uid, source = {}) {
  const publicProfile = buildUsuarioPublicProfileRecord(source, uid);
  await update(ref(db), {
    [`usuarios/${uid}/publicProfile/uid`]: publicProfile.uid || uid,
    [`usuarios/${uid}/publicProfile/userName`]: publicProfile.userName || DEFAULT_USER_DISPLAY_NAME,
    [`usuarios/${uid}/publicProfile/userHandle`]: publicProfile.userHandle || null,
    [`usuarios/${uid}/publicProfile/userAvatar`]: publicProfile.userAvatar || AVATAR_FALLBACK,
    [`usuarios/${uid}/publicProfile/accountType`]: publicProfile.accountType || 'comum',
    [`usuarios/${uid}/publicProfile/signupIntent`]: publicProfile.signupIntent || 'reader',
    [`usuarios/${uid}/publicProfile/status`]: publicProfile.status || '',
    [`usuarios/${uid}/publicProfile/updatedAt`]: Date.now(),
  });
}

export async function refreshAuthUser(user) {
  await reload(user);
  await getIdToken(user, true);
}

export async function ensureUsuarioRecord(usuario, nome, fotoUrl, listaAvatares, statusInicial = 'pendente') {
  const userRef = ref(db, `usuarios/${usuario.uid}`);
  const snapshot = await get(userRef);
  const agora = Date.now();
  const avatar = fotoUrl || (listaAvatares && listaAvatares[0]) || AVATAR_FALLBACK;
  const status = statusInicial;
  const email = String(usuario?.email || '').trim().toLowerCase();

  if (!snapshot.exists()) {
    const record = buildUsuarioBaseRecord({
      uid: usuario.uid,
      email,
      userName: nome || DEFAULT_USER_DISPLAY_NAME,
      userAvatar: avatar,
      status: 'pendente',
      now: agora,
    });
    await set(userRef, record);
    await syncPublicProfileIdentity(usuario.uid, record);
    if (status === 'ativo') {
      await update(ref(db), {
        [`usuarios/${usuario.uid}/status`]: 'ativo',
        [`usuarios/${usuario.uid}/lastLogin`]: agora,
      });
    }
    return { ...record, status };
  }

  const atual = snapshot.val() || {};
  const patch = buildUsuarioMissingFieldsPatch(atual, {
    uid: usuario.uid,
    email,
    userName: nome?.trim() || atual.userName || DEFAULT_USER_DISPLAY_NAME,
    userAvatar: fotoUrl || avatar,
    status,
    now: agora,
  });

  if (Object.keys(patch).length) {
    const rootPatch = {};
    for (const [key, value] of Object.entries(patch)) {
      rootPatch[`usuarios/${usuario.uid}/${key}`] = value;
    }
    await update(ref(db), rootPatch);
  }

  await syncPublicProfileIdentity(usuario.uid, { ...atual, ...patch });

  return { ...atual, ...patch };
}

export async function syncAuthenticatedUserProfile(usuario, listaAvatares = []) {
  if (!usuario?.uid) return null;
  const userRef = ref(db, `usuarios/${usuario.uid}`);
  const snapshot = await get(userRef);
  const atual = snapshot.exists() ? snapshot.val() || {} : {};
  const persistedAvatar = String(atual.userAvatar || '').trim();
  const persistedReaderAvatar = String(atual.readerProfileAvatarUrl || '').trim();
  const fallbackAvatar = usuario.photoURL || listaAvatares[0] || AVATAR_FALLBACK;
  /** Nunca preferir Auth sobre avatar já salvo no RTDB (ex.: preset da plataforma vs foto Google). */
  const fotoParaRegistro = persistedAvatar || persistedReaderAvatar || fallbackAvatar;
  const perfil = await ensureUsuarioRecord(
    usuario,
    usuario.displayName || DEFAULT_USER_DISPLAY_NAME,
    fotoParaRegistro,
    listaAvatares.length ? listaAvatares : [fallbackAvatar],
    'ativo'
  );
  return perfil;
}

export async function ativarContaUsuario(uid) {
  const statusRef = ref(db, `usuarios/${uid}/status`);
  const snap = await get(statusRef);
  const now = Date.now();

  if (!snap.exists()) {
    await update(ref(db), {
      [`usuarios/${uid}/status`]: 'pendente',
      [`usuarios/${uid}/lastLogin`]: now,
    });
    await update(ref(db), {
      [`usuarios/${uid}/status`]: 'ativo',
      [`usuarios/${uid}/lastLogin`]: now,
    });
    return;
  }

  const status = snap.val();
  if (status === 'ativo') {
    await update(ref(db), { [`usuarios/${uid}/lastLogin`]: now });
    return;
  }
  if (status === 'banido') {
    throw new Error('Conta bloqueada.');
  }
  if (status === 'pendente') {
    await update(ref(db), {
      [`usuarios/${uid}/status`]: 'ativo',
      [`usuarios/${uid}/lastLogin`]: now,
    });
    return;
  }

  await update(ref(db), {
    [`usuarios/${uid}/status`]: 'pendente',
    [`usuarios/${uid}/lastLogin`]: now,
  });
  await update(ref(db), {
    [`usuarios/${uid}/status`]: 'ativo',
    [`usuarios/${uid}/lastLogin`]: now,
  });
}
