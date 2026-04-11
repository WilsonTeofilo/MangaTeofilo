import React from 'react';

export default function LoginAvatarModal({
  showAvatarModal,
  listaAvatares,
  selectedAvatar,
  setSelectedAvatar,
  setShowAvatarModal,
  fallbackAvatar,
}) {
  if (!showAvatarModal) return null;
  return (
    <div className="avatar-modal-overlay">
      <div className="avatar-modal-card">
        <header className="avatar-modal-header">
          <h3>Escolha sua Face</h3>
          <button type="button" className="btn-close-modal" onClick={() => setShowAvatarModal(false)}>&times;</button>
        </header>
        <div className="avatar-modal-body">
          <div className="avatar-selection-grid">
            {listaAvatares.map((path, index) => (
              <button key={index} type="button"
                className={`avatar-option-item ${selectedAvatar === path ? 'selected' : ''}`}
                onClick={() => { setSelectedAvatar(path); setShowAvatarModal(false); }}>
                <img src={path} alt={`Avatar ${index + 1}`}
                  onError={(e) => { e.target.src = fallbackAvatar; }} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
