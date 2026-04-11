import React from 'react';

export default function ChapterFooterNav({
  capNavError,
  anteriorCapituloId,
  proximoCapituloId,
  capsLiberadosLista,
  currentId,
  onNavigateChapter,
  onSelectChapter,
  onTriggerError,
}) {
  return (
    <div className={`leitor-cap-nav${capNavError ? ' leitor-cap-nav--error' : ''}`}>
      <button
        type="button"
        className="leitor-cap-nav-btn"
        onClick={() =>
          anteriorCapituloId ? onNavigateChapter(anteriorCapituloId) : onTriggerError()
        }
      >
        ← Capítulo anterior
      </button>
      {capsLiberadosLista.length > 0 ? (
        <label className="leitor-cap-select-wrap">
          <span className="leitor-cap-select-label">Capítulo</span>
          <select
            className="leitor-cap-select"
            value={currentId}
            onChange={(e) => onSelectChapter(e.target.value)}
            aria-label="Escolher capítulo para ler"
          >
            {capsLiberadosLista.map((c) => {
              const n = Number(c.numero || 0);
              const tituloCurto = String(c.titulo || '').trim();
              const labBase = tituloCurto || (n ? `Capítulo ${n}` : 'Capítulo');
              const lab = n ? `#${n} — ${labBase}` : labBase;
              return (
                <option key={c.id} value={c.id}>
                  {lab}
                </option>
              );
            })}
          </select>
        </label>
      ) : null}
      <button
        type="button"
        className="leitor-cap-nav-btn"
        onClick={() =>
          proximoCapituloId ? onNavigateChapter(proximoCapituloId) : onTriggerError()
        }
      >
        Próximo capítulo →
      </button>
    </div>
  );
}
