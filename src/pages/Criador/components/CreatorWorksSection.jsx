import React from 'react';

import { applyImageFallback, resolveCreatorWorkCoverUrl } from '../creatorPublicProfileUtils';

export default function CreatorWorksSection({
  obrasSorted,
  obrasCount,
  sortObras,
  onSortChange,
  workCoverOverrides,
  chapterCoverResolved,
  onOpenWork,
  sectionRef,
}) {
  return (
    <section ref={sectionRef} className="criador-section" id="obras-do-criador">
      <div className="criador-section__head criador-section__head--row">
        <h2>Obras publicadas</h2>
        <div className="criador-section__meta">
          <span>{obrasCount} obra(s)</span>
          <label className="criador-sort-label">
            Ordenar
            <select value={sortObras} onChange={(e) => onSortChange(e.target.value)} aria-label="Ordenar obras">
              <option value="recent">Mais recentes</option>
              <option value="popular">Mais populares</option>
            </select>
          </label>
        </div>
      </div>
      {!obrasSorted.length ? (
        <p className="criador-section__empty">Nenhuma obra pública cadastrada ainda.</p>
      ) : (
        <div className="criador-obras-grid">
          {obrasSorted.map((obra) => {
            const sinopse = String(obra.sinopse || obra.descricao || '').trim();
            return (
              <article
                key={obra.id}
                className="criador-obra-card"
                role="button"
                tabIndex={0}
                onClick={() => onOpenWork(obra)}
                onKeyDown={(e) => e.key === 'Enter' && onOpenWork(obra)}
              >
                <div className="criador-obra-card__thumb">
                  <img
                    src={resolveCreatorWorkCoverUrl(obra, workCoverOverrides, chapterCoverResolved)}
                    alt={obra.titulo || obra.id}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                    onError={(e) => applyImageFallback(e)}
                  />
                </div>
                <div className="criador-obra-card__body">
                  <strong className="criador-obra-card__title">{obra.titulo || obra.id}</strong>
                  <span className="criador-obra-card__meta">{obra.status || 'ongoing'}</span>
                  {sinopse ? (
                    <p className="criador-obra-card__synopsis">{sinopse}</p>
                  ) : null}
                  <div className="criador-obra-stats" aria-label="Estatisticas da obra">
                    <small>{obra.stats.likes} curtidas</small>
                    <small>{obra.stats.views} views</small>
                    <small>{obra.stats.comments} comentarios</small>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
