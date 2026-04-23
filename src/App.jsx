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
import { emptyAdminAccess, resolveAdminAccess } from './auth/adminAccess';
import {
  canAccessAdminPath,
  canAccessCreatorPath,
  getDefaultAdminRedirect,
  getDefaultCreatorRedirect,
  hasAnyAdminWorkspaceAccess,
} from './auth/adminPermissions';
import { APP_ROLE, resolveAppRoleContext } from './auth/appRoles';
import { syncAuthenticatedUserProfile } from './userProfileSyncV2';
import { parseBirthDateLocal } from './utils/birthDateAge';
import {
  buildCreatorOnboardingSteps,
  creatorOnboardingIsRequiredComplete,
  creatorOnboardingPrimaryNextPath,
} from './utils/creatorOnboardingProgress';
import { resolveEffectiveCreatorMonetizationStatusFromDb } from './utils/creatorMonetizationUi';
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
const CapitulosAdminHub = lazy(() => import('./pages/Admin/CapitulosAdminHub.jsx'));
const AdminPanel = lazy(() => import('./pages/Admin/AdminPanel.jsx'));
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
const UsuariosAdmin = lazy(() => import('./pages/Admin/UsuariosAdmin.jsx'));
const CreatorsApplyPage = lazy(() => import('./pages/Creators/CreatorsApplyPage.jsx'));
const CreatorOnboardingPage = lazy(() => import('./pages/Creators/CreatorOnboardingPage.jsx'));
const UsernamePublicRoute = lazy(() => import('./pages/Public/UsernamePublicRoute.jsx'));

function RedirectToLogin() {
  const loc = useLocation();
  return <Navigate to={buildLoginUrlWithRedirect(loc.pathname, loc.search)} replace />;
}

function resolveShellRedirectTarget(raw, { adminAccess }) {
  const target =
    raw != null && String(raw).trim() !== ''
      ? resolveSafeInternalRedirect(raw)
      : '/';
  const isCreatorFlow =
    target === '/creators' ||
    target.startsWith('/creator') ||
    target.startsWith('/print-on-demand?ctx=creator') ||
    target.includes('ctx=creator');
  if (hasAnyAdminWorkspaceAccess(adminAccess) && isCreatorFlow) {
    if (canAccessAdminPath('/admin/criadores', adminAccess)) {
      return '/admin/criadores';
    }
    return getDefaultAdminRedirect(adminAccess);
  }
  return target;
}

function LoginRoute({ podeAcessarApp, adminAccess }) {
  const [sp] = useSearchParams();
  if (podeAcessarApp) {
    const raw = sp.get('redirect');
    const target = resolveShellRedirectTarget(raw, { adminAccess });
    return <Navigate to={target} replace />;
  }
  return <Login />;
}

/** URL canónica pública do POD; `/creator/print` redireciona para `?ctx=creator`. */
function computePodeAcessarApp(usuario, perfilUsuario, adminAccess) {
  if (!usuario) return false;
  if (adminAccess?.canAccessAdmin) return true;
  if (!perfilUsuario) return false;
  if (perfilUsuario.status !== 'ativo' && perfilUsuario.status !== 'banido') return false;
  return true;
}

function resolveBanInfo(perfilUsuario) {
  const moderation = perfilUsuario?.moderation || {};
  const isBanned = moderation?.isBanned === true || perfilUsuario?.status === 'banido';
  const expiresAt = Number(moderation?.currentBanExpiresAt || 0) || 0;
  const now = Date.now();
  const active = Boolean(isBanned && (!expiresAt || expiresAt > now));
  const totalBanCount = Number(moderation?.totalBanCount || 0) || 0;
  return {
    active,
    reason: String(moderation?.lastBanReason || perfilUsuario?.banReason || '').trim(),
    expiresAt: expiresAt || null,
    totalBanCount,
    bansRemaining: Math.max(0, 4 - totalBanCount),
  };
}

function formatBanRemaining(expiresAt) {
  const end = Number(expiresAt || 0);
  if (!end) return 'sem prazo definido';
  const diff = Math.max(0, end - Date.now());
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${Math.max(1, minutes)}min`;
}

function BanBlockedRoute({ banInfo, onGoProfile, onGoHome }) {
  return (
    <div style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: '32px 16px' }}>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: 'min(560px, 100%)',
          background: '#10141f',
          border: '1px solid rgba(255,215,0,0.18)',
          borderRadius: '20px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
          padding: '24px',
          color: '#f5f7fb',
        }}
      >
        <p style={{ color: '#f1c232', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
          Conta temporariamente suspensa
        </p>
        <h2 style={{ margin: '10px 0 12px', fontSize: '1.8rem' }}>Você não pode acessar esta obra agora</h2>
        <p style={{ margin: '0 0 12px', color: '#d7deea', lineHeight: 1.6 }}>
          Sua conta está com ban ativo. Durante esse período, leitura, comentários e publicação ficam bloqueados.
        </p>
        <p style={{ margin: '0 0 8px', color: '#f5f7fb' }}>
          <strong>Motivo:</strong> {banInfo.reason || 'Não informado pela equipe.'}
        </p>
        <p style={{ margin: '0 0 8px', color: '#f5f7fb' }}>
          <strong>Tempo restante:</strong>{' '}
          {banInfo.expiresAt
            ? `${formatBanRemaining(banInfo.expiresAt)} (até ${new Date(banInfo.expiresAt).toLocaleString('pt-BR')})`
            : 'sem prazo definido'}
        </p>
        <p style={{ margin: '0 0 20px', color: '#f5f7fb' }}>
          <strong>Bans acumulados:</strong> {banInfo.totalBanCount} de 4.{' '}
          {banInfo.bansRemaining > 0
            ? `Faltam ${banInfo.bansRemaining} para exclusão permanente da conta.`
            : 'O próximo passo é exclusão permanente.'}
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onGoProfile}
            style={{
              border: 0,
              borderRadius: '999px',
              padding: '12px 18px',
              background: '#f1c232',
              color: '#0f1218',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Ir para minha conta
          </button>
          <button
            type="button"
            onClick={onGoHome}
            style={{
              borderRadius: '999px',
              padding: '12px 18px',
              background: 'transparent',
              color: '#f5f7fb',
              border: '1px solid rgba(255,255,255,0.22)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Voltar ao início
          </button>
        </div>
      </div>
    </div>
  );
}


function AppRoutes() {
  const location = useLocation();
  const isKokuinImmersiveRoute = location.pathname === '/kokuin';
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);

  const [perfilUsuario, setPerfilUsuario] = useState(null);
  const [perfilLoadedUid, setPerfilLoadedUid] = useState('');
  const [perfilLoadTimedOut, setPerfilLoadTimedOut] = useState(false);
  const [adminAccess, setAdminAccess] = useState(emptyAdminAccess());

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUsuario(user);
      if (!user) {
        setPerfilUsuario(null);
        setPerfilLoadedUid('');
        setPerfilLoadTimedOut(false);
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
    setPerfilLoadTimedOut(false);
    if (!usuario?.uid) {
      return () => {};
    }
    const timeoutId = window.setTimeout(() => {
      setPerfilLoadTimedOut(true);
      setPerfilLoadedUid(usuario.uid);
    }, 5000);
    const r = ref(db, `usuarios/${usuario.uid}`);
    const unsub = onValue(r, (snap) => {
      setPerfilUsuario(snap.exists() ? snap.val() : null);
      setPerfilLoadedUid(usuario.uid);
      setPerfilLoadTimedOut(false);
    });
    return () => {
      window.clearTimeout(timeoutId);
      unsub();
    };
  }, [usuario]);

  const perfilBelongsToCurrentUser = Boolean(usuario?.uid) && perfilLoadedUid === usuario.uid;
  const roleContext = resolveAppRoleContext(perfilUsuario, adminAccess, {
    profileLoaded: perfilBelongsToCurrentUser,
  });
  const banInfo = resolveBanInfo(perfilUsuario);
  const creatorCatalogUid = usuario?.uid && roleContext.isCreator ? usuario.uid : null;
  const { obrasVal: creatorObrasVal, capsVal: creatorCapsVal, produtosVal: creatorProdutosVal } =
    useCreatorScopedCatalog(db, creatorCatalogUid);

  useEffect(() => {
    if (!usuario?.uid) return;
    syncAuthenticatedUserProfile(usuario).catch(() => {});
  }, [usuario]);

  useEffect(() => {
    let ativo = true;
    let timeoutId = 0;
    if (!usuario) {
      return () => {};
    }
    timeoutId = window.setTimeout(() => {
      if (!ativo) return;
      setAdminAccess((current) =>
        current.profileLoaded ? current : { ...emptyAdminAccess(), profileLoaded: true }
      );
    }, 5000);
    resolveAdminAccess(usuario)
      .then((result) => {
        if (!ativo) return;
        window.clearTimeout(timeoutId);
        setAdminAccess(result);
      })
      .catch(() => {
        if (!ativo) return;
        window.clearTimeout(timeoutId);
        setAdminAccess(emptyAdminAccess());
      });
    return () => {
      ativo = false;
      window.clearTimeout(timeoutId);
    };
  }, [usuario]);

  useEffect(() => {
    if (!usuario?.uid) return () => {};

    let cancelled = false;
    let inFlight = false;
    let lastRefreshAt = Date.now();

    async function refreshAdminAccess(force = false) {
      if (cancelled || inFlight || !auth.currentUser?.uid) return;
      inFlight = true;
      try {
        const result = await resolveAdminAccess(auth.currentUser, { force });
        if (!cancelled) {
          setAdminAccess(result);
          lastRefreshAt = Date.now();
        }
      } catch {
        if (!cancelled) {
          setAdminAccess(emptyAdminAccess());
          lastRefreshAt = Date.now();
        }
      } finally {
        inFlight = false;
      }
    }

    const refreshIfStale = () => {
      if (Date.now() - lastRefreshAt >= 45 * 1000) {
        refreshAdminAccess(true);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshIfStale();
    };

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshAdminAccess(true);
      }
    }, 60 * 1000);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refreshIfStale);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [usuario?.uid]);

  if (carregando && !isKokuinImmersiveRoute) {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  const perfilCarregando =
    Boolean(usuario?.uid) &&
    perfilLoadedUid !== usuario.uid &&
    perfilLoadTimedOut !== true;
  if (usuario && perfilCarregando && !isKokuinImmersiveRoute) {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  const podeAcessarApp =
    Boolean(usuario) &&
    computePodeAcessarApp(usuario, perfilUsuario, adminAccess);

  const sessaoInvalida =
    Boolean(usuario) &&
    !perfilCarregando &&
    !podeAcessarApp;

  if (sessaoInvalida && location.pathname !== '/login' && !isKokuinImmersiveRoute) {
    return <Navigate to={buildLoginUrlWithRedirect(location.pathname, location.search)} replace />;
  }

  const resolvedAppRole = roleContext.appRole;
  const isMangakaEffective = roleContext.isCreator;
  const accessForCreatorRouting = roleContext.accessForCreatorRouting;
  const routeShellReady = !usuario || adminAccess.profileLoaded || roleContext.creatorBootstrap;
  const canAccessAdminWorkspace =
    hasAnyAdminWorkspaceAccess(adminAccess) && resolvedAppRole === APP_ROLE.ADMIN;
  const canAccessCreator = canAccessCreatorPath('/creator', accessForCreatorRouting);
  const hasBirthDateOnProfile = Boolean(parseBirthDateLocal(String(perfilUsuario?.birthDate || '').trim()));
  const requiresBirthDateCompletion =
    Boolean(podeAcessarApp) &&
    resolvedAppRole !== APP_ROLE.ADMIN &&
    !hasBirthDateOnProfile;
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
    resolveEffectiveCreatorMonetizationStatusFromDb(perfilUsuario) === 'active';
  const adminPathOk = (path) => canAccessAdminPath(path, adminAccess);
  const creatorPathOk = (path) => canAccessCreatorPath(path, accessForCreatorRouting);
  const qs = new URLSearchParams(location.search || '');
  const trafficSource = String(qs.get('src') || '').toLowerCase();
  const cameFromPromoTracking =
    trafficSource === 'promo_email' ||
    trafficSource === 'promo_admin' ||
    trafficSource === 'chapter_email';
  const hideGlobalChrome = isKokuinImmersiveRoute;
  const birthDateGuardBypass =
    location.pathname === '/login' ||
    location.pathname === '/perfil' ||
    location.pathname.startsWith('/creator/onboarding');
  const bannedAccountOnly =
    Boolean(podeAcessarApp) &&
    banInfo.active === true &&
    resolvedAppRole !== APP_ROLE.ADMIN;
  const banPathAllowed =
    location.pathname === '/login' ||
    location.pathname === '/perfil';
  const banPathUsesModal =
    location.pathname.startsWith('/work/') ||
    location.pathname.startsWith('/ler/');

  // Segurança UX: se o tracking abrir na home, empurra para /apoie mantendo query.
  if (location.pathname === '/' && cameFromPromoTracking) {
    return <Navigate to={`/apoie${location.search || ''}`} replace />;
  }
  if (bannedAccountOnly && !banPathAllowed && !banPathUsesModal) {
    return <Navigate to="/perfil?ban=1" replace />;
  }
  if (requiresBirthDateCompletion && !birthDateGuardBypass) {
    return <Navigate to="/perfil?required=birthDate" replace />;
  }

  return (
    <>
      <SeoManager />
      <ScrollToTop />
      {hideGlobalChrome ? null : (
        <Header
          usuario={podeAcessarApp ? usuario : null}
          perfil={podeAcessarApp ? perfilUsuario : null}
          adminAccess={adminAccess}
          creatorAccess={accessForCreatorRouting}
          shellRole={resolvedAppRole}
          canSeeAdminWorkspace={canAccessAdminWorkspace}
          canSeeCreatorWorkspace={canAccessCreator}
          isMangakaEffective={isMangakaEffective}
        />
      )}

      <main className="shito-main-content">
        <Suspense fallback={hideGlobalChrome ? null : <div className="shito-app-splash" aria-hidden="true" />}>
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
              bannedAccountOnly ? (
                <BanBlockedRoute
                  banInfo={banInfo}
                  onGoProfile={() => window.location.assign('/perfil?ban=1')}
                  onGoHome={() => window.location.assign('/')}
                />
              ) : (
                <ObraDetalhe
                  user={podeAcessarApp ? usuario : null}
                  perfil={podeAcessarApp ? perfilUsuario : null}
                  adminAccess={adminAccess}
                />
              )
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
                adminAccess={adminAccess}
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
          <Route
            path="/print-on-demand"
            element={
              <PrintOnDemandPage
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
                shellRole={resolvedAppRole}
                isMangakaEffective={isMangakaEffective}
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
              bannedAccountOnly ? (
                <BanBlockedRoute
                  banInfo={banInfo}
                  onGoProfile={() => window.location.assign('/perfil?ban=1')}
                  onGoHome={() => window.location.assign('/')}
                />
              ) : (
                <Leitor
                  user={podeAcessarApp ? usuario : null}
                  perfil={podeAcessarApp ? perfilUsuario : null}
                  adminAccess={adminAccess}
                />
              )
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
                <CreatorsApplyPage
                  user={podeAcessarApp ? usuario : null}
                  adminAccess={adminAccess}
                  shellRole={resolvedAppRole}
                  isMangakaEffective={isMangakaEffective}
                />
              )
            }
          />
          <Route path="/apoie/criador/:creatorId" element={<ApoieCreatorRedirect />} />
          <Route
            path="/premium"
            element={
              <Apoie
                user={podeAcessarApp ? usuario : null}
                perfil={podeAcessarApp ? perfilUsuario : null}
                initialView="premium"
              />
            }
          />
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
            element={<LoginRoute podeAcessarApp={podeAcessarApp} adminAccess={adminAccess} />}
          />

          <Route
            path="/perfil"
            element={
                podeAcessarApp ? (
                  <Perfil
                    user={usuario}
                    adminAccess={adminAccess}
                    shellRole={resolvedAppRole}
                    isMangakaEffective={isMangakaEffective}
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
                    <CreatorOnboardingPage
                      user={usuario}
                      perfil={perfilUsuario}
                      adminAccess={adminAccess}
                      shellRole={resolvedAppRole}
                      isMangakaEffective={isMangakaEffective}
                    />
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
          <Route path="/:userHandle" element={<UsernamePublicRoute />} />

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
            path="/admin/capitulos/editor"
            element={
              !routeShellReady ? (
                <div className="shito-app-splash" aria-hidden="true" />
              ) : adminPathOk('/admin/capitulos') ? (
                <AdminPanel adminAccess={adminAccess} workspace="admin" />
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
                <AvatarAdmin adminAccess={adminAccess} />
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
              path="/admin/usuarios"
              element={
                !routeShellReady ? (
                  <div className="loading-screen">Carregando...</div>
                ) : adminPathOk('/admin/usuarios') ? (
                  <UsuariosAdmin adminAccess={adminAccess} />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
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
                <CriadoresAdmin adminAccess={adminAccess} />
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
                <CreatorWorksPage adminAccess={accessForCreatorRouting} />
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
                <CreatorChaptersPage adminAccess={accessForCreatorRouting} />
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
                <CreatorChapterEditorPage adminAccess={accessForCreatorRouting} />
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

