import React from 'react';

export default function CreatorProfileTabs({ profileMode, profileTab, onTabChange }) {
  return (
    <nav
      className={`criador-profile-tabs${profileMode === 'reader' ? ' criador-profile-tabs--reader' : ''}`}
      aria-label="Seções do perfil"
    >
      {profileMode === 'writer' ? (
        <button
          type="button"
          className={profileTab === 'works' ? 'is-active' : ''}
          onClick={() => onTabChange('works')}
        >
          Obras
        </button>
      ) : null}
      <button
        type="button"
        className={profileTab === 'likes' ? 'is-active' : ''}
        onClick={() => onTabChange('likes')}
      >
        {profileMode === 'writer' ? 'Curtidas' : 'Biblioteca'}
      </button>
    </nav>
  );
}
