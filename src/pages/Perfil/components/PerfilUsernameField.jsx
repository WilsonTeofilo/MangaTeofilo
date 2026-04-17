import React from 'react';

import { SITE_ORIGIN } from '../../../config/site';
import { normalizeUsernameInput } from '../../../utils/usernameValidation';

export default function PerfilUsernameField({
  id,
  userHandleDraft,
  setUserHandleDraft,
  usernameInputRef,
  lockedHandle,
  placeholder,
  usernameCheck,
  onSuggest,
  suggestLabel,
  helperText,
}) {
  return (
    <div className="input-group" id={id}>
      <label>USERNAME (@)</label>
      <p className="perfil-mangaka-apoio-label" style={{ marginBottom: 8 }}>
        {helperText}{' '}
        <strong>{SITE_ORIGIN.replace(/^https?:\/\//, '')}/@{normalizeUsernameInput(userHandleDraft) || 'seuuser'}</strong>
      </p>
      <input
        type="text"
        className="perfil-input"
        ref={usernameInputRef}
        autoComplete="username"
        spellCheck={false}
        value={userHandleDraft}
        onChange={(e) => setUserHandleDraft(normalizeUsernameInput(e.target.value))}
        maxLength={20}
        disabled={Boolean(String(lockedHandle || '').trim())}
        placeholder={placeholder}
      />
      {!String(lockedHandle || '').trim() ? (
        <button
          type="button"
          className="perfil-mangaka-apoio-copy"
          style={{ marginTop: 8 }}
          onClick={onSuggest}
        >
          {suggestLabel}
        </button>
      ) : null}
      {usernameCheck.status === 'ok' ? (
        <p className="perfil-username-status perfil-username-status--ok">{usernameCheck.message}</p>
      ) : null}
      {usernameCheck.status === 'taken' || usernameCheck.status === 'invalid' ? (
        <p className="perfil-username-status perfil-username-status--bad">{usernameCheck.message}</p>
      ) : null}
      {usernameCheck.status === 'checking' ? (
        <p className="perfil-username-status">{usernameCheck.message}</p>
      ) : null}
    </div>
  );
}
