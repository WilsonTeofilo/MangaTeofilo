// src/App.jsx
import React, { useState, useEffect, lazy, Suspense } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import { buildLoginUrlWithRedirect, resolveSafeInternalRedirect } from './utils/loginRedirectPath';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';

import { auth, db } from './services/firebase';
import { isAdminUser } from './constants';
import { emptyAdminAccess, resolveAdminAccess } from './auth/adminAccess';
import {
  canAccessAdminPath,
  canAccessCreatorPath,
  getDefaultAdminRedirect,
  getDefaultCreatorRedirect,
} from './auth/adminPermissions';
import { syncAuthenticatedUserProfile } from './userProfileSyncV2';
import {
  buildCreatorOnboardingSteps,
  creatorOnboardingIsRequiredComplete,
  creatorOnboardingPrimaryNextPath,
} from './utils/creatorOnboardingProgress';

import Header from './components/Header.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';
import SeoManager from './seo/SeoManager.jsx';

const HomeAdaptive = lazy(() => import('./pages/Home/HomeAdaptive.jsx'));
const SobreAutor = lazy(() => import('./pages/Home/SobreAutorV2.jsx'));
const Apoie = lazy(() => import('./pages/Home/Apoie.jsx'));
const ApoieCreatorRedirect = lazy(() => import('./pages/Home/ApoieCreatorRedirect.jsx'));
const ListaMangas = lazy(() => import('./pages/Mangas/ListaMangas.jsx'));
const ObraDetalhe = lazy(() => import('./pages/Mangas/ObraDetalhe.jsx'));
const BibliotecaFavoritos = lazy(() => import('./pages/Mangas/BibliotecaFavoritos.jsx'));
const LojaCatalogo = lazy(() => import('./pages/Loja/LojaCatalogo.jsx'));
const LojaProduto = lazy(() => import('./pages/Loja/LojaProduto.jsx'));
const LojaCarrinho = lazy(() => import('./pages/Loja/LojaCarrinho.jsx'));
const LojaPedidos = lazy(() => import('./pages/Loja/LojaPedidos.jsx'));
const Login = lazy(() => import('./pages/Auth/Login.jsx'));
const Perfil = lazy(() => import('./pages/Perfil/Perfil.jsx'));
const Leitor = lazy(() => import('./pages/Leitor/Leitor.jsx'));
const CreatorPublicProfilePage = lazy(() => import('./pages/Criador/CreatorPublicProfilePage.jsx'));
const CreatorWorkspace = lazy(() => import('./pages/Criador/CreatorWorkspace.jsx'));
const CreatorProfilePage = lazy(() => import('./pages/Criador/CreatorProfilePage.jsx'));
const CreatorAudiencePage = lazy(() => import('./pages/Criador/CreatorAudiencePage.jsx'));
const CreatorMonetizationPage = lazy(() => import('./pages/Criador/CreatorMonetizationPage.jsx'));
const CreatorStorePage = lazy(() => import('./pages/Criador/CreatorStorePage.jsx'));
const CreatorWorksPage = lazy(() => import('./pages/Criador/CreatorWorksPage.jsx'));
const CreatorChaptersPage = lazy(() => import('./pages/Criador/CreatorChaptersPage.jsx'));
const CreatorChapterEditorPage = lazy(() => import('./pages/Criador/CreatorChapterEditorPage.jsx'));
const AdminPanel = lazy(() => import('./pages/Admin/AdminPanel.jsx'));
const CapitulosAdminHub = lazy(() => import('./pages/Admin/CapitulosAdminHub.jsx'));
const ObrasAdmin = lazy(() => import('./pages/Admin/ObrasAdmin.jsx'));
const AvatarAdmin = lazy(() => import('./pages/Admin/AvatarAdmin.jsx'));
const DashboardAdmin = lazy(() => import('./pages/Admin/DashboardAdmin.jsx'));
const FinanceiroAdmin = lazy(() => import('./pages/Admin/FinanceiroAdmin.jsx'));
const LojaAdmin = lazy(() => import('./pages/Admin/LojaAdmin.jsx'));
const AdminLojaPedidos = lazy(() => import('./pages/Admin/AdminLojaPedidos.jsx'));
const EquipeAdmin = lazy(() => import('./pages/Admin/EquipeAdmin.jsx'));
const SessoesAdmin = lazy(() => import('./pages/Admin/SessoesAdmin.jsx'));
const MangakaFinanceiroAdmin = lazy(() => import('./pages/Admin/MangakaFinanceiroAdmin.jsx'));
const CriadoresAdmin = lazy(() => import('./pages/Admin/CriadoresAdmin.jsx'));

function RedirectToLogin() {
  const loc = useLocation();
  return <Navigate to={buildLoginUrlWithRedirect(loc.pathname, loc.search)} replace />;
}

function LoginRoute({ podeAcessarApp }) {
  const [sp] = useSearchParams();
  if (podeAcessarApp) {
    return <Navigate to={resolveSafeInternalRedirect(sp.get('redirect'))} replace />;
  }
  return <Login />;
}

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
  const [creatorObrasVal, setCreatorObrasVal] = useState(null);
  const [creatorCapsVal, setCreatorCapsVal] = useState(null);
  const [creatorProdutosVal, setCreatorProdutosVal] = useState(null);

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
    if (!usuario?.uid || !adminAccess.isMangaka) {
      setCreatorObrasVal(null);
      setCreatorCapsVal(null);
      setCreatorProdutosVal(null);
      return () => {};
    }
    const unsubObras = onValue(ref(db, 'obras'), (snap) => {
      setCreatorObrasVal(snap.exists() ? snap.val() : {});
    });
    const unsubCaps = onValue(ref(db, 'capitulos'), (snap) => {
      setCreatorCapsVal(snap.exists() ? snap.val() : {});
    });
    const unsubProdutos = onValue(ref(db, 'loja/produtos'), (snap) => {
      setCreatorProdutosVal(snap.exists() ? snap.val() : {});
    });
    return () => {
      unsubObras();
      unsubCaps();
      unsubProdutos();
    };
  }, [usuario?.uid, adminAccess.isMangaka]);

  useEffect(() => {
    if (!usuario?.uid) return;
    syncAuthenticatedUserProfile(usuario).catch(() => {});
  }, [usuario]);

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
        setAdminAccess({ ...emptyAdminAccess(), byAllowlist: isAdminUser(usuario), canAccessAdmin: isAdminUser(usuario) });
      });
    return () => {
      ativo = false;
    };
  }, [usuario, perfilUsuario?.role, perfilUsuario?.creatorApplicationStatus]);

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
    return <Navigate to={buildLoginUrlWithRedirect(location.pathname, location.search)} replace />;
  }

  const isAdmin = adminAccess.canAccessAdmin;
  const canAccessAdminWorkspace = isAdmin && !adminAccess.isMangaka;
  const canAccessCreator = canAccessCreatorPath('/creator', adminAccess);
  const creatorOnboardingSteps = buildCreatorOnboardingSteps({
    uid: usuario?.uid,
    perfilDb: perfilUsuario || {},
    obrasVal: creatorObrasVal,
    capsVal: creatorCapsVal,
    produtosVal: creatorProdutosVal,
    storeSkipped: Boolean(perfilUsuario?.creatorOnboardingStoreSkipped),
  });
  const creatorOnboardingComplete =
    !adminAccess.isMangaka || creatorOnboardingIsRequiredComplete(creatorOnboardingSteps);
  const creatorOnboardingNextPath = creatorOnboardingPrimaryNextPath(creatorOnboardingSteps);
  const adminAccessReady = !usuario || adminAccess.profileLoaded || adminAccess.byAllowlist;
  const adminPathOk = (path) => canAccessAdminPath(path, adminAccess);
  const creatorPathOk = (path) => canAccessCreatorPath(path, adminAccess);
  const qs = new URLSearchParams(location.search || '');
  const trafficSource = String(qs.get('src') || '').toLowerCase();
  const cameFromPromoTracking =
    trafficSource === 'promo_email' ||
    trafficSource === 'promo_admin' ||
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
        <Suspense fallback={<div className="shito-app-splash" aria-hidden="true" />}>
        <Routes>
          <Route
            path="/"
            element={<HomeAdaptive user={podeAcessarApp ? usuario : null} />}
          />
          <Route
            path="/works"
            element={<ListaMangas user={podeAcessarApp ? usuario : null} />}
          />
          <Route
            path="/mangas"
            element={<ListaMangas user={podeAcessarApp ? usuario : null} />}
          />
          <Route
            path="/work/:slug"
            element={
              <ObraDetalhe
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
                adminAccess={adminAccess}
              />
            }
          />
          <Route
            path="/obra/:obraId"
            element={
              <ObraDetalhe
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
                adminAccess={adminAccess}
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
                <RedirectToLogin />
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
            element={<Navigate to="/works" replace />}
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
          <Route path="/apoie/criador/:creatorId" element={<ApoieCreatorRedirect />} />
          <Route
            path="/apoie"
            element={
              <Apoie
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
              />
            }
          />

          <Route path="/login" element={<LoginRoute podeAcessarApp={podeAcessarApp} />} />

          <Route
            path="/perfil"
            element={
              podeAcessarApp ? <Perfil user={usuario} adminAccess={adminAccess} /> : <RedirectToLogin />
            }
          />
          <Route
            path="/creator/perfil"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/perfil') ? (
                podeAcessarApp ? <CreatorProfilePage user={usuario} adminAccess={adminAccess} /> : <RedirectToLogin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/criador/:creatorId"
            element={<CreatorPublicProfilePage user={podeAcessarApp ? usuario : null} />}
          />

          <Route
            path="/admin"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : canAccessAdminWorkspace ? (
                <Navigate to={getDefaultAdminRedirect(adminAccess)} replace />
              ) : canAccessCreator ? (
                <Navigate
                  to={adminAccess.isMangaka && !creatorOnboardingComplete
                    ? creatorOnboardingNextPath
                    : getDefaultCreatorRedirect(adminAccess)}
                  replace
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : canAccessCreator ? (
                <Navigate
                  to={adminAccess.isMangaka && !creatorOnboardingComplete
                    ? creatorOnboardingNextPath
                    : getDefaultCreatorRedirect(adminAccess)}
                  replace
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/capitulos"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/capitulos') ? (
                <CapitulosAdminHub adminAccess={adminAccess} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/manga"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/manga') ? (
                <AdminPanel adminAccess={adminAccess} workspace="admin" />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/obras"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/obras') ? (
                <ObrasAdmin adminAccess={adminAccess} workspace="admin" />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/avatares"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/avatares') ? (
                <AvatarAdmin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/dashboard') ? (
                <DashboardAdmin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/financeiro"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/financeiro') ? (
                adminAccess?.isMangaka ? (
                  <MangakaFinanceiroAdmin user={usuario} workspace="admin" />
                ) : (
                  <FinanceiroAdmin />
                )
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/loja"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/loja') ? (
                <LojaAdmin user={usuario} adminAccess={adminAccess} workspace="admin" />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/pedidos"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/pedidos') ? (
                <AdminLojaPedidos user={usuario} adminAccess={adminAccess} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/sessoes"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/sessoes') ? (
                <SessoesAdmin adminAccess={adminAccess} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/equipe"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/equipe') ? (
                <EquipeAdmin adminAccess={adminAccess} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/criadores"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/criadores') ? (
                <CriadoresAdmin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator/dashboard"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/dashboard') ? (
                adminAccess?.isMangaka ? (
                  <CreatorWorkspace user={usuario} perfil={perfilUsuario} />
                ) : adminPathOk('/admin/dashboard') ? (
                  <DashboardAdmin />
                ) : (
                  <FinanceiroAdmin />
                )
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator/audience"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/audience') && adminAccess?.isMangaka ? (
                <CreatorAudiencePage user={usuario} perfil={perfilUsuario} />
              ) : (
                <Navigate to="/creator/dashboard" replace />
              )
            }
          />
          <Route
            path="/creator/obras"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/obras') ? (
                <CreatorWorksPage adminAccess={adminAccess} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator/capitulos"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/capitulos') ? (
                <CreatorChaptersPage adminAccess={adminAccess} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator/editor"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/editor') ? (
                <CreatorChapterEditorPage adminAccess={adminAccess} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator/avatares"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/avatares') ? (
                <Navigate to="/admin/avatares" replace />
              ) : (
                <Navigate to="/creator/perfil" replace />
              )
            }
          />
          <Route
            path="/creator/promocoes"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/promocoes') ? (
                adminAccess?.isMangaka ? (
                  <CreatorMonetizationPage user={usuario} />
                ) : (
                  <FinanceiroAdmin />
                )
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator/loja"
            element={
              !adminAccessReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/loja') ? (
                adminAccess?.isMangaka ? (
                  <CreatorStorePage user={usuario} adminAccess={adminAccess} />
                ) : adminPathOk('/admin/pedidos') ? (
                  <AdminLojaPedidos user={usuario} adminAccess={adminAccess} />
                ) : (
                  <LojaAdmin user={usuario} adminAccess={adminAccess} workspace="creator" />
                )
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
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
