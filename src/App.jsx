// src/App.jsx
import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
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

const PENDING_METHOD_KEY = 'login_pending_method';

function computePodeAcessarApp(usuario, perfilUsuario) {
  if (!usuario) return false;
  if (isAdminUser(usuario)) return true;
  const passwordProvider = usuario.providerData?.some((p) => p.providerId === 'password');
  if (passwordProvider && !usuario.emailVerified) return false;
  if (!perfilUsuario) return false;
  if (perfilUsuario.status === 'banido') return false;
  if (perfilUsuario.status !== 'ativo') return false;
  return true;
}

function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);

  const [temPending, setTemPending] = useState(
    () => Boolean(sessionStorage.getItem(PENDING_METHOD_KEY))
  );

  const [perfilUsuario, setPerfilUsuario] = useState(null);
  const [perfilCarregando, setPerfilCarregando] = useState(false);

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    let mode = search.get('mode');
    let oobCode = search.get('oobCode');
    if (!oobCode && location.hash) {
      const h = location.hash;
      const q = h.indexOf('?');
      const raw = q >= 0 ? h.slice(q + 1) : h.replace(/^#/, '');
      const hp = new URLSearchParams(raw);
      mode = mode || hp.get('mode');
      oobCode = oobCode || hp.get('oobCode');
    }
    if (!oobCode || mode !== 'verifyEmail' || location.pathname === '/login') return;
    navigate(
      `/login?mode=${encodeURIComponent(mode)}&oobCode=${encodeURIComponent(oobCode)}`,
      { replace: true }
    );
  }, [location.pathname, location.search, location.hash, navigate]);

  useEffect(() => {
    const handler = () => {
      setTemPending(Boolean(sessionStorage.getItem(PENDING_METHOD_KEY)));
    };
    window.addEventListener('pendingVerificationChanged', handler);
    return () => window.removeEventListener('pendingVerificationChanged', handler);
  }, []);

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
    if (!usuario?.uid || temPending) {
      setPerfilUsuario(null);
      setPerfilCarregando(false);
      return undefined;
    }
    setPerfilCarregando(true);
    const r = ref(db, `usuarios/${usuario.uid}`);
    const unsub = onValue(r, (snap) => {
      setPerfilUsuario(snap.exists() ? snap.val() : null);
      setPerfilCarregando(false);
    });
    return () => unsub();
  }, [usuario?.uid, temPending]);

  if (carregando) {
    return <div style={{ background: '#050505', height: '100vh' }} />;
  }

  if (usuario && !temPending && perfilCarregando) {
    return <div style={{ background: '#050505', height: '100vh' }} />;
  }

  const podeAcessarApp =
    Boolean(usuario) &&
    !temPending &&
    computePodeAcessarApp(usuario, perfilUsuario);

  const sessaoInvalida =
    Boolean(usuario) &&
    !temPending &&
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
              isAdmin && !temPending ? (
                <Navigate to="/admin/manga" replace />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/manga"
            element={
              isAdmin && !temPending ? (
                <AdminPanel user={usuario} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/avatares"
            element={
              isAdmin && !temPending ? (
                <AvatarAdmin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              isAdmin && !temPending ? (
                <DashboardAdmin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/financeiro"
            element={
              isAdmin && !temPending ? (
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
