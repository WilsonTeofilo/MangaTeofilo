import React, { useState } from 'react';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword 
} from "firebase/auth";
import './Login.css';

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const auth = getAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const action = isRegistering 
        ? createUserWithEmailAndPassword 
        : signInWithEmailAndPassword;

      await action(auth, email.trim(), password);
      // O Firebase Auth detectará a mudança e o App.jsx fará o redirecionamento.
    } catch (err) {
      let message = "Erro ao conectar à Tempestade";
      
      switch (err.code) {
        case "auth/invalid-email":
          message = "O e-mail inserido é inválido.";
          break;
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
          message = "Credenciais incorretas.";
          break;
        case "auth/email-already-in-use":
          message = "Este e-mail já possui uma alma vinculada.";
          break;
        case "auth/weak-password":
          message = "A senha deve ter pelo menos 6 fragmentos (caracteres).";
          break;
        default:
          message = "Falha na Matrix: " + err.message;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-void">
      <div className="nebula-bg"></div>
      
      <div className="login-vessel">
        <div className="glitch-hover">
          <h1 className="title-glitch" data-text="SHITO">SHITO</h1>
        </div>
        
        <p className="subtitle-seduce">
          {isRegistering ? "DESPERTAR NOVA ALMA" : "ENTRAR NA TEMPESTADE"}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="input-wrapper">
            <input
              className="neon-input"
              type="email"
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
            <div className="input-glow"></div>
          </div>

          <div className="input-wrapper">
            <input
              className="neon-input"
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
            <div className="input-glow"></div>
          </div>

          <button 
            type="submit" 
            className={`submit-pulse ${loading ? "loading" : ""}`}
            disabled={loading || !email.trim() || password.length < 6}
          >
            {loading ? (
              <span className="loader">CONECTANDO...</span>
            ) : (
              isRegistering ? "CRIAR CONTA" : "ENTRAR"
            )}
          </button>
        </form>

        {error && <p className="error-seductive">{error}</p>}

        <p 
          className="toggle-soul"
          onClick={() => {
            setIsRegistering(!isRegistering);
            setError("");
          }}
        >
          {isRegistering 
            ? "Já possui conta? Entrar" 
            : "Ainda não tem conta? Despertar"}
        </p>
      </div>
    </div>
  );
}