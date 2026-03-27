// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from './services/firebase';
import { isAdminUser } from './constants'; // ✅ centralizado

import Header from './components/Header.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';

import ShitoManga  from './pages/Home/ShitoManga.jsx';
import SobreAutor  from './pages/Home/SobreAutor.jsx';
import Apoie       from './pages/Home/Apoie.jsx';
import Login       from './pages/Auth/Login.jsx';
import Perfil      from './pages/Perfil/Perfil.jsx';
import Capitulos   from './pages/Capitulos/Capitulos.jsx';
import Leitor      from './pages/Leitor/Leitor.jsx';
import AdminPanel  from './pages/Admin/AdminPanel.jsx';
import AvatarAdmin from './pages/Admin/AvatarAdmin.jsx';
import DashboardAdmin from './pages/Admin/DashboardAdmin.jsx';
import FinanceiroAdmin from './pages/Admin/FinanceiroAdmin.jsx';

import './index.css';

export default function App() {
  const [usuario, setUsuario]     = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      setCarregando(false);
    });

    // Fallback: não trava a tela se o Firebase demorar
    const timer = setTimeout(() => setCarregando(false), 3000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  if (carregando) return <div style={{ background: '#050505', height: '100vh' }} />;

  const isAdmin = isAdminUser(usuario);

  return (
    <Router>
      <ScrollToTop />
      <Header usuario={usuario} />

      <main className="shito-main-content">
        <Routes>
          {/* Rotas públicas */}
          <Route path="/"            element={<ShitoManga user={usuario} />} />
          <Route path="/capitulos"   element={<Capitulos  user={usuario} />} />
          <Route path="/ler/:id"     element={<Leitor     user={usuario} />} />
          <Route path="/sobre-autor" element={<SobreAutor />} />
          <Route path="/apoie"       element={<Apoie />} />

          {/* Auth */}
          <Route
            path="/login"
            element={!usuario ? <Login /> : <Navigate to="/" />}
          />
          <Route
            path="/perfil"
            element={usuario ? <Perfil user={usuario} /> : <Navigate to="/login" />}
          />

          {/* Admin — protegido pelo UID */}
          <Route
            path="/admin"
            element={isAdmin ? <Navigate to="/admin/manga" /> : <Navigate to="/" />}
          />
          <Route
            path="/admin/manga"
            element={isAdmin ? <AdminPanel user={usuario} /> : <Navigate to="/" />}
          />
          <Route
            path="/admin/avatares"
            element={isAdmin ? <AvatarAdmin /> : <Navigate to="/" />}
          />
          <Route
            path="/admin/dashboard"
            element={isAdmin ? <DashboardAdmin /> : <Navigate to="/" />}
          />
          <Route
            path="/admin/financeiro"
            element={isAdmin ? <FinanceiroAdmin /> : <Navigate to="/" />}
          />

          {/* 404 */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </Router>
  );
}

