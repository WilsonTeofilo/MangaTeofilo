import React from 'react';

export default function WorkspaceNav({
  menuAberto,
  setMenuAberto,
  primaryNavItems,
  primaryNavIsActive,
  isLanceRouteActive,
  lanceSuaLinhaPath,
  showCreatorsNav,
  pushRoute,
}) {
  return (
    <>
      <div className="nav-center-wrap">
        <ul className={`nav-menu nav-menu--primary ${menuAberto ? 'active' : ''}`}>
          {primaryNavItems.map((item) => (
            <li key={item.path} className={primaryNavIsActive(item) ? 'is-active' : ''}>
              <button
                type="button"
                className="nav-link-btn"
                onClick={() => pushRoute(item.path)}
                aria-current={primaryNavIsActive(item) ? 'page' : undefined}
              >
                {item.label}
              </button>
            </li>
          ))}
          <li className="nav-menu__cta-mobile">
            <button
              type="button"
              className={`header-cta-lance header-cta-lance--block ${isLanceRouteActive ? 'is-active' : ''}`}
              onClick={() => pushRoute(lanceSuaLinhaPath)}
            >
              Lance sua linha
            </button>
          </li>
          {showCreatorsNav ? (
            <li className="nav-menu__extra">
              <button type="button" className="nav-link-btn" onClick={() => pushRoute('/creators')}>
                CREATORS
              </button>
            </li>
          ) : null}
        </ul>

        <button
          type="button"
          className={`header-cta-lance header-cta-lance--desktop ${isLanceRouteActive ? 'is-active' : ''}`}
          onClick={() => pushRoute(lanceSuaLinhaPath)}
          title="Producao de manga fisico e venda na loja"
        >
          Lance sua linha
        </button>
      </div>

      <button
        type="button"
        className={`mobile-menu-icon ${menuAberto ? 'active' : ''}`}
        onClick={() => setMenuAberto(!menuAberto)}
        aria-label="Menu"
        aria-expanded={menuAberto}
      >
        <span className="bar" />
        <span className="bar" />
        <span className="bar" />
      </button>

      {menuAberto && (
        <button
          type="button"
          className="mobile-menu-overlay"
          aria-label="Fechar menu"
          onClick={() => setMenuAberto(false)}
        />
      )}
    </>
  );
}
