import React from 'react';

export default function LoginExistingGoogleStep({
  loading,
  handleGoogleSignIn,
  onBack,
}) {
  return (
    <>
      <p className="login-google-hint login-google-hint--block">
        Este e-mail foi cadastrado com <strong>Conectar com Google</strong>. O site nao guarda a senha da
        sua conta Google — por isso digitar o e-mail e a senha do Gmail aqui nao funciona.
      </p>
      <button type="button" className="btn-google-shito" onClick={handleGoogleSignIn} disabled={loading}>
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
        CONECTAR COM GOOGLE
      </button>
      <button
        type="button"
        className="btn-text-action"
        onClick={onBack}
        disabled={loading}
      >
        Usar outro e-mail
      </button>
    </>
  );
}
