// src/pages/Auth/Login.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  applyActionCode,
  checkActionCode,
  onAuthStateChanged,
  ActionCodeOperation,
} from 'firebase/auth';
import { ref, get, onValue } from 'firebase/database';
import { auth, db, googleProvider } from '../../services/firebase';
import { LISTA_AVATARES, AVATAR_FALLBACK, isAdminUser } from '../../constants';
import { ensureUsuarioRecord, refreshAuthUser, ativarContaUsuario } from '../../userProfileSync';
import './Login.css';

const PENDING_METHOD_KEY = 'login_pending_method';
const PENDING_EMAIL_KEY  = 'login_pending_email';
/** UID da conta Google em ativação (fallback se a flag por e-mail não bater). */
const PENDING_GOOGLE_UID_KEY = 'login_pending_google_uid';
const RESEND_KEY         = 'login_resend_verification_until';
const FORGOT_KEY         = 'login_forgot_password_until';
/** Só libera ativação Google após applyActionCode do link do Firebase (não basta emailVerified do Google). */
const VERIFY_LINK_OK_KEY = 'shito_firebase_verify_link_ok';

const MSG_VERIFY_GOOGLE_BLOCK =
  'Não foi possível prosseguir. Verifique sua caixa de spam ou lixeira, abra o link que enviamos para ativar sua conta e volte aqui. Use "Já verifiquei (Google)" com a mesma conta.';

const MSG_GOOGLE_CONTA_ERRADA = (esperado, recebido) =>
  `Você entrou com outra conta Google (${recebidoShort(recebido)}). Esta ativação é para ${esperado}. Toque em "Reenviar e-mail" para mandar outro link para o e-mail certo.`;

function recebidoShort(email) {
  return (email || '').trim() || 'outra conta';
}

function verifyLinkStorageKey(email) {
  const em = (email || '').trim().toLowerCase();
  return em ? `shito_verify_link_${em}` : '';
}

function setVerifyLinkOk(email, uidOptional) {
  sessionStorage.setItem(VERIFY_LINK_OK_KEY, '1');
  const k = verifyLinkStorageKey(email);
  if (k) localStorage.setItem(k, '1');
  if (uidOptional) {
    localStorage.setItem(`shito_verify_uid_${uidOptional}`, '1');
  }
}

/** Domínio da URL deve estar em Authentication → Authorized domains no Console. */
function getEmailVerificationActionSettings() {
  return {
    url: `${window.location.origin}/login`,
    handleCodeInApp: true,
  };
}

/** Firebase pode mandar mode/oob na query ou no hash (ex.: #/login?mode=...). */
function parseAuthEmailLinkParams() {
  const search = new URLSearchParams(window.location.search);
  let mode = search.get('mode');
  let oobCode = search.get('oobCode');
  if (oobCode && mode) return { mode, oobCode };

  const hash = window.location.hash || '';
  if (hash) {
    const q = hash.indexOf('?');
    const raw = q >= 0 ? hash.slice(q + 1) : hash.replace(/^#/, '');
    const hp = new URLSearchParams(raw);
    mode = mode || hp.get('mode');
    oobCode = oobCode || hp.get('oobCode');
  }
  return { mode, oobCode };
}

function clearVerifyLinkFlags(emailOptional, uidOptional) {
  sessionStorage.removeItem(VERIFY_LINK_OK_KEY);
  const k = verifyLinkStorageKey(emailOptional);
  if (k) localStorage.removeItem(k);
  const uid = uidOptional || sessionStorage.getItem(PENDING_GOOGLE_UID_KEY);
  if (uid) localStorage.removeItem(`shito_verify_uid_${uid}`);
}

/** Aceita flag na sessão, por e-mail, ou por UID Google (link aplicado no mesmo aparelho). */
function hasVerifyLinkOk(email, googleUidOptional) {
  if (sessionStorage.getItem(VERIFY_LINK_OK_KEY) === '1') return true;
  const k = verifyLinkStorageKey(email);
  if (k && localStorage.getItem(k) === '1') return true;
  const uid = googleUidOptional || sessionStorage.getItem(PENDING_GOOGLE_UID_KEY);
  if (uid && localStorage.getItem(`shito_verify_uid_${uid}`) === '1') return true;
  return false;
}

/** Copia qualquer flag `shito_verify_link_*` do localStorage para a sessão antes de validar. */
function syncVerifyLinkFromStorage(expectedEmail, googleUidOptional) {
  if (sessionStorage.getItem(VERIFY_LINK_OK_KEY) === '1') return;
  const uid = googleUidOptional || sessionStorage.getItem(PENDING_GOOGLE_UID_KEY);
  if (uid && localStorage.getItem(`shito_verify_uid_${uid}`) === '1') {
    sessionStorage.setItem(VERIFY_LINK_OK_KEY, '1');
    return;
  }
  const tryEmail = (expectedEmail || sessionStorage.getItem(PENDING_EMAIL_KEY) || '').trim();
  if (tryEmail) {
    const k = verifyLinkStorageKey(tryEmail);
    if (k && localStorage.getItem(k) === '1') {
      sessionStorage.setItem(VERIFY_LINK_OK_KEY, '1');
      return;
    }
  }
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith('shito_verify_link_') && localStorage.getItem(key) === '1') {
      sessionStorage.setItem(VERIFY_LINK_OK_KEY, '1');
      break;
    }
  }
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith('shito_verify_uid_') && localStorage.getItem(key) === '1') {
      sessionStorage.setItem(VERIFY_LINK_OK_KEY, '1');
      break;
    }
  }
}

const ATTEMPT_LIMITS_KEY = 'login_attempt_limits_v1';
const ATTEMPT_RULES = {
  login:    { max: 12, windowMs: 10 * 60 * 1000, blockMs: 10 * 60 * 1000 },
  register: { max: 5, windowMs: 60 * 60 * 1000, blockMs: 45 * 60 * 1000 },
};

function emailsIguais(a, b) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

/** Conta Google criada agora (não confundir com “sem nó no RTDB” por recovery). */
function isContaGoogleNovaProvavel(user) {
  if (!user?.metadata?.creationTime || !user?.metadata?.lastSignInTime) return true;
  const c = new Date(user.metadata.creationTime).getTime();
  const l = new Date(user.metadata.lastSignInTime).getTime();
  return Number.isFinite(c) && Number.isFinite(l) && Math.abs(l - c) < 3 * 60 * 1000;
}

/** Força reload real da SPA: `replace('/login')` na mesma URL às vezes não remonta o React. */
function irParaLoginAtivarConta() {
  const u = new URL(`${window.location.origin}/login`);
  u.searchParams.set('ativar', '1');
  u.searchParams.set('t', String(Date.now()));
  window.location.replace(u.toString());
}

/** Evita corrida: App lê perfil no RTDB antes de liberar a rota /. */
function delayNavigateHome(navigate, ms = 120) {
  return new Promise((resolve) => {
    setTimeout(() => {
      navigate('/', { replace: true });
      resolve();
    }, ms);
  });
}

// Avisa o App.jsx que o sessionStorage mudou — ele escuta esse evento
// para atualizar o estado `temPending` de forma reativa.
function notificarPendingChanged() {
  window.dispatchEvent(new Event('pendingVerificationChanged'));
}

/** Limpa pendência em session + flags de link (sem setState; uso pós-link ou ativação automática). */
function clearPendingVerificationSession(emailOptional, uidOptional) {
  sessionStorage.removeItem(PENDING_METHOD_KEY);
  sessionStorage.removeItem(PENDING_EMAIL_KEY);
  sessionStorage.removeItem(PENDING_GOOGLE_UID_KEY);
  clearVerifyLinkFlags(emailOptional || '', uidOptional);
  notificarPendingChanged();
}

export default function Login() {
  const navigate = useNavigate();

  const [displayName,     setDisplayName]     = useState('');
  const [email,           setEmail]           = useState(() => sessionStorage.getItem(PENDING_EMAIL_KEY) || '');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRegistering,   setIsRegistering]   = useState(false);
  const [error,           setError]           = useState('');
  const [info,            setInfo]            = useState('');
  const [loading,         setLoading]         = useState(false);

  // 'idle' | 'pending_email' | 'pending_google'
  const [verificationState,     setVerificationState]     = useState(() => {
    const method = sessionStorage.getItem(PENDING_METHOD_KEY);
    if (!method) return 'idle';
    return method === 'google' ? 'pending_google' : 'pending_email';
  });
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [pendingEmailDisplay,   setPendingEmailDisplay]   = useState(() => sessionStorage.getItem(PENDING_EMAIL_KEY) || '');

  const [resendCooldown,  setResendCooldown]  = useState(0);
  const [forgotCooldown,  setForgotCooldown]  = useState(0);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [listaAvatares,   setListaAvatares]   = useState(LISTA_AVATARES);
  const [selectedAvatar,  setSelectedAvatar]  = useState(LISTA_AVATARES[0] || AVATAR_FALLBACK);

  const isNewAccountRef = useRef(false);

  const hasUpper   = /[A-Z]/.test(password);
  const hasNumber  = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasLength  = password.length >= 8;

  // ── Cooldowns ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const now = Date.now();
    const ru  = Number(sessionStorage.getItem(RESEND_KEY) || 0);
    const fu  = Number(sessionStorage.getItem(FORGOT_KEY) || 0);
    if (ru > now) setResendCooldown(Math.ceil((ru - now) / 1000));
    else sessionStorage.removeItem(RESEND_KEY);
    if (fu > now) setForgotCooldown(Math.ceil((fu - now) / 1000));
    else sessionStorage.removeItem(FORGOT_KEY);
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((p) => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  useEffect(() => {
    if (forgotCooldown <= 0) return;
    const t = setInterval(() => setForgotCooldown((p) => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, [forgotCooldown]);

  useEffect(() => { if (resendCooldown === 0) sessionStorage.removeItem(RESEND_KEY); }, [resendCooldown]);
  useEffect(() => { if (forgotCooldown === 0) sessionStorage.removeItem(FORGOT_KEY); }, [forgotCooldown]);

  // ── Link do e-mail Firebase (oobCode) → e-mail via checkActionCode (funciona sem sessão) ─
  useEffect(() => {
    const { mode, oobCode } = parseAuthEmailLinkParams();
    if (!oobCode || mode !== 'verifyEmail') return undefined;
    let cancelled = false;

    (async () => {
      try {
        const info = await checkActionCode(auth, oobCode);
        if (cancelled) return;
        if (info.operation !== ActionCodeOperation.VERIFY_EMAIL) {
          setError('Este link não é de verificação de e-mail.');
          return;
        }
        const emailFromCode = (info.data?.email || '').trim();

        await applyActionCode(auth, oobCode);
        if (cancelled) return;

        if (auth.currentUser) await refreshAuthUser(auth.currentUser);

        const uid = auth.currentUser?.uid || null;
        const em =
          emailFromCode ||
          auth.currentUser?.email?.trim() ||
          sessionStorage.getItem(PENDING_EMAIL_KEY) ||
          '';
        setVerifyLinkOk(em, uid);

        if (auth.currentUser) {
          const u = auth.currentUser;
          const av = LISTA_AVATARES[0] || AVATAR_FALLBACK;
          const isGoogle = u.providerData?.some((p) => p.providerId === 'google.com');
          await updateProfile(u, {
            photoURL: isGoogle ? av : (u.photoURL || av),
            displayName: u.displayName || 'Guerreiro',
          });
          await refreshAuthUser(u);
          await ensureUsuarioRecord(
            u,
            u.displayName || 'Guerreiro',
            isGoogle ? av : (u.photoURL || av),
            LISTA_AVATARES
          );
          await ativarContaUsuario(u.uid);
          clearPendingVerificationSession(em, uid);
          window.history.replaceState({}, '', '/login');
          setInfo('Conta ativada! Entrando...');
          window.location.replace(`${window.location.origin}/`);
          return;
        }

        window.history.replaceState({}, '', '/login');
        setInfo(
          'E-mail confirmado. Use "CONECTAR COM GOOGLE" de novo com a mesma conta — a conta será ativada e você entra direto.'
        );
        notificarPendingChanged();
      } catch (e) {
        if (cancelled) return;
        const code = e?.code;
        const msg =
          code === 'auth/invalid-action-code' || code === 'auth/expired-action-code'
            ? 'Link expirado ou já usado. Use "Reenviar e-mail" e abra o novo link.'
            : e?.message || 'Não foi possível confirmar o link.';
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Outra aba gravou confirmação no localStorage → sincroniza esta aba
  useEffect(() => {
    const onStorage = (e) => {
      if (e.newValue !== '1') return;
      const k = e.key || '';
      if (!k.startsWith('shito_verify_link_') && !k.startsWith('shito_verify_uid_')) return;
      sessionStorage.setItem(VERIFY_LINK_OK_KEY, '1');
      setInfo((prev) => prev || 'Confirmação encontrada neste navegador. Use "Já verifiquei".');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Após signOut (ex.: fluxo Google pendente), o React às vezes não mostra ATIVAR — alinha com sessionStorage
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) return;
      const method = sessionStorage.getItem(PENDING_METHOD_KEY);
      if (!method) return;
      const em = sessionStorage.getItem(PENDING_EMAIL_KEY) || '';
      setPendingEmailDisplay(em);
      setEmail(em);
      setVerificationState(method === 'google' ? 'pending_google' : 'pending_email');
      setInfo((prev) =>
        prev ||
        (method === 'google'
          ? 'Conta pendente. Abra o link no e-mail e depois use "Já verifiquei (Google)".'
          : 'Conta pendente. Verifique seu e-mail e use "Já verifiquei meu e-mail".')
      );
    });
    return () => unsub();
  }, []);

  // Volta do app de e-mail / outra aba no mesmo navegador: copia flag do localStorage
  useEffect(() => {
    const syncVerify = () => {
      const pendEm = sessionStorage.getItem(PENDING_EMAIL_KEY);
      if (sessionStorage.getItem(VERIFY_LINK_OK_KEY) === '1') return;
      if (pendEm) {
        const k = verifyLinkStorageKey(pendEm);
        if (k && localStorage.getItem(k) === '1') {
          sessionStorage.setItem(VERIFY_LINK_OK_KEY, '1');
          setInfo((prev) => prev || 'Confirmação encontrada. Use "Já verifiquei".');
          return;
        }
      }
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith('shito_verify_link_') && localStorage.getItem(key) === '1') {
          sessionStorage.setItem(VERIFY_LINK_OK_KEY, '1');
          setInfo((prev) => prev || 'Link de e-mail confirmado neste aparelho. Use "Já verifiquei".');
          break;
        }
      }
    };
    syncVerify();
    window.addEventListener('focus', syncVerify);
    document.addEventListener('visibilitychange', syncVerify);
    return () => {
      window.removeEventListener('focus', syncVerify);
      document.removeEventListener('visibilitychange', syncVerify);
    };
  }, []);

  // Volta do redirect pós-Google (?ativar=1 força reload; alinha estado com sessionStorage)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('ativar')) return;
    const method = sessionStorage.getItem(PENDING_METHOD_KEY);
    if (method) {
      const em = sessionStorage.getItem(PENDING_EMAIL_KEY) || '';
      setPendingEmailDisplay(em);
      setEmail(em);
      setVerificationState(method === 'google' ? 'pending_google' : 'pending_email');
    }
    window.history.replaceState({}, '', '/login');
  }, []);

  // ── Retoma verificação pendente (ex.: outra aba alterou sessionStorage) ─────
  useEffect(() => {
    const method = sessionStorage.getItem(PENDING_METHOD_KEY);
    const em     = sessionStorage.getItem(PENDING_EMAIL_KEY);
    if (!method) return;
    setPendingEmailDisplay(em || '');
    setEmail(em || '');
    setVerificationState(method === 'google' ? 'pending_google' : 'pending_email');
    setInfo(
      method === 'google'
        ? 'Conta pendente. Abra o link no e-mail e depois use "Já verifiquei (Google)".'
        : 'Conta pendente. Verifique seu e-mail e clique em "Já verifiquei meu e-mail".'
    );
  }, []);

  // ── Avatares dinâmicos ────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onValue(ref(db, 'avatares'), (snap) => {
      if (!snap.exists()) return;
      const data = Object.values(snap.val() || {})
        .filter((i) => i?.active !== false && typeof i?.url === 'string')
        .sort((a, b) => {
          const aO = typeof a?.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
          const bO = typeof b?.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
          return aO !== bO ? aO - bO : (b?.createdAt || 0) - (a?.createdAt || 0);
        })
        .map((i) => i.url);
      if (data.length > 0) {
        setListaAvatares(data);
        setSelectedAvatar((prev) => (data.includes(prev) ? prev : data[0]));
      }
    });
    return () => unsub();
  }, []);

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const getAttemptState = (action) => {
    const now    = Date.now();
    const parsed = JSON.parse(localStorage.getItem(ATTEMPT_LIMITS_KEY) || '{}');
    const entry  = parsed[action] || { count: 0, windowStart: now, blockedUntil: 0 };
    if (entry.blockedUntil && entry.blockedUntil > now)
      return { blocked: true, retryInSec: Math.ceil((entry.blockedUntil - now) / 1000) };
    if (!entry.windowStart || now - entry.windowStart > ATTEMPT_RULES[action].windowMs)
      return { blocked: false };
    return { blocked: false };
  };

  const registerAttemptResult = (action, success) => {
    const now    = Date.now();
    const parsed = JSON.parse(localStorage.getItem(ATTEMPT_LIMITS_KEY) || '{}');
    const entry  = { ...(parsed[action] || { count: 0, windowStart: now, blockedUntil: 0 }) };
    if (success) {
      entry.count = 0; entry.windowStart = now; entry.blockedUntil = 0;
    } else {
      if (!entry.windowStart || now - entry.windowStart > ATTEMPT_RULES[action].windowMs) {
        entry.count = 0; entry.windowStart = now; entry.blockedUntil = 0;
      }
      entry.count += 1;
      if (entry.count >= ATTEMPT_RULES[action].max)
        entry.blockedUntil = now + ATTEMPT_RULES[action].blockMs;
    }
    parsed[action] = entry;
    localStorage.setItem(ATTEMPT_LIMITS_KEY, JSON.stringify(parsed));
  };

  /** null = nó inexistente (ex.: apagado no console). */
  const carregarStatusConta = async (uid) => {
    const snap = await get(ref(db, `usuarios/${uid}`));
    if (!snap.exists()) return null;
    return snap.val()?.status ?? 'pendente';
  };

  // Recria ficha se Auth existe mas RTDB foi apagado (recuperação).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = auth.currentUser;
      if (!u || sessionStorage.getItem(PENDING_METHOD_KEY)) return;
      const snap = await get(ref(db, `usuarios/${u.uid}`));
      if (cancelled || snap.exists()) return;
      const av = listaAvatares[0] || AVATAR_FALLBACK;
      try {
        await refreshAuthUser(u);
        await ensureUsuarioRecord(u, u.displayName || 'Guerreiro', u.photoURL || av, listaAvatares);
        const isGoogle = u.providerData?.some((p) => p.providerId === 'google.com');
        if (u.emailVerified && !isGoogle) await ativarContaUsuario(u.uid);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listaAvatares]);

  // ── Helpers de verificação ────────────────────────────────────────────────
  const iniciarFluxoVerificacao = (method, emailAddr, googleUid = null) => {
    const prevEm = sessionStorage.getItem(PENDING_EMAIL_KEY);
    const prevUid = sessionStorage.getItem(PENDING_GOOGLE_UID_KEY);
    if (prevEm) clearVerifyLinkFlags(prevEm, prevUid);
    sessionStorage.removeItem(PENDING_GOOGLE_UID_KEY);
    clearVerifyLinkFlags(emailAddr);
    sessionStorage.setItem(PENDING_METHOD_KEY, method);
    sessionStorage.setItem(PENDING_EMAIL_KEY, emailAddr);
    if (method === 'google' && googleUid) {
      sessionStorage.setItem(PENDING_GOOGLE_UID_KEY, googleUid);
    }
    notificarPendingChanged(); // ← avisa o App para re-renderizar
    setPendingEmailDisplay(emailAddr);
    setEmail(emailAddr);
    setVerificationState(method === 'google' ? 'pending_google' : 'pending_email');
    setShowVerificationModal(false);
  };

  const limparFluxoVerificacao = () => {
    const em = sessionStorage.getItem(PENDING_EMAIL_KEY);
    const uid = sessionStorage.getItem(PENDING_GOOGLE_UID_KEY);
    sessionStorage.removeItem(PENDING_METHOD_KEY);
    sessionStorage.removeItem(PENDING_EMAIL_KEY);
    sessionStorage.removeItem(PENDING_GOOGLE_UID_KEY);
    clearVerifyLinkFlags(em || '', uid);
    notificarPendingChanged(); // ← avisa o App para re-renderizar
    setVerificationState('idle');
    setPendingEmailDisplay('');
    setShowVerificationModal(false);
  };

  // ── LOGIN COM GOOGLE ──────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    setInfo('');
    isNewAccountRef.current = false;
    let skipLoadingReset = false;
    const av = listaAvatares[0] || AVATAR_FALLBACK;
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const googleUser = result.user;
      await updateProfile(googleUser, {
        photoURL: av,
        displayName: googleUser.displayName || 'Guerreiro',
      });
      await refreshAuthUser(googleUser);

      if (isAdminUser(googleUser)) {
        await ensureUsuarioRecord(googleUser, googleUser.displayName || 'Guerreiro', av, listaAvatares);
        await ativarContaUsuario(googleUser.uid);
        await delayNavigateHome(navigate);
        return;
      }

      const statusAtual = await carregarStatusConta(googleUser.uid);

      if (statusAtual === 'banido') {
        await signOut(auth);
        setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
        return;
      }

      if (statusAtual === 'ativo') {
        await ensureUsuarioRecord(googleUser, googleUser.displayName || 'Guerreiro', av, listaAvatares);
        await delayNavigateHome(navigate);
        return;
      }

      // Link do e-mail Firebase já foi clicado neste aparelho → ativa RTDB e entra (sem novo e-mail / loop)
      syncVerifyLinkFromStorage(googleUser.email || '', googleUser.uid);
      if (
        (statusAtual === 'pendente' || statusAtual === null) &&
        hasVerifyLinkOk(googleUser.email || '', googleUser.uid)
      ) {
        await ensureUsuarioRecord(googleUser, googleUser.displayName || 'Guerreiro', av, listaAvatares);
        await ativarContaUsuario(googleUser.uid);
        limparFluxoVerificacao();
        setInfo('Conta ativa! Bem-vindo à Tempestade.');
        await delayNavigateHome(navigate);
        return;
      }

      // Ficha apagada no RTDB mas Auth existe: recuperação (não é conta acabada de criar no Google)
      if (
        statusAtual === null &&
        googleUser.emailVerified &&
        !isContaGoogleNovaProvavel(googleUser)
      ) {
        await ensureUsuarioRecord(googleUser, googleUser.displayName || 'Guerreiro', av, listaAvatares);
        await ativarContaUsuario(googleUser.uid);
        await delayNavigateHome(navigate);
        return;
      }

      // Pendente ou primeira vez: link do Firebase obrigatório (conta nova Google cai aqui, não no atalho acima)
      await ensureUsuarioRecord(googleUser, googleUser.displayName || 'Guerreiro', av, listaAvatares);
      await sendEmailVerification(googleUser, getEmailVerificationActionSettings());
      iniciarFluxoVerificacao('google', googleUser.email || '', googleUser.uid);
      await signOut(auth);
      skipLoadingReset = true;
      irParaLoginAtivarConta();
      return;
    } catch (err) {
      const msgs = {
        'auth/popup-closed-by-user': 'Popup fechado. Você continua na tela de login.',
        'auth/account-exists-with-different-credential':
          'Essa conta já existe com outro método de login.',
      };
      setError(msgs[err.code] || `Falha ao conectar com Google: ${err.message}`);
    } finally {
      if (!skipLoadingReset) setLoading(false);
    }
  };

  // ── LOGIN / CADASTRO COM EMAIL + SENHA ───────────────────────────────────
  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    const action       = isRegistering ? 'register' : 'login';
    const attemptState = getAttemptState(action);
    if (attemptState.blocked) {
      setError(`Muitas tentativas. Tente novamente em ${attemptState.retryInSec}s.`);
      setLoading(false);
      return;
    }

    if (isRegistering) {
      if (!displayName.trim())                                  { setError('Escolha um nome para sua alma.');      setLoading(false); return; }
      if (password !== confirmPassword)                         { setError('As senhas não coincidem.');            setLoading(false); return; }
      if (!hasUpper || !hasNumber || !hasSpecial || !hasLength) { setError('A senha não atende aos requisitos.'); setLoading(false); return; }
    }

    try {
      if (isRegistering) {
        // ── CADASTRO ──────────────────────────────────────────────────────
        isNewAccountRef.current = true;
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: displayName.trim(), photoURL: selectedAvatar });
        await ensureUsuarioRecord(cred.user, displayName.trim(), selectedAvatar, listaAvatares);
        await sendEmailVerification(cred.user, getEmailVerificationActionSettings());
        await signOut(auth);

        setIsRegistering(false);
        iniciarFluxoVerificacao('email', email.trim());
        registerAttemptResult('register', true);
        irParaLoginAtivarConta();
        return;

      } else {
        // ── LOGIN ─────────────────────────────────────────────────────────
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await refreshAuthUser(cred.user);

        const av = listaAvatares[0] || AVATAR_FALLBACK;

        if (isAdminUser(cred.user)) {
          const foto = cred.user.photoURL || av;
          await updateProfile(cred.user, { photoURL: foto });
          await ensureUsuarioRecord(cred.user, cred.user.displayName || 'Guerreiro', foto, listaAvatares);
          registerAttemptResult('login', true);
          await delayNavigateHome(navigate);
          return;
        }

        const statusConta = await carregarStatusConta(cred.user.uid);

        if (statusConta === 'banido') {
          await signOut(auth);
          setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
          return;
        }

        if (!cred.user.emailVerified) {
          await sendEmailVerification(cred.user, getEmailVerificationActionSettings());
          await signOut(auth);
          iniciarFluxoVerificacao('email', email.trim());
          irParaLoginAtivarConta();
          return;
        }

        const foto = cred.user.photoURL || av;

        if (statusConta === null) {
          await ensureUsuarioRecord(cred.user, cred.user.displayName || 'Guerreiro', foto, listaAvatares);
          await ativarContaUsuario(cred.user.uid);
          registerAttemptResult('login', true);
          await delayNavigateHome(navigate);
          return;
        }

        if (statusConta === 'pendente') {
          await ativarContaUsuario(cred.user.uid);
        }

        await ensureUsuarioRecord(cred.user, cred.user.displayName || 'Guerreiro', foto, listaAvatares);
        registerAttemptResult('login', true);
        await delayNavigateHome(navigate);
      }

    } catch (err) {
      registerAttemptResult(action, false);
      const msgs = {
        'auth/invalid-email':        'E-mail inválido.',
        'auth/user-not-found':       'E-mail ou senha incorretos.',
        'auth/wrong-password':       'E-mail ou senha incorretos.',
        'auth/email-already-in-use': 'Este e-mail já está em uso.',
        'auth/weak-password':        'Senha muito fraca.',
        'auth/invalid-credential':   'E-mail ou senha incorretos.',
      };
      setError(msgs[err.code] || `Erro: ${err.code || err.message}`);
    } finally {
      isNewAccountRef.current = false;
      setLoading(false);
    }
  };

  // ── ESQUECI A SENHA ───────────────────────────────────────────────────────
  const handleForgotPassword = async () => {
    setError(''); setInfo('');
    if (forgotCooldown > 0) { setError(`Aguarde ${forgotCooldown}s.`); return; }
    if (!email.trim())      { setError('Digite seu e-mail para recuperar a senha.'); return; }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      sessionStorage.setItem(FORGOT_KEY, String(Date.now() + 45_000));
      setForgotCooldown(45);
      setInfo('Link de redefinição enviado para seu e-mail.');
    } catch (err) {
      const msgs = {
        'auth/invalid-email':     'E-mail inválido.',
        'auth/user-not-found':    'Nenhuma conta com esse e-mail.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde.',
      };
      setError(msgs[err.code] || 'Não foi possível enviar o e-mail.');
    } finally { setLoading(false); }
  };

  // ── REENVIAR VERIFICAÇÃO (não conta no rate limit de login) ───────────────
  const handleResendVerification = async () => {
    setError('');
    setInfo('');
    if (resendCooldown > 0) {
      setError(`Aguarde ${resendCooldown}s para reenviar.`);
      return;
    }
    setLoading(true);
    const av = listaAvatares[0] || AVATAR_FALLBACK;
    const esperado = (pendingEmailDisplay || sessionStorage.getItem(PENDING_EMAIL_KEY) || '').trim();
    try {
      let currentUser = null;

      if (verificationState === 'pending_google') {
        const result = await signInWithPopup(auth, googleProvider);
        currentUser = result.user;
        await refreshAuthUser(currentUser);
        if (esperado && !emailsIguais(currentUser.email, esperado)) {
          await signOut(auth);
          setError(MSG_GOOGLE_CONTA_ERRADA(esperado, currentUser.email));
          return;
        }
      } else {
        if (!email.trim() || !password) {
          setError('Preencha e-mail e senha (os mesmos do cadastro) para reenviar.');
          setLoading(false);
          return;
        }
        if (esperado && !emailsIguais(email.trim(), esperado)) {
          setError('Use o mesmo e-mail que está em ativação (o que recebeu o link).');
          setLoading(false);
          return;
        }
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        currentUser = cred.user;
        await refreshAuthUser(currentUser);
      }

      // Google já vem com emailVerified=true sem abrir o link do Firebase — NUNCA ativar só por isso.
      if (currentUser.emailVerified && verificationState !== 'pending_google') {
        await updateProfile(currentUser, {
          photoURL: currentUser.photoURL || av,
          displayName: currentUser.displayName || 'Guerreiro',
        });
        await ensureUsuarioRecord(
          currentUser,
          currentUser.displayName || 'Guerreiro',
          currentUser.photoURL || av,
          listaAvatares
        );
        await ativarContaUsuario(currentUser.uid);
        limparFluxoVerificacao();
        setInfo('E-mail já confirmado! Entrando...');
        await delayNavigateHome(navigate);
        return;
      }

      clearVerifyLinkFlags(currentUser.email || esperado, currentUser.uid);
      await sendEmailVerification(currentUser, getEmailVerificationActionSettings());
      await signOut(auth);
      sessionStorage.setItem(RESEND_KEY, String(Date.now() + 60_000));
      setResendCooldown(60);
      setInfo('Novo e-mail enviado. Confira caixa e spam. Você continua nesta tela.');
    } catch (err) {
      const msgs = {
        'auth/invalid-email': 'E-mail inválido.',
        'auth/user-not-found': 'Conta não encontrada.',
        'auth/wrong-password': 'Senha incorreta.',
        'auth/invalid-credential': 'Credenciais inválidas.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde.',
        'auth/popup-closed-by-user': 'Popup fechado. Você continua aqui para tentar de novo.',
      };
      setError(msgs[err.code] || 'Não foi possível reenviar o e-mail.');
    } finally {
      setLoading(false);
    }
  };

  // ── JÁ VERIFIQUEI MEU E-MAIL ──────────────────────────────────────────────
  const handleCheckVerification = async () => {
    setError('');
    setInfo('');
    setLoading(true);
    const av = listaAvatares[0] || AVATAR_FALLBACK;
    const esperado = (pendingEmailDisplay || sessionStorage.getItem(PENDING_EMAIL_KEY) || '').trim();
    try {
      let currentUser = null;

      if (verificationState === 'pending_google') {
        const result = await signInWithPopup(auth, googleProvider);
        currentUser = result.user;
        await refreshAuthUser(currentUser);
        if (esperado && !emailsIguais(currentUser.email, esperado)) {
          await signOut(auth);
          setError(MSG_GOOGLE_CONTA_ERRADA(esperado, currentUser.email));
          return;
        }
      } else {
        if (!email.trim() || !password) {
          setError('Preencha e-mail e senha para validar.');
          setLoading(false);
          return;
        }
        if (esperado && !emailsIguais(email.trim(), esperado)) {
          setError('Use o mesmo e-mail que está em ativação.');
          setLoading(false);
          return;
        }
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        currentUser = cred.user;
        await refreshAuthUser(currentUser);
      }

      await refreshAuthUser(currentUser);

      if (verificationState === 'pending_google') {
        syncVerifyLinkFromStorage(esperado || currentUser.email || '', currentUser.uid);
        const emAlvo = (esperado || currentUser.email || '').trim();
        if (!hasVerifyLinkOk(emAlvo, currentUser.uid)) {
          await signOut(auth);
          setError(
            'Confirmação do link não encontrada neste navegador. Abra o e-mail de ativação de novo e use o link (ele deve abrir esta página em /login). Se o Gmail abriu outro navegador, copie o link e abra no mesmo navegador onde você está logando. Depois use "Já verifiquei (Google)".'
          );
          return;
        }
      } else if (!currentUser.emailVerified) {
        await signOut(auth);
        setError(
          'Ainda não detectamos o clique no link. Abra o e-mail, confirme e clique em "VALIDAR CONTA" de novo.'
        );
        return;
      }

      if (verificationState === 'pending_google') {
        await updateProfile(currentUser, {
          photoURL: av,
          displayName: currentUser.displayName || 'Guerreiro',
        });
      }

      await ensureUsuarioRecord(
        currentUser,
        currentUser.displayName || 'Guerreiro',
        verificationState === 'pending_google' ? av : (currentUser.photoURL || av),
        listaAvatares
      );
      await ativarContaUsuario(currentUser.uid);
      limparFluxoVerificacao();
      setInfo('Conta ativa! Bem-vindo à Tempestade.');
      await delayNavigateHome(navigate);
    } catch (err) {
      console.error('validar conta:', err);
      const raw = (err?.message || String(err)).trim();
      const code = err?.code;
      const msgs = {
        'auth/invalid-email': 'E-mail inválido.',
        'auth/user-not-found': 'Conta não encontrada.',
        'auth/wrong-password': 'Senha incorreta.',
        'auth/invalid-credential': 'Credenciais inválidas.',
        'auth/popup-closed-by-user': 'Popup fechado. Você continua nesta tela.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente de novo.',
      };
      if (msgs[code]) {
        setError(msgs[code]);
      } else if (
        code === 'PERMISSION_DENIED' ||
        code === 'permission_denied' ||
        /permission|PERMISSION_DENIED/i.test(raw)
      ) {
        setError(
          'Não foi possível salvar sua ativação agora (permissão negada). Toque em "Reenviar e-mail", confirme o link e tente "Já verifiquei" de novo com a mesma conta.'
        );
      } else if (raw) {
        setError(`Não foi possível concluir: ${raw}`);
      } else {
        setError('Não foi possível validar. Tente de novo ou use "Reenviar e-mail".');
      }
    } finally {
      setLoading(false);
    }
  };

  const estaEmVerificacao = verificationState !== 'idle';
  const isGooglePending   = verificationState === 'pending_google';

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <main className="login-content">
      <div className="login-card">
        <h1 className="login-title shito-glitch">Bem vindo de volta!</h1>
        <p className="login-subtitle">
          {estaEmVerificacao
            ? 'ATIVAR CONTA'
            : isRegistering
              ? 'DESPERTAR NOVA ALMA'
              : 'ENTRAR NA TEMPESTADE'}
        </p>

        {isRegistering && !estaEmVerificacao && (
          <div className="avatar-preview-container" onClick={() => setShowAvatarModal(true)}>
            <div className="avatar-circle-wrapper">
              <img src={selectedAvatar} alt="Avatar" className="avatar-preview-img"
                onError={(e) => { e.target.src = AVATAR_FALLBACK; }} />
              <div className="edit-overlay"><i className="fa-solid fa-camera" /></div>
            </div>
            <p className="avatar-change-text">TOQUE PARA MUDAR O VISUAL</p>
          </div>
        )}

        {/* ── TELA DE VERIFICAÇÃO PENDENTE ── */}
        {estaEmVerificacao && (
          <>
            <div className="verification-box">
              <p>
                {isGooglePending
                  ? <>Acesse <strong>{pendingEmailDisplay}</strong>, clique no link de ativação e volte aqui. Depois clique em "Já verifiquei" e autentique com Google novamente.</>
                  : <>Acesse <strong>{pendingEmailDisplay}</strong>, clique no link de ativação e volte aqui para confirmar.</>
                }
              </p>

              {/* Campo de senha só para fluxo email/senha */}
              {!isGooglePending && (
                <div className="input-field" style={{ marginTop: '1rem' }}>
                  <i className="fa-solid fa-lock" />
                  <input
                    type="password"
                    placeholder="Digite sua senha para confirmar"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
              )}

              <div className="verification-actions" style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn-verify-secondary"
                  onClick={handleResendVerification}
                  disabled={loading || resendCooldown > 0}
                >
                  {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : 'Reenviar e-mail'}
                </button>
                <button
                  type="button"
                  className="btn-verify-primary"
                  onClick={handleCheckVerification}
                  disabled={loading}
                >
                  {isGooglePending ? 'Já verifiquei (Google)' : 'Já verifiquei meu e-mail'}
                </button>
              </div>

              <button
                type="button"
                className="btn-text-action"
                onClick={() => { limparFluxoVerificacao(); setError(''); setInfo(''); setPassword(''); }}
                style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}
              >
                Voltar ao login
              </button>
            </div>
          </>
        )}

        {/* ── FORMULÁRIO NORMAL (esconde durante verificação) ── */}
        {!estaEmVerificacao && (
          <>
            <form onSubmit={handleFormSubmit} className="login-form">
              {isRegistering && (
                <div className="input-field">
                  <i className="fa-solid fa-user" />
                  <input
                    type="text"
                    placeholder="Nome do Usuário"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={25}
                    required
                    disabled={loading}
                  />
                </div>
              )}

              <div className="input-field">
                <i className="fa-solid fa-envelope" />
                <input
                  type="email"
                  placeholder="E-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                  autoComplete="email"
                  required
                  disabled={loading}
                />
              </div>

              <div className="input-field">
                <i className="fa-solid fa-lock" />
                <input
                  type="password"
                  placeholder="Senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              {isRegistering && (
                <>
                  <div className="input-field">
                    <i className="fa-solid fa-shield-halved" />
                    <input
                      type="password"
                      placeholder="Confirmar Senha"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      disabled={loading}
                    />
                  </div>
                  <div className="password-requirements" style={{ marginBottom: '20px', paddingLeft: '5px' }}>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.82rem', textAlign: 'left' }}>
                      {[
                        { ok: hasLength,  label: 'Mínimo 8 caracteres' },
                        { ok: hasUpper,   label: 'Uma letra maiúscula' },
                        { ok: hasNumber,  label: 'Um número' },
                        { ok: hasSpecial, label: 'Caractere especial (@$!%*?)' },
                      ].map(({ ok, label }) => (
                        <li key={label} style={{ color: ok ? '#4caf50' : '#ff4444', transition: '0.3s' }}>
                          <i className={`fa-solid ${ok ? 'fa-check' : 'fa-xmark'}`} style={{ marginRight: '8px' }} />
                          {label}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              <button type="submit" className="btn-submit-shito" disabled={loading}>
                {loading
                  ? <i className="fa-solid fa-spinner fa-spin" />
                  : isRegistering ? 'CADASTRAR' : 'ENTRAR'}
              </button>
            </form>

            <div className="social-divider"><span>OU</span></div>

            <button
              type="button"
              className="btn-google-shito"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
              CONECTAR COM GOOGLE
            </button>

            {!isRegistering && (
              <button
                type="button"
                className="btn-validar-conta-destaque"
                onClick={() => {
                  const method = sessionStorage.getItem(PENDING_METHOD_KEY);
                  const em = sessionStorage.getItem(PENDING_EMAIL_KEY);
                  if (method) {
                    setPendingEmailDisplay(em || email);
                    setEmail(em || email);
                    setVerificationState(method === 'google' ? 'pending_google' : 'pending_email');
                    setError('');
                    setInfo('Conclua a ativação nos botões abaixo.');
                  } else if (!email.trim()) {
                    setError('Digite o e-mail que você usou no cadastro e clique de novo em VALIDAR CONTA.');
                  } else {
                    iniciarFluxoVerificacao('email', email.trim());
                    setInfo('Digite sua senha e use "Já verifiquei meu e-mail".');
                  }
                }}
                disabled={loading}
              >
                VALIDAR CONTA
              </button>
            )}

            {!isRegistering && (
              <button
                type="button"
                className="btn-text-action"
                onClick={handleForgotPassword}
                disabled={loading || forgotCooldown > 0}
              >
                {forgotCooldown > 0 ? `Esqueci minha senha (${forgotCooldown}s)` : 'Esqueci minha senha'}
              </button>
            )}

            <p className="toggle-register">
              {isRegistering ? (
                <>Já possui uma alma vinculada?{' '}
                  <span onClick={() => { setIsRegistering(false); setError(''); setInfo(''); }}>Entrar</span>
                </>
              ) : (
                <>É novo nesta jornada?{' '}
                  <span onClick={() => { setIsRegistering(true); setError(''); setInfo(''); }}>Despertar</span>
                </>
              )}
            </p>
          </>
        )}

        {error && <div className="error-banner"><i className="fa-solid fa-circle-exclamation" /> {error}</div>}
        {info  && <div className="info-banner"><i className="fa-solid fa-circle-check" /> {info}</div>}
      </div>

      {/* Modal de seleção de avatar */}
      {showAvatarModal && (
        <div className="avatar-modal-overlay">
          <div className="avatar-modal-card">
            <header className="avatar-modal-header">
              <h3>Escolha sua Face</h3>
              <button type="button" className="btn-close-modal" onClick={() => setShowAvatarModal(false)}>&times;</button>
            </header>
            <div className="avatar-modal-body">
              <div className="avatar-selection-grid">
                {listaAvatares.map((path, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`avatar-option-item ${selectedAvatar === path ? 'selected' : ''}`}
                    onClick={() => { setSelectedAvatar(path); setShowAvatarModal(false); }}
                  >
                    <img src={path} alt={`Avatar ${index + 1}`}
                      onError={(e) => { e.target.src = AVATAR_FALLBACK; }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal explicativo — aparece após cadastro ou primeiro Google */}
      {showVerificationModal && (
        <div className="verify-modal-overlay">
          <div className="verify-modal-card">
            <h3>Verifique seu e-mail para ativar a conta</h3>
            <p>
              Enviamos um link de ativação para <strong>{pendingEmailDisplay}</strong>.<br /><br />
              Verifique sua caixa de entrada (e spam), clique no link e depois volte aqui e clique em{' '}
              <strong>"Já verifiquei meu e-mail"</strong>.<br /><br />
              Sua conta ficará em modo <strong>pendente</strong>. Se não confirmar em até{' '}
              <strong>40 minutos</strong>, ela será removida automaticamente.
            </p>
            <button
              type="button"
              className="btn-verify-primary"
              onClick={() => setShowVerificationModal(false)}
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
