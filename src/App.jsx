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
import { emptyAdminAccess, resolveAdminAccess } from './auth/adminAccess';
import { cleanupDeprecatedUsuarioFields } from './userProfileSync';

import Header from './components/Header.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';
import SeoManager from './seo/SeoManager.jsx';

import HomeAdaptive from './pages/Home/HomeAdaptive.jsx';
import SobreAutor from './pages/Home/SobreAutor.jsx';
import Apoie from './pages/Home/Apoie.jsx';
import ListaMangas from './pages/Mangas/ListaMangas.jsx';
import ObraDetalhe from './pages/Mangas/ObraDetalhe.jsx';
import BibliotecaFavoritos from './pages/Mangas/BibliotecaFavoritos.jsx';
import LojaCatalogo from './pages/Loja/LojaCatalogo.jsx';
import LojaProduto from './pages/Loja/LojaProduto.jsx';
import LojaCarrinho from './pages/Loja/LojaCarrinho.jsx';
import LojaPedidos from './pages/Loja/LojaPedidos.jsx';
import Login from './pages/Auth/Login.jsx';
import Perfil from './pages/Perfil/Perfil.jsx';
import Leitor from './pages/Leitor/Leitor.jsx';
import AdminPanel from './pages/Admin/AdminPanel.jsx';
import CapitulosAdminHub from './pages/Admin/CapitulosAdminHub.jsx';
import ObrasAdmin from './pages/Admin/ObrasAdmin.jsx';
import AvatarAdmin from './pages/Admin/AvatarAdmin.jsx';
import DashboardAdmin from './pages/Admin/DashboardAdmin.jsx';
import FinanceiroAdmin from './pages/Admin/FinanceiroAdmin.jsx';
import LojaAdmin from './pages/Admin/LojaAdmin.jsx';

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
  const [adminAccess, setAdminAccess] = useState(emptyAdminAccess());

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
      setAdminAccess(emptyAdminAccess());
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

  useEffect(() => {
    if (!usuario?.uid) return;
    cleanupDeprecatedUsuarioFields(usuario.uid).catch(() => {});
  }, [usuario?.uid]);

  useEffect(() => {
    let ativo = true;
    if (!usuario) {
      setAdminAccess(emptyAdminAccess());
      return () => {};
    }
    resolveAdminAccess(usuario)
      .then((result) => {
        if (!ativo) return;
        setAdminAccess(result);
      })
      .catch(() => {
        if (!ativo) return;
        setAdminAccess({
          byClaim: false,
          byAllowlist: isAdminUser(usuario),
          canAccessAdmin: isAdminUser(usuario),
          claimChecked: false,
        });
      });
    return () => {
      ativo = false;
    };
  }, [usuario]);

  if (carregando) {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  if (usuario && perfilCarregando) {
    return <div className="shito-app-splash" aria-hidden="true" />;
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

  const isAdmin = adminAccess.canAccessAdmin;
  const qs = new URLSearchParams(location.search || '');
  const trafficSource = String(qs.get('src') || '').toLowerCase();
  const cameFromPromoTracking =
    trafficSource === 'promo_email' ||
    trafficSource === 'chapter_email';

  // Segurança UX: se o tracking abrir na home, empurra para /apoie mantendo query.
  if (location.pathname === '/' && cameFromPromoTracking) {
    return <Navigate to={`/apoie${location.search || ''}`} replace />;
  }

  return (
    <>
      <SeoManager />
      <ScrollToTop />
      <Header
        usuario={podeAcessarApp ? usuario : null}
        perfil={podeAcessarApp ? perfilUsuario : null}
        adminAccess={adminAccess}
      />

      <main className="shito-main-content">
        <Routes>
          <Route
            path="/"
            element={<HomeAdaptive user={podeAcessarApp ? usuario : null} />}
          />
          <Route
            path="/mangas"
            element={<ListaMangas user={podeAcessarApp ? usuario : null} />}
          />
          <Route
            path="/obra/:obraId"
            element={
              <ObraDetalhe
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
              />
            }
          />
          <Route
            path="/biblioteca"
            element={
              podeAcessarApp ? (
                <BibliotecaFavoritos
                  user={usuario}
                  perfil={perfilUsuario}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/loja"
            element={
              <LojaCatalogo
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
              />
            }
          />
          <Route
            path="/loja/produto/:productId"
            element={
              <LojaProduto
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
              />
            }
          />
          <Route
            path="/loja/carrinho"
            element={
              <LojaCarrinho
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
              />
            }
          />
          <Route
            path="/loja/pedidos"
            element={
              <LojaPedidos
                user={podeAcessarApp ? usuario : null}
              />
            }
          />
          <Route
            path="/capitulos"
            element={<Navigate to="/mangas" replace />}
          />
          <Route
            path="/ler/:id"
            element={
              <Leitor
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
              />
            }
          />
          <Route path="/sobre-autor" element={<SobreAutor />} />
          <Route
            path="/apoie"
            element={
              <Apoie
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
              />
            }
          />

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
                <Navigate to="/admin/capitulos" replace />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/capitulos"
            element={
              isAdmin ? (
                <CapitulosAdminHub />
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
            path="/admin/obras"
            element={
              isAdmin ? (
                <ObrasAdmin />
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
          <Route
            path="/admin/loja"
            element={
              isAdmin ? (
                <LojaAdmin />
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
