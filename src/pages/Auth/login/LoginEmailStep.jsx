import React from 'react';

export default function LoginEmailStep({
  email,
  setEmail,
  loading,
  handleSendCode,
  signupCodeMode,
  handleSendCodeSignup,
  handleGoogleSignIn,
  handleForgotPassword,
  forgotCooldown,
}) {
  return (
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
          {loading ? <i className="fa-solid fa-spinner fa-spin" /> : 'Enviar codigo (tenho conta)'}
        </button>
      </form>

      {signupCodeMode ? (
        <div className="login-signup-code-hint">
          <p className="login-info-inline">
            Primeiro acesso com este e-mail? Receba o codigo so para cadastro, sem gastar tentativa de quem ja tem conta.
          </p>
          <button
            type="button"
            className="btn-submit-shito btn-submit-shito--secondary"
            disabled={loading}
            onClick={handleSendCodeSignup}
          >
            {loading ? <i className="fa-solid fa-spinner fa-spin" /> : 'Receber codigo para criar conta'}
          </button>
        </div>
      ) : null}

      <div className="social-divider"><span>OU</span></div>

      <button type="button" className="btn-google-shito" onClick={handleGoogleSignIn} disabled={loading}>
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
        CONECTAR COM GOOGLE
      </button>

      <p className="login-google-hint">
        Conta criada com Google? Use o botao acima. A senha do Gmail <strong>nao</strong> e usada neste
        site — so o login oficial do Google.
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
  );
}
