import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { catalogWorkDisplayMeta, searchQueryIsActive } from '../utils/mangaCatalogSearch';
import { AVATAR_FALLBACK } from '../constants';
import './MangaCatalogSearchBar.css';

/**
 * Busca no catálogo (Explorar) com dropdown de sugestões estilo MAL/AniList.
 */
export default function MangaCatalogSearchBar({
  value,
  onChange,
  suggestions = [],
  onSelectWork,
  disabled = false,
  resultCount = null,
  totalCount = null,
  coverFallback = AVATAR_FALLBACK,
}) {
  const inputId = useId();
  const listId = useId();
  const rootRef = useRef(null);
  const blurCloseTimer = useRef(null);
  const q = String(value || '');
  const showMeta =
    typeof resultCount === 'number' && typeof totalCount === 'number' && searchQueryIsActive(q);
  const showList =
    searchQueryIsActive(q) && Array.isArray(suggestions) && suggestions.length > 0 && typeof onSelectWork === 'function';

  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const clearBlurTimer = useCallback(() => {
    if (blurCloseTimer.current != null) {
      window.clearTimeout(blurCloseTimer.current);
      blurCloseTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearBlurTimer();
    blurCloseTimer.current = window.setTimeout(() => {
      setListOpen(false);
      setActiveIndex(-1);
    }, 160);
  }, [clearBlurTimer]);

  useEffect(() => {
    if (!showList) {
      setListOpen(false);
      setActiveIndex(-1);
      return;
    }
    setListOpen(true);
    setActiveIndex((prev) => {
      if (prev >= 0 && prev < suggestions.length) return prev;
      return 0;
    });
  }, [showList, suggestions.length]);

  useEffect(() => () => clearBlurTimer(), [clearBlurTimer]);

  const openList = useCallback(() => {
    clearBlurTimer();
    if (showList) setListOpen(true);
  }, [clearBlurTimer, showList]);

  const pick = useCallback(
    (card) => {
      if (!card || typeof onSelectWork !== 'function') return;
      clearBlurTimer();
      setListOpen(false);
      setActiveIndex(-1);
      onSelectWork(card);
    },
    [clearBlurTimer, onSelectWork]
  );

  const onInputKeyDown = (e) => {
    if (!showList || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setListOpen(true);
      setActiveIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setListOpen(true);
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter' && listOpen && activeIndex >= 0 && suggestions[activeIndex]) {
      e.preventDefault();
      pick(suggestions[activeIndex]);
      return;
    }
    if (e.key === 'Escape') {
      setListOpen(false);
      setActiveIndex(-1);
    }
  };

  const activeDescendant =
    listOpen && activeIndex >= 0 && suggestions[activeIndex]
      ? `${listId}-opt-${activeIndex}`
      : undefined;

  return (
    <div className="manga-catalog-search manga-catalog-search--combo" ref={rootRef}>
      <label className="manga-catalog-search__label visually-hidden" htmlFor={inputId}>
        Pesquisar em Lista de Mangás
      </label>
      <div
        className="manga-catalog-search__shell"
        onMouseDown={(e) => {
          if (e.target.closest('.manga-catalog-search__dropdown')) return;
          clearBlurTimer();
        }}
      >
        <input
          id={inputId}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={listOpen && showList}
          aria-controls={listId}
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
          className="manga-catalog-search__input"
          placeholder="Pesquisar em 'Lista de Mangás'..."
          value={q}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onFocus={openList}
          onBlur={scheduleClose}
          onKeyDown={onInputKeyDown}
        />
        {q ? (
          <button
            type="button"
            className="manga-catalog-search__clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('');
              setListOpen(false);
              setActiveIndex(-1);
            }}
            aria-label="Limpar pesquisa"
          >
            ×
          </button>
        ) : null}
        <span className="manga-catalog-search__icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm9 2-4.35-4.35"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>

      {listOpen && showList ? (
        <ul
          id={listId}
          className="manga-catalog-search__dropdown"
          role="listbox"
          aria-label="Sugestões de obras"
          onMouseDown={(e) => e.preventDefault()}
        >
          {suggestions.map((card, i) => {
            const { primaryTitle, secondaryTitle, typeLabel } = catalogWorkDisplayMeta(card);
            const cover = String(card?.capaUrl || card?.bannerUrl || '').trim() || coverFallback;
            const active = i === activeIndex;
            return (
              <li key={String(card?.obraId || card?.id || i)} role="none">
                <button
                  type="button"
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={active}
                  className={`manga-catalog-search__option${active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => pick(card)}
                >
                  <img
                    src={cover}
                    alt=""
                    className="manga-catalog-search__thumb"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      e.target.src = coverFallback;
                    }}
                  />
                  <div className="manga-catalog-search__titles">
                    <span className="manga-catalog-search__primary">{primaryTitle}</span>
                    {secondaryTitle ? (
                      <span className="manga-catalog-search__secondary">{secondaryTitle}</span>
                    ) : null}
                  </div>
                  <span className="manga-catalog-search__type">{typeLabel}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {showMeta ? (
        <p className="manga-catalog-search__meta" aria-live="polite">
          {resultCount === 0
            ? 'Nenhuma obra encontrada para esta busca.'
            : `${resultCount} de ${totalCount} obra(s) na lista`}
        </p>
      ) : !searchQueryIsActive(q) && q.length > 0 ? (
        <p className="manga-catalog-search__meta manga-catalog-search__meta--hint" aria-live="polite">
          Digite pelo menos 2 letras para sugestões e filtro (título, autor, gênero).
        </p>
      ) : null}
    </div>
  );
}
