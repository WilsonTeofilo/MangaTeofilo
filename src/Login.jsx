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

import './Login.css';

// Recebendo a prop 'user' que vem lá do App.jsx
export default function Login({ user }) {
  const navigate = useNavigate();
  const auth = getAuth();
  const googleProvider = new GoogleAuthProvider();

  // Estados do formulário
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Se o usuário já estiver logado, manda ele pra home automaticamente
  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
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
        // Cria usuário e atualiza o nome imediatamente
        const res = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(res.user, { 
          displayName: displayName.trim() 
        });
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
        case 'auth/weak-password': message = 'Senha muito fraca.'; break;
        default: message = `Erro: ${err.code}`;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsRegistering(!isRegistering);
    setError('');
  };

  return (
    <div className="login-page">
      <nav className="reader-header">
        <div className="nav-container">
          <div className="nav-logo" onClick={() => navigate('/')}>SHITO</div>
          <ul className="nav-menu">
            <li onClick={() => navigate('/')}>Início</li>
            <li onClick={() => navigate('/sobre-autor')}>Sobre</li>
          </ul>
        </div>
      </nav>

      <main className="login-content">
        <div className="login-card">
          <h1 className="login-title">SHITO</h1>
          <p className="login-subtitle">
            {isRegistering ? 'Despertar Nova Alma' : 'Entrar na Tempestade'}
          </p>

          <form onSubmit={handleFormSubmit}>
            {isRegistering && (
              <input
                className="login-input"
                type="text"
                placeholder="Nome do Usuário (ex: Marcelly)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={35}
                required
              />
            )}
            <input
              className="login-input"
              type="email"
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="login-input"
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {isRegistering && (
              <input
                className="login-input"
                type="password"
                placeholder="Confirmar Senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            )}
            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? 'CARREGANDO...' : isRegistering ? 'CADASTRAR' : 'ENTRAR'}
            </button>
          </form>

          <div className="social-divider">ou</div>

          <button type="button" className="btn-google" onClick={handleGoogleSignIn} disabled={loading}>
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" />
            GOOGLE
          </button>

          {error && <p className="error-message">{error}</p>}

          <p className="toggle-register">
            {isRegistering ? (
              <>Já tem conta? <span onClick={toggleMode}>Entrar</span></>
            ) : (
              <>Novo por aqui? <span onClick={toggleMode}>Despertar</span></>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}