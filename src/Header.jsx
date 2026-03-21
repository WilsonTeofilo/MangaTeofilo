import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth, signOut } from "firebase/auth";
import './Header.css';

export default function Header({ usuario }) {
  const navigate = useNavigate();
  const auth = getAuth();
  const [menuAberto, setMenuAberto] = useState(false);
  const ADMIN_UID = "n5JTPLsxpyQPeC5qQtraSrBa4rG3"; // Seu UID de Admin

  // Função para deslogar e limpar o estado do menu
  const handleLogout = async (e) => {
    e.stopPropagation(); 
    try {
      await signOut(auth);
      setMenuAberto(false);
      navigate('/login');
    } catch (error) {
      console.error("Erro ao sair:", error);
    }
  };

  // Navegação que garante o fechamento do menu no mobile
  const pushRoute = (path) => {
    navigate(path);
    setMenuAberto(false);
  };

  return (
    <nav className="reader-header">
      <div className="nav-container">
        
        {/* LOGO - Sempre leva para a Home */}
        <div className="nav-logo" onClick={() => pushRoute('/')}>
          SHITO
        </div>

        {/* ÍCONE HAMBÚRGUER - Visível apenas no Mobile via CSS */}
        <div 
          className={`mobile-menu-icon ${menuAberto ? 'active' : ''}`} 
          onClick={() => setMenuAberto(!menuAberto)}
        >
          <span className="bar"></span>
          <span className="bar"></span>
          <span className="bar"></span>
        </div>

        {/* MENU DE NAVEGAÇÃO */}
        <ul className={`nav-menu ${menuAberto ? 'active' : ''}`}>
          <li onClick={() => pushRoute('/')}>Início</li>
          <li onClick={() => pushRoute('/capitulos')}>Capítulos</li>
          <li onClick={() => pushRoute('/sobre-autor')}>Sobre o Autor</li>
          <li onClick={() => pushRoute('/apoie')}>Apoie a Obra</li>

          {/* LINK DE ADMIN - Aparece apenas para o seu UID */}
          {usuario && usuario.uid === ADMIN_UID && (
            <li 
              className="admin-link-highlight"
              onClick={() => pushRoute('/admin')}
            >
              LANÇAR MANGÁ
            </li>
          )}
          
          {/* Opção de Sair dentro do menu mobile para facilitar */}
          {usuario && menuAberto && (
            <li className="mobile-only-logout" onClick={handleLogout}>
              Sair da Conta
            </li>
          )}
        </ul>

        {/* ÁREA DE AUTH / PERFIL */}
        <div className="nav-auth">
          {!usuario ? (
            <button className="btn-login-header" onClick={() => pushRoute('/login')}>
              ENTRAR / CADASTRAR
            </button>
          ) : (
            <div 
              className="user-info-header" 
              onClick={() => pushRoute('/perfil')}
              title="Acessar Perfil"
            >
              {/* Avatar estilo bolinha com o zoom que você pediu */}
              <div className="header-avatar-wrapper">
                <img 
                  src={usuario.photoURL || '/assets/avatares/ava1.webp'} 
                  alt="Avatar" 
                  className="header-avatar-img"
                  onError={(e) => { e.target.src = '/assets/avatares/ava1.webp'; }}
                />
              </div>
              
              <div className="user-text-group">
                <span className="welcome-text">
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