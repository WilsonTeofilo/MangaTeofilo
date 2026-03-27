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

export default function Login() {
  const navigate = useNavigate();

  // Estados do formulário
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const RESEND_KEY = 'login_resend_verification_until';
  const FORGOT_KEY = 'login_forgot_password_until';
  const PENDING_VERIFICATION_KEY = 'login_pending_verification_email';
  const ATTEMPT_LIMITS_KEY = 'login_attempt_limits_v1';
  const ATTEMPT_RULES = {
    login: { max: 6, windowMs: 10 * 60 * 1000, blockMs: 15 * 60 * 1000 },
    register: { max: 3, windowMs: 60 * 60 * 1000, blockMs: 60 * 60 * 1000 },
  };

  // Modal de seleção de avatar
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [listaAvatares, setListaAvatares] = useState(LISTA_AVATARES);
  const [selectedAvatar, setSelectedAvatar] = useState(LISTA_AVATARES[0] || AVATAR_FALLBACK);
  const isRegisteringFlowRef = useRef(false);

  // Regex para validação visual
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasLength = password.length >= 8;

  useEffect(() => {
    const now = Date.now();
    const resendUntil = Number(sessionStorage.getItem(RESEND_KEY) || 0);
    const forgotUntil = Number(sessionStorage.getItem(FORGOT_KEY) || 0);

    if (resendUntil > now) {
      setResendCooldown(Math.ceil((resendUntil - now) / 1000));
    } else {
      sessionStorage.removeItem(RESEND_KEY);
    }

    if (forgotUntil > now) {
      setForgotCooldown(Math.ceil((forgotUntil - now) / 1000));
    } else {
      sessionStorage.removeItem(FORGOT_KEY);
    }
  }, []);

  const getAttemptState = (action) => {
    const now = Date.now();
    const raw = localStorage.getItem(ATTEMPT_LIMITS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const entry = parsed[action] || { count: 0, windowStart: now, blockedUntil: 0 };
    if (entry.blockedUntil && entry.blockedUntil > now) {
      return { blocked: true, retryInSec: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    if (!entry.windowStart || now - entry.windowStart > ATTEMPT_RULES[action].windowMs) {
      return { blocked: false, store: parsed, entry: { count: 0, windowStart: now, blockedUntil: 0 } };
    }
    return { blocked: false, store: parsed, entry };
  };

  const registerAttemptResult = (action, success) => {
    const now = Date.now();
    const raw = localStorage.getItem(ATTEMPT_LIMITS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const baseEntry = parsed[action] || { count: 0, windowStart: now, blockedUntil: 0 };
    const entry = { ...baseEntry };

    if (success) {
      entry.count = 0;
      entry.windowStart = now;
      entry.blockedUntil = 0;
    } else {
      if (!entry.windowStart || now - entry.windowStart > ATTEMPT_RULES[action].windowMs) {
        entry.count = 0;
        entry.windowStart = now;
        entry.blockedUntil = 0;
      }
      entry.count += 1;
      if (entry.count >= ATTEMPT_RULES[action].max) {
        entry.blockedUntil = now + ATTEMPT_RULES[action].blockMs;
      }
    }

    parsed[action] = entry;
    localStorage.setItem(ATTEMPT_LIMITS_KEY, JSON.stringify(parsed));
  };

  useEffect(() => {
    const pendingEmail = sessionStorage.getItem(PENDING_VERIFICATION_KEY);
    if (!pendingEmail) return;

    setEmail(pendingEmail);
    setRequiresVerification(true);
    setShowVerificationModal(true);
    setIsRegistering(false);
    setInfo('Conta pendente de verificacao. Confira o e-mail enviado e conclua a validacao.');
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (forgotCooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setForgotCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [forgotCooldown]);

  useEffect(() => {
    if (resendCooldown === 0) {
      sessionStorage.removeItem(RESEND_KEY);
    }
  }, [resendCooldown, RESEND_KEY]);

  useEffect(() => {
    if (forgotCooldown === 0) {
      sessionStorage.removeItem(FORGOT_KEY);
    }
  }, [forgotCooldown, FORGOT_KEY]);

  useEffect(() => {
    const unsub = onValue(ref(db, 'avatares'), (snap) => {
      if (!snap.exists()) return;
      const data = Object.values(snap.val() || {})
        .filter((item) => item?.active !== false && typeof item?.url === 'string')
        .sort((a, b) => {
          const aOrder = typeof a?.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
          const bOrder = typeof b?.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return (b?.createdAt || 0) - (a?.createdAt || 0);
        })
        .map((item) => item.url);
      if (data.length > 0) {
        setListaAvatares(data);
        setSelectedAvatar((prev) => (data.includes(prev) ? prev : data[0]));
      }
    });
    return () => unsub();
  }, []);

  // Função auxiliar para sincronizar usuário no Realtime Database
  const sincronizarUsuarioPublico = async (usuario, nome, foto, accountType = 'comum') => {
    await set(ref(db, `usuarios_publicos/${usuario.uid}`), {
      uid: usuario.uid,
      userName: nome || 'Guerreiro',
      userAvatar: foto || listaAvatares[0] || AVATAR_FALLBACK,
      accountType,
      updatedAt: Date.now(),
    });
  };

  const sincronizarUsuarioNoBanco = async (usuario, nome, foto) => {
    const userRef = ref(db, `usuarios/${usuario.uid}`);
    const snapshot = await get(userRef);
    const agora = Date.now();

    const defaults = {
      uid: usuario.uid,
      userName: nome || 'Guerreiro',
      userAvatar: foto || listaAvatares[0],
      role: 'user',
      accountType: 'comum',
      gender: 'nao_informado',
      birthYear: null,
      status: isRegistering ? 'pendente' : 'ativo',
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

    if (!snapshot.exists() || isRegistering) {
      await set(userRef, defaults);
      await sincronizarUsuarioPublico(usuario, defaults.userName, defaults.userAvatar, defaults.accountType);
      return;
    }

    const atual = snapshot.val() || {};
    const patch = {
      lastLogin: agora,
    };

    if (!atual.uid) patch.uid = usuario.uid;
    if (!atual.userName) patch.userName = defaults.userName;
    if (!atual.userAvatar) patch.userAvatar = defaults.userAvatar;
    if (!atual.createdAt) patch.createdAt = agora;
    if (!atual.role) patch.role = 'user';
    if (!atual.accountType) patch.accountType = 'comum';
    if (!atual.gender) patch.gender = 'nao_informado';
    if (typeof atual.birthYear !== 'number' && atual.birthYear !== null) patch.birthYear = null;
    if (!atual.status) patch.status = 'ativo';
    if (typeof atual.notifyNewChapter !== 'boolean') patch.notifyNewChapter = false;
    if (typeof atual.marketingOptIn !== 'boolean') patch.marketingOptIn = false;
    if (typeof atual.marketingOptInAt !== 'number' && atual.marketingOptInAt !== null) patch.marketingOptInAt = null;
    if (!atual.membershipStatus) patch.membershipStatus = 'inativo';
    if (typeof atual.memberUntil !== 'number' && atual.memberUntil !== null) patch.memberUntil = null;
    if (typeof atual.currentPlanId !== 'string' && atual.currentPlanId !== null) patch.currentPlanId = null;
    if (typeof atual.lastPaymentAt !== 'number' && atual.lastPaymentAt !== null) patch.lastPaymentAt = null;
    if (!atual.sourceAcquisition) patch.sourceAcquisition = 'organico';

    await update(userRef, patch);
    await sincronizarUsuarioPublico(
      usuario,
      atual.userName || patch.userName || defaults.userName,
      atual.userAvatar || patch.userAvatar || defaults.userAvatar,
      atual.accountType || patch.accountType || defaults.accountType
    );
  };

  const carregarStatusConta = async (uid) => {
    const snap = await get(ref(db, `usuarios/${uid}`));
    if (!snap.exists()) return 'ativo';
    return snap.val()?.status || 'ativo';
  };

  const ativarConta = async (uid) => {
    await update(ref(db, `usuarios/${uid}`), {
      status: 'ativo',
      lastLogin: Date.now(),
    });
  };

  // Login com Google
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await sincronizarUsuarioNoBanco(result.user, result.user.displayName, result.user.photoURL);

      const statusConta = await carregarStatusConta(result.user.uid);
      if (statusConta === 'banido') {
        await signOut(auth);
        setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
        return;
      }

      if (statusConta === 'pendente') {
        await ativarConta(result.user.uid);
      }

      navigate('/');
    } catch (err) {
      let message = 'Falha ao conectar com Google';
      if (err.code === 'auth/popup-closed-by-user') {
        message = 'Popup fechado. Tente novamente.';
      } else if (err.code === 'auth/account-exists-with-different-credential') {
        message = 'Essa conta já existe com outro método de login.';
      }
      setError(`${message}: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Submit do formulário (email/password)
  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    const action = isRegistering ? 'register' : 'login';
    const attemptState = getAttemptState(action);
    if (attemptState.blocked) {
      setError(`Muitas tentativas. Tente novamente em ${attemptState.retryInSec}s.`);
      setLoading(false);
      return;
    }

    if (isRegistering) {
      if (!displayName.trim()) {
        setError('Escolha um nome para sua alma.');
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError('As senhas não coincidem.');
        setLoading(false);
        return;
      }
      // Validação de segurança
      if (!hasUpper || !hasNumber || !hasSpecial || !hasLength) {
        setError('A senha não atende aos requisitos de segurança.');
        setLoading(false);
        return;
      }
    }

    try {
      let userCredential;
      if (isRegistering) {
        isRegisteringFlowRef.current = true;
        userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(userCredential.user, {
          displayName: displayName.trim(),
          photoURL: selectedAvatar,
        });
        await sincronizarUsuarioNoBanco(userCredential.user, displayName.trim(), selectedAvatar);
        await sendEmailVerification(userCredential.user);
        sessionStorage.setItem(PENDING_VERIFICATION_KEY, email.trim());
        await signOut(auth);
        setRequiresVerification(true);
        setShowVerificationModal(true);
        setInfo('Conta criada! Enviamos um e-mail de verificacao. Verifique sua caixa e depois clique em "Ja verifiquei meu e-mail".');
        registerAttemptResult('register', true);
        setIsRegistering(false);
        return;
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
        await reload(userCredential.user);

        const isGoogle = userCredential.user.providerData?.some((p) => p.providerId === 'google.com');
        const statusConta = await carregarStatusConta(userCredential.user.uid);

        if (statusConta === 'banido') {
          await signOut(auth);
          setError('Sua conta foi bloqueada. Entre em contato com o suporte.');
          return;
        }

        if (!userCredential.user.emailVerified && !isGoogle && !isAdminUser(userCredential.user)) {
          await sendEmailVerification(userCredential.user);
          await signOut(auth);
          setRequiresVerification(true);
          setError('Seu e-mail ainda nao foi verificado. Enviamos um novo link para voce.');
          return;
        }

        if (statusConta === 'pendente' && userCredential.user.emailVerified) {
          await ativarConta(userCredential.user.uid);
        }

        await sincronizarUsuarioNoBanco(
          userCredential.user,
          userCredential.user.displayName,
          userCredential.user.photoURL
        );
        registerAttemptResult('login', true);
      }
      setTimeout(() => navigate('/'), 800);
    } catch (err) {
      registerAttemptResult(action, false);
      let message = 'Erro ao conectar à Tempestade';
      switch (err.code) {
        case 'auth/invalid-email': message = 'E-mail inválido.'; break;
        case 'auth/user-not-found':
        case 'auth/wrong-password': message = 'E-mail ou senha incorretos.'; break;
        case 'auth/email-already-in-use': message = 'Este e-mail já está em uso.'; break;
        case 'auth/weak-password': message = 'Senha muito fraca.'; break;
        default: message = `Erro: ${err.code || err.message}`;
      }
      setError(message);
    } finally {
      isRegisteringFlowRef.current = false;
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError('');
    setInfo('');
    if (forgotCooldown > 0) {
      setError(`Aguarde ${forgotCooldown}s para solicitar novamente.`);
      return;
    }

    const sanitizedEmail = email.trim();
    if (!sanitizedEmail) {
      setError('Digite seu e-mail para recuperar a senha.');
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, sanitizedEmail);
      const cooldownUntil = Date.now() + (45 * 1000);
      sessionStorage.setItem(FORGOT_KEY, String(cooldownUntil));
      setForgotCooldown(45);
      setInfo('Enviamos um link para redefinicao de senha no seu e-mail.');
    } catch (err) {
      const messages = {
        'auth/invalid-email': 'E-mail invalido.',
        'auth/user-not-found': 'Nao encontramos conta com esse e-mail.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
      };
      setError(messages[err.code] || 'Nao foi possivel enviar o e-mail de recuperacao.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setError('');
    setInfo('');
    if (resendCooldown > 0) {
      setError(`Aguarde ${resendCooldown}s para reenviar novamente.`);
      return;
    }

    const sanitizedEmail = email.trim();
    if (!sanitizedEmail || !password) {
      setError('Para reenviar o e-mail de verificacao, preencha e-mail e senha.');
      return;
    }

    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, sanitizedEmail, password);
      await reload(cred.user);

      if (cred.user.emailVerified) {
        await ativarConta(cred.user.uid);
        await sincronizarUsuarioNoBanco(cred.user, cred.user.displayName, cred.user.photoURL);
        sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
        setRequiresVerification(false);
        navigate('/');
        return;
      }

      await sendEmailVerification(cred.user);
      await signOut(auth);
      const cooldownUntil = Date.now() + (60 * 1000);
      sessionStorage.setItem(RESEND_KEY, String(cooldownUntil));
      setResendCooldown(60);
      setInfo('Novo e-mail de verificacao enviado. Confira sua caixa de entrada e spam.');
    } catch (err) {
      const messages = {
        'auth/invalid-email': 'E-mail invalido.',
        'auth/user-not-found': 'Conta nao encontrada.',
        'auth/wrong-password': 'Senha incorreta para reenviar verificacao.',
        'auth/invalid-credential': 'Credenciais invalidas.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
      };
      setError(messages[err.code] || 'Nao foi possivel reenviar o e-mail de verificacao.');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerification = async () => {
    setError('');
    setInfo('');

    const sanitizedEmail = email.trim();
    if (!sanitizedEmail || !password) {
      setError('Preencha e-mail e senha para validar a verificacao.');
      return;
    }

    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, sanitizedEmail, password);
      await reload(cred.user);

      if (!cred.user.emailVerified) {
        await signOut(auth);
        setError('Seu e-mail ainda nao foi confirmado. Clique em "Reenviar e-mail".');
        return;
      }

      await ativarConta(cred.user.uid);
      await sincronizarUsuarioNoBanco(cred.user, cred.user.displayName, cred.user.photoURL);
      sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
      setRequiresVerification(false);
      setInfo('E-mail confirmado com sucesso.');
      navigate('/');
    } catch (err) {
      const messages = {
        'auth/invalid-email': 'E-mail invalido.',
        'auth/user-not-found': 'Conta nao encontrada.',
        'auth/wrong-password': 'Senha incorreta.',
        'auth/invalid-credential': 'Credenciais invalidas.',
      };
      setError(messages[err.code] || 'Nao foi possivel validar a verificacao agora.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-content">
      <div className="login-card">
        <h1 className="login-title shito-glitch">Bem vindo de volta!</h1>
        <p className="login-subtitle">
          {isRegistering ? 'DESPERTAR NOVA ALMA' : 'ENTRAR NA TEMPESTADE'}
        </p>

        {isRegistering && (
          <div className="avatar-preview-container" onClick={() => setShowAvatarModal(true)}>
            <div className="avatar-circle-wrapper">
              <img src={selectedAvatar} alt="Avatar" className="avatar-preview-img" />
              <div className="edit-overlay"><i className="fa-solid fa-camera"></i></div>
            </div>
            <p className="avatar-change-text">TOQUE PARA MUDAR O VISUAL</p>
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="login-form">
          {isRegistering && (
            <div className="input-field">
              <i className="fa-solid fa-user"></i>
              <input type="text" placeholder="Nome do Usuário" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={25} required disabled={loading} />
            </div>
          )}

          <div className="input-field">
            <i className="fa-solid fa-envelope"></i>
            <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading} />
          </div>

          <div className="input-field">
            <i className="fa-solid fa-lock"></i>
            <input type="password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading} />
          </div>

          {isRegistering && (
            <>
              <div className="input-field">
                <i className="fa-solid fa-shield-halved"></i>
                <input type="password" placeholder="Confirmar Senha" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required disabled={loading} />
              </div>

              {/* LISTA DE REQUISITOS COM CORES DINÂMICAS */}
              <div className="password-requirements" style={{ marginBottom: '20px', paddingLeft: '5px' }}>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.82rem', textAlign: 'left' }}>
                  <li style={{ color: hasLength ? '#4caf50' : '#ff4444', transition: '0.3s' }}>
                    <i className={`fa-solid ${hasLength ? 'fa-check' : 'fa-xmark'}`} style={{ marginRight: '8px' }}></i>
                    Mínimo 8 caracteres
                  </li>
                  <li style={{ color: hasUpper ? '#4caf50' : '#ff4444', transition: '0.3s' }}>
                    <i className={`fa-solid ${hasUpper ? 'fa-check' : 'fa-xmark'}`} style={{ marginRight: '8px' }}></i>
                    Uma letra maiúscula
                  </li>
                  <li style={{ color: hasNumber ? '#4caf50' : '#ff4444', transition: '0.3s' }}>
                    <i className={`fa-solid ${hasNumber ? 'fa-check' : 'fa-xmark'}`} style={{ marginRight: '8px' }}></i>
                    Um número
                  </li>
                  <li style={{ color: hasSpecial ? '#4caf50' : '#ff4444', transition: '0.3s' }}>
                    <i className={`fa-solid ${hasSpecial ? 'fa-check' : 'fa-xmark'}`} style={{ marginRight: '8px' }}></i>
                    Caractere especial (@$!%*?)
                  </li>
                </ul>
              </div>
            </>
          )}

          <button type="submit" className="btn-submit-shito" disabled={loading}>
            {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : isRegistering ? 'CADASTRAR' : 'ENTRAR'}
          </button>
        </form>

        <div className="social-divider"><span>OU</span></div>

        <button type="button" className="btn-google-shito" onClick={handleGoogleSignIn} disabled={loading}>
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
          CONECTAR COM GOOGLE
        </button>

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

        {requiresVerification && !isRegistering && (
          <div className="verification-box">
            <p>
              Conta pendente de verificacao. Acesse seu e-mail e clique no link enviado.
            </p>
            <div className="verification-actions">
              <button
                type="button"
                className="btn-verify-secondary"
                onClick={handleResendVerification}
                disabled={loading || resendCooldown > 0}
              >
                {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : 'Reenviar e-mail'}
              </button>
              <button type="button" className="btn-verify-primary" onClick={handleCheckVerification} disabled={loading}>
                Ja verifiquei meu e-mail
              </button>
            </div>
          </div>
        )}

        {error && <div className="error-banner"><i className="fa-solid fa-circle-exclamation"></i> {error}</div>}
        {info && <div className="info-banner"><i className="fa-solid fa-circle-check"></i> {info}</div>}

        <p className="toggle-register">
          {isRegistering ? (
            <>Já possui uma alma vinculada? <span onClick={() => setIsRegistering(false)}>Entrar</span></>
          ) : (
            <>É novo nesta jornada? <span onClick={() => setIsRegistering(true)}>Despertar</span></>
          )}
        </p>
      </div>

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
                  <button key={index} type="button" className={`avatar-option-item ${selectedAvatar === path ? 'selected' : ''}`} onClick={() => { setSelectedAvatar(path); setShowAvatarModal(false); }}>
                    <img src={path} alt={`Avatar ${index + 1}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showVerificationModal && (
        <div className="verify-modal-overlay">
          <div className="verify-modal-card">
            <h3>E-mail de verificacao enviado</h3>
            <p>
              Enviamos um link para <strong>{email.trim()}</strong>.
              <br />
              Verifique sua caixa de entrada (e spam) e clique em "Ja verifiquei meu e-mail".
              <br />
              Sua conta foi criada em modo <strong>pendente</strong>. Se nao confirmar em ate <strong>40 minutos</strong>, ela sera removida automaticamente.
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