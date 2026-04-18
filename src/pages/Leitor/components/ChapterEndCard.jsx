import React, { useMemo } from 'react';

function chapterLabel(chapter) {
  const row = chapter && typeof chapter === 'object' ? chapter : {};
  const n = Number(row.numero || 0);
  const title = String(row.titulo || '').trim();
  if (n && title) return `Capitulo ${n} - ${title}`;
  if (n) return `Capitulo ${n}`;
  return title || 'Capitulo';
}

export default function ChapterEndCard({
  modoLeitura,
  currentChapter,
  nextChapter,
  capsLiberadosLista,
  currentId,
  onSelectChapter,
  onNavigateNext,
  isLoggedIn,
  chapterLikedByUser,
  chapterLikeBusy,
  chapterLikesCount,
  onToggleLike,
}) {
  const currentLabel = useMemo(() => chapterLabel(currentChapter), [currentChapter]);
  const nextLabel = useMemo(() => chapterLabel(nextChapter), [nextChapter]);
  const hasNext = Boolean(nextChapter?.id);

  return (
    <section className={`chapter-end-card chapter-end-card--${modoLeitura}`} aria-label="Fim do capitulo">
      <div className="chapter-end-card__eyebrow">Fim do capitulo</div>
      <h2 className="chapter-end-card__title">{currentLabel}</h2>
      <p className="chapter-end-card__text">
        {hasNext
          ? 'Voce chegou ao fim. Pode continuar no proximo capitulo por clique, sem perder a navegacao por gesto.'
          : 'Voce chegou ao fim do capitulo atual. Use a lista para voltar ou escolher outro capitulo liberado.'}
      </p>

      <div className="chapter-end-card__actions">
        <button
          type="button"
          className={`chapter-end-card__like ${chapterLikedByUser ? 'is-liked' : ''}`}
          onClick={onToggleLike}
          disabled={chapterLikeBusy}
          title={
            isLoggedIn
              ? (chapterLikedByUser ? 'Remover curtida do capitulo' : 'Curtir capitulo')
              : 'Faca login para curtir o capitulo'
          }
        >
          <span className="chapter-end-card__like-icon">{chapterLikedByUser ? '♥' : '♡'}</span>
          <span className="chapter-end-card__like-label">
            {chapterLikeBusy ? 'Salvando...' : chapterLikedByUser ? 'Curtido' : 'Curtir capitulo'}
          </span>
          <span className="chapter-end-card__like-count">{chapterLikesCount}</span>
        </button>

        {hasNext ? (
          <button
            type="button"
            className="chapter-end-card__next"
            onClick={() => onNavigateNext?.(nextChapter.id)}
          >
            <span className="chapter-end-card__next-kicker">Proximo capitulo</span>
            <strong>{nextLabel}</strong>
          </button>
        ) : null}
      </div>

      <div className="chapter-end-card__selector">
        <label className="chapter-end-card__selector-label" htmlFor={`chapter-end-select-${modoLeitura}`}>
          Ir para um capitulo liberado
        </label>
        <select
          id={`chapter-end-select-${modoLeitura}`}
          className="chapter-end-card__select"
          value={currentId}
          onChange={(e) => onSelectChapter?.(e.target.value)}
          aria-label="Escolher capitulo liberado"
        >
          {capsLiberadosLista.map((c) => (
            <option key={c.id} value={c.id}>
              {chapterLabel(c)}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
