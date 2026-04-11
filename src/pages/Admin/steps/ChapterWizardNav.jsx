import React from 'react';

export default function ChapterWizardNav({ etapaAtiva, onPrev, onNext }) {
  return (
    <div className="step-nav-actions">
      <button
        type="button"
        className="btn-cancel"
        disabled={etapaAtiva <= 1}
        onClick={onPrev}
      >
        Etapa anterior
      </button>
      <button
        type="button"
        className="btn-edit"
        disabled={etapaAtiva >= 5}
        onClick={onNext}
      >
        Proxima etapa
      </button>
    </div>
  );
}
