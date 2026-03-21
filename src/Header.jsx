import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth, signOut } from "firebase/auth";

export default function Header({ usuario }) {
  const navigate = useNavigate();
  const auth = getAuth();
  const ADMIN_UID = "n5JTPLsxpyQPeC5qQtraSrBa4rG3"; // Seu ID mestre

  return (
    <nav className="reader-header">
      <div className="nav-container">
        <div className="nav-logo" onClick={() => navigate('/')}>SHITO</div>
        
        <ul className="nav-menu">
          <li onClick={() => navigate('/')}>Início</li>
          <li onClick={() => navigate('/capitulos')}>Capítulos</li>
          <li onClick={() => navigate('/sobre-autor')}>Sobre o Autor</li>
          <li onClick={() => navigate('/apoie')}>Apoie a Obra</li>

          {/* SÓ APARECE PARA O WILSON (ADMIN) */}
          {usuario && usuario.uid === ADMIN_UID && (
            <li 
              onClick={() => navigate('/admin')} 
              style={{ color: '#ffcc00', fontWeight: 'bold', cursor: 'pointer' }}
            >
              LANÇAR MANGÁ
            </li>
          )}
        </ul>

        <div className="nav-auth">
          {!usuario ? (
            <button className="btn-login-header" onClick={() => navigate('/login')}>
              ENTRAR / CADASTRAR
            </button>
          ) : (
            <div className="user-info-header">
              <span>Olá, {usuario.displayName || 'Guerreiro'}</span>
              <button onClick={() => signOut(auth)}>Sair</button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}