import React from 'react';

export default function LoginExistingPasswordStep({
  email,
  password,
  setPassword,
  rememberMe,
  setRememberMe,
  loading,
  handleExistingPasswordLogin,
  handleForgotPassword,
  forgotCooldown,
  mostrarGoogleComoAlternativa,
  handleGoogleSignIn,
  onBack,
}) {
  return (
    <>
      <form onSubmit={handleExistingPasswordLogin} className="login-form">
        <div className="input-field">
          <i className="fa-solid fa-envelope" />
          <input
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={() => {}}
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
        <label className="login-remember">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            disabled={loading}
          />
          Manter conectado
        </label>
        <button type="submit" className="btn-submit-shito" disabled={loading}>
          {loading ? <i className="fa-solid fa-spinner fa-spin" /> : 'ENTRAR'}
        </button>
      </form>
      <button
        type="button"
        className="btn-text-action"
        onClick={handleForgotPassword}
        disabled={loading || forgotCooldown > 0}
      >
        {forgotCooldown > 0 ? `Esqueci minha senha (${forgotCooldown}s)` : 'Esqueci minha senha'}
      </button>

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
        onClick={onBack}
        disabled={loading}
      >
        Voltar para codigo
      </button>
    </>
  );
}
