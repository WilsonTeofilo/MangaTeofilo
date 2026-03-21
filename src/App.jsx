import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// 1. FIREBASE
import { auth } from './services/firebase'; 
import { onAuthStateChanged } from 'firebase/auth';

// 2. COMPONENTES (Arquivos .jsx na pasta components)
import Header from './components/Header.jsx'; 
import ScrollToTop from './components/ScrollToTop.jsx';

// 3. PÁGINAS (Baseado na sua estrutura de pastas atual)
import ShitoManga from './pages/Home/ShitoManga.jsx'; 
import SobreAutor from './pages/Home/SobreAutor.jsx';
import Apoie from './pages/Home/Apoie.jsx';
import Login from './pages/Auth/Login.jsx';     
import Perfil from './pages/Perfil/Perfil.jsx'; 
import Capitulos from './pages/Capitulos/Capitulos.jsx'; 
import Leitor from './pages/Leitor/Leitor.jsx';          
import AdminPanel from './pages/Admin/AdminPanel.jsx';

import './index.css'; 

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  
  // Seu UID de Admin (Regra do Database)
  const ADMIN_UID = "n5JTPLsxpyQPeC5qQtraSrBa4rG3";

  useEffect(() => {
    // Monitor de autenticação
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      setCarregando(false);
    });

    // Fallback para não travar a tela se o Firebase demorar
    const timer = setTimeout(() => setCarregando(false), 3000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  // Sem Splash de cuzao: Se estiver carregando, mostra o fundo preto
  if (carregando) return <div style={{background: '#050505', height: '100vh'}} />;

  return (
    <Router>
      <ScrollToTop />
      {/* Passando o usuario para o Header conforme o seu monolito fazia */}
      <Header usuario={usuario} />
      
      <main className="shito-main-content">
        <Routes>
          {/* Rotas Principais */}
          <Route path="/" element={<ShitoManga user={usuario} />} />
          <Route path="/capitulos" element={<Capitulos user={usuario} />} />
          <Route path="/ler/:id" element={<Leitor user={usuario} />} />
          <Route path="/sobre-autor" element={<SobreAutor />} />
          <Route path="/apoie" element={<Apoie />} />
          
          {/* Auth System */}
          <Route path="/login" element={!usuario ? <Login /> : <Navigate to="/perfil" />} />
          <Route path="/perfil" element={usuario ? <Perfil user={usuario} /> : <Navigate to="/login" />} />
          
          {/* Admin System (Restringido pelo seu UID) */}
          <Route 
            path="/admin" 
            element={usuario?.uid === ADMIN_UID ? <AdminPanel user={usuario} /> : <Navigate to="/" />} 
          />
          
          {/* 404 */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </Router>
  );
}