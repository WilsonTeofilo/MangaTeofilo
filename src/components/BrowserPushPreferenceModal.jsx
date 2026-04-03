import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './BrowserPushPreferenceModal.css';

/**
 * Modal para contexto de "acompanhar obra / capítulo / criador" + estado real de Notification.permission.
 * Renderiza em document.body para não ser cortado por overflow do layout.
 */
export default function BrowserPushPreferenceModal({
  open,
  permission = 'default',
  title = 'Notificações no navegador',
  description,
  onClose,
}) {
  const { detail, primaryLabel, showSecondary, secondaryLabel } = useMemo(() => {
    const p = String(permission || 'default').toLowerCase();
    if (p === 'granted') {
      return {
        detail:
          'Permissão já concedida neste navegador. Você pode receber avisos quando a plataforma enviar notificações.',
        primaryLabel: 'Entendi',
        showSecondary: false,
        secondaryLabel: '',
      };
    }
    if (p === 'denied') {
      return {
        detail:
          'As notificações estão bloqueadas para este site. Para ativar depois, use o cadeado ou as configurações do navegador nesta página e permita notificações.',
        primaryLabel: 'Fechar',
        showSecondary: false,
        secondaryLabel: '',
      };
    }
    if (p === 'unsupported') {
      return {
        detail:
          'Este navegador ou ambiente não expõe notificações na área de trabalho. O acompanhamento da obra continua salvo na sua conta.',
        primaryLabel: 'Fechar',
        showSecondary: false,
        secondaryLabel: '',
      };
    }
    return {
      detail:
        'Se permitir, o navegador pode mostrar um aviso quando houver novidade (depende do sistema e das configurações do site).',
      primaryLabel: 'Permitir avisos',
      showSecondary: true,
      secondaryLabel: 'Agora não',
    };
  }, [permission]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handlePrimary = async () => {
    const p = String(permission || 'default').toLowerCase();
    if (p === 'default' && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* ignore */
      }
    }
    onClose?.();
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="browser-push-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="browser-push-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="browser-push-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="browser-push-modal-title" className="browser-push-modal__title">
          {title}
        </h2>
        {description ? <p className="browser-push-modal__text">{description}</p> : null}
        <p className="browser-push-modal__text browser-push-modal__text--muted">{detail}</p>
        <div className="browser-push-modal__actions">
          {showSecondary ? (
            <button
              type="button"
              className="browser-push-modal__btn browser-push-modal__btn--ghost"
              onClick={() => onClose?.()}
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button type="button" className="browser-push-modal__btn browser-push-modal__btn--primary" onClick={handlePrimary}>
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
