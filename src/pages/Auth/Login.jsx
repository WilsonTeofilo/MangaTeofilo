import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
} from 'firebase/auth';
import { ref, set, get } from 'firebase/database';
import { auth, db, googleProvider } from '../../services/firebase';
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
  const [loading, setLoading] = useState(false);

  // Modal de seleção de avatar
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const listaAvatares = Array.from({ length: 17 }, (_, i) => `/assets/avatares/ava${i + 1}.webp`);
  const [selectedAvatar, setSelectedAvatar] = useState(listaAvatares[0]);

  // Regex para validação visual
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasLength = password.length >= 8;

  // Redireciona se já estiver logado
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      if (currentUser) {
        navigate('/');
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  // Função auxiliar para sincronizar usuário no Realtime Database
  const sincronizarUsuarioNoBanco = async (usuario, nome, foto) => {
    const userRef = ref(db, `usuarios/${usuario.uid}`);
    const snapshot = await get(userRef);

    if (!snapshot.exists() || isRegistering) {
      await set(userRef, {
        userName: nome || 'Guerreiro',
        userAvatar: foto || listaAvatares[0],
        uid: usuario.uid,
      });
    }
  };

  // Login com Google
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await sincronizarUsuarioNoBanco(result.user, result.user.displayName, result.user.photoURL);
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
    setLoading(true);

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
        userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(userCredential.user, {
          displayName: displayName.trim(),
          photoURL: selectedAvatar,
        });
        await sincronizarUsuarioNoBanco(userCredential.user, displayName.trim(), selectedAvatar);
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      setTimeout(() => navigate('/'), 800);
    } catch (err) {
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

        {error && <div className="error-banner"><i className="fa-solid fa-circle-exclamation"></i> {error}</div>}

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
    </main>
  );
}