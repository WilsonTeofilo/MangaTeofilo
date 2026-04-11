import React from 'react';

import { applyImageFallback } from '../creatorPublicProfileUtils';

export default function CreatorFollowersModal({
  open,
  onClose,
  followersBusy,
  followersError,
  followersList,
  followersCountLabel,
  onFollowerClick,
  privateFollowerModal,
  onClosePrivateModal,
}) {
  if (!open && !privateFollowerModal) return null;

  return (
    <>
      {open ? (
        <div className="criador-followers-modal__overlay" role="presentation" onClick={onClose}>
          <div
            className="criador-followers-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="criador-followers-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="criador-followers-modal__head">
              <div>
                <h2 id="criador-followers-title">Seguidores</h2>
                <p>{followersCountLabel}</p>
              </div>
              <button type="button" className="criador-followers-modal__close" onClick={onClose}>
                Fechar
              </button>
            </div>
            {followersBusy ? <p className="criador-followers-modal__empty">Carregando seguidores...</p> : null}
            {!followersBusy && followersError ? (
              <p className="criador-followers-modal__error">{followersError}</p>
            ) : null}
            {!followersBusy && !followersError && !followersList.length ? (
              <p className="criador-followers-modal__empty">Ninguem esta seguindo este escritor ainda.</p>
            ) : null}
            {!followersBusy && !followersError && followersList.length ? (
              <div className="criador-followers-modal__list">
                {followersList.map((follower) => (
                  <button
                    key={String(follower.uid || '')}
                    type="button"
                    className="criador-follower-row"
                    onClick={() => onFollowerClick(follower)}
                  >
                    <img
                      src={String(follower.avatarUrl || '').trim() || '/assets/avatares/ava1.webp'}
                      alt={String(follower.displayName || follower.userHandle || 'Usuario')}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                      onError={(e) => applyImageFallback(e, '/assets/avatares/ava1.webp')}
                    />
                    <span className="criador-follower-row__body">
                      <strong>{follower.displayName || 'Leitor'}</strong>
                      <span>
                        {follower.userHandle ? `@${follower.userHandle}` : 'sem @'}{' '}
                        {follower.isCreatorProfile ? '• escritor' : follower.isProfilePublic ? '• leitor publico' : '• perfil privado'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {privateFollowerModal ? (
        <div className="criador-followers-modal__overlay" role="presentation" onClick={onClosePrivateModal}>
          <div
            className="criador-followers-modal criador-followers-modal--private"
            role="dialog"
            aria-modal="true"
            aria-labelledby="criador-private-profile-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="criador-private-profile-title">Perfil privado</h2>
            <p>{privateFollowerModal.label} nao deixou o card publico disponivel no momento.</p>
            <div className="criador-followers-modal__actions">
              <button type="button" onClick={onClosePrivateModal}>
                Entendi
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
