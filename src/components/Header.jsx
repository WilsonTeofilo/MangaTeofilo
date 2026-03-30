// src/components/Header.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { AVATAR_FALLBACK, isAdminUser } from '../constants'; // ✅ centralizado
import { assinaturaPremiumAtiva } from '../utils/capituloLancamento';
import './Header.css';

export default function Header({ usuario, perfil, adminAccess }) {
  const MOBILE_BREAKPOINT = 1360;
  const navigate = useNavigate();
  const location = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const adminCloseTimer = useRef(null);

  const handleLogout = async (e) => {
    e.stopPropagation();
    try {
      await signOut(auth);
      setMenuAberto(false);
      setAdminMenuOpen(false);
      navigate('/login');
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
  };

  const pushRoute = (path) => {
    navigate(path);
    setMenuAberto(false);
    setAdminMenuOpen(false);
  };

  const abrirMenuAdmin = () => {
    if (adminCloseTimer.current) {
      clearTimeout(adminCloseTimer.current);
      adminCloseTimer.current = null;
    }
    setAdminMenuOpen(true);
  };

  const fecharMenuAdmin = () => {
    if (adminCloseTimer.current) clearTimeout(adminCloseTimer.current);
    adminCloseTimer.current = setTimeout(() => {
      setAdminMenuOpen(false);
      adminCloseTimer.current = null;
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (adminCloseTimer.current) clearTimeout(adminCloseTimer.current);
    };
  }, []);

  useEffect(() => {
    setMenuAberto(false);
    setAdminMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const syncMenuState = () => {
      if (window.innerWidth > MOBILE_BREAKPOINT) {
        setMenuAberto(false);
      }
      if (window.innerWidth <= MOBILE_BREAKPOINT) {
        setAdminMenuOpen(false);
      }
    };
    syncMenuState();
    window.addEventListener('resize', syncMenuState);
    return () => window.removeEventListener('resize', syncMenuState);
  }, []);

  const isAdmin = Boolean(adminAccess?.canAccessAdmin ?? isAdminUser(usuario));
  /** Coroa só com assinatura Premium paga ativa (mesma regra do leitor). */
  const isPremium = !isAdmin && assinaturaPremiumAtiva(perfil);
  const navItems = [
    { label: 'Lista de Mangás', path: '/mangas' },
    { label: 'Loja', path: '/loja' },
    ...(usuario ? [{ label: 'Minha Biblioteca', path: '/biblioteca' }] : []),
    { label: 'Sobre o Autor', path: '/sobre-autor' },
    { label: 'Apoie a Obra', path: '/apoie' },
  ];
  const isActivePath = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <nav className={`reader-header ${usuario ? 'reader-header--logged' : 'reader-header--guest'} ${isAdmin ? 'reader-header--admin' : ''}`}>
      <div className="nav-container">

        <button type="button" className="nav-logo" onClick={() => pushRoute('/')}>
          MangaTeofilo
        </button>

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

        <ul className={`nav-menu ${menuAberto ? 'active' : ''}`}>
          {navItems.map((item) => (
            <li key={item.path} className={isActivePath(item.path) ? 'is-active' : ''}>
              <button
                type="button"
                className="nav-link-btn"
                onClick={() => pushRoute(item.path)}
                aria-current={isActivePath(item.path) ? 'page' : undefined}
              >
                {item.label}
              </button>
            </li>
          ))}

          {isAdmin && (
            <li
              className={`admin-menu-item ${adminMenuOpen ? 'open' : ''}`}
              onMouseEnter={abrirMenuAdmin}
              onMouseLeave={fecharMenuAdmin}
            >
              <button
                type="button"
                className="admin-menu-trigger"
                onClick={() => setAdminMenuOpen((prev) => !prev)}
                onFocus={abrirMenuAdmin}
              >
                <span className="admin-label-long">ADMINISTRATIVO</span>
                <span className="admin-label-short">ADMIN</span>
              </button>
              <div className="admin-dropdown">
                <button type="button" onClick={() => pushRoute('/admin/capitulos')}>Capítulos</button>
                <button type="button" onClick={() => pushRoute('/admin/obras')}>CRUD de Obras</button>
                <button type="button" onClick={() => pushRoute('/admin/avatares')}>CRUD de Avatares</button>
                <button type="button" onClick={() => pushRoute('/admin/dashboard')}>Dashboard</button>
                <button type="button" onClick={() => pushRoute('/admin/financeiro')}>Financeiro & Promos</button>
                <button type="button" onClick={() => pushRoute('/admin/loja')}>Loja Física</button>
              </div>
            </li>
          )}

          {usuario && menuAberto && (
            <li className="mobile-only-logout">
              <button type="button" className="nav-link-btn" onClick={handleLogout}>
                Sair da Conta
              </button>
            </li>
          )}
        </ul>

        <div className="nav-auth">
          {!usuario ? (
            <button className="btn-login-header" onClick={() => pushRoute('/login')}>
              <span className="btn-login-long">ENTRAR / CADASTRAR</span>
              <span className="btn-login-short">ENTRAR</span>
            </button>
          ) : (
            <div className="user-info-header" title="Acessar Perfil">
              <div className="header-avatar-wrapper" onClick={() => pushRoute('/perfil')}>
                <img
                  src={usuario.photoURL || AVATAR_FALLBACK} // ✅ centralizado
                  alt="Avatar"
                  className="header-avatar-img"
                  onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
                />
              </div>
              <div className="user-text-group">
                <span className="welcome-text" onClick={() => pushRoute('/perfil')}>
                  Olá, {usuario.displayName?.split(' ')[0] || 'Guerreiro'}
                  {isPremium ? ' 👑' : ''}
                </span>
                <button className="btn-logout-header" onClick={handleLogout}>
                  Sair
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </nav>
  );
}

