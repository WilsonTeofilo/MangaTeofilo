import React from 'react';
import { Link } from 'react-router-dom';

import './CreatorUnlockCelebrationModal.css';

/**
 * @param {{ open: boolean, onClose: () => void }} props
 */
export default function CreatorUnlockCelebrationModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      className="creator-unlock-overlay"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="creator-unlock-modal" role="dialog" aria-modal="true" aria-labelledby="creator-unlock-title">
        <div className="creator-unlock-modal__confetti" aria-hidden="true">
          🎉✨🎊
        </div>
        <h2 id="creator-unlock-title" className="creator-unlock-modal__title">
          Parabéns!
        </h2>
        <p className="creator-unlock-modal__lead">Você desbloqueou o nível para monetizar na plataforma.</p>
        <ul className="creator-unlock-modal__list">
          <li>Ganhar com vendas e repasses (com monetização aprovada no perfil)</li>
          <li>Vender mangá físico na loja com repasse</li>
          <li>Membership e apoio, conforme seu cadastro</li>
        </ul>
        <div className="creator-unlock-modal__actions">
          <button type="button" className="creator-unlock-modal__btn creator-unlock-modal__btn--ghost" onClick={onClose}>
            Fechar
          </button>
          <Link
            to="/print-on-demand?ctx=creator&iniciar=1"
            className="creator-unlock-modal__btn creator-unlock-modal__btn--primary"
            onClick={onClose}
          >
            Começar agora
          </Link>
        </div>
      </div>
    </div>
  );
}
