// src/App.jsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from './services/firebase';
import { isAdminUser } from './constants';

import Header         from './components/Header.jsx';
import ScrollToTop    from './components/ScrollToTop.jsx';

import ShitoManga      from './pages/Home/ShitoManga.jsx';
import SobreAutor      from './pages/Home/SobreAutor.jsx';
import Apoie           from './pages/Home/Apoie.jsx';
import Login           from './pages/Auth/Login.jsx';
import Perfil          from './pages/Perfil/Perfil.jsx';
import Capitulos       from './pages/Capitulos/Capitulos.jsx';
import Leitor          from './pages/Leitor/Leitor.jsx';
import AdminPanel      from './pages/Admin/AdminPanel.jsx';
import AvatarAdmin     from './pages/Admin/AvatarAdmin.jsx';
import DashboardAdmin  from './pages/Admin/DashboardAdmin.jsx';
import FinanceiroAdmin from './pages/Admin/FinanceiroAdmin.jsx';

import './index.css';

const PENDING_METHOD_KEY = 'login_pending_method';

export default function App() {
  const [usuario,    setUsuario]    = useState(null);
  const [carregando, setCarregando] = useState(true);

  // ── Estado REATIVO do pending ─────────────────────────────────────────────
  // Lê o sessionStorage na montagem e escuta o evento customizado que o
  // Login.jsx dispara sempre que grava ou limpa o PENDING_METHOD_KEY.
  // Sem isso, o App não re-renderiza quando o Login muda o sessionStorage.
  const [temPending, setTemPending] = useState(
    () => Boolean(sessionStorage.getItem(PENDING_METHOD_KEY))
  );

  useEffect(() => {
    const handler = () => {
      setTemPending(Boolean(sessionStorage.getItem(PENDING_METHOD_KEY)));
    };
    window.addEventListener('pendingVerificationChanged', handler);
    return () => window.removeEventListener('pendingVerificationChanged', handler);
  }, []);

  // ── Firebase Auth ─────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      setCarregando(false);
    });
    const timer = setTimeout(() => setCarregando(false), 3000);
    return () => { unsubscribe(); clearTimeout(timer); };
  }, []);

  if (carregando) return <div style={{ background: '#050505', height: '100vh' }} />;

  const isAdmin = isAdminUser(usuario);

  // Usuário logado E sem verificação pendente = pode usar o app
  const podeAcessarApp = Boolean(usuario) && !temPending;

  return (
    <Router>
      <ScrollToTop />
      <Header usuario={podeAcessarApp ? usuario : null} />

      <main className="shito-main-content">
        <Routes>
          {/* Públicas */}
          <Route path="/"            element={<ShitoManga user={podeAcessarApp ? usuario : null} />} />
          <Route path="/capitulos"   element={<Capitulos  user={podeAcessarApp ? usuario : null} />} />
          <Route path="/ler/:id"     element={<Leitor     user={podeAcessarApp ? usuario : null} />} />
          <Route path="/sobre-autor" element={<SobreAutor />} />
          <Route path="/apoie"       element={<Apoie />} />

          {/* Login: abre se não tiver usuário OU se tiver pending */}
          <Route
            path="/login"
            element={!podeAcessarApp ? <Login /> : <Navigate to="/" />}
          />

          <Route
            path="/perfil"
            element={podeAcessarApp ? <Perfil user={usuario} /> : <Navigate to="/login" />}
          />

          {/* Admin */}
          <Route path="/admin"
            element={isAdmin && !temPending ? <Navigate to="/admin/manga" /> : <Navigate to="/" />}
          />
          <Route path="/admin/manga"
            element={isAdmin && !temPending ? <AdminPanel user={usuario} /> : <Navigate to="/" />}
          />
          <Route path="/admin/avatares"
            element={isAdmin && !temPending ? <AvatarAdmin /> : <Navigate to="/" />}
          />
          <Route path="/admin/dashboard"
            element={isAdmin && !temPending ? <DashboardAdmin /> : <Navigate to="/" />}
          />
          <Route path="/admin/financeiro"
            element={isAdmin && !temPending ? <FinanceiroAdmin /> : <Navigate to="/" />}
          />

          {/* 404 */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </Router>
  );
}

