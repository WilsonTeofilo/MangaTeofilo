import React from 'react';

const STEP_LABELS = {
  1: '1. Upload',
  2: '2. Organizar',
  3: '3. Ajustar capa',
  4: '4. Revisar',
  5: '5. Publicar',
};

export default function ChapterWizardSteps({ etapaAtiva, etapaLiberadaMax, onSelect }) {
  return (
    <div className="editor-steps">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`editor-step-chip${etapaAtiva === n ? ' active' : ''}`}
          disabled={n > etapaLiberadaMax}
          onClick={() => onSelect(n)}
        >
          {STEP_LABELS[n]}
        </button>
      ))}
    </div>
  );
}
