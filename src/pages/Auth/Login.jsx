// src/pages/Auth/Login.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  updateProfile,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import { ref, get, onValue, update } from 'firebase/database';
import { auth, db, googleProvider } from '../../services/firebase';
import {
  LISTA_AVATARES,
  AVATAR_FALLBACK,
  DEFAULT_USER_DISPLAY_NAME,
  DISPLAY_NAME_MAX_LENGTH,
} from '../../constants';
import { resolveAdminAccess } from '../../auth/adminAccess';
import { canAccessAdminPath } from '../../auth/adminPermissions';
import { buildPublicFunctionUrl } from '../../config/functions';
import { ensureUsuarioRecord, ativarContaUsuario, refreshAuthUser } from '../../userProfileSyncV2';
import { resolveSafeInternalRedirect } from '../../utils/loginRedirectPath';
import { avatarEhPublicoNoCadastro } from '../../utils/avatarAccess';
import { normalizeUsernameInput, validateUsernameHandle } from '../../utils/usernameValidation';
import { isTrustedPlatformAssetUrl } from '../../utils/trustedAssetUrls';
import LoginEmailStep from './login/LoginEmailStep.jsx';
import LoginCodeStep from './login/LoginCodeStep.jsx';
import LoginNewUserStep from './login/LoginNewUserStep.jsx';
import LoginExistingGoogleStep from './login/LoginExistingGoogleStep.jsx';
import LoginExistingPasswordStep from './login/LoginExistingPasswordStep.jsx';
import LoginAvatarModal from './login/LoginAvatarModal.jsx';
import './Login.css';

// --- Chaves de sessionStorage ───────────────────────────────────────────────
const FORGOT_KEY         = 'shito_forgot_until';
const ATTEMPT_LIMITS_KEY = 'shito_attempt_limits';
const ATTEMPT_RULES = {
  sendCode:         { max: 8, windowMs: 10 * 60 * 1000, blockMs: 10 * 60 * 1000 },
  verifyCode:       { max: 8, windowMs: 10 * 60 * 1000, blockMs: 10 * 60 * 1000 },
  loginPassword:    { max: 8, windowMs: 10 * 60 * 1000, blockMs: 10 * 60 * 1000 },
  registerPassword: { max: 4, windowMs: 60 * 60 * 1000, blockMs: 45 * 60 * 1000 },
};
const SEND_LOGIN_CODE_URL = buildPublicFunctionUrl('sendLoginCode');
const VERIFY_LOGIN_CODE_URL = buildPublicFunctionUrl('verifyLoginCode');
const AUTH_REQUEST_TIMEOUT_MS = 15_000;

// --- Rate limiting ──────────────────────────────────────────────────────────
function readAttemptStore() {
  try {
    const raw = localStorage.getItem(ATTEMPT_LIMITS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getAttemptState(action) {
  const now    = Date.now();
  const parsed = readAttemptStore();
  const entry  = parsed[action] || { count: 0, windowStart: now, blockedUntil: 0 };
  if (entry.blockedUntil && entry.blockedUntil > now)
    return { blocked: true, retryInSec: Math.ceil((entry.blockedUntil - now) / 1000) };
  return { blocked: false };
}

function registerAttemptResult(action, success) {
  const now    = Date.now();
  const parsed = readAttemptStore();
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
}

function resolveSafeAuthAvatar(authPhoto, fallback) {
  const raw = String(authPhoto || '').trim();
  if (isTrustedPlatformAssetUrl(raw, { allowLocalAssets: true })) return raw;
  return fallback;
}

async function parseAuthJsonResponse(resp) {
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    if (!resp.ok) throw new Error('Resposta inesperada do servidor de login.');
    return {};
  }
}

async function postAuthJson(url, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await parseAuthJsonResponse(resp);
    return { resp, data };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('A requisicao demorou demais. Tente novamente em instantes.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function carregarStatusConta(uid) {
  const snap = await get(ref(db, `usuarios/${uid}/status`));
  return snap.exists() ? snap.val() : null;
}

// --- Componente ─────────────────────────────────────────────────────────────
export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resolvePostLoginRedirect = async (authUser) => {
    const raw = searchParams.get('redirect');
    const resolved = resolveSafeInternalRedirect(raw);
    const isCreatorFlow =
      resolved === '/creators' ||
      resolved.startsWith('/creator') ||
      resolved.startsWith('/print-on-demand?ctx=creator') ||
      resolved.includes('ctx=creator');
    if (authUser && isCreatorFlow) {
      try {
        const adminAccess = await resolveAdminAccess(authUser);
        if (adminAccess.canAccessAdmin === true && adminAccess.isMangaka !== true) {
          return canAccessAdminPath('/admin/criadores', adminAccess) ? '/admin/criadores' : '/admin';
        }
      } catch {
        /* usa redirect seguro padrao */
      }
    }
    return resolved;
  };
  const irParaAposLogin = async (authUser) => {
    const resolved = await resolvePostLoginRedirect(authUser);
    if (resolved !== '/') {
      navigate(resolved, { replace: true });
      return;
    }
    navigate('/', { replace: true });
  };
  // step: 'email' | 'code' | 'new-user' | 'existing-password' | 'existing-google'
  const [step, setStep] = useState('email');
  const [existingAccountBackStep, setExistingAccountBackStep] = useState('email');
  /** Após codigo: usuario tem senha no site e tambem Google — mostrar alternativa */
  const [mostrarGoogleComoAlternativa, setMostrarGoogleComoAlternativa] = useState(false);
  const [email,           setEmail]           = useState('');
  const [code,            setCode]            = useState('');
  const [displayName,     setDisplayName]     = useState('');
  const [signupHandle,    setSignupHandle]    = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe,      setRememberMe]      = useState(true);
  const [error,           setError]           = useState('');
  const [info,            setInfo]            = useState('');
  const [loading,         setLoading]         = useState(false);
  const [forgotCooldown,  setForgotCooldown]  = useState(0);
  const [resendCooldown,  setResendCooldown]  = useState(0);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [listaAvatares,   setListaAvatares]   = useState(LISTA_AVATARES);
  const [selectedAvatar,  setSelectedAvatar]  = useState(LISTA_AVATARES[0] || AVATAR_FALLBACK);
  const [signupIntent,    setSignupIntent]    = useState('reader');
  /** Fluxo explícito "criar conta" — envia codigo mesmo sem usuario no Auth */
  const [signupCodeMode, setSignupCodeMode]    = useState(false);
  const lastCodeWasSignupRef = useRef(false);

  const hasUpper   = /[A-Z]/.test(password);
  const hasNumber  = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasLength  = password.length >= 8;

  const normalizeLoginEmail = (raw) => String(raw || '').trim().toLowerCase();

  const validarEmailComDica = (rawEmail) => {
    const norm = normalizeLoginEmail(rawEmail);
    if (!norm) return { ok: false, message: 'Informe um e-mail valido.' };
    if (norm.includes('@gmail') && !norm.endsWith('@gmail.com') && !norm.endsWith('@googlemail.com')) {
      return {
        ok: false,
        message: 'Parece Gmail incompleto. Use: seuemail@gmail.com (ou @googlemail.com).',
      };
    }
    const domainTypos = [
      ['@gmial.com', '@gmail.com'],
      ['@gmai.com', '@gmail.com'],
      ['@gmail.con', '@gmail.com'],
      ['@gmail.coom', '@gmail.com'],
      ['@gmail.co', '@gmail.com'],
      ['@hotmai.com', '@hotmail.com'],
      ['@hotmal.com', '@hotmail.com'],
      ['@outlok.com', '@outlook.com'],
    ];
    for (const [bad, good] of domainTypos) {
      if (norm.endsWith(bad)) {
        return { ok: false, message: `Confira o dominio do e-mail (ex.: ...${good}).` };
      }
    }
    const emailRegex = /^[\w-.]+@[\w-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(norm)) {
      return { ok: false, message: 'Informe um e-mail valido (ex: usuario@email.com).' };
    }
    return { ok: true, email: norm };
  };

  const clearSignupDraft = () => {
    setDisplayName('');
    setSignupHandle('');
    setPassword('');
    setConfirmPassword('');
    setSignupIntent('reader');
    setMostrarGoogleComoAlternativa(false);
  };

  const moveToExistingAccountStep = ({ hasPassword = false, hasGoogle = false, message = '' } = {}) => {
    clearSignupDraft();
    setExistingAccountBackStep('email');
    setSignupCodeMode(false);
    lastCodeWasSignupRef.current = false;

    if (hasGoogle && !hasPassword) {
      setStep('existing-google');
      setInfo(
        message ||
          'Este e-mail ja esta vinculado a login com Google. Use "Conectar com Google" para entrar.'
      );
      return;
    }

    setStep('existing-password');
    setMostrarGoogleComoAlternativa(Boolean(hasPassword && hasGoogle));
    setInfo(
      message ||
        (hasGoogle
          ? 'Esta conta ja existe no site. Digite sua senha ou use "Conectar com Google" abaixo.'
          : 'Esta conta ja existe no site. Digite sua senha para entrar.')
    );
  };

  // --- Cooldowns ──────────────────────────────────────────────────────────
  useEffect(() => {
    const now = Date.now();
    const fu  = Number(sessionStorage.getItem(FORGOT_KEY) || 0);
    if (fu > now) setForgotCooldown(Math.ceil((fu - now) / 1000));
    else sessionStorage.removeItem(FORGOT_KEY);
  }, []);

  useEffect(() => {
    if (forgotCooldown <= 0) return;
    const t = setInterval(() => setForgotCooldown((p) => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, [forgotCooldown]);

  useEffect(() => { if (forgotCooldown === 0) sessionStorage.removeItem(FORGOT_KEY); }, [forgotCooldown]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((p) => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // --- Avatares dinâmicos ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onValue(ref(db, 'avatares'), (snap) => {
      if (!snap.exists()) return;
      const ordenados = Object.values(snap.val() || {})
        .filter((i) => i?.active !== false && typeof i?.url === 'string')
        .sort((a, b) => {
          const aO = typeof a?.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
          const bO = typeof b?.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
          return aO !== bO ? aO - bO : (b?.createdAt || 0) - (a?.createdAt || 0);
        });
      const somentePublicos = ordenados.filter((i) => avatarEhPublicoNoCadastro(i)).map((i) => i.url);
      if (somentePublicos.length > 0) {
        setListaAvatares(somentePublicos);
        setSelectedAvatar((prev) => (somentePublicos.includes(prev) ? prev : somentePublicos[0]));
      } else {
        setListaAvatares(LISTA_AVATARES);
        setSelectedAvatar((prev) =>
          LISTA_AVATARES.includes(prev) ? prev : LISTA_AVATARES[0] || AVATAR_FALLBACK
        );
      }
    });
    return () => unsub();
  }, []);

  // --- LOGIN COM GOOGLE ───────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    setInfo('');
    try {
      try {
        await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      } catch {
        /* ignore */
      }
      const result     = await signInWithPopup(auth, googleProvider);
      const googleUser = result.user;

      const statusAtual = await carregarStatusConta(googleUser.uid);
      if (statusAtual === 'banido') {
        await signOut(auth);
        setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
        return;
      }

      const av = listaAvatares[0] || AVATAR_FALLBACK;
      const authPhoto = String(googleUser.photoURL || '').trim();
      const authName = String(googleUser.displayName || '').trim();
      if (!authPhoto || !authName) {
        await updateProfile(googleUser, {
          photoURL: authPhoto || av,
          displayName: authName || DEFAULT_USER_DISPLAY_NAME,
        });
      }
      await refreshAuthUser(googleUser);

      const safeAvatar = resolveSafeAuthAvatar(authPhoto, av);
      const perfil = await ensureUsuarioRecord(
        googleUser,
        googleUser.displayName || DEFAULT_USER_DISPLAY_NAME,
        safeAvatar,
        listaAvatares,
        'ativo'
      );
      await ativarContaUsuario(googleUser.uid);

      if (!String(perfil?.userHandle || '').trim()) {
        navigate('/perfil?required=username', { replace: true });
        return;
      }
      await irParaAposLogin(googleUser);
    } catch (err) {
      const msgs = {
        'auth/popup-closed-by-user':                     'Popup fechado. Tente novamente.',
        'auth/account-exists-with-different-credential': 'Essa conta já existe com outro método de login.',
      };
      setError(msgs[err.code] || `Falha ao conectar com Google: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Envia codigo por e-mail. `signupExplicit`: true = cadastro novo (servidor envia mesmo sem Auth).
   * Retorna true se ok.
   */
  const enviarCodigoLogin = async (signupExplicit = false) => {
    if (loading) return false;
    const attempt = getAttemptState('sendCode');
    if (attempt.blocked) {
      setError(`Muitas tentativas. Tente novamente em ${attempt.retryInSec}s.`);
      return false;
    }

    const validacao = validarEmailComDica(email);
    if (!validacao.ok) {
      setError(validacao.message);
      return false;
    }
    const emailNorm = validacao.email;
    setEmail(emailNorm);

    setLoading(true);
    setError('');
    try {
      const { resp, data } = await postAuthJson(SEND_LOGIN_CODE_URL, {
        email: emailNorm,
        signup: signupExplicit === true,
      });
      if (!resp.ok || !data.ok) {
        if (data?.code === 'GOOGLE_ONLY_AUTH') {
          moveToExistingAccountStep({
            hasPassword: false,
            hasGoogle: true,
            message: String(
              data?.error || 'Este e-mail ja esta cadastrado com login pelo Google. Use "Conectar com Google".'
            ),
          });
          return;
        }
        if (signupExplicit && data?.code === 'ACCOUNT_ALREADY_EXISTS') {
          moveToExistingAccountStep({
            hasPassword: data?.hasPassword === true,
            hasGoogle: data?.hasGoogle === true,
            message: String(
              data?.error || 'Este e-mail ja possui conta. Entre com sua senha ou com o metodo ja vinculado.'
            ),
          });
          return false;
        }
        if (!signupExplicit && data?.code === 'NO_AUTH_USER') {
          setSignupCodeMode(true);
          setError('');
          setInfo(
            'Não encontramos conta com este e-mail no MangaTeofilo. Se você já entrou com Google, use "Conectar com Google". Para cadastrar com e-mail, use "Receber código para criar conta" abaixo.'
          );
          return false;
        }
        if (!signupExplicit && data?.code === 'GOOGLE_ONLY_AUTH') {
          setExistingAccountBackStep('email');
          setStep('existing-google');
          setSignupCodeMode(false);
          setError('');
          setInfo(
            String(
              data.error ||
                'Este e-mail já está cadastrado com login pelo Google. Use "Conectar com Google".'
            )
          );
          return false;
        }
        throw new Error(data.error || 'Não foi possível enviar o código.');
      }

      registerAttemptResult('sendCode', true);
      lastCodeWasSignupRef.current = signupExplicit === true;
      setSignupCodeMode(false);
      setInfo(
        data?.hasGoogle && data?.hasPassword
          ? 'Código enviado. Esta conta aceita Google e senha do site; confira o e-mail e siga.'
          : 'Código enviado. Confira seu e-mail (e spam) e digite abaixo.'
      );
      setResendCooldown(45);
      return true;
    } catch (err) {
      registerAttemptResult('sendCode', false);
      setError(err.message || 'Falha ao enviar código. Tente novamente.');
      return false;
    } finally {
      setLoading(false);
    }
  };
  const handleSendCode = async (e) => {
    e.preventDefault();
    if (loading) return;
    setInfo('');
    const ok = await enviarCodigoLogin(false);
    if (ok) setStep('code');
  };

  const handleSendCodeSignup = async (e) => {
    e?.preventDefault?.();
    if (loading) return;
    setInfo('');
    const ok = await enviarCodigoLogin(true);
    if (ok) setStep('code');
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0 || loading) return;
    setError('');
    await enviarCodigoLogin(lastCodeWasSignupRef.current === true);
  };

  // --- FLUXO: 2) VALIDAR CODIGO ────────────────────────────────────────────
  const handleVerifyCode = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setInfo('');

    const attempt = getAttemptState('verifyCode');
    if (attempt.blocked) {
      setError(`Muitas tentativas. Tente novamente em ${attempt.retryInSec}s.`);
      return;
    }

    const validacao = validarEmailComDica(email);
    if (!validacao.ok || code.trim().length !== 6) {
      setError('Digite o e-mail e o código de 6 dígitos.');
      return;
    }
    const emailNorm = validacao.email;
    setEmail(emailNorm);

    setLoading(true);
    try {
      const { resp, data } = await postAuthJson(VERIFY_LOGIN_CODE_URL, {
        email: emailNorm,
        code: code.trim(),
      });
      if (!resp.ok || !data.ok) {
        if (data?.code === 'GOOGLE_ONLY_AUTH') {
          moveToExistingAccountStep({
            hasPassword: false,
            hasGoogle: true,
            message: String(
              data?.error || 'Este e-mail ja esta cadastrado com login pelo Google. Use "Conectar com Google".'
            ),
          });
          return;
        }
        throw new Error(data.error || 'Código inválido.');
      }

      registerAttemptResult('verifyCode', true);
      setMostrarGoogleComoAlternativa(false);

      if (data.isNewUser) {
        setStep('new-user');
        setInfo('Nova alma detectada. Configure seu nome, avatar e senha.');
        return;
      }

      const temSenhaSite = data?.hasPassword === true;
      const temGoogle = data?.hasGoogle === true;

      if (temSenhaSite) {
        setExistingAccountBackStep('code');
        setStep('existing-password');
        setPassword('');
        setMostrarGoogleComoAlternativa(temGoogle);
        setInfo(
          temGoogle
            ? 'Digite a senha que você cadastrou neste site. Ela não é a mesma da conta Google — ou use "Conectar com Google" abaixo.'
            : 'Bem-vindo de volta! Digite a senha que você cadastrou no site.'
        );
        return;
      }

      if (temGoogle) {
        setExistingAccountBackStep('code');
        setStep('existing-google');
        setInfo('');
        return;
      }

      setExistingAccountBackStep('code');
      setStep('existing-password');
      setPassword('');
      setMostrarGoogleComoAlternativa(false);
      setInfo(
        'Digite a senha cadastrada neste site, se você criou uma. Se entra só com Google, use "Conectar com Google" na primeira tela — a senha do Gmail não é usada aqui.'
      );
    } catch (err) {
      registerAttemptResult('verifyCode', false);
      setError(err.message || 'Falha ao validar código. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // --- FLUXO: 3) NOVO USUÁRIO (NOME + AVATAR + SENHA) ──────────────────────
  const handleRegisterWithPassword = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setInfo('');

    const attempt = getAttemptState('registerPassword');
    if (attempt.blocked) {
      setError(`Muitas tentativas. Tente novamente em ${attempt.retryInSec}s.`);
      return;
    }

    if (!displayName.trim()) { setError('Escolha um nome para sua alma.'); return; }
    const handleNorm = normalizeUsernameInput(signupHandle);
    const handleCheck = validateUsernameHandle(handleNorm);
    if (!handleCheck.ok) { setError(handleCheck.message); return; }
    if (password !== confirmPassword) { setError('As senhas não coincidem.'); return; }
    if (!hasUpper || !hasNumber || !hasSpecial || !hasLength) {
      setError('A senha não atende aos requisitos.');
      return;
    }

    const avatarSeguro =
      listaAvatares.includes(selectedAvatar) ? selectedAvatar : listaAvatares[0] || AVATAR_FALLBACK;

    setLoading(true);
    try {
      try {
        await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      } catch {
        /* ignore */
      }
      const handleSnap = await get(ref(db, `usernames/${handleNorm}`));
      if (handleSnap.exists()) {
        setError('Este @username já está em uso. Escolha outro.');
        registerAttemptResult('registerPassword', false);
        setLoading(false);
        return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, {
        displayName: displayName.trim(),
        photoURL:    avatarSeguro,
      });
      await refreshAuthUser(cred.user);

      const perfil = await ensureUsuarioRecord(
        cred.user,
        displayName.trim(),
        avatarSeguro,
        listaAvatares,
        'ativo'
      );

      if (!perfil.status || perfil.status !== 'ativo') {
        await ativarContaUsuario(cred.user.uid);
      }

      await update(ref(db), {
        [`usernames/${handleNorm}`]: cred.user.uid,
        [`usuarios/${cred.user.uid}/userHandle`]: handleNorm,
        [`usuarios/${cred.user.uid}/userAvatar`]: avatarSeguro,
        [`usuarios/${cred.user.uid}/readerProfileAvatarUrl`]: avatarSeguro,
        [`usuarios/${cred.user.uid}/publicProfile/userHandle`]: handleNorm,
        [`usuarios/${cred.user.uid}/publicProfile/userAvatar`]: avatarSeguro,
        [`usuarios/${cred.user.uid}/publicProfile/readerProfileAvatarUrl`]: avatarSeguro,
        [`usuarios/${cred.user.uid}/signupIntent`]: signupIntent,
        [`usuarios/${cred.user.uid}/creatorApplicationStatus`]:
          signupIntent === 'creator' ? 'draft' : null,
        [`usuarios/${cred.user.uid}/creatorRequestedAt`]: null,
      });

      registerAttemptResult('registerPassword', true);
      setInfo(
        signupIntent === 'creator'
          ? 'Conta criada! Abrindo o cadastro de criador em pagina dedicada.'
          : 'Conta criada! Bem-vindo a Tempestade.'
      );
      if (signupIntent === 'creator') {
        navigate('/creator/onboarding', {
          replace: true,
          state: {
            signupDraft: {
              displayName: displayName.trim(),
              userHandle: handleNorm,
              avatarUrl: avatarSeguro,
            },
          },
        });
      } else {
        await irParaAposLogin(cred.user);
      }
    } catch (err) {
      registerAttemptResult('registerPassword', false);
      if (err.code === 'auth/email-already-in-use') {
        moveToExistingAccountStep({
          hasPassword: true,
          hasGoogle: false,
          message: 'Este e-mail ja possui conta. Entre com sua senha para continuar.',
        });
        return;
      }
      const msgs = {
        'auth/invalid-email':        'E-mail inválido.',
        'auth/email-already-in-use': 'Este e-mail já está em uso.',
        'auth/weak-password':        'Senha muito fraca.',
      };
      setError(msgs[err.code] || `Erro ao criar conta: ${err.code || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // --- FLUXO: 4) USUÁRIO EXISTENTE (SENHA) ─────────────────────────────────
  const handleExistingPasswordLogin = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setInfo('');

    const attempt = getAttemptState('loginPassword');
    if (attempt.blocked) {
      setError(`Muitas tentativas. Tente novamente em ${attempt.retryInSec}s.`);
      return;
    }

    if (!password) {
      setError('Digite sua senha.');
      return;
    }

    setLoading(true);
    try {
      try {
        await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      } catch {
        /* ignore */
      }
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await refreshAuthUser(cred.user);

      const statusConta = await carregarStatusConta(cred.user.uid);
      if (statusConta === 'banido') {
        await signOut(auth);
        setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
        return;
      }

      const av = listaAvatares[0] || AVATAR_FALLBACK;
      const safeAvatar = resolveSafeAuthAvatar(cred.user.photoURL, av);
      const perfil = await ensureUsuarioRecord(
        cred.user,
        cred.user.displayName || DEFAULT_USER_DISPLAY_NAME,
        safeAvatar,
        listaAvatares,
        'ativo'
      );

      if (!statusConta || statusConta === 'pendente' || perfil.status !== 'ativo') {
        await ativarContaUsuario(cred.user.uid);
      }

      registerAttemptResult('loginPassword', true);
      if (!String(perfil?.userHandle || '').trim()) {
        navigate('/perfil?required=username', { replace: true });
        return;
      }
      await irParaAposLogin(cred.user);
    } catch (err) {
      registerAttemptResult('loginPassword', false);
      const base = {
        'auth/invalid-email':      'E-mail inválido.',
        'auth/user-not-found':     'E-mail ou senha incorretos.',
        'auth/wrong-password':     'E-mail ou senha incorretos.',
        'auth/invalid-credential': 'E-mail ou senha incorretos.',
      };
      let msg = base[err.code] || `Erro ao entrar: ${err.code || err.message}`;
      if (['auth/wrong-password', 'auth/invalid-credential', 'auth/user-not-found'].includes(err.code)) {
        msg +=
          ' Se você criou a conta com Google, a senha do Gmail não funciona aqui — volte e use "Conectar com Google".';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // --- ESQUECI A SENHA ────────────────────────────────────────────────────
  const handleForgotPassword = async () => {
    if (loading) return;
    setError(''); setInfo('');
    if (forgotCooldown > 0) { setError(`Aguarde ${forgotCooldown}s.`); return; }
    const validacao = validarEmailComDica(email);
    if (!validacao.ok) { setError(validacao.message); return; }
    const emailNorm = validacao.email;
    setEmail(emailNorm);

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, emailNorm);
      sessionStorage.setItem(FORGOT_KEY, String(Date.now() + 45_000));
      setForgotCooldown(45);
      setInfo('Link de redefinição enviado para seu e-mail.');
    } catch (err) {
      const msgs = {
        'auth/invalid-email':     'E-mail invalido.',
        'auth/user-not-found':    'Nenhuma conta com esse e-mail.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde.',
      };
      setError(msgs[err.code] || 'Nao foi possivel enviar o e-mail.');
    } finally {
      setLoading(false);
    }
  };

  // --- RENDER ---------------------------------------------------------------
  // --- RENDER ---------------------------------------------------------------
  return (
    <main className="login-content">
      <div className="login-card">
        <p className="login-brand-mark" aria-hidden="true">
          MangaTeofilo
        </p>
        <h1 className="login-title">Bem-vindo de volta</h1>
        <p className="login-subtitle">
          {step === 'email' && 'Entrar ou criar conta'}
          {step === 'code' && 'Insira o codigo enviado'}
          {step === 'new-user' && 'Configure seu perfil'}
          {step === 'existing-password' && 'Digite sua senha'}
          {step === 'existing-google' && 'Entre com Google'}
        </p>

        {step === 'email' ? (
          <LoginEmailStep
            email={email}
            setEmail={setEmail}
            loading={loading}
            handleSendCode={handleSendCode}
            signupCodeMode={signupCodeMode}
            handleSendCodeSignup={handleSendCodeSignup}
            handleGoogleSignIn={handleGoogleSignIn}
            handleForgotPassword={handleForgotPassword}
            forgotCooldown={forgotCooldown}
          />
        ) : null}

        {step === 'code' ? (
          <LoginCodeStep
            email={email}
            setEmail={setEmail}
            code={code}
            setCode={setCode}
            loading={loading}
            handleVerifyCode={handleVerifyCode}
            handleResendCode={handleResendCode}
            resendCooldown={resendCooldown}
            onBack={() => {
              setStep(existingAccountBackStep);
              if (existingAccountBackStep === 'email') {
                setCode('');
                clearSignupDraft();
                setResendCooldown(0);
              }
              setError('');
              setInfo('');
            }}
          />
        ) : null}

        {step === 'new-user' ? (
          <LoginNewUserStep
            selectedAvatar={selectedAvatar}
            setShowAvatarModal={setShowAvatarModal}
            signupIntent={signupIntent}
            setSignupIntent={setSignupIntent}
            displayName={displayName}
            setDisplayName={setDisplayName}
            signupHandle={signupHandle}
            onSignupHandleChange={(value) => setSignupHandle(normalizeUsernameInput(value))}
            email={email}
            password={password}
            setPassword={setPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            rememberMe={rememberMe}
            setRememberMe={setRememberMe}
            loading={loading}
            handleRegisterWithPassword={handleRegisterWithPassword}
            onBack={() => {
              setStep('code');
              setPassword('');
              setConfirmPassword('');
              setError('');
              setInfo('');
            }}
            hasLength={hasLength}
            hasUpper={hasUpper}
            hasNumber={hasNumber}
            hasSpecial={hasSpecial}
            displayNameMaxLength={DISPLAY_NAME_MAX_LENGTH}
          />
        ) : null}

        {step === 'existing-google' ? (
          <LoginExistingGoogleStep
            loading={loading}
            handleGoogleSignIn={handleGoogleSignIn}
            onBack={() => {
              setStep(existingAccountBackStep);
              if (existingAccountBackStep === 'email') {
                setCode('');
                clearSignupDraft();
                setResendCooldown(0);
              }
              setError('');
              setInfo('');
            }}
          />
        ) : null}

        {step === 'existing-password' ? (
          <LoginExistingPasswordStep
            email={email}
            password={password}
            setPassword={setPassword}
            rememberMe={rememberMe}
            setRememberMe={setRememberMe}
            loading={loading}
            handleExistingPasswordLogin={handleExistingPasswordLogin}
            handleForgotPassword={handleForgotPassword}
            forgotCooldown={forgotCooldown}
            mostrarGoogleComoAlternativa={mostrarGoogleComoAlternativa}
            handleGoogleSignIn={handleGoogleSignIn}
            onBack={() => {
              setStep(existingAccountBackStep);
              setPassword('');
              setError('');
              setInfo('');
              setMostrarGoogleComoAlternativa(false);
              if (existingAccountBackStep === 'email') {
                setCode('');
                clearSignupDraft();
                setResendCooldown(0);
              }
            }}
          />
        ) : null}

        {error ? <div className="error-banner"><i className="fa-solid fa-circle-exclamation" /> {error}</div> : null}
        {info ? <div className="info-banner"><i className="fa-solid fa-circle-check" /> {info}</div> : null}
      </div>

      <LoginAvatarModal
        showAvatarModal={showAvatarModal}
        listaAvatares={listaAvatares}
        selectedAvatar={selectedAvatar}
        setSelectedAvatar={setSelectedAvatar}
        setShowAvatarModal={setShowAvatarModal}
        fallbackAvatar={AVATAR_FALLBACK}
      />
    </main>
  );
}
