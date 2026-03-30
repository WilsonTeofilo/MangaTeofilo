// src/components/Header.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { AVATAR_FALLBACK, isAdminUser } from '../constants'; // ✅ centralizado
import { assinaturaPremiumAtiva } from '../utils/capituloLancamento';
import './Header.css';

export default function Header({ usuario, perfil, adminAccess }) {
  const navigate = useNavigate();
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

  const isAdmin = Boolean(adminAccess?.canAccessAdmin ?? isAdminUser(usuario));
  /** Coroa só com assinatura Premium paga ativa (mesma regra do leitor). */
  const isPremium = !isAdmin && assinaturaPremiumAtiva(perfil);

  return (
    <nav className="reader-header">
      <div className="nav-container">

        <div className="nav-logo" onClick={() => pushRoute('/')}>
          SHITO
        </div>

        <div
          className={`mobile-menu-icon ${menuAberto ? 'active' : ''}`}
          onClick={() => setMenuAberto(!menuAberto)}
          aria-label="Menu"
        >
          <span className="bar" />
          <span className="bar" />
          <span className="bar" />
        </div>

        <ul className={`nav-menu ${menuAberto ? 'active' : ''}`}>
          <li onClick={() => pushRoute('/')}>Início</li>
          <li onClick={() => pushRoute('/capitulos')}>Capítulos</li>
          <li onClick={() => pushRoute('/sobre-autor')}>Sobre o Autor</li>
          <li onClick={() => pushRoute('/apoie')}>Apoie a Obra</li>

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
                ADMINISTRATIVO
              </button>
              <div className="admin-dropdown">
                <button type="button" onClick={() => pushRoute('/admin/manga')}>Lançar Mangá</button>
                <button type="button" onClick={() => pushRoute('/admin/avatares')}>CRUD de Avatares</button>
                <button type="button" onClick={() => pushRoute('/admin/dashboard')}>Dashboard</button>
                <button type="button" onClick={() => pushRoute('/admin/financeiro')}>Financeiro & Promos</button>
              </div>
            </li>
          )}

          {usuario && menuAberto && (
            <li className="mobile-only-logout" onClick={handleLogout}>
              Sair da Conta
            </li>
          )}
        </ul>

        <div className="nav-auth">
          {!usuario ? (
            <button className="btn-login-header" onClick={() => pushRoute('/login')}>
              ENTRAR / CADASTRAR
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

