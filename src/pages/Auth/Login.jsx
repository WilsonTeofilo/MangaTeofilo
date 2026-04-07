// src/pages/Auth/Login.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
  fetchSignInMethodsForEmail,
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
  /** Após código: usuário tem senha no site e também Google — mostrar alternativa */
  const [mostrarGoogleComoAlternativa, setMostrarGoogleComoAlternativa] = useState(false);
  const [email,           setEmail]           = useState('');
  const [code,            setCode]            = useState('');
  const [displayName,     setDisplayName]     = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error,           setError]           = useState('');
  const [info,            setInfo]            = useState('');
  const [loading,         setLoading]         = useState(false);
  const [forgotCooldown,  setForgotCooldown]  = useState(0);
  const [resendCooldown,  setResendCooldown]  = useState(0);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [listaAvatares,   setListaAvatares]   = useState(LISTA_AVATARES);
  const [selectedAvatar,  setSelectedAvatar]  = useState(LISTA_AVATARES[0] || AVATAR_FALLBACK);
  const [signupIntent,    setSignupIntent]    = useState('reader');
  /** Fluxo explícito "criar conta" — envia código mesmo sem usuário no Auth */
  const [signupCodeMode, setSignupCodeMode]    = useState(false);
  const lastCodeWasSignupRef = useRef(false);

  const hasUpper   = /[A-Z]/.test(password);
  const hasNumber  = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasLength  = password.length >= 8;

  const normalizeLoginEmail = (raw) => String(raw || '').trim().toLowerCase();

  const validarEmailComDica = (rawEmail) => {
    const norm = normalizeLoginEmail(rawEmail);
    if (!norm) return { ok: false, message: 'Informe um e-mail válido.' };
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
        return { ok: false, message: `Confira o domínio do e-mail (ex.: …${good}).` };
      }
    }
    const emailRegex = /^[\w-.]+@[\w-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(norm)) {
      return { ok: false, message: 'Informe um e-mail válido (ex: usuario@email.com).' };
    }
    return { ok: true, email: norm };
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
      const result     = await signInWithPopup(auth, googleProvider);
      const googleUser = result.user;

      const statusAtual = await carregarStatusConta(googleUser.uid);
      if (statusAtual === 'banido') {
        await signOut(auth);
        setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
        return;
      }

      const av = listaAvatares[0] || AVATAR_FALLBACK;
      await updateProfile(googleUser, {
        photoURL:    av,
        displayName: googleUser.displayName || DEFAULT_USER_DISPLAY_NAME,
      });
      await refreshAuthUser(googleUser);

      await ensureUsuarioRecord(googleUser, googleUser.displayName || DEFAULT_USER_DISPLAY_NAME, av, listaAvatares, 'ativo');
      await ativarContaUsuario(googleUser.uid);

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
   * Envia código por e-mail. `signupExplicit`: true = cadastro novo (servidor envia mesmo sem Auth).
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

    if (!signupExplicit) {
      try {
        const methods = await fetchSignInMethodsForEmail(auth, emailNorm);
        const temGoogle = methods.includes('google.com');
        const temSenhaSite = methods.includes('password');

        if (temGoogle && !temSenhaSite) {
          setStep('existing-google');
          setSignupCodeMode(false);
          setError('');
          setInfo(
            'Este e-mail já está cadastrado com login pelo Google. A senha do Gmail não vale aqui — use «Conectar com Google». Não há perfil com e-mail e senha neste site para esse endereço.'
          );
          return false;
        }

        if (methods.length === 0) {
          setSignupCodeMode(true);
          setError('');
          setInfo(
            'Não encontramos conta com este e-mail no MangaTeofilo. Se você já entrou com Google, use o botão Google. Para cadastrar com e-mail, use «Receber código para criar conta» abaixo (evita gastar e-mail à toa).'
          );
          return false;
        }

        if (temGoogle && temSenhaSite) {
          setInfo('Esta conta tem Google e senha no site — você pode usar o código ou qualquer um dos dois.');
        } else {
          setInfo('');
        }
      } catch {
        setSignupCodeMode(true);
        setError('');
        setInfo(
          'Não conseguimos consultar o e-mail agora. Se é cadastro novo, use «Receber código para criar conta». Se já tem conta, use Google ou tente de novo em instantes.'
        );
        return false;
      }
    }

    setLoading(true);
    setError('');
    try {
      const { resp, data } = await postAuthJson(SEND_LOGIN_CODE_URL, {
        email: emailNorm,
        signup: signupExplicit === true,
      });
      if (!resp.ok || !data.ok) {
        const msg =
          data?.code === 'NO_AUTH_USER'
            ? String(data.error || 'Nenhuma conta com este e-mail.')
            : data.error || 'Não foi possível enviar o código.';
        throw new Error(msg);
      }

      registerAttemptResult('sendCode', true);
      lastCodeWasSignupRef.current = signupExplicit === true;
      setSignupCodeMode(false);
      setInfo('Código enviado! Confira seu e-mail (e spam) e digite abaixo.');
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

  // --- FLUXO: 2) VALIDAR CÓDIGO ────────────────────────────────────────────
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
        throw new Error(data.error || 'Código inválido.');
      }

      registerAttemptResult('verifyCode', true);
      setMostrarGoogleComoAlternativa(false);

      if (data.isNewUser) {
        setStep('new-user');
        setInfo('Nova alma detectada. Configure seu nome, avatar e senha.');
        return;
      }

      let methods = [];
      try {
        methods = await fetchSignInMethodsForEmail(auth, emailNorm);
      } catch {
        methods = [];
      }

      const temSenhaSite = methods.includes('password');
      const temGoogle = methods.includes('google.com');

      if (temSenhaSite) {
        setStep('existing-password');
        setPassword('');
        setMostrarGoogleComoAlternativa(temGoogle);
        setInfo(
          temGoogle
            ? 'Digite a senha que você cadastrou neste site. Ela não é a mesma da conta Google — ou use Conectar com Google abaixo.'
            : 'Bem-vindo de volta! Digite a senha que você cadastrou no site.'
        );
        return;
      }

      if (temGoogle) {
        setStep('existing-google');
        setInfo('');
        return;
      }

      setStep('existing-password');
      setPassword('');
      setMostrarGoogleComoAlternativa(false);
      setInfo(
        'Digite a senha cadastrada neste site, se você criou uma. Se entra só com Google, use o botão Conectar com Google na primeira tela — a senha do Gmail não é usada aqui.'
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
    if (password !== confirmPassword) { setError('As senhas não coincidem.'); return; }
    if (!hasUpper || !hasNumber || !hasSpecial || !hasLength) {
      setError('A senha não atende aos requisitos.');
      return;
    }

    const avatarSeguro =
      listaAvatares.includes(selectedAvatar) ? selectedAvatar : listaAvatares[0] || AVATAR_FALLBACK;

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const agora = Date.now();
      await updateProfile(cred.user, {
        displayName: displayName.trim(),
        photoURL:    avatarSeguro,
      });

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
        [`usuarios/${cred.user.uid}/signupIntent`]: signupIntent,
        [`usuarios/${cred.user.uid}/creatorApplicationStatus`]:
          signupIntent === 'creator' ? 'draft' : null,
        [`usuarios/${cred.user.uid}/creatorRequestedAt`]: null,
      });

      registerAttemptResult('registerPassword', true);
      setInfo(
        signupIntent === 'creator'
          ? 'Conta criada! Abrindo o cadastro de criador em pagina dedicada.'
          : 'Conta criada! Bem-vindo à Tempestade.'
      );
      if (signupIntent === 'creator') {
        navigate('/creator/onboarding', { replace: true });
      } else {
        await irParaAposLogin(cred.user);
      }
    } catch (err) {
      registerAttemptResult('registerPassword', false);
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
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await refreshAuthUser(cred.user);

      const statusConta = await carregarStatusConta(cred.user.uid);
      if (statusConta === 'banido') {
        await signOut(auth);
        setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
        return;
      }

      const av = listaAvatares[0] || AVATAR_FALLBACK;
      const perfil = await ensureUsuarioRecord(
        cred.user,
        cred.user.displayName || DEFAULT_USER_DISPLAY_NAME,
        cred.user.photoURL || av,
        listaAvatares,
        'ativo'
      );

      if (!statusConta || statusConta === 'pendente' || perfil.status !== 'ativo') {
        await ativarContaUsuario(cred.user.uid);
      }

      registerAttemptResult('loginPassword', true);
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
          ' Se você criou a conta com Google, a senha do Gmail não funciona aqui — volte e use Conectar com Google.';
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
        'auth/invalid-email':     'E-mail inválido.',
        'auth/user-not-found':    'Nenhuma conta com esse e-mail.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde.',
      };
      setError(msgs[err.code] || 'Não foi possível enviar o e-mail.');
    } finally { setLoading(false); }
  };

  // --- RENDER ─────────────────────────────────────────────────────────────
  return (
    <main className="login-content">
      <div className="login-card">
        <p className="login-brand-mark" aria-hidden="true">
          MangaTeofilo
        </p>
        <h1 className="login-title">Bem-vindo de volta</h1>
        <p className="login-subtitle">
          {step === 'email' && 'Entrar ou criar conta'}
          {step === 'code' && 'Insira o código enviado'}
          {step === 'new-user' && 'Configure seu perfil'}
          {step === 'existing-password' && 'Digite sua senha'}
          {step === 'existing-google' && 'Entre com Google'}
        </p>

        {/* STEP 1: E-MAIL */}
        {step === 'email' && (
          <>
            <form onSubmit={handleSendCode} className="login-form">
              <div className="input-field">
                <i className="fa-solid fa-envelope" />
                <input
                  type="email"
                  placeholder="E-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <button type="submit" className="btn-submit-shito" disabled={loading}>
                {loading ? <i className="fa-solid fa-spinner fa-spin" /> : 'Enviar código (tenho conta)'}
              </button>
            </form>

            {signupCodeMode ? (
              <div className="login-signup-code-hint">
                <p className="login-info-inline">
                  Primeiro acesso com este e-mail? Receba o código só para cadastro (não gasta tentativa de quem já tem conta).
                </p>
                <button
                  type="button"
                  className="btn-submit-shito btn-submit-shito--secondary"
                  disabled={loading}
                  onClick={handleSendCodeSignup}
                >
                  {loading ? <i className="fa-solid fa-spinner fa-spin" /> : 'Receber código para criar conta'}
                </button>
              </div>
            ) : null}

            <div className="social-divider"><span>OU</span></div>

            <button type="button" className="btn-google-shito" onClick={handleGoogleSignIn} disabled={loading}>
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
              CONECTAR COM GOOGLE
            </button>

            <p className="login-google-hint">
              Conta criada com Google? Use o botão acima. A senha do Gmail <strong>não</strong> é usada neste
              site — só o login oficial do Google.
            </p>

            <button
              type="button"
              className="btn-text-action"
              onClick={handleForgotPassword}
              disabled={loading || forgotCooldown > 0}
            >
              {forgotCooldown > 0 ? `Esqueci minha senha (${forgotCooldown}s)` : 'Esqueci minha senha'}
            </button>
          </>
        )}

        {/* STEP 2: CÓDIGO */}
        {step === 'code' && (
          <>
            <form onSubmit={handleVerifyCode} className="login-form">
              <div className="input-field">
                <i className="fa-solid fa-envelope" />
                <input
                  type="email"
                  placeholder="E-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <div className="input-field">
                <i className="fa-solid fa-hashtag" />
                <input
                  type="text"
                  placeholder="Código de 6 dígitos"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  disabled={loading}
                />
              </div>
              <button type="submit" className="btn-submit-shito" disabled={loading}>
                {loading ? <i className="fa-solid fa-spinner fa-spin" /> : 'VALIDAR CÓDIGO'}
              </button>
            </form>

            <div className="login-code-actions">
              <button
                type="button"
                className="btn-text-action"
                onClick={handleResendCode}
                disabled={loading || resendCooldown > 0}
              >
                {resendCooldown > 0 ? `Reenviar código (${resendCooldown}s)` : 'Reenviar código'}
              </button>
              <button
                type="button"
                className="btn-text-action"
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError('');
                  setInfo('');
                  setResendCooldown(0);
                }}
                disabled={loading}
              >
                Trocar e-mail
              </button>
            </div>
          </>
        )}

        {/* STEP 3: NOVO USUÁRIO */}
        {step === 'new-user' && (
          <>
            <div className="avatar-preview-container" onClick={() => setShowAvatarModal(true)}>
              <div className="avatar-circle-wrapper">
                <img src={selectedAvatar} alt="Avatar" className="avatar-preview-img"
                  onError={(e) => { e.target.src = AVATAR_FALLBACK; }} />
                <div className="edit-overlay"><i className="fa-solid fa-camera" /></div>
              </div>
              <p className="avatar-change-text">TOQUE PARA MUDAR O VISUAL</p>
            </div>

            <form onSubmit={handleRegisterWithPassword} className="login-form">
              <div className="signup-intent-picker">
                <span className="signup-intent-picker__label">Como você quer entrar?</span>
                <div className="signup-intent-picker__options">
                  <button
                    type="button"
                    className={`signup-intent-card ${signupIntent === 'reader' ? 'is-active' : ''}`}
                    onClick={() => setSignupIntent('reader')}
                  >
                    <strong>Leitor</strong>
                    <span>Entra lendo na hora, com favoritos, biblioteca e loja.</span>
                  </button>
                  <button
                    type="button"
                    className={`signup-intent-card ${signupIntent === 'creator' ? 'is-active' : ''}`}
                    onClick={() => setSignupIntent('creator')}
                  >
                    <strong>Quero ser mangaka</strong>
                    <span>Cria a conta agora e envia a solicitacao de creator logo depois, com revisao humana.</span>
                  </button>
                </div>
              </div>

              <div className="input-field">
                <i className="fa-solid fa-user" />
                <input
                  type="text"
                  placeholder="Nome do Usuário"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                  required
                  disabled={loading}
                />
              </div>
              <div className="input-field">
                <i className="fa-solid fa-envelope" />
                <input
                  type="email"
                  placeholder="E-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled
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

              <button type="submit" className="btn-submit-shito" disabled={loading}>
                {loading ? <i className="fa-solid fa-spinner fa-spin" /> : 'CRIAR CONTA'}
              </button>
            </form>

            <button
              type="button"
              className="btn-text-action"
              onClick={() => {
                setStep('code');
                setPassword('');
                setConfirmPassword('');
                setError('');
                setInfo('');
              }}
              disabled={loading}
            >
              Já tenho conta
            </button>
          </>
        )}

        {/* Conta existente só com Google (sem senha no Firebase) */}
        {step === 'existing-google' && (
          <>
            <p className="login-google-hint login-google-hint--block">
              Este e-mail foi cadastrado com <strong>Conectar com Google</strong>. O site não guarda a senha da
              sua conta Google — por isso digitar o e-mail e a senha do Gmail aqui não funciona.
            </p>
            <button type="button" className="btn-google-shito" onClick={handleGoogleSignIn} disabled={loading}>
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
              CONECTAR COM GOOGLE
            </button>
            <button
              type="button"
              className="btn-text-action"
              onClick={() => {
                setStep('email');
                setCode('');
                setError('');
                setInfo('');
                setResendCooldown(0);
              }}
              disabled={loading}
            >
              Usar outro e-mail
            </button>
          </>
        )}

        {/* STEP 4: USUÁRIO EXISTENTE (SENHA) */}
        {step === 'existing-password' && (
          <>
            <form onSubmit={handleExistingPasswordLogin} className="login-form">
              <div className="input-field">
                <i className="fa-solid fa-envelope" />
                <input
                  type="email"
                  placeholder="E-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled
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
              <button type="submit" className="btn-submit-shito" disabled={loading}>
                {loading ? <i className="fa-solid fa-spinner fa-spin" /> : 'ENTRAR'}
              </button>
            </form>

            {mostrarGoogleComoAlternativa && (
              <>
                <div className="social-divider"><span>OU</span></div>
                <button type="button" className="btn-google-shito" onClick={handleGoogleSignIn} disabled={loading}>
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
                  CONECTAR COM GOOGLE
                </button>
              </>
            )}

            <button
              type="button"
              className="btn-text-action"
              onClick={() => {
                setStep('code');
                setPassword('');
                setError('');
                setInfo('');
                setMostrarGoogleComoAlternativa(false);
              }}
              disabled={loading}
            >
              Voltar para código
            </button>
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
                  <button key={index} type="button"
                    className={`avatar-option-item ${selectedAvatar === path ? 'selected' : ''}`}
                    onClick={() => { setSelectedAvatar(path); setShowAvatarModal(false); }}>
                    <img src={path} alt={`Avatar ${index + 1}`}
                      onError={(e) => { e.target.src = AVATAR_FALLBACK; }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
