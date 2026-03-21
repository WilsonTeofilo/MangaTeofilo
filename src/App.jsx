import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

// Componentes e Páginas
import Header from './Header'; 
import Login from './Login';
import ShitoGame from './ShitoGame';
import SobreAutor from './SobreAutor';
import Apoie from './Apoie';
import AdminPanel from './AdminPanel';
import Capitulos from './Capitulos'; 
import Leitor from './Leitor';
import Perfil from './Perfil';

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCIfoyLhykhz6IstjXNfHvMOltnPUHNvIA",
  authDomain: "shitoproject-ed649.firebaseapp.com",
  projectId: "shitoproject-ed649",
  storageBucket: "shitoproject-ed649.firebasestorage.app",
  messagingSenderId: "613627655546",
  appId: "1:613627655546:web:370838bb5e3867f431d2c3",
  measurementId: "G-5QNETWX5RW",
  databaseURL: "https://shitoproject-ed649-default-rtdb.firebaseio.com"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

// Componente para rolar a página para o topo em trocas de rota
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  
  const ADMIN_UID = "n5JTPLsxpyQPeC5qQtraSrBa4rG3";

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      setCarregando(false);
    });
    return () => unsubscribe();
  }, []);

  if (carregando) {
    return (
      <div className="shito-loading-screen">
        <div className="shito-loader-content">
          <div className="shito-spinner"></div>
          <h2 className="shito-loading-text">DESPERTANDO ALMA...</h2>
          <p className="shito-loading-sub">A névoa está se dissipando</p>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <ScrollToTop />
      {/* O Header recebe o objeto usuario para gerenciar o menu e perfil */}
      <Header usuario={usuario} />

      <main className="shito-main-content">
        <Routes>
          {/* NAVEGAÇÃO PRINCIPAL */}
          <Route path="/" element={<ShitoGame user={usuario} />} />
          <Route path="/capitulos" element={<Capitulos user={usuario} />} />
          <Route path="/ler/:id" element={<Leitor user={usuario} />} />
          
          {/* ÁREA DO USUÁRIO */}
          <Route path="/perfil" element={usuario ? <Perfil user={usuario} /> : <Navigate to="/login" />} />
          <Route path="/login" element={!usuario ? <Login /> : <Navigate to="/" />} />
          
          {/* INSTITUCIONAL */}
          <Route path="/sobre-autor" element={<SobreAutor user={usuario} />} />
          <Route path="/apoie" element={<Apoie user={usuario} />} />

          {/* ADMINISTRAÇÃO - Segurança em dobro (Rota e Componente) */}
          <Route 
            path="/admin" 
            element={usuario?.uid === ADMIN_UID ? <AdminPanel user={usuario} /> : <Navigate to="/" />} 
          />
          
          {/* 404 - ESTILIZADO */}
          <Route path="*" element={<Pagina404 />} />
        </Routes>
      </main>
    </Router>
  );
}

// Componente Interno para 404 (Mantém o App.js organizado)
function Pagina404() {
  return (
    <div className="shito-404-container">
      <h1 className="shito-404-title">404</h1>
      <div className="shito-404-divider"></div>
      <p className="shito-404-text">Caminho perdido na névoa eterna.</p>
      <button className="shito-404-btn" onClick={() => window.location.href = '/'}>
        RETORNAR AO INÍCIO
      </button>
    </div>
  );
}