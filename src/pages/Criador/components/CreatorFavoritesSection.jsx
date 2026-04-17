import React from 'react';

import { applyImageFallback, resolveFavoriteWorkCoverUrl } from '../creatorPublicProfileUtils';

export default function CreatorFavoritesSection({
  profileMode,
  favoritesPublicVisible,
  favoritesList,
  workCoverOverrides,
  chapterCoverResolved,
  onOpenFavorite,
}) {
  return (
    <section className="criador-section criador-section--favorites" aria-labelledby="criador-curtidas-title">
      <div className="criador-section__head">
        <h2 id="criador-curtidas-title">{profileMode === 'writer' ? 'Obras curtidas' : 'Biblioteca pública'}</h2>
      </div>
      {!favoritesPublicVisible ? (
        <p className="criador-section__empty">Este usuário não exibe curtidas publicamente.</p>
      ) : !favoritesList.length ? (
        <p className="criador-section__empty">
          {profileMode === 'writer'
            ? 'Este escritor ainda não salvou nenhuma obra por aqui.'
            : 'Este leitor ainda não salvou nenhuma obra publicamente.'}
        </p>
      ) : (
        <div className="criador-favorites-grid">
          {favoritesList.map((fav) => (
            <button
              key={String(fav.workId)}
              type="button"
              className="criador-favorite-card"
              onClick={() => onOpenFavorite(fav)}
            >
              <div className="criador-favorite-card__thumb">
                <img
                  src={resolveFavoriteWorkCoverUrl(fav, workCoverOverrides, chapterCoverResolved)}
                  alt={String(fav.title || fav.workId || '')}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => applyImageFallback(e)}
                />
              </div>
              <span className="criador-favorite-card__title">{fav.title || fav.workId}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
