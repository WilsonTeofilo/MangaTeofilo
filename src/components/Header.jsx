import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from "firebase/auth";

// 1. IMPORTAÇÃO DO SERVICE CENTRAL
import { auth } from '../services/firebase';

import './Header.css';

export default function Header({ usuario }) {
  const navigate = useNavigate();
  const [menuAberto, setMenuAberto] = useState(false);
  
  // Seu UID de Administrador para o link de lançamento
  const ADMIN_UID = "n5JTPLsxpyQPeC5qQtraSrBa4rG3"; 

  // Função para deslogar
  const handleLogout = async (e) => {
    e.stopPropagation(); 
    try {
      await signOut(auth);
      setMenuAberto(false);
      navigate('/login');
    } catch (error) {
      console.error("Erro ao sair da tempestade:", error);
    }
  };

  // Navegação que fecha o menu mobile automaticamente
  const pushRoute = (path) => {
    navigate(path);
    setMenuAberto(false);
  };

  return (
    <nav className="reader-header">
      <div className="nav-container">
        
        {/* LOGO */}
        <div className="nav-logo" onClick={() => pushRoute('/')}>
          SHITO
        </div>

        {/* ÍCONE HAMBÚRGUER (Mobile) */}
        <div 
          className={`mobile-menu-icon ${menuAberto ? 'active' : ''}`} 
          onClick={() => setMenuAberto(!menuAberto)}
          aria-label="Menu"
        >
          <span className="bar"></span>
          <span className="bar"></span>
          <span className="bar"></span>
        </div>

        {/* LINKS DE NAVEGAÇÃO */}
        <ul className={`nav-menu ${menuAberto ? 'active' : ''}`}>
          <li onClick={() => pushRoute('/')}>Início</li>
          <li onClick={() => pushRoute('/capitulos')}>Capítulos</li>
          <li onClick={() => pushRoute('/sobre-autor')}>Sobre o Autor</li>
          <li onClick={() => pushRoute('/apoie')}>Apoie a Obra</li>

          {/* ÁREA ADMIN: Só aparece para você */}
          {usuario && usuario.uid === ADMIN_UID && (
            <li 
              className="admin-link-highlight"
              onClick={() => pushRoute('/admin')}
            >
              LANÇAR MANGÁ
            </li>
          )}
          
          {/* Logout visível apenas no menu mobile aberto */}
          {usuario && menuAberto && (
            <li className="mobile-only-logout" onClick={handleLogout}>
              Sair da Conta
            </li>
          )}
        </ul>

        {/* IDENTIDADE DO USUÁRIO */}
        <div className="nav-auth">
          {!usuario ? (
            <button className="btn-login-header" onClick={() => pushRoute('/login')}>
              ENTRAR / CADASTRAR
            </button>
          ) : (
            <div 
              className="user-info-header" 
              title="Acessar Perfil"
            >
              {/* Avatar com fallback para caso a imagem falhe */}
              <div className="header-avatar-wrapper" onClick={() => pushRoute('/perfil')}>
                <img 
                  src={usuario.photoURL || '/assets/avatares/ava1.webp'} 
                  alt="Avatar" 
                  className="header-avatar-img"
                  onError={(e) => { e.target.src = '/assets/avatares/ava1.webp'; }}
                />
              </div>
              
              <div className="user-text-group">
                <span className="welcome-text" onClick={() => pushRoute('/perfil')}>
                  Olá, {usuario.displayName?.split(' ')[0] || 'Guerreiro'}
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