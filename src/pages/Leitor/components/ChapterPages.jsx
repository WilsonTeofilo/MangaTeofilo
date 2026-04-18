import React from 'react';

export default function ChapterPages({
  modoLeitura,
  paginas,
  zoom,
  paginaAtual,
  totalPaginas,
  imgAltPrefix,
  endCard,
  onPrev,
  onNext,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}) {
  const totalHorizontalSlides = totalPaginas + (endCard ? 1 : 0);
  const showingEndCard = Boolean(endCard) && paginaAtual >= totalPaginas;

  if (modoLeitura === 'vertical') {
    return (
      <main className="paginas-lista">
        {paginas?.map((url, index) => (
          <img
            key={index}
            src={url}
            alt={`${imgAltPrefix || 'Manga'} ${index + 1}`}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            style={{ width: `${zoom}%`, display: 'block', margin: '0 auto' }}
          />
        ))}
        {endCard}
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
        {showingEndCard ? (
          <div className="pagina-unica__end-card">{endCard}</div>
        ) : (
          <img
            src={paginas?.[paginaAtual]}
            alt={`${imgAltPrefix || 'Manga'} ${paginaAtual + 1}`}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            style={{ width: `${zoom}%`, margin: '0 auto', display: 'block' }}
          />
        )}
      </div>

      <button
        type="button"
        className="seta direita"
        onClick={onNext}
        disabled={paginaAtual >= totalHorizontalSlides - 1}
      >
        ›
      </button>

      <div className="contador">
        {Math.min(paginaAtual + 1, totalHorizontalSlides)} / {totalHorizontalSlides}
      </div>
    </div>
  );
}
