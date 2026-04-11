import React from 'react';

export default function LoginCodeStep({
  email,
  setEmail,
  code,
  setCode,
  loading,
  handleVerifyCode,
  handleResendCode,
  resendCooldown,
  onBack,
}) {
  return (
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
            placeholder="Codigo de 6 digitos"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            disabled={loading}
          />
        </div>
        <button type="submit" className="btn-submit-shito" disabled={loading}>
          {loading ? <i className="fa-solid fa-spinner fa-spin" /> : 'VALIDAR CODIGO'}
        </button>
      </form>

      <div className="login-code-actions">
        <button
          type="button"
          className="btn-text-action"
          onClick={handleResendCode}
          disabled={loading || resendCooldown > 0}
        >
          {resendCooldown > 0 ? `Reenviar codigo (${resendCooldown}s)` : 'Reenviar codigo'}
        </button>
        <button
          type="button"
          className="btn-text-action"
          onClick={onBack}
          disabled={loading}
        >
          Trocar e-mail
        </button>
      </div>
    </>
  );
}
