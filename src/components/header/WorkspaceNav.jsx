import React, { useEffect, useMemo, useRef, useState } from 'react';

export default function WorkspaceNav({
  isAdminShell,
  menuAberto,
  setMenuAberto,
  adminMenuAberto,
  setAdminMenuAberto,
  primaryNavItems,
  primaryNavIsActive,
  isLanceRouteActive,
  lanceSuaLinhaPath,
  showCreatorsNav,
  pushRoute,
  adminShellSections,
  currentPathname,
}) {
  const [openSectionId, setOpenSectionId] = useState('');
  const adminNavRef = useRef(null);
  const adminMobileSections = useMemo(() => adminShellSections.filter((section) => Array.isArray(section.items) && section.items.length > 0), [adminShellSections]);

  useEffect(() => {
    if (!isAdminShell) return () => {};
    const handleOutsideClick = (event) => {
      if (!adminNavRef.current?.contains(event.target)) {
        setOpenSectionId('');
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [isAdminShell]);

  if (isAdminShell) {
    return (
      <>
        <div ref={adminNavRef} className="nav-center-wrap nav-center-wrap--admin-shell">
          <button
            type="button"
            className={`admin-public-trigger ${menuAberto ? 'active' : ''}`}
            onClick={() => {
              setAdminMenuAberto(false);
              setMenuAberto(!menuAberto);
            }}
            aria-label="Abrir navegacao publica"
            aria-expanded={menuAberto}
          >
            <span className="admin-public-trigger__icon" aria-hidden="true">
              <span className="bar" />
              <span className="bar" />
              <span className="bar" />
            </span>
          </button>

          <button
            type="button"
            className={`admin-shell-trigger ${adminMenuAberto ? 'active' : ''}`}
            onClick={() => {
              setMenuAberto(false);
              setAdminMenuAberto(!adminMenuAberto);
            }}
            aria-label="Abrir navegacao administrativa"
            aria-expanded={adminMenuAberto}
          >
            <span className="admin-shell-trigger__icon" aria-hidden="true">
              <span className="bar" />
              <span className="bar" />
              <span className="bar" />
            </span>
          </button>

          <ul className="admin-top-nav" aria-label="Navegacao administrativa">
            {adminShellSections.map((section) => {
              const sectionIsActive = section.items.some((item) =>
                item.path === '/admin/dashboard'
                  ? currentPathname === '/admin/dashboard'
                  : currentPathname.startsWith(item.path)
              );
              return (
                <li
                  key={section.id}
                  className={`workspace-menu-item admin-top-nav__item ${sectionIsActive ? 'is-active' : ''} ${openSectionId === section.id ? 'open' : ''}`}
                >
                  <button
                    type="button"
                    className="workspace-menu-trigger workspace-menu-trigger--admin admin-top-nav__trigger"
                    aria-haspopup="menu"
                    aria-expanded={openSectionId === section.id}
                    onClick={() => setOpenSectionId((prev) => (prev === section.id ? '' : section.id))}
                  >
                    <span className="workspace-menu-label">{section.label}</span>
                  </button>
                  <div
                    className={`workspace-dropdown admin-top-nav__dropdown ${openSectionId === section.id ? 'is-visible' : ''}`}
                    role="menu"
                  >
                    {section.items.map((item) => {
                      const isActive =
                        item.path === '/admin/dashboard'
                          ? currentPathname === '/admin/dashboard'
                          : currentPathname.startsWith(item.path);
                      return (
                          <button
                            key={item.path}
                            type="button"
                            className={isActive ? 'is-active' : ''}
                            onClick={() => {
                              setOpenSectionId('');
                              pushRoute(item.path, 'admin');
                            }}
                            aria-current={isActive ? 'page' : undefined}
                          >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {menuAberto ? (
          <>
            <button
              type="button"
              className="mobile-menu-overlay mobile-menu-overlay--admin-shell"
              aria-label="Fechar navegacao publica"
              onClick={() => setMenuAberto(false)}
            />
            <aside className="admin-public-drawer" aria-label="Navegacao publica">
              <div className="admin-public-drawer__head">
                <strong>MangaTeofilo</strong>
                <small>Atalhos do site sem misturar com o painel administrativo.</small>
              </div>
              <div className="admin-public-drawer__body">
                <section className="admin-shell-section">
                  <h3 className="admin-shell-section__title">Navegacao do site</h3>
                  <div className="admin-shell-section__items">
                    <button
                      type="button"
                      className={currentPathname === '/' ? 'admin-shell-link is-active' : 'admin-shell-link'}
                      onClick={() => pushRoute('/')}
                    >
                      Inicio
                    </button>
                    {primaryNavItems.map((item) => {
                      const isActive = primaryNavIsActive(item);
                      return (
                        <button
                          key={item.path}
                          type="button"
                          className={`admin-shell-link ${isActive ? 'is-active' : ''}`}
                          onClick={() => pushRoute(item.path)}
                          aria-current={isActive ? 'page' : undefined}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className={`admin-shell-link ${isLanceRouteActive ? 'is-active' : ''}`}
                      onClick={() => pushRoute(lanceSuaLinhaPath)}
                      aria-current={isLanceRouteActive ? 'page' : undefined}
                    >
                      Lance sua linha
                    </button>
                    {showCreatorsNav ? (
                      <button
                        type="button"
                        className={`admin-shell-link ${currentPathname.startsWith('/creators') ? 'is-active' : ''}`}
                        onClick={() => pushRoute('/creators')}
                      >
                        Creators
                      </button>
                    ) : null}
                  </div>
                </section>
              </div>
            </aside>
          </>
        ) : null}

        {adminMenuAberto ? (
          <>
            <button
              type="button"
              className="mobile-menu-overlay mobile-menu-overlay--admin-shell"
              aria-label="Fechar navegacao administrativa"
              onClick={() => setAdminMenuAberto(false)}
            />
            <aside className="admin-shell-drawer admin-shell-drawer--mobile" aria-label="Navegacao administrativa">
              <div className="admin-shell-drawer__head">
                <strong>Painel admin</strong>
                <small>Atalhos do painel da equipe em qualquer tamanho de tela.</small>
              </div>
              <div className="admin-shell-drawer__body">
                {adminMobileSections.map((section) => (
                  <section key={section.id} className="admin-shell-section">
                    <h3 className="admin-shell-section__title">{section.label}</h3>
                    <div className="admin-shell-section__items">
                      {section.items.map((item) => {
                        const isActive =
                          item.path === '/admin/dashboard'
                            ? currentPathname === '/admin/dashboard'
                            : currentPathname.startsWith(item.path);
                        return (
                          <button
                            key={item.path}
                            type="button"
                            className={`admin-shell-link admin-shell-link--admin ${isActive ? 'is-active' : ''}`}
                            onClick={() => pushRoute(item.path, 'admin')}
                            aria-current={isActive ? 'page' : undefined}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </aside>
          </>
        ) : null}
      </>
    );
  }

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
