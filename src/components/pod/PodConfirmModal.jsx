import React from 'react';
import './PodConfirmModal.css';

/**
 * @param {{
 *   open: boolean,
 *   title: string,
 *   description: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   busy?: boolean,
 *   onConfirm: () => void,
 *   onClose: () => void,
 * }} props
 */
export default function PodConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Continuar',
  cancelLabel = 'Cancelar',
  busy = false,
  onConfirm,
  onClose,
}) {
  if (!open) return null;
  return (
    <div
      className="pod-confirm-modal__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="pod-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="pod-confirm-title">
        <h2 id="pod-confirm-title" className="pod-confirm-modal__title">
          {title}
        </h2>
        <p className="pod-confirm-modal__desc">{description}</p>
        <div className="pod-confirm-modal__actions">
          <button type="button" className="pod-confirm-modal__btn pod-confirm-modal__btn--ghost" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </button>
          <button type="button" className="pod-confirm-modal__btn pod-confirm-modal__btn--primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'Aguarde…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
