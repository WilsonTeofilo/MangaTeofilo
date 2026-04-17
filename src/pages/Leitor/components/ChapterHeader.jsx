import React from 'react';

export default function ChapterHeader({
  title,
  isLoggedIn,
  chapterLikedByUser,
  chapterLikeBusy,
  chapterLikesCount,
  onToggleLike,
  showConfig,
  onToggleConfig,
}) {
  return (
    <header className="leitor-header">
      <div className="leitor-header-main">
        <h1>{title}</h1>
        <button
          type="button"
          className={`leitor-chapter-like ${chapterLikedByUser ? 'is-liked' : ''}`}
          onClick={onToggleLike}
          disabled={chapterLikeBusy}
          title={
            isLoggedIn
              ? (chapterLikedByUser ? 'Remover curtida do capitulo' : 'Curtir capitulo')
              : 'Faca login para curtir o capitulo'
          }
        >
          <span className="leitor-chapter-like-icon">{chapterLikedByUser ? '♥' : '♡'}</span>
          <span className="leitor-chapter-like-text">
            {chapterLikeBusy ? 'Salvando...' : (chapterLikedByUser ? 'Descurtir capitulo' : 'Curtir capitulo')}
          </span>
          <span className="leitor-chapter-like-count">{chapterLikesCount}</span>
        </button>
      </div>
      <button
        type="button"
        className="btn-config"
        aria-label="Abrir configuracoes de leitura"
        aria-expanded={showConfig}
        onClick={onToggleConfig}
      >
        ⚙
      </button>
    </header>
  );
}
