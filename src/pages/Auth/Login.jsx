// src/pages/Auth/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  sendPasswordResetEmail,
  sendEmailVerification,
  reload,
  signOut,
} from 'firebase/auth';
import { ref, get, onValue } from 'firebase/database';
import { auth, db, googleProvider } from '../../services/firebase';
import { LISTA_AVATARES, AVATAR_FALLBACK, isAdminUser } from '../../constants';
import { ensureUsuarioRecord, ativarContaUsuario, refreshAuthUser } from '../../userProfileSync';
import './Login.css';

// ── Chaves de sessionStorage ───────────────────────────────────────────────
// Persistem só enquanto a aba está aberta.
// Se o usuário fechar e reabrir, começa do zero (sem modal fantasma).
const PENDING_EMAIL_KEY  = 'shito_pending_email';
const RESEND_KEY         = 'shito_resend_until';
const FORGOT_KEY         = 'shito_forgot_until';
const ATTEMPT_LIMITS_KEY = 'shito_attempt_limits';

const ATTEMPT_RULES = {
  login:    { max: 8, windowMs: 10 * 60 * 1000, blockMs: 10 * 60 * 1000 },
  register: { max: 4, windowMs: 60 * 60 * 1000, blockMs: 45 * 60 * 1000 },
};

// ── Rate limiting ──────────────────────────────────────────────────────────
function getAttemptState(action) {
  const now    = Date.now();
  const parsed = JSON.parse(localStorage.getItem(ATTEMPT_LIMITS_KEY) || '{}');
  const entry  = parsed[action] || { count: 0, windowStart: now, blockedUntil: 0 };
  if (entry.blockedUntil && entry.blockedUntil > now)
    return { blocked: true, retryInSec: Math.ceil((entry.blockedUntil - now) / 1000) };
  return { blocked: false };
}

function registerAttemptResult(action, success) {
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
}

async function carregarStatusConta(uid) {
  const snap = await get(ref(db, `usuarios/${uid}/status`));
  return snap.exists() ? snap.val() : null;
}

// ── Componente ─────────────────────────────────────────────────────────────
export default function Login() {
  const navigate = useNavigate();

  const [displayName,     setDisplayName]     = useState('');
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRegistering,   setIsRegistering]   = useState(false);
  const [error,           setError]           = useState('');
  const [info,            setInfo]            = useState('');
  const [loading,         setLoading]         = useState(false);

  // 'idle' | 'pending'  — só email/senha chega em 'pending'
  const [verificationState,   setVerificationState]   = useState('idle');
  const [showModal,           setShowModal]           = useState(false);
  const [pendingEmailDisplay, setPendingEmailDisplay] = useState('');

  const [resendCooldown,  setResendCooldown]  = useState(0);
  const [forgotCooldown,  setForgotCooldown]  = useState(0);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [listaAvatares,   setListaAvatares]   = useState(LISTA_AVATARES);
  const [selectedAvatar,  setSelectedAvatar]  = useState(LISTA_AVATARES[0] || AVATAR_FALLBACK);

  const hasUpper   = /[A-Z]/.test(password);
  const hasNumber  = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasLength  = password.length >= 8;

  // ── Restaura pendência ao recarregar a página ──────────────────────────
  useEffect(() => {
    const saved = sessionStorage.getItem(PENDING_EMAIL_KEY);
    if (!saved) return;
    setPendingEmailDisplay(saved);
    setEmail(saved);
    setVerificationState('pending');
    setInfo('Verifique seu e-mail e clique em "Já verifiquei meu e-mail".');
  }, []);

  // ── Cooldowns ──────────────────────────────────────────────────────────
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

  // ── Avatares dinâmicos ─────────────────────────────────────────────────
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

  // ── Helpers de estado de verificação ──────────────────────────────────
  // IMPORTANTE: signOut JÁ deve ter sido chamado antes de chamar iniciarPendente.
  // Isso impede que o onAuthStateChanged do App.jsx detecte o usuário logado
  // e redirecione para '/' antes da tela de pendente aparecer.
  const iniciarPendente = (emailAddr) => {
    sessionStorage.setItem(PENDING_EMAIL_KEY, emailAddr);
    setPendingEmailDisplay(emailAddr);
    setEmail(emailAddr);
    setVerificationState('pending');
    setShowModal(true);
    setPassword('');
    setError('');
  };

  const limparPendente = () => {
    sessionStorage.removeItem(PENDING_EMAIL_KEY);
    setVerificationState('idle');
    setPendingEmailDisplay('');
    setShowModal(false);
    setPassword('');
  };

  // ── LOGIN COM GOOGLE ───────────────────────────────────────────────────
  // REGRA FINAL: Google → ativo direto. Sem email, sem link, sem modal.
  // O OAuth do Google já garante que o e-mail é real.
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const result     = await signInWithPopup(auth, googleProvider);
      const googleUser = result.user;

      if (isAdminUser(googleUser)) {
        // Admin: garante ficha e entra
        const av = listaAvatares[0] || AVATAR_FALLBACK;
        await ensureUsuarioRecord(googleUser, googleUser.displayName || 'Guerreiro', av, listaAvatares, 'ativo');
        await ativarContaUsuario(googleUser.uid);
        navigate('/', { replace: true });
        return;
      }

      const statusAtual = await carregarStatusConta(googleUser.uid);

      if (statusAtual === 'banido') {
        await signOut(auth);
        setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
        return;
      }

      // Avatar do sistema — não usa foto do Google
      const av = listaAvatares[0] || AVATAR_FALLBACK;
      await updateProfile(googleUser, {
        photoURL:    av,
        displayName: googleUser.displayName || 'Guerreiro',
      });
      await refreshAuthUser(googleUser);

      // ensureUsuarioRecord com 'ativo': se conta nova, cria pendente e já ativa em seguida
      // Se conta já existe, não toca no status
      await ensureUsuarioRecord(googleUser, googleUser.displayName || 'Guerreiro', av, listaAvatares, 'ativo');

      // Garante ativação independente do que havia antes (pendente, inativo, null)
      // Se já era ativo, ativarContaUsuario só atualiza lastLogin
      await ativarContaUsuario(googleUser.uid);

      // Limpa qualquer pendência de email/senha com o mesmo email (caso raro)
      const savedEm = sessionStorage.getItem(PENDING_EMAIL_KEY);
      if (savedEm && savedEm.toLowerCase() === (googleUser.email || '').toLowerCase()) {
        limparPendente();
      }

      navigate('/', { replace: true });

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

  // ── LOGIN / CADASTRO COM EMAIL + SENHA ─────────────────────────────────
  // REGRA FINAL: email/senha → obriga verificação de email.
  // Cadastro: cria conta → envia link → signOut → tela de pendente.
  // Login: se não verificou → reenvia link → signOut → tela de pendente.
  //        se verificou → ativa → entra.
  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    const action = isRegistering ? 'register' : 'login';
    const attempt = getAttemptState(action);
    if (attempt.blocked) {
      setError(`Muitas tentativas. Tente novamente em ${attempt.retryInSec}s.`);
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
        // ── CADASTRO ────────────────────────────────────────────────────
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);

        await updateProfile(cred.user, {
          displayName: displayName.trim(),
          photoURL:    selectedAvatar,
        });

        // Ficha nasce como pendente — só ativa após clicar no link
        await ensureUsuarioRecord(cred.user, displayName.trim(), selectedAvatar, listaAvatares, 'pendente');

        // Envia link de verificação
        // handleCodeInApp: false → Firebase redireciona para a URL normal
        // sem precisar do domínio configurado como dynamic link
        await sendEmailVerification(cred.user, {
          url:            `${window.location.origin}/login`,
          handleCodeInApp: false,
        });

        // CRÍTICO: signOut ANTES de qualquer setState relacionado à tela de pendente.
        // Se o usuário ainda estiver logado quando o React re-renderizar,
        // o onAuthStateChanged do App.jsx detecta e redireciona para '/'
        // antes da tela de pendente aparecer.
        await signOut(auth);

        // Agora sim: muda a tela para pendente
        registerAttemptResult('register', true);
        setIsRegistering(false);
        iniciarPendente(email.trim());
        return;

      } else {
        // ── LOGIN ────────────────────────────────────────────────────────
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await refreshAuthUser(cred.user);

        // Admin: entra direto sem verificação de email
        if (isAdminUser(cred.user)) {
          const av = listaAvatares[0] || AVATAR_FALLBACK;
          await ensureUsuarioRecord(cred.user, cred.user.displayName || 'Guerreiro', cred.user.photoURL || av, listaAvatares, 'ativo');
          await ativarContaUsuario(cred.user.uid);
          registerAttemptResult('login', true);
          navigate('/', { replace: true });
          return;
        }

        const statusConta = await carregarStatusConta(cred.user.uid);

        if (statusConta === 'banido') {
          await signOut(auth);
          setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
          return;
        }

        // Email não verificado → reenvia link e manda para tela de pendente
        if (!cred.user.emailVerified) {
          await sendEmailVerification(cred.user, {
            url:            `${window.location.origin}/login`,
            handleCodeInApp: false,
          });
          // CRÍTICO: signOut ANTES dos setState
          await signOut(auth);
          iniciarPendente(email.trim());
          setError('Seu e-mail ainda não foi verificado. Enviamos um novo link.');
          return;
        }

        // Email verificado — garante ficha e ativa se necessário
        const av = listaAvatares[0] || AVATAR_FALLBACK;
        await ensureUsuarioRecord(cred.user, cred.user.displayName || 'Guerreiro', cred.user.photoURL || av, listaAvatares, 'pendente');

        if (!statusConta || statusConta === 'pendente') {
          await ativarContaUsuario(cred.user.uid);
        }

        limparPendente();
        registerAttemptResult('login', true);
        navigate('/', { replace: true });
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
      setLoading(false);
    }
  };

  // ── ESQUECI A SENHA ────────────────────────────────────────────────────
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

  // ── REENVIAR LINK DE VERIFICAÇÃO ───────────────────────────────────────
  const handleResendVerification = async () => {
    setError(''); setInfo('');
    if (resendCooldown > 0) { setError(`Aguarde ${resendCooldown}s para reenviar.`); return; }
    if (!email.trim() || !password) {
      setError('Preencha e-mail e senha para reenviar o link.');
      return;
    }
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await refreshAuthUser(cred.user);

      // Já verificou antes de clicar em reenviar — aproveita e ativa
      if (cred.user.emailVerified) {
        const av = listaAvatares[0] || AVATAR_FALLBACK;
        await ensureUsuarioRecord(cred.user, cred.user.displayName || 'Guerreiro', cred.user.photoURL || av, listaAvatares, 'pendente');
        await ativarContaUsuario(cred.user.uid);
        limparPendente();
        setInfo('E-mail já confirmado! Entrando...');
        navigate('/', { replace: true });
        return;
      }

      await sendEmailVerification(cred.user, {
        url:            `${window.location.origin}/login`,
        handleCodeInApp: false,
      });
      await signOut(auth);

      sessionStorage.setItem(RESEND_KEY, String(Date.now() + 60_000));
      setResendCooldown(60);
      setInfo('Novo link enviado. Confira caixa de entrada e spam.');
    } catch (err) {
      const msgs = {
        'auth/invalid-email':      'E-mail inválido.',
        'auth/user-not-found':     'Conta não encontrada.',
        'auth/wrong-password':     'Senha incorreta.',
        'auth/invalid-credential': 'Credenciais inválidas.',
        'auth/too-many-requests':  'Muitas tentativas. Aguarde.',
      };
      setError(msgs[err.code] || 'Não foi possível reenviar o link.');
    } finally { setLoading(false); }
  };

  // ── JÁ VERIFIQUEI MEU E-MAIL ───────────────────────────────────────────
  const handleCheckVerification = async () => {
    setError(''); setInfo('');
    if (!email.trim() || !password) {
      setError('Preencha e-mail e senha para confirmar.');
      return;
    }
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await refreshAuthUser(cred.user);

      if (!cred.user.emailVerified) {
        await signOut(auth);
        setError('E-mail ainda não confirmado. Abra o link no e-mail e tente de novo.');
        return;
      }

      const av = listaAvatares[0] || AVATAR_FALLBACK;
      await ensureUsuarioRecord(cred.user, cred.user.displayName || 'Guerreiro', cred.user.photoURL || av, listaAvatares, 'pendente');
      await ativarContaUsuario(cred.user.uid);
      limparPendente();
      setInfo('Conta ativada! Bem-vindo à Tempestade.');
      navigate('/', { replace: true });

    } catch (err) {
      const msgs = {
        'auth/invalid-email':      'E-mail inválido.',
        'auth/user-not-found':     'Conta não encontrada.',
        'auth/wrong-password':     'Senha incorreta.',
        'auth/invalid-credential': 'Credenciais inválidas.',
        'auth/too-many-requests':  'Muitas tentativas. Aguarde.',
      };
      setError(msgs[err.code] || 'Não foi possível confirmar. Tente de novo.');
    } finally { setLoading(false); }
  };

  const estaEmVerificacao = verificationState === 'pending';

  // ── RENDER ─────────────────────────────────────────────────────────────
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

        {/* ── TELA DE VERIFICAÇÃO PENDENTE ── */}
        {estaEmVerificacao && (
          <div className="verification-box">
            <p>
              Acesse <strong>{pendingEmailDisplay}</strong>, clique no link de ativação
              e volte aqui para confirmar. Verifique também o spam e lixo eletrônico.
            </p>

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
                Já verifiquei meu e-mail
              </button>
            </div>

            <button
              type="button"
              className="btn-text-action"
              onClick={() => { limparPendente(); setError(''); setInfo(''); }}
              style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}
            >
              Voltar ao login
            </button>
          </div>
        )}

        {/* ── FORMULÁRIO NORMAL ── */}
        {!estaEmVerificacao && (
          <>
            {isRegistering && (
              <div className="avatar-preview-container" onClick={() => setShowAvatarModal(true)}>
                <div className="avatar-circle-wrapper">
                  <img src={selectedAvatar} alt="Avatar" className="avatar-preview-img"
                    onError={(e) => { e.target.src = AVATAR_FALLBACK; }} />
                  <div className="edit-overlay"><i className="fa-solid fa-camera" /></div>
                </div>
                <p className="avatar-change-text">TOQUE PARA MUDAR O VISUAL</p>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="login-form">
              {isRegistering && (
                <div className="input-field">
                  <i className="fa-solid fa-user" />
                  <input type="text" placeholder="Nome do Usuário" value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)} maxLength={25} required disabled={loading} />
                </div>
              )}

              <div className="input-field">
                <i className="fa-solid fa-envelope" />
                <input type="email" placeholder="E-mail" value={email}
                  onChange={(e) => setEmail(e.target.value)} required disabled={loading} />
              </div>

              <div className="input-field">
                <i className="fa-solid fa-lock" />
                <input type="password" placeholder="Senha" value={password}
                  onChange={(e) => setPassword(e.target.value)} required disabled={loading} />
              </div>

              {isRegistering && (
                <>
                  <div className="input-field">
                    <i className="fa-solid fa-shield-halved" />
                    <input type="password" placeholder="Confirmar Senha" value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)} required disabled={loading} />
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

            <button type="button" className="btn-google-shito" onClick={handleGoogleSignIn} disabled={loading}>
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
              CONECTAR COM GOOGLE
            </button>

            {/* Botão para quem fechou a tela de pendente sem querer */}
            {!isRegistering && (
              <button
                type="button"
                className="btn-text-action"
                style={{ marginTop: '8px' }}
                disabled={loading}
                onClick={() => {
                  const saved = sessionStorage.getItem(PENDING_EMAIL_KEY);
                  if (saved) {
                    // Já tem pendência salva — restaura a tela
                    setPendingEmailDisplay(saved);
                    setEmail(saved);
                    setVerificationState('pending');
                    setError('');
                    setInfo('');
                  } else if (email.trim()) {
                    // Usuário digitou o email — inicia fluxo de validação
                    iniciarPendente(email.trim());
                    setInfo('Digite sua senha e clique em "Já verifiquei meu e-mail".');
                  } else {
                    setError('Digite o e-mail que você usou no cadastro.');
                  }
                }}
              >
                Validar minha conta
              </button>
            )}

            {!isRegistering && (
              <button type="button" className="btn-text-action" onClick={handleForgotPassword}
                disabled={loading || forgotCooldown > 0}>
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

      {/* Modal explicativo — aparece só após cadastro email/senha */}
      {showModal && (
        <div className="verify-modal-overlay">
          <div className="verify-modal-card">
            <h3>Verifique seu e-mail para ativar a conta</h3>
            <p>
              Enviamos um link de ativação para <strong>{pendingEmailDisplay}</strong>.<br /><br />
              Verifique sua caixa de entrada <strong>e também o spam / lixo eletrônico</strong>.<br />
              Clique no link e depois volte aqui e clique em{' '}
              <strong>"Já verifiquei meu e-mail"</strong>.<br /><br />
              Sua conta ficará pendente. Se não confirmar em até{' '}
              <strong>40 minutos</strong>, ela será removida automaticamente.
            </p>
            <button type="button" className="btn-verify-primary" onClick={() => setShowModal(false)}>
              Entendi
            </button>
          </div>
        </div>
      )}
    </main>
  );
}