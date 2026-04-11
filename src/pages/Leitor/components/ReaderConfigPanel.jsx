import React from 'react';

export default function ReaderConfigPanel({ modoLeitura, onModoChange, zoom, onZoomChange }) {
  return (
    <div className="config-panel">
      <button
        type="button"
        aria-pressed={modoLeitura === 'vertical'}
        className={modoLeitura === 'vertical' ? 'active' : ''}
        onClick={() => onModoChange('vertical')}
      >
        Vertical
      </button>
      <button
        type="button"
        aria-pressed={modoLeitura === 'horizontal'}
        className={modoLeitura === 'horizontal' ? 'active' : ''}
        onClick={() => onModoChange('horizontal')}
      >
        Horizontal
      </button>
      <div>
        <button type="button" onClick={() => onZoomChange(Math.max(50, zoom - 10))}>-</button>
        <span>{zoom}%</span>
        <button type="button" onClick={() => onZoomChange(Math.min(200, zoom + 10))}>+</button>
      </div>
    </div>
  );
}
