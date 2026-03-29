// src/App.jsx
import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';

import { auth, db } from './services/firebase';
import { isAdminUser } from './constants';

import Header from './components/Header.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';

import ShitoManga from './pages/Home/ShitoManga.jsx';
import SobreAutor from './pages/Home/SobreAutor.jsx';
import Apoie from './pages/Home/Apoie.jsx';
import Login from './pages/Auth/Login.jsx';
import Perfil from './pages/Perfil/Perfil.jsx';
import Capitulos from './pages/Capitulos/Capitulos.jsx';
import Leitor from './pages/Leitor/Leitor.jsx';
import AdminPanel from './pages/Admin/AdminPanel.jsx';
import AvatarAdmin from './pages/Admin/AvatarAdmin.jsx';
import DashboardAdmin from './pages/Admin/DashboardAdmin.jsx';
import FinanceiroAdmin from './pages/Admin/FinanceiroAdmin.jsx';

import './index.css';

function computePodeAcessarApp(usuario, perfilUsuario) {
  if (!usuario) return false;
  if (isAdminUser(usuario)) return true;
  if (!perfilUsuario) return false;
  if (perfilUsuario.status === 'banido') return false;
  if (perfilUsuario.status !== 'ativo') return false;
  return true;
}


function AppRoutes() {
  const location = useLocation();
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);

  const [perfilUsuario, setPerfilUsuario] = useState(null);
  const [perfilCarregando, setPerfilCarregando] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      setCarregando(false);
    });
    const timer = setTimeout(() => setCarregando(false), 3000);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!usuario?.uid) {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      setPerfilUsuario(null);
      setPerfilCarregando(false);
      return;
    }
    setPerfilCarregando(true);
    const r = ref(db, `usuarios/${usuario.uid}`);
    const unsub = onValue(r, (snap) => {
      setPerfilUsuario(snap.exists() ? snap.val() : null);
      setPerfilCarregando(false);
    });
    return () => unsub();
  }, [usuario?.uid]);

  if (carregando) {
    return <div style={{ background: '#050505', height: '100vh' }} />;
  }

  if (usuario && perfilCarregando) {
    return <div style={{ background: '#050505', height: '100vh' }} />;
  }

  const podeAcessarApp =
    Boolean(usuario) &&
    computePodeAcessarApp(usuario, perfilUsuario);

  const sessaoInvalida =
    Boolean(usuario) &&
    !perfilCarregando &&
    !podeAcessarApp;

  if (sessaoInvalida && location.pathname !== '/login') {
    return <Navigate to="/login" replace />;
  }

  const isAdmin = isAdminUser(usuario);

  return (
    <>
      <ScrollToTop />
      <Header usuario={podeAcessarApp ? usuario : null} />

      <main className="shito-main-content">
        <Routes>
          <Route
            path="/"
            element={<ShitoManga user={podeAcessarApp ? usuario : null} />}
          />
          <Route
            path="/capitulos"
            element={<Capitulos user={podeAcessarApp ? usuario : null} />}
          />
          <Route
            path="/ler/:id"
            element={<Leitor user={podeAcessarApp ? usuario : null} />}
          />
          <Route path="/sobre-autor" element={<SobreAutor />} />
          <Route path="/apoie" element={<Apoie />} />

          <Route
            path="/login"
            element={
              !podeAcessarApp ? <Login /> : <Navigate to="/" replace />
            }
          />

          <Route
            path="/perfil"
            element={
              podeAcessarApp ? (
                <Perfil user={usuario} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route
            path="/admin"
            element={
              isAdmin ? (
                <Navigate to="/admin/manga" replace />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/manga"
            element={
              isAdmin ? (
                <AdminPanel user={usuario} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/avatares"
            element={
              isAdmin ? (
                <AvatarAdmin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              isAdmin ? (
                <DashboardAdmin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/financeiro"
            element={
              isAdmin ? (
                <FinanceiroAdmin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  );
}
