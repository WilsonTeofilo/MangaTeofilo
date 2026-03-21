import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { getDatabase, ref, set, get } from "firebase/database"; 

import './Login.css';

export default function Login({ user }) {
  const navigate = useNavigate();
  const auth = getAuth();
  const db = getDatabase();
  const googleProvider = new GoogleAuthProvider();

  // Estados do formulário
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Controle do Modal de Seleção de Avatar
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  const listaAvatares = Array.from({ length: 17 }, (_, i) => `/assets/avatares/ava${i + 1}.webp`);
  const [selectedAvatar, setSelectedAvatar] = useState(listaAvatares[0]);

  useEffect(() => {
    if (user) navigate('/');
  }, [user, navigate]);

  // FUNÇÃO CORRIGIDA: Não sobrescreve usuários existentes ao fazer login
  const sincronizarUsuarioNoBanco = async (usuario, nome, foto) => {
    const userRef = ref(db, `usuarios/${usuario.uid}`);
    const snapshot = await get(userRef);
    
    // SÓ grava no Database se o usuário for novo OU se for um cadastro manual (isRegistering)
    if (!snapshot.exists() || isRegistering) {
      await set(userRef, {
        userName: nome || "Guerreiro",
        userAvatar: foto || listaAvatares[0],
        uid: usuario.uid
      });
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await signInWithPopup(auth, googleProvider);
      // Sincroniza mantendo os dados do Google mas sem atropelar o banco
      await sincronizarUsuarioNoBanco(res.user, res.user.displayName, res.user.photoURL);
      navigate('/');
    } catch (err) {
      setError(`Falha ao conectar com Google: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

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
    }

    try {
      if (isRegistering) {
        const res = await createUserWithEmailAndPassword(auth, email.trim(), password);
        
        // 1. Atualiza Perfil no Auth
        await updateProfile(res.user, { 
          displayName: displayName.trim(),
          photoURL: selectedAvatar 
        });

        // 2. Registra no Database (Novo usuário)
        await sincronizarUsuarioNoBanco(res.user, displayName.trim(), selectedAvatar);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      navigate('/');
    } catch (err) {
      let message = 'Erro ao conectar à Tempestade';
      switch (err.code) {
        case 'auth/invalid-email': message = 'E-mail inválido.'; break;
        case 'auth/invalid-credential': message = 'E-mail ou senha incorretos.'; break;
        case 'auth/email-already-in-use': message = 'Este e-mail já está em uso.'; break;
        case 'auth/weak-password': message = 'Senha muito fraca (mínimo 6 caracteres).'; break;
        default: message = `Erro: ${err.code}`;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-content">
      <div className="login-card">
        <h1 className="login-title shito-glitch">SHITO</h1>
        <p className="login-subtitle">
          {isRegistering ? 'DESPERTAR NOVA ALMA' : 'ENTRAR NA TEMPESTADE'}
        </p>

        {isRegistering && (
          <div className="avatar-preview-container" onClick={() => setShowAvatarModal(true)}>
            <div className="avatar-circle-wrapper">
              <img src={selectedAvatar} alt="Avatar" className="avatar-preview-img" />
              <div className="edit-overlay">
                <i className="fa-solid fa-camera"></i>
              </div>
            </div>
            <p className="avatar-change-text">TOQUE PARA MUDAR O VISUAL</p>
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="login-form">
          {isRegistering && (
            <div className="input-field">
              <i className="fa-solid fa-user"></i>
              <input
                type="text"
                placeholder="Nome do Usuário"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={25}
                required
              />
            </div>
          )}
          
          <div className="input-field">
            <i className="fa-solid fa-envelope"></i>
            <input
              type="email"
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-field">
            <i className="fa-solid fa-lock"></i>
            <input
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {isRegistering && (
            <div className="input-field">
              <i className="fa-solid fa-shield-halved"></i>
              <input
                type="password"
                placeholder="Confirmar Senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          )}

          <button type="submit" className="btn-submit-shito" disabled={loading}>
            {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : isRegistering ? 'CADASTRAR' : 'ENTRAR'}
          </button>
        </form>

        <div className="social-divider"><span>OU</span></div>

        <button type="button" className="btn-google-shito" onClick={handleGoogleSignIn} disabled={loading}>
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" />
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
                  <button 
                    key={index} 
                    type="button" 
                    className={`avatar-option-item ${selectedAvatar === path ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedAvatar(path);
                      setShowAvatarModal(false);
                    }}
                  >
                    <img src={path} alt={`Opção ${index}`} />
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