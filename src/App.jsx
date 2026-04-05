// src/App.jsx
import React, { useState, useEffect, lazy, Suspense } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useSearchParams,
  useParams,
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
import { APP_ROLE, resolveAppRole, resolveCreatorRoleBootstrap } from './auth/appRoles';
import { syncAuthenticatedUserProfile } from './userProfileSyncV2';
import {
  buildCreatorOnboardingSteps,
  creatorOnboardingIsRequiredComplete,
  creatorOnboardingPrimaryNextPath,
} from './utils/creatorOnboardingProgress';
import { effectiveCreatorMonetizationStatus } from './utils/creatorMonetizationUi';
import { useCreatorScopedCatalog } from './hooks/useCreatorScopedCatalog';

import Header from './components/Header.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';
import SeoManager from './seo/SeoManager.jsx';
import './pages/Admin/AdminUiForms.css';

const MangaMain = lazy(() => import('./pages/Home/MangaMain.jsx'));
const SobreAutor = lazy(() => import('./pages/Home/SobreAutorV2.jsx'));
const KokuinLegacyPage = lazy(() => import('./pages/Home/KokuinLegacyPage.jsx'));
const Apoie = lazy(() => import('./pages/Home/Apoie.jsx'));
const ApoieCreatorRedirect = lazy(() => import('./pages/Home/ApoieCreatorRedirect.jsx'));
const ListaMangas = lazy(() => import('./pages/Mangas/ListaMangas.jsx'));
const ObraDetalhe = lazy(() => import('./pages/Mangas/ObraDetalhe.jsx'));
const BibliotecaFavoritos = lazy(() => import('./pages/Mangas/BibliotecaFavoritos.jsx'));
const LojaCatalogo = lazy(() => import('./pages/Loja/LojaCatalogo.jsx'));
const LojaProduto = lazy(() => import('./pages/Loja/LojaProduto.jsx'));
const LojaCarrinho = lazy(() => import('./pages/Loja/LojaCarrinho.jsx'));
const MeusPedidosHub = lazy(() => import('./pages/Loja/MeusPedidosHub.jsx'));
const StoreOrderDetailPage = lazy(() => import('./pages/Loja/StoreOrderDetailPage.jsx'));
const PodOrderDetailPage = lazy(() => import('./pages/Loja/PodOrderDetailPage.jsx'));
const PrintOnDemandPage = lazy(() => import('./pages/Loja/PrintOnDemandPage.jsx'));
const PrintOnDemandCheckoutPage = lazy(() => import('./pages/Loja/PrintOnDemandCheckoutPage.jsx'));
const Login = lazy(() => import('./pages/Auth/Login.jsx'));
const Perfil = lazy(() => import('./pages/Perfil/Perfil.jsx'));
const Leitor = lazy(() => import('./pages/Leitor/Leitor.jsx'));
const CreatorPublicProfilePage = lazy(() => import('./pages/Criador/CreatorPublicProfilePage.jsx'));
const CreatorMonetizationGrowthPage = lazy(() => import('./pages/Criador/CreatorMonetizationGrowthPage.jsx'));
const CreatorMissionsPage = lazy(() => import('./pages/Criador/CreatorMissionsPage.jsx'));
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
const LojaProductsListAdmin = lazy(() => import('./pages/Admin/LojaProductsListAdmin.jsx'));
const LojaProductEditorAdmin = lazy(() => import('./pages/Admin/LojaProductEditorAdmin.jsx'));
const StoreSettingsAdmin = lazy(() => import('./pages/Admin/StoreSettingsAdmin.jsx'));
const AdminPedidosHub = lazy(() => import('./pages/Admin/AdminPedidosHub.jsx'));
const EquipeAdmin = lazy(() => import('./pages/Admin/EquipeAdmin.jsx'));
const SessoesAdmin = lazy(() => import('./pages/Admin/SessoesAdmin.jsx'));
const CriadoresAdmin = lazy(() => import('./pages/Admin/CriadoresAdmin.jsx'));
const CreatorsApplyPage = lazy(() => import('./pages/Creators/CreatorsApplyPage.jsx'));
const CreatorOnboardingPage = lazy(() => import('./pages/Creators/CreatorOnboardingPage.jsx'));
const UsernamePublicRoute = lazy(() => import('./pages/Public/UsernamePublicRoute.jsx'));

function RedirectToLogin() {
  const loc = useLocation();
  return <Navigate to={buildLoginUrlWithRedirect(loc.pathname, loc.search)} replace />;
}

function resolveShellRedirectTarget(raw, { usuario, adminAccess }) {
  const target =
    raw != null && String(raw).trim() !== ''
      ? resolveSafeInternalRedirect(raw)
      : '/';
  const isCreatorFlow =
    target === '/creators' ||
    target.startsWith('/creator') ||
    target.startsWith('/print-on-demand?ctx=creator') ||
    target.includes('ctx=creator');
  if ((adminAccess?.canAccessAdmin || isAdminUser(usuario)) && isCreatorFlow) {
    if (adminAccess?.canAccessAdmin && canAccessAdminPath('/admin/criadores', adminAccess)) {
      return '/admin/criadores';
    }
    return '/admin';
  }
  return target;
}

function LoginRoute({ podeAcessarApp, usuario, adminAccess }) {
  const [sp] = useSearchParams();
  if (podeAcessarApp) {
    const raw = sp.get('redirect');
    const target = resolveShellRedirectTarget(raw, { usuario, adminAccess });
    return <Navigate to={target} replace />;
  }
  return <Login />;
}

/** URL canónica pública do POD; `/creator/print` redireciona para `?ctx=creator`. */
function LegacyPrintOnDemandRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/print-on-demand${search}`} replace />;
}

function LegacyReaderPublicRedirect() {
  const { readerUid } = useParams();
  const uid = String(readerUid || '').trim();
  if (!uid) return <Navigate to="/works" replace />;
  return <Navigate to={`/criador/${encodeURIComponent(uid)}?tab=likes`} replace />;
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
  const [perfilLoadedUid, setPerfilLoadedUid] = useState('');
  const [adminAccess, setAdminAccess] = useState(emptyAdminAccess());

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      if (!user) {
        setPerfilUsuario(null);
        setPerfilLoadedUid('');
        setAdminAccess(emptyAdminAccess());
      }
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
      return () => {};
    }
    const r = ref(db, `usuarios/${usuario.uid}`);
    const unsub = onValue(r, (snap) => {
      setPerfilUsuario(snap.exists() ? snap.val() : null);
      setPerfilLoadedUid(usuario.uid);
    });
    return () => unsub();
  }, [usuario?.uid]);

  const staffBypassMangaka = adminAccess.canAccessAdmin === true;
  const roleMk =
    !staffBypassMangaka && String(perfilUsuario?.role || '').trim().toLowerCase() === 'mangaka';
  const creatorCatalogUid =
    usuario?.uid && (adminAccess.isMangaka === true || roleMk === true) ? usuario.uid : null;
  const { obrasVal: creatorObrasVal, capsVal: creatorCapsVal, produtosVal: creatorProdutosVal } =
    useCreatorScopedCatalog(db, creatorCatalogUid);

  useEffect(() => {
    if (!usuario?.uid) return;
    syncAuthenticatedUserProfile(usuario).catch(() => {});
  }, [usuario]);

  useEffect(() => {
    let ativo = true;
    if (!usuario) {
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

  const perfilCarregando = Boolean(usuario?.uid) && perfilLoadedUid !== usuario.uid;
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
  const creatorRoleFromResolvedBootstrap =
    Boolean(usuario?.uid) &&
    perfilLoadedUid === usuario.uid &&
    resolveCreatorRoleBootstrap(perfilUsuario, adminAccess);
  const roleBootstrapIsCreator = creatorRoleFromResolvedBootstrap;
  const resolvedAppRole = resolveAppRole(perfilUsuario, adminAccess, roleBootstrapIsCreator);
  const isMangakaEffective = resolvedAppRole === APP_ROLE.CREATOR;
  const accessForCreatorRouting =
    resolvedAppRole === APP_ROLE.CREATOR
      ? { ...adminAccess, isMangaka: true, canAccessAdmin: false, panelRole: 'mangaka' }
      : { ...adminAccess, isMangaka: false };
  const routeShellReady =
    !usuario || adminAccess.profileLoaded || adminAccess.byAllowlist || creatorRoleFromResolvedBootstrap;
  const canAccessAdminWorkspace = isAdmin && resolvedAppRole === APP_ROLE.ADMIN;
  const canAccessCreator = canAccessCreatorPath('/creator', accessForCreatorRouting);
  const creatorOnboardingSteps = buildCreatorOnboardingSteps({
    uid: usuario?.uid,
    perfilDb: perfilUsuario || {},
    obrasVal: creatorObrasVal,
    capsVal: creatorCapsVal,
    produtosVal: creatorProdutosVal,
    storeSkipped: Boolean(perfilUsuario?.creatorOnboardingStoreSkipped),
  });
  const creatorOnboardingComplete =
    !isMangakaEffective || creatorOnboardingIsRequiredComplete(creatorOnboardingSteps);
  const creatorOnboardingNextPath = creatorOnboardingPrimaryNextPath(creatorOnboardingSteps);
  const creatorMonetizationIsActive =
    effectiveCreatorMonetizationStatus(
      perfilUsuario?.creatorMonetizationPreference,
      perfilUsuario?.creatorMonetizationStatus
    ) === 'active';
  const adminPathOk = (path) => canAccessAdminPath(path, adminAccess);
  const creatorPathOk = (path) => canAccessCreatorPath(path, accessForCreatorRouting);
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
            element={<MangaMain user={podeAcessarApp ? usuario : null} />}
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
            path="/pedidos"
            element={
                <MeusPedidosHub
                  user={podeAcessarApp ? usuario : null}
                  showCreatorSalesTab={podeAcessarApp && isMangakaEffective}
                />
            }
          />
          <Route
            path="/loja/pedidos"
            element={
                <MeusPedidosHub
                  user={podeAcessarApp ? usuario : null}
                  showCreatorSalesTab={podeAcessarApp && isMangakaEffective}
                />
            }
          />
          <Route
            path="/pedidos/loja/:orderId"
            element={
              podeAcessarApp ? <StoreOrderDetailPage user={usuario} /> : <RedirectToLogin />
            }
          />
          <Route
            path="/pedidos/fisico/:orderId"
            element={podeAcessarApp ? <PodOrderDetailPage user={usuario} /> : <RedirectToLogin />}
          />
          <Route path="/store/print-on-demand" element={<LegacyPrintOnDemandRedirect />} />
          <Route
            path="/print-on-demand"
            element={
              <PrintOnDemandPage
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
                adminAccess={adminAccess}
                obrasVal={creatorObrasVal}
                capsVal={creatorCapsVal}
              />
            }
          />
          <Route path="/print-on-demand/carrinho" element={<Navigate to="/loja/carrinho" replace />} />
          <Route
            path="/print-on-demand/checkout"
            element={<PrintOnDemandCheckoutPage user={podeAcessarApp ? usuario : null} />}
          />
          <Route path="/creator/print" element={<Navigate to="/print-on-demand?ctx=creator" replace />} />
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
          <Route path="/kokuin" element={<KokuinLegacyPage />} />
          <Route
            path="/creators"
            element={
              usuario && !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : (
                <CreatorsApplyPage user={podeAcessarApp ? usuario : null} adminAccess={adminAccess} />
              )
            }
          />
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

          <Route
            path="/login"
            element={<LoginRoute podeAcessarApp={podeAcessarApp} usuario={usuario} adminAccess={adminAccess} />}
          />

          <Route
            path="/perfil"
            element={
              podeAcessarApp ? (
                <Perfil
                  user={usuario}
                  adminAccess={adminAccess}
                  suppressCreatorProfileUi={canAccessAdminWorkspace}
                />
              ) : (
                <RedirectToLogin />
              )
            }
          />
          <Route
            path="/creator/onboarding"
            element={
              usuario && !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : canAccessAdminWorkspace ? (
                <Navigate to={getDefaultAdminRedirect(adminAccess)} replace />
              ) : podeAcessarApp ? (
                creatorPathOk('/creator/onboarding') ? (
                  <CreatorOnboardingPage user={usuario} perfil={perfilUsuario} adminAccess={adminAccess} />
                ) : (
                  <Navigate to="/" replace />
                )
              ) : (
                <RedirectToLogin />
              )
            }
          />
          <Route
            path="/criador/:creatorId"
            element={<CreatorPublicProfilePage user={podeAcessarApp ? usuario : null} />}
          />
          <Route path="/@:userHandle" element={<UsernamePublicRoute />} />
          <Route path="/leitor/:readerUid" element={<LegacyReaderPublicRedirect />} />

          <Route
            path="/admin"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : canAccessAdminWorkspace ? (
                <Navigate to={getDefaultAdminRedirect(adminAccess)} replace />
              ) : canAccessCreator ? (
                <Navigate
                  to={isMangakaEffective && !creatorOnboardingComplete
                    ? creatorOnboardingNextPath
                    : getDefaultCreatorRedirect(accessForCreatorRouting)}
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
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : canAccessCreator ? (
                <Navigate
                  to={isMangakaEffective && !creatorOnboardingComplete
                    ? creatorOnboardingNextPath
                    : getDefaultCreatorRedirect(accessForCreatorRouting)}
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
              !routeShellReady ? (
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
              !routeShellReady ? (
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
              !routeShellReady ? (
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
              !routeShellReady ? (
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
              !routeShellReady ? (
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
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/financeiro') ? (
                <FinanceiroAdmin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/admin/loja" element={<Navigate to="/admin/products" replace />} />
          <Route
            path="/admin/store/settings"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/store/settings') ? (
                <StoreSettingsAdmin />
              ) : (
                <Navigate to={isMangakaEffective ? '/admin/products' : '/'} replace />
              )
            }
          />
          <Route
            path="/admin/products/create"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/products') ? (
                <LojaProductEditorAdmin user={usuario} adminAccess={adminAccess} workspace="admin" />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/products/:productId/edit"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/products') ? (
                <LojaProductEditorAdmin user={usuario} adminAccess={adminAccess} workspace="admin" />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/products"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/products') ? (
                <LojaProductsListAdmin user={usuario} adminAccess={adminAccess} workspace="admin" />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/pedidos"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/pedidos') ? (
                <AdminPedidosHub user={usuario} adminAccess={adminAccess} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/admin/orders" element={<Navigate to="/admin/pedidos?tab=producao" replace />} />
          <Route path="/admin/producao-fisica" element={<Navigate to="/admin/pedidos?tab=producao" replace />} />
          <Route
            path="/admin/sessoes"
            element={
              !routeShellReady ? (
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
              !routeShellReady ? (
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
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/criadores') ? (
                <CriadoresAdmin />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator/monetizacao"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/monetizacao') && isMangakaEffective ? (
                <CreatorMonetizationGrowthPage user={usuario} perfil={perfilUsuario} />
              ) : (
                <Navigate to="/perfil" replace />
              )
            }
          />
          <Route
            path="/creator/missoes"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/missoes') && isMangakaEffective ? (
                <CreatorMissionsPage user={usuario} perfil={perfilUsuario} />
              ) : (
                <Navigate to="/perfil" replace />
              )
            }
          />
          <Route
            path="/creator/dashboard"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/dashboard') ? (
                <Navigate to={getDefaultCreatorRedirect(accessForCreatorRouting)} replace />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator/audience"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/audience') && isMangakaEffective ? (
                <CreatorAudiencePage user={usuario} perfil={perfilUsuario} />
              ) : (
                <Navigate to="/perfil" replace />
              )
            }
          />
          <Route
            path="/creator/obras"
            element={
              !routeShellReady ? (
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
              !routeShellReady ? (
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
              !routeShellReady ? (
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
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator') ? (
                <Navigate to={getDefaultCreatorRedirect(accessForCreatorRouting)} replace />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator/promocoes"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/promocoes') ? (
                creatorMonetizationIsActive ? (
                  <CreatorMonetizationPage user={usuario} />
                ) : (
                  <Navigate to="/perfil" replace />
                )
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/creator/loja/produtos/criar"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/loja') && isMangakaEffective && creatorMonetizationIsActive ? (
                <LojaProductEditorAdmin user={usuario} adminAccess={adminAccess} workspace="creator" />
              ) : (
                <Navigate to="/perfil" replace />
              )
            }
          />
          <Route
            path="/creator/loja/produtos/:productId/editar"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/loja') && isMangakaEffective && creatorMonetizationIsActive ? (
                <LojaProductEditorAdmin user={usuario} adminAccess={adminAccess} workspace="creator" />
              ) : (
                <Navigate to="/perfil" replace />
              )
            }
          />
          <Route
            path="/creator/loja/produtos"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/loja') && isMangakaEffective && creatorMonetizationIsActive ? (
                <LojaProductsListAdmin user={usuario} adminAccess={adminAccess} workspace="creator" />
              ) : (
                <Navigate to="/perfil" replace />
              )
            }
          />
          <Route
            path="/creator/loja"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : creatorPathOk('/creator/loja') ? (
                creatorMonetizationIsActive ? (
                  <CreatorStorePage user={usuario} />
                ) : (
                  <Navigate to="/perfil" replace />
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
