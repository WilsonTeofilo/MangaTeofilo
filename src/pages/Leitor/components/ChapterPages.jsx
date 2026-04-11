import React from 'react';

export default function ChapterPages({
  modoLeitura,
  paginas,
  zoom,
  paginaAtual,
  totalPaginas,
  imgAltPrefix,
  onPrev,
  onNext,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}) {
  if (modoLeitura === 'vertical') {
    return (
      <main className="paginas-lista">
        {paginas?.map((url, index) => (
          <img
            key={index}
            src={url}
            alt={`${imgAltPrefix || 'Mangá'} ${index + 1}`}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            style={{ width: `${zoom}%`, display: 'block', margin: '0 auto' }}
          />
        ))}
      </main>
    );
  }

  return (
    <div
      className="horizontal-reader"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <button type="button" className="seta esquerda" onClick={onPrev} disabled={paginaAtual === 0}>
        ‹
      </button>
      <div className="pagina-unica">
        <img
          src={paginas?.[paginaAtual]}
          alt={`${imgAltPrefix || 'Mangá'} ${paginaAtual + 1}`}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          style={{ width: `${zoom}%`, margin: '0 auto', display: 'block' }}
        />
      </div>
      <button
        type="button"
        className="seta direita"
        onClick={onNext}
        disabled={paginaAtual >= totalPaginas - 1}
      >
        ›
      </button>
      <div className="contador">
        {paginaAtual + 1} / {totalPaginas}
      </div>
    </div>
  );
}
