import React from 'react';

export default function LoginNewUserStep({
  selectedAvatar,
  setShowAvatarModal,
  signupIntent,
  setSignupIntent,
  displayName,
  setDisplayName,
  signupHandle,
  onSignupHandleChange,
  email,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  rememberMe,
  setRememberMe,
  loading,
  handleRegisterWithPassword,
  onBack,
  hasLength,
  hasUpper,
  hasNumber,
  hasSpecial,
  displayNameMaxLength,
}) {
  return (
    <>
      <div className="avatar-preview-container" onClick={() => setShowAvatarModal(true)}>
        <div className="avatar-circle-wrapper">
          <img src={selectedAvatar} alt="Avatar" className="avatar-preview-img"
            onError={(e) => { e.target.src = '/assets/avatares/ava1.webp'; }} />
          <div className="edit-overlay"><i className="fa-solid fa-camera" /></div>
        </div>
        <p className="avatar-change-text">TOQUE PARA MUDAR O VISUAL</p>
      </div>

      <form onSubmit={handleRegisterWithPassword} className="login-form">
        <div className="signup-intent-picker">
          <span className="signup-intent-picker__label">Como voce quer entrar?</span>
          <div className="signup-intent-picker__options">
            <button
              type="button"
              className={`signup-intent-card ${signupIntent === 'reader' ? 'is-active' : ''}`}
              onClick={() => setSignupIntent('reader')}
            >
              <strong>Leitor</strong>
              <span>Entra lendo na hora, com favoritos, biblioteca e loja.</span>
            </button>
            <button
              type="button"
              className={`signup-intent-card ${signupIntent === 'creator' ? 'is-active' : ''}`}
              onClick={() => setSignupIntent('creator')}
            >
              <strong>Quero ser mangaka</strong>
              <span>Cria a conta agora e envia a solicitacao de creator logo depois, com revisao humana.</span>
            </button>
          </div>
        </div>

        <div className="input-field">
          <i className="fa-solid fa-user" />
          <input
            type="text"
            placeholder="Nome do usuario"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={displayNameMaxLength}
            required
            disabled={loading}
          />
        </div>
        <div className="input-field">
          <i className="fa-solid fa-at" />
          <input
            type="text"
            placeholder="@username"
            value={signupHandle}
            onChange={(e) => (onSignupHandleChange ? onSignupHandleChange(e.target.value) : null)}
            maxLength={20}
            required
            disabled={loading}
          />
        </div>
        <p className="login-info-inline">
          Seu @username e unico na plataforma e nao pode ser alterado depois.
        </p>
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
              { ok: hasLength,  label: 'Minimo 8 caracteres' },
              { ok: hasUpper,   label: 'Uma letra maiuscula' },
              { ok: hasNumber,  label: 'Um numero' },
              { ok: hasSpecial, label: 'Caractere especial (@$!%*?)' },
            ].map(({ ok, label }) => (
              <li key={label} style={{ color: ok ? '#4caf50' : '#ff4444', transition: '0.3s' }}>
                <i className={`fa-solid ${ok ? 'fa-check' : 'fa-xmark'}`} style={{ marginRight: '8px' }} />
                {label}
              </li>
            ))}
          </ul>
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
          {loading ? <i className="fa-solid fa-spinner fa-spin" /> : 'CRIAR CONTA'}
        </button>
      </form>

      <button
        type="button"
        className="btn-text-action"
        onClick={onBack}
        disabled={loading}
      >
        Ja tenho conta
      </button>
    </>
  );
}
