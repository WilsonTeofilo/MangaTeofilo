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
  reload,
  signOut,
} from 'firebase/auth';
import { ref, set, get, update, onValue } from 'firebase/database';
import { auth, db, googleProvider } from '../../services/firebase';
import { LISTA_AVATARES, AVATAR_FALLBACK, isAdminUser } from '../../constants';
import './Login.css';

const PENDING_METHOD_KEY = 'login_pending_method';
const PENDING_EMAIL_KEY  = 'login_pending_email';
const RESEND_KEY         = 'login_resend_verification_until';
const FORGOT_KEY         = 'login_forgot_password_until';
const ATTEMPT_LIMITS_KEY = 'login_attempt_limits_v1';
const ATTEMPT_RULES = {
  login:    { max: 6, windowMs: 10 * 60 * 1000, blockMs: 15 * 60 * 1000 },
  register: { max: 3, windowMs: 60 * 60 * 1000, blockMs: 60 * 60 * 1000 },
};

// Avisa o App.jsx que o sessionStorage mudou — ele escuta esse evento
// para atualizar o estado `temPending` de forma reativa.
function notificarPendingChanged() {
  window.dispatchEvent(new Event('pendingVerificationChanged'));
}

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

  // 'idle' | 'pending_email' | 'pending_google'
  const [verificationState,     setVerificationState]     = useState('idle');
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [pendingEmailDisplay,   setPendingEmailDisplay]   = useState('');

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

  // ── Retoma verificação pendente entre recargas ────────────────────────────
  useEffect(() => {
    const method = sessionStorage.getItem(PENDING_METHOD_KEY);
    const em     = sessionStorage.getItem(PENDING_EMAIL_KEY);
    if (!method) return;
    setPendingEmailDisplay(em || '');
    setEmail(em || '');
    setVerificationState(method === 'google' ? 'pending_google' : 'pending_email');
    setInfo('Conta pendente. Verifique seu e-mail e clique em "Já verifiquei meu e-mail".');
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

  // ── Sincroniza perfil público ─────────────────────────────────────────────
  const sincronizarUsuarioPublico = async (usuario, nome, foto, accountType = 'comum') => {
    await set(ref(db, `usuarios_publicos/${usuario.uid}`), {
      uid:        usuario.uid,
      userName:   nome || 'Guerreiro',
      userAvatar: foto || AVATAR_FALLBACK,
      accountType,
      updatedAt:  Date.now(),
    });
  };

  // ── Sincroniza perfil privado ─────────────────────────────────────────────
  const sincronizarUsuarioNoBanco = async (usuario, nome, foto, avataresList) => {
    const userRef  = ref(db, `usuarios/${usuario.uid}`);
    const snapshot = await get(userRef);
    const agora    = Date.now();
    const av       = (avataresList && avataresList[0]) || AVATAR_FALLBACK;

    const defaults = {
      uid:               usuario.uid,
      userName:          nome || 'Guerreiro',
      userAvatar:        foto || av,
      role:              'user',
      accountType:       'comum',
      gender:            'nao_informado',
      birthYear:         null,
      status:            'pendente',
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

    if (!snapshot.exists() || !snapshot.val()?.status) {
      await set(userRef, defaults);
      await sincronizarUsuarioPublico(usuario, defaults.userName, defaults.userAvatar, defaults.accountType);
      return;
    }

    const atual = snapshot.val() || {};
    const patch  = { lastLogin: agora };
    if (!atual.uid)         patch.uid         = usuario.uid;
    if (!atual.userName)    patch.userName    = defaults.userName;
    if (!atual.userAvatar)  patch.userAvatar  = defaults.userAvatar;
    if (!atual.createdAt)   patch.createdAt   = agora;
    if (!atual.role)        patch.role        = 'user';
    if (!atual.accountType) patch.accountType = 'comum';
    if (!atual.gender)      patch.gender      = 'nao_informado';
    if (typeof atual.birthYear !== 'number' && atual.birthYear !== null) patch.birthYear = null;
    if (!atual.status)      patch.status      = 'pendente';
    if (typeof atual.notifyNewChapter !== 'boolean') patch.notifyNewChapter = false;
    if (typeof atual.marketingOptIn   !== 'boolean') patch.marketingOptIn   = false;
    if (typeof atual.marketingOptInAt !== 'number' && atual.marketingOptInAt !== null) patch.marketingOptInAt = null;
    if (!atual.membershipStatus)  patch.membershipStatus  = 'inativo';
    if (typeof atual.memberUntil   !== 'number' && atual.memberUntil   !== null) patch.memberUntil   = null;
    if (typeof atual.currentPlanId !== 'string' && atual.currentPlanId !== null) patch.currentPlanId = null;
    if (typeof atual.lastPaymentAt !== 'number' && atual.lastPaymentAt !== null) patch.lastPaymentAt = null;
    if (!atual.sourceAcquisition) patch.sourceAcquisition = 'organico';

    await update(userRef, patch);
    await sincronizarUsuarioPublico(
      usuario,
      atual.userName    || patch.userName    || defaults.userName,
      atual.userAvatar  || patch.userAvatar  || defaults.userAvatar,
      atual.accountType || patch.accountType || defaults.accountType
    );
  };

  const carregarStatusConta = async (uid) => {
    const snap = await get(ref(db, `usuarios/${uid}`));
    if (!snap.exists()) return 'pendente';
    return snap.val()?.status || 'pendente';
  };

  const ativarConta = async (uid) => {
    await update(ref(db, `usuarios/${uid}`), { status: 'ativo', lastLogin: Date.now() });
  };

  // ── Helpers de verificação ────────────────────────────────────────────────
  const iniciarFluxoVerificacao = (method, emailAddr) => {
    sessionStorage.setItem(PENDING_METHOD_KEY, method);
    sessionStorage.setItem(PENDING_EMAIL_KEY, emailAddr);
    notificarPendingChanged(); // ← avisa o App para re-renderizar
    setPendingEmailDisplay(emailAddr);
    setEmail(emailAddr);
    setVerificationState(method === 'google' ? 'pending_google' : 'pending_email');
    setShowVerificationModal(true);
  };

  const limparFluxoVerificacao = () => {
    sessionStorage.removeItem(PENDING_METHOD_KEY);
    sessionStorage.removeItem(PENDING_EMAIL_KEY);
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
    try {
      const result     = await signInWithPopup(auth, googleProvider);
      const googleUser = result.user;

      // Admin sempre entra direto
      if (isAdminUser(googleUser)) {
        await sincronizarUsuarioNoBanco(googleUser, googleUser.displayName, listaAvatares[0] || AVATAR_FALLBACK, listaAvatares);
        await ativarConta(googleUser.uid);
        navigate('/');
        return;
      }

      const statusAtual = await carregarStatusConta(googleUser.uid);

      if (statusAtual === 'banido') {
        await signOut(auth);
        setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
        return;
      }

      if (statusAtual === 'ativo') {
        // Conta já ativa — entra direto
        await sincronizarUsuarioNoBanco(googleUser, googleUser.displayName, listaAvatares[0] || AVATAR_FALLBACK, listaAvatares);
        navigate('/');
        return;
      }

      // Conta nova ou pendente — avatar do sistema, nome do Google
      await sincronizarUsuarioNoBanco(
        googleUser,
        googleUser.displayName,
        listaAvatares[0] || AVATAR_FALLBACK,
        listaAvatares
      );
      await sendEmailVerification(googleUser);
      await signOut(auth);

      iniciarFluxoVerificacao('google', googleUser.email || '');
      setInfo('Conta criada! Verifique seu e-mail e clique em "Já verifiquei meu e-mail".');

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
        await sincronizarUsuarioNoBanco(cred.user, displayName.trim(), selectedAvatar, listaAvatares);
        await sendEmailVerification(cred.user);
        await signOut(auth);

        iniciarFluxoVerificacao('email', email.trim());
        setInfo('Conta criada! Verifique seu e-mail e clique em "Já verifiquei meu e-mail".');
        registerAttemptResult('register', true);
        setIsRegistering(false);
        return;

      } else {
        // ── LOGIN ─────────────────────────────────────────────────────────
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await reload(cred.user);

        // Admin entra direto sempre
        if (isAdminUser(cred.user)) {
          await sincronizarUsuarioNoBanco(cred.user, cred.user.displayName, cred.user.photoURL, listaAvatares);
          registerAttemptResult('login', true);
          setTimeout(() => navigate('/'), 800);
          return;
        }

        const statusConta = await carregarStatusConta(cred.user.uid);

        if (statusConta === 'banido') {
          await signOut(auth);
          setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
          return;
        }

        // Email não verificado → manda pro fluxo de verificação
        if (!cred.user.emailVerified) {
          await sendEmailVerification(cred.user);
          await signOut(auth);
          iniciarFluxoVerificacao('email', email.trim());
          setError('Seu e-mail ainda não foi verificado. Verifique sua caixa e clique no link.');
          return;
        }

        // Email verificado + pendente → ativa agora
        if (statusConta === 'pendente' && cred.user.emailVerified) {
          await ativarConta(cred.user.uid);
        }

        await sincronizarUsuarioNoBanco(cred.user, cred.user.displayName, cred.user.photoURL, listaAvatares);
        registerAttemptResult('login', true);
        setTimeout(() => navigate('/'), 800);
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

  // ── REENVIAR VERIFICAÇÃO ──────────────────────────────────────────────────
  const handleResendVerification = async () => {
    setError(''); setInfo('');
    if (resendCooldown > 0) { setError(`Aguarde ${resendCooldown}s para reenviar.`); return; }
    setLoading(true);
    try {
      let currentUser = null;

      if (verificationState === 'pending_google') {
        const result = await signInWithPopup(auth, googleProvider);
        await reload(result.user);
        currentUser = result.user;
      } else {
        if (!email.trim() || !password) {
          setError('Preencha e-mail e senha para reenviar.');
          setLoading(false);
          return;
        }
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await reload(cred.user);
        currentUser = cred.user;
      }

      // Já verificou antes de reenviar — ativa e libera
      if (currentUser.emailVerified) {
        await ativarConta(currentUser.uid);
        await sincronizarUsuarioNoBanco(currentUser, currentUser.displayName, currentUser.photoURL, listaAvatares);
        limparFluxoVerificacao();
        setInfo('E-mail já confirmado! Entrando...');
        setTimeout(() => navigate('/'), 800);
        return;
      }

      // Não verificou — reenvia e avisa que o link anterior foi invalidado
      await sendEmailVerification(currentUser);
      await signOut(auth);
      sessionStorage.setItem(RESEND_KEY, String(Date.now() + 60_000));
      setResendCooldown(60);
      setInfo('Novo e-mail enviado. O link anterior foi invalidado. Confira sua caixa e spam.');
    } catch (err) {
      const msgs = {
        'auth/invalid-email':        'E-mail inválido.',
        'auth/user-not-found':       'Conta não encontrada.',
        'auth/wrong-password':       'Senha incorreta.',
        'auth/invalid-credential':   'Credenciais inválidas.',
        'auth/too-many-requests':    'Muitas tentativas. Aguarde.',
        'auth/popup-closed-by-user': 'Popup fechado. Tente novamente.',
      };
      setError(msgs[err.code] || 'Não foi possível reenviar o e-mail.');
    } finally { setLoading(false); }
  };

  // ── JÁ VERIFIQUEI MEU E-MAIL ──────────────────────────────────────────────
  const handleCheckVerification = async () => {
    setError(''); setInfo('');
    setLoading(true);
    try {
      let currentUser = null;

      if (verificationState === 'pending_google') {
        const result = await signInWithPopup(auth, googleProvider);
        await reload(result.user);
        currentUser = result.user;
      } else {
        if (!email.trim() || !password) {
          setError('Preencha e-mail e senha para validar.');
          setLoading(false);
          return;
        }
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await reload(cred.user);
        currentUser = cred.user;
      }

      if (!currentUser.emailVerified) {
        await signOut(auth);
        setError('E-mail ainda não confirmado. Clique no link no seu e-mail e tente novamente.');
        return;
      }

      await ativarConta(currentUser.uid);
      await sincronizarUsuarioNoBanco(currentUser, currentUser.displayName, currentUser.photoURL, listaAvatares);
      limparFluxoVerificacao();
      setInfo('E-mail confirmado! Bem-vindo à Tempestade.');
      setTimeout(() => navigate('/'), 800);
    } catch (err) {
      const msgs = {
        'auth/invalid-email':        'E-mail inválido.',
        'auth/user-not-found':       'Conta não encontrada.',
        'auth/wrong-password':       'Senha incorreta.',
        'auth/invalid-credential':   'Credenciais inválidas.',
        'auth/popup-closed-by-user': 'Popup fechado. Tente novamente.',
      };
      setError(msgs[err.code] || 'Não foi possível validar. Tente novamente.');
    } finally { setLoading(false); }
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

            {/* Botão VALIDAR CONTA — aparece na tela de login normal */}
            {/* Útil para quem saiu da tela e voltou sem ter ativado */}
            {!isRegistering && (
              <button
                type="button"
                className="btn-text-action"
                onClick={() => {
                  const method = sessionStorage.getItem(PENDING_METHOD_KEY);
                  const em     = sessionStorage.getItem(PENDING_EMAIL_KEY);
                  if (method) {
                    setPendingEmailDisplay(em || email);
                    setEmail(em || email);
                    setVerificationState(method === 'google' ? 'pending_google' : 'pending_email');
                    setError(''); setInfo('');
                  } else {
                    // Não tem pending salvo — pede email e manda pro fluxo
                    if (!email.trim()) {
                      setError('Digite seu e-mail para validar a conta.');
                      return;
                    }
                    iniciarFluxoVerificacao('email', email.trim());
                    setInfo('Digite sua senha e clique em "Já verifiquei meu e-mail".');
                  }
                }}
                style={{ marginTop: '0.25rem' }}
                disabled={loading}
              >
                Validar conta
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

