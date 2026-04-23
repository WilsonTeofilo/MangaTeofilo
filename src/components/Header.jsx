import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../services/firebase';
import { AVATAR_FALLBACK } from '../constants';
import NotificationCenter from './header/NotificationCenter.jsx';
import WorkspaceNav from './header/WorkspaceNav.jsx';
import { canAccessAdminPath, canAccessCreatorPath, hasAnyAdminWorkspaceAccess } from '../auth/adminPermissions';
import { assinaturaPremiumAtiva } from '../utils/capituloLancamento';
import {
  resolveEffectiveCreatorMonetizationStatusFromDb,
} from '../utils/creatorMonetizationUi';
import { CART_CHANGED_EVENT, cartCount, getCartItems } from '../store/cartStore';
import { getPodCartDraft, POD_CART_CHANGED_EVENT } from '../store/podCartStore';
import { lockBodyScroll, unlockBodyScroll } from '../utils/bodyScrollLock';
import './HeaderV2.css';

/** Menu hamburguer so em viewport tipica de telemovel / tablet estreito - nao em PC com janela estreita ate ~laptop 13". */
const MOBILE_BREAKPOINT = 768;
const WORKSPACE_STORAGE_KEY = 'shito:last-workspace';

function resolveHeaderBanInfo(perfil) {
  const moderation = perfil?.moderation && typeof perfil.moderation === 'object' ? perfil.moderation : {};
  const expiresAt = Number(moderation?.currentBanExpiresAt || 0) || 0;
  const active =
    (moderation?.isBanned === true || String(perfil?.status || '').trim().toLowerCase() === 'banido') &&
    (!expiresAt || expiresAt > Date.now());
  const totalBanCount = Number(moderation?.totalBanCount || 0) || 0;
  return {
    active,
    reason: String(moderation?.lastBanReason || perfil?.banReason || '').trim(),
    expiresAt: expiresAt || null,
    totalBanCount,
    bansRemaining: Math.max(0, 4 - totalBanCount),
  };
}

function formatHeaderBanRemaining(expiresAt) {
  const end = Number(expiresAt || 0);
  if (!Number.isFinite(end) || end <= 0) return 'sem prazo definido';
  const diff = Math.max(0, end - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  const dias = Math.floor(totalSeconds / 86400);
  const horas = Math.floor((totalSeconds % 86400) / 3600);
  const minutos = Math.floor((totalSeconds % 3600) / 60);
  const segundos = totalSeconds % 60;
  return [
    dias > 0 ? `${dias}d` : null,
    horas > 0 || dias > 0 ? `${horas}h` : null,
    minutos > 0 || horas > 0 || dias > 0 ? `${minutos}m` : null,
    `${segundos}s`,
  ]
    .filter(Boolean)
    .join(' ');
}

export default function Header({
  usuario,
  perfil,
  adminAccess,
  creatorAccess = null,
  shellRole = null,
  canSeeAdminWorkspace: canSeeAdminWorkspaceProp = null,
  canSeeCreatorWorkspace: canSeeCreatorWorkspaceProp = null,
  isMangakaEffective = false,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);
  const [adminMenuAberto, setAdminMenuAberto] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [banBlockedModalOpen, setBanBlockedModalOpen] = useState(false);
  const [headerNotifications, setHeaderNotifications] = useState([]);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [storeCartItems, setStoreCartItems] = useState(() => getCartItems());
  const [podCartActive, setPodCartActive] = useState(() => Boolean(getPodCartDraft()));
  const mobileMenuLockRef = useRef(false);
  const notificationIdsSeenRef = useRef(new Set());
  const notificationsInitializedRef = useRef(false);
  const markUserNotificationRead = useMemo(
    () => httpsCallable(functions, 'markUserNotificationRead'),
    []
  );
  const deleteUserNotification = useMemo(
    () => httpsCallable(functions, 'deleteUserNotification'),
    []
  );

  const isAdmin = hasAnyAdminWorkspaceAccess(adminAccess);
  const creatorNavAccess = useMemo(() => {
    if (creatorAccess) return creatorAccess;
    if (adminAccess?.canAccessAdmin === true) {
      return { ...adminAccess, isMangaka: false };
    }
    return adminAccess;
  }, [creatorAccess, adminAccess]);
  const isMangakaPanel = Boolean(isMangakaEffective || creatorNavAccess?.isMangaka);
  const canSeeAdminWorkspace =
    typeof canSeeAdminWorkspaceProp === 'boolean'
      ? canSeeAdminWorkspaceProp
      : !isMangakaPanel && canAccessAdminPath('/admin', adminAccess);
  const canSeeCreatorWorkspace =
    typeof canSeeCreatorWorkspaceProp === 'boolean'
      ? canSeeCreatorWorkspaceProp
      : canAccessCreatorPath('/creator', creatorNavAccess);

  const storeCartCount = cartCount(storeCartItems);
  const combinedCartCount = storeCartCount + (podCartActive ? 1 : 0);

  const headerAvatarSrc =
    String(perfil?.userAvatar || '').trim() ||
    String(perfil?.creatorProfile?.avatarUrl || '').trim() ||
    String(usuario?.photoURL || '').trim() ||
    AVATAR_FALLBACK;

  const isPremium = !isAdmin && assinaturaPremiumAtiva(perfil);
  const banInfo = useMemo(() => resolveHeaderBanInfo(perfil), [perfil]);
  const creatorMonetizationIsActive =
    resolveEffectiveCreatorMonetizationStatusFromDb(perfil) === 'active';

  /** Candidatura publica: quem ja abre ADMIN (Criadores etc.) nao precisa do atalho CREATORS. */
  const showCreatorsNav =
    shellRole !== 'creator' &&
    shellRole !== 'admin' &&
    !isMangakaPanel &&
    !canSeeAdminWorkspace;
  const isAdminShell = canSeeAdminWorkspace;

  const lanceSuaLinhaPath =
    usuario && creatorNavAccess?.isMangaka && creatorMonetizationIsActive ? '/creator/print' : '/print-on-demand';

  /** Navegacao central do site leitor; o CTA de Lance sua linha fica separado. */
  const primaryNavItems = useMemo(
    () => [
      { label: 'Obras', path: '/works' },
      ...(usuario ? [{ label: 'Minha biblioteca', path: '/biblioteca' }] : []),
      { label: isPremium ? 'Premium ativo' : 'Seja premium', path: '/premium' },
      { label: 'Loja', path: '/loja' },
      { label: 'Sobre', path: '/sobre-autor' },
    ],
    [isPremium, usuario]
  );

  const isLanceRouteActive =
    location.pathname.startsWith('/print-on-demand') || location.pathname.startsWith('/creator/print');

  const adminShellSections = useMemo(() => {
    if (!isAdminShell) return [];
    const sections = [];
    const userItems = [
      canAccessAdminPath('/admin/equipe', adminAccess) ? { label: 'Equipe ADM', path: '/admin/equipe' } : null,
      canAccessAdminPath('/admin/criadores', adminAccess) ? { label: 'Criadores', path: '/admin/criadores' } : null,
      canAccessAdminPath('/admin/usuarios', adminAccess) ? { label: 'Usuarios', path: '/admin/usuarios' } : null,
      canAccessAdminPath('/admin/sessoes', adminAccess) ? { label: 'Sessoes', path: '/admin/sessoes' } : null,
    ].filter(Boolean);
    if (userItems.length) sections.push({ id: 'users', label: 'Usuarios', items: userItems });

    const storeItems = [
      canAccessAdminPath('/admin/products', adminAccess) ? { label: 'Produtos', path: '/admin/products' } : null,
      canAccessAdminPath('/admin/pedidos', adminAccess) ? { label: 'Pedidos', path: '/admin/pedidos' } : null,
      canAccessAdminPath('/admin/store/settings', adminAccess) ? { label: 'Configuracoes', path: '/admin/store/settings' } : null,
    ].filter(Boolean);
    if (storeItems.length) sections.push({ id: 'store', label: 'Loja', items: storeItems });

    const artItems = [
      canAccessAdminPath('/admin/obras', adminAccess) ? { label: 'Obras', path: '/admin/obras' } : null,
      canAccessAdminPath('/admin/capitulos', adminAccess) ? { label: 'Capitulos', path: '/admin/capitulos' } : null,
      canAccessAdminPath('/admin/avatares', adminAccess) ? { label: 'Avatares', path: '/admin/avatares' } : null,
    ].filter(Boolean);
    if (artItems.length) sections.push({ id: 'art', label: 'Arte', items: artItems });

    const dashboardItems = [
      canAccessAdminPath('/admin/dashboard', adminAccess) ? { label: 'Dashboard', path: '/admin/dashboard' } : null,
      canAccessAdminPath('/admin/financeiro', adminAccess) ? { label: 'Financeiro', path: '/admin/financeiro' } : null,
    ].filter(Boolean);
    if (dashboardItems.length) sections.push({ id: 'dashboards', label: 'Dashboards', items: dashboardItems });

    return sections;
  }, [adminAccess, isAdminShell]);

  const workspaceMenus = useMemo(() => {
    const menus = [];
    const adminWorkspaceCreatorStrip = canSeeAdminWorkspace;

    if (canSeeAdminWorkspace) {
      const lojaMenuBits = [];
      if (canAccessAdminPath('/admin/products', adminAccess)) {
        if (!lojaMenuBits.length) lojaMenuBits.push({ type: 'heading', label: 'Loja' });
        lojaMenuBits.push({ label: 'Produtos', path: '/admin/products' });
      }
      if (canAccessAdminPath('/admin/pedidos', adminAccess)) {
        if (!lojaMenuBits.length) lojaMenuBits.push({ type: 'heading', label: 'Loja' });
        lojaMenuBits.push({ label: 'Pedidos', path: '/admin/pedidos' });
      }
      if (canAccessAdminPath('/admin/store/settings', adminAccess)) {
        if (!lojaMenuBits.length) lojaMenuBits.push({ type: 'heading', label: 'Loja' });
        lojaMenuBits.push({ label: 'Configuracoes', path: '/admin/store/settings' });
      }
      if (
        adminWorkspaceCreatorStrip &&
        canAccessCreatorPath('/creator/promocoes', creatorNavAccess) &&
        canAccessAdminPath('/admin/financeiro', adminAccess)
      ) {
        if (!lojaMenuBits.length) lojaMenuBits.push({ type: 'heading', label: 'Loja' });
        lojaMenuBits.push({ label: 'Promocoes', path: '/creator/promocoes' });
      }
      if (
        adminWorkspaceCreatorStrip &&
        canAccessCreatorPath('/creator/loja', creatorNavAccess) &&
        (canAccessAdminPath('/admin/products', adminAccess) || canAccessAdminPath('/admin/pedidos', adminAccess))
      ) {
        if (!lojaMenuBits.length) lojaMenuBits.push({ type: 'heading', label: 'Loja' });
        lojaMenuBits.push({ label: 'Loja', path: '/creator/loja' });
      }

      const conteudoMenuBits = [];
      const adminObrasOk = canAccessAdminPath('/admin/obras', adminAccess);
      const adminCapitulosOk = canAccessAdminPath('/admin/capitulos', adminAccess);
      if (adminObrasOk || adminCapitulosOk) {
        conteudoMenuBits.push({ type: 'heading', label: 'Conteudo global' });
        if (adminObrasOk) conteudoMenuBits.push({ label: 'Obras', path: '/admin/obras' });
        if (adminCapitulosOk) conteudoMenuBits.push({ label: 'Capitulos', path: '/admin/capitulos' });
      }

      menus.push({
        id: 'admin',
        label: 'ADMIN',
        clusterTitle: 'Painel da equipe',
        items: [
          canAccessAdminPath('/admin/equipe', adminAccess) ? { label: 'Equipe', path: '/admin/equipe' } : null,
          canAccessAdminPath('/admin/criadores', adminAccess) ? { label: 'Criadores', path: '/admin/criadores' } : null,
          canAccessAdminPath('/admin/sessoes', adminAccess) ? { label: 'Sessoes', path: '/admin/sessoes' } : null,
          canAccessAdminPath('/admin/avatares', adminAccess) ? { label: 'Avatares', path: '/admin/avatares' } : null,
          canAccessAdminPath('/admin/dashboard', adminAccess) ? { label: 'Financeiro', path: '/admin/dashboard' } : null,
          adminWorkspaceCreatorStrip || !canAccessAdminPath('/admin/financeiro', adminAccess)
            ? null
            : { label: 'Promocoes', path: '/admin/financeiro' },
          ...conteudoMenuBits,
          ...lojaMenuBits,
        ].filter(Boolean),
      });
    }
    if (canSeeCreatorWorkspace && !canSeeAdminWorkspace) {
      menus.push({
        id: 'creator',
        label: 'CREATOR',
        subtitle: isMangakaPanel ? 'Meu conteudo' : 'Conteudo global',
        items: [
          canAccessCreatorPath('/perfil', creatorNavAccess)
            ? { label: 'Identidade publica', path: '/perfil' }
            : null,
          canAccessCreatorPath('/creator/monetizacao', creatorNavAccess)
            ? { label: 'Monetizacao', path: '/creator/monetizacao' }
            : null,
          canAccessCreatorPath('/creator/missoes', creatorNavAccess)
            ? { label: 'Missoes & XP', path: '/creator/missoes' }
            : null,
          canAccessCreatorPath('/creator/audience', creatorNavAccess) ? { label: 'Analytics', path: '/creator/audience' } : null,
          canAccessCreatorPath('/creator/obras', creatorNavAccess)
            ? { label: isMangakaPanel ? 'Minhas obras' : 'Obras', path: '/creator/obras' }
            : null,
          canAccessCreatorPath('/creator/capitulos', creatorNavAccess) ? { label: 'Capitulos', path: '/creator/capitulos' } : null,
          canAccessCreatorPath('/creator/promocoes', creatorNavAccess) && (!isMangakaPanel || creatorMonetizationIsActive)
            ? { label: 'Promocoes', path: '/creator/promocoes' }
            : null,
          canAccessCreatorPath('/creator/loja', creatorNavAccess) && (!isMangakaPanel || creatorMonetizationIsActive)
            ? { label: 'Loja', path: '/creator/loja' }
            : null,
          isMangakaPanel && canSeeCreatorWorkspace
            ? { label: 'Meus pedidos', path: '/pedidos?tab=fisico' }
            : null,
        ].filter(Boolean),
      });
    }
    return menus;
  }, [
    adminAccess,
    creatorNavAccess,
    canSeeAdminWorkspace,
    canSeeCreatorWorkspace,
    creatorMonetizationIsActive,
    isMangakaPanel,
  ]);

  const persistWorkspace = (workspaceId) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
    }
  };

  const handleLogout = async (e) => {
    e.stopPropagation();
    try {
      await signOut(auth);
      setMenuAberto(false);
      setAdminMenuAberto(false);
      setAccountMenuOpen(false);
      setNotificationsOpen(false);
      navigate('/login');
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
  };

  const pushRoute = (path, workspaceId = null) => {
    const targetPath = String(path || '').trim() || '/';
    const banAllowedPath = targetPath === '/perfil' || targetPath.startsWith('/perfil?') || targetPath === '/login';
    if (banInfo.active && !banAllowedPath) {
      setBanBlockedModalOpen(true);
      setMenuAberto(false);
      setAdminMenuAberto(false);
      setAccountMenuOpen(false);
      setNotificationsOpen(false);
      return;
    }
    if (workspaceId) persistWorkspace(workspaceId);
    navigate(targetPath);
    setMenuAberto(false);
    setAdminMenuAberto(false);
    setAccountMenuOpen(false);
    setNotificationsOpen(false);
  };

  useEffect(() => {
    // Fechamos os menus ao trocar de rota para evitar overlays presos em navegacao SPA.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuAberto(false);
    setAdminMenuAberto(false);
    setNotificationsOpen(false);
    setAccountMenuOpen(false);
    setSelectedNotification(null);
    if (location.pathname.startsWith('/admin') && canSeeAdminWorkspace) {
      persistWorkspace('admin');
      return;
    }
    if (location.pathname.startsWith('/creator') && canSeeCreatorWorkspace) {
      persistWorkspace('creator');
    }
  }, [location.pathname, canSeeAdminWorkspace, canSeeCreatorWorkspace]);

  useEffect(() => {
    const syncMenuState = () => {
      if (!isAdminShell && window.innerWidth > MOBILE_BREAKPOINT) {
        setMenuAberto(false);
        setAdminMenuAberto(false);
        if (mobileMenuLockRef.current) {
          unlockBodyScroll('header-mobile-menu', { className: 'mobile-menu-open' });
          mobileMenuLockRef.current = false;
        }
      }
    };
    syncMenuState();
    window.addEventListener('resize', syncMenuState);
    return () => window.removeEventListener('resize', syncMenuState);
  }, [isAdminShell]);

  useEffect(() => {
    /**
     * Fechar dropdowns ao clicar fora. Regras:
     * - `click` em fase de bolha (sem capture): no Firefox, capture no document quebrava
     *   interacao com botoes do menu (ex.: Sair).
     * - Nao usar `mousedown`: ao arrastar a scrollbar nativa o target costuma ser html/body
     *   e o painel fechava; `click` nao dispara apos arrastar so a barra.
     * - `touchstart` removido: gerava fechamento falso e conflito com rolagem/toque no menu.
     */
    const hitInside = (event, className) => {
      const t = event.target;
      if (t instanceof Element && t.closest(`.${className}`)) return true;
      if (typeof event.composedPath === 'function') {
        const path = event.composedPath();
        for (let i = 0; i < path.length; i += 1) {
          const n = path[i];
          if (n instanceof Element && n.classList?.contains(className)) return true;
        }
      }
      return false;
    };

    const closeIfOutside = (event) => {
      if (!hitInside(event, 'header-notification-shell')) {
        setNotificationsOpen(false);
      }
      if (!hitInside(event, 'header-account-shell')) {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener('click', closeIfOutside);
    return () => {
      document.removeEventListener('click', closeIfOutside);
    };
  }, []);

  useEffect(() => {
    const mobileOpen = (menuAberto || adminMenuAberto) && (isAdminShell || window.innerWidth <= MOBILE_BREAKPOINT);
    if (mobileOpen && !mobileMenuLockRef.current) {
      lockBodyScroll('header-mobile-menu', { className: 'mobile-menu-open' });
      mobileMenuLockRef.current = true;
    }
    if (!mobileOpen && mobileMenuLockRef.current) {
      unlockBodyScroll('header-mobile-menu', { className: 'mobile-menu-open' });
      mobileMenuLockRef.current = false;
    }
    return () => {
      if (mobileMenuLockRef.current) {
        unlockBodyScroll('header-mobile-menu', { className: 'mobile-menu-open' });
        mobileMenuLockRef.current = false;
      }
    };
  }, [adminMenuAberto, isAdminShell, menuAberto]);

  useEffect(() => {
    const syncCart = () => setStoreCartItems(getCartItems());
    const onVis = () => {
      if (document.visibilityState === 'visible') syncCart();
    };
    syncCart();
    window.addEventListener('storage', syncCart);
    window.addEventListener(CART_CHANGED_EVENT, syncCart);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('storage', syncCart);
      window.removeEventListener(CART_CHANGED_EVENT, syncCart);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [usuario?.uid]);

  useEffect(() => {
    const sync = () => setPodCartActive(Boolean(getPodCartDraft()));
    sync();
    window.addEventListener(POD_CART_CHANGED_EVENT, sync);
    return () => window.removeEventListener(POD_CART_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!usuario?.uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHeaderNotifications([]);
      notificationIdsSeenRef.current = new Set();
      notificationsInitializedRef.current = false;
      return () => {};
    }
    const unsub = onValue(ref(db, `usuarios/${usuario.uid}/notifications`), (snapshot) => {
      const list = snapshot.exists()
        ? Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...(value || {}) }))
        : [];
      list.sort((a, b) => {
        const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
        if (priorityDiff !== 0) return priorityDiff;
        return Number(b.createdAt || b.updatedAt || 0) - Number(a.createdAt || a.updatedAt || 0);
      });
      setHeaderNotifications(list.slice(0, 150));
    });
    return () => unsub();
  }, [usuario?.uid]);

  useEffect(() => {
    if (!usuario?.uid) return;
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;

    if (!notificationsInitializedRef.current) {
      headerNotifications.forEach((item) => {
        if (item?.id) notificationIdsSeenRef.current.add(item.id);
      });
      notificationsInitializedRef.current = true;
      return;
    }

    headerNotifications.forEach((item) => {
      if (!item?.id || item.read || notificationIdsSeenRef.current.has(item.id)) return;
      notificationIdsSeenRef.current.add(item.id);
      const browserNotification = new Notification(item.title || 'Atualizacao', {
        body: item.message || 'Voce recebeu uma nova notificacao.',
        tag: `user-notification-${item.id}`,
      });
      browserNotification.onclick = () => {
        window.focus();
        const targetPath = item?.targetPath || item?.data?.readPath || item?.data?.creatorPath || '/perfil';
        navigate(targetPath);
      };
    });
  }, [headerNotifications, navigate, usuario?.uid]);
  const allNotifications = useMemo(() => {
    const list = [...headerNotifications];
    list.sort((a, b) => {
      const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      return Number(b.createdAt || b.updatedAt || 0) - Number(a.createdAt || a.updatedAt || 0);
    });
    return list.slice(0, 16);
  }, [headerNotifications]);

  const unreadNotificationsCount = allNotifications.filter((item) => item.read !== true).length;

  const openNotificationTarget = async (item) => {
    if (!item?.id) return;
    try {
      if (item.read !== true) {
        await markUserNotificationRead({ notificationId: item.id });
      }
    } catch (error) {
      console.error('Erro ao marcar notificacao:', error);
    }
    setSelectedNotification(item);
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      await markUserNotificationRead({ markAll: true });
    } catch (error) {
      console.error('Erro ao marcar notificacoes como lidas:', error);
    }
  };

  const handleDeleteNotification = async (item, event = null) => {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!item?.id) return;
    try {
      await deleteUserNotification({ notificationId: item.id });
      setSelectedNotification((current) => (current?.id === item.id ? null : current));
    } catch (error) {
      console.error('Erro ao deletar notificacao:', error);
    }
  };

  const handleDeleteAllNotifications = async () => {
    try {
      const hasUserNotifications = headerNotifications.length > 0;
      if (hasUserNotifications) {
        await deleteUserNotification({ deleteAll: true });
      }
      setSelectedNotification(null);
    } catch (error) {
      console.error('Erro ao deletar todas as notificacoes:', error);
    }
  };

  const handleToggleNotifications = async () => {
    setAccountMenuOpen(false);
    setSelectedNotification(null);
    setAdminMenuAberto(false);
    setNotificationsOpen((prev) => !prev);
  };

  const handleToggleAccountMenu = () => {
    setNotificationsOpen(false);
    setAdminMenuAberto(false);
    setAccountMenuOpen((prev) => !prev);
  };

  const priorityLabel = (item) => {
    const priority = Number(item?.priority || 0);
    if (priority >= 3) return 'critica';
    if (priority >= 2) return 'importante';
    return 'nova';
  };

  const openSelectedNotificationPath = () => {
    const item = selectedNotification;
    if (!item) return;
    const targetPath = item?.targetPath || item?.data?.readPath || item?.data?.creatorPath || '/perfil';
    setSelectedNotification(null);
    setNotificationsOpen(false);
    setMenuAberto(false);
    setAdminMenuAberto(false);
    navigate(targetPath);
  };

  const isActivePath = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const primaryNavIsActive = (item) => isActivePath(item.path);

  const renderWorkspaceAccountSections = () =>
    workspaceMenus.map((workspace) => {
      const workspaceHomePath =
        workspace.id === 'admin'
          ? '/admin/dashboard'
          : isMangakaPanel
            ? '/perfil'
            : '/creator/dashboard';
      const canOpenWorkspaceHome =
        workspace.id === 'admin'
          ? canAccessAdminPath(workspaceHomePath, adminAccess)
          : canSeeAdminWorkspace
            ? false
            : canAccessCreatorPath(workspaceHomePath, creatorNavAccess);
      return (
        <div key={workspace.id} className="header-account-menu__cluster">
          <div className="header-account-menu__heading">
                    {workspace.clusterTitle || (workspace.id === 'admin' ? 'Administracao' : 'Criador')}
          </div>
          {canOpenWorkspaceHome ? (
            <button
              type="button"
              className="header-account-menu__dash"
              onClick={() => pushRoute(workspaceHomePath, workspace.id)}
            >
              {workspace.id === 'admin' ? 'Painel admin' : 'Workspace do creator'}
            </button>
          ) : null}
          {workspace.items.map((item, idx) =>
            item.type === 'heading' ? (
              <div key={`${item.label}-${idx}`} className="header-account-menu__subhead">
                {item.label}
              </div>
            ) : item.path === workspaceHomePath && canOpenWorkspaceHome ? null : (
              <button key={item.path} type="button" onClick={() => pushRoute(item.path, workspace.id)}>
                {item.label}
              </button>
            )
          )}
        </div>
      );
    });

  return (
    <nav
      className={`reader-header ${usuario ? 'reader-header--logged' : 'reader-header--guest'} ${isAdmin ? 'reader-header--admin' : ''} ${canSeeAdminWorkspace ? 'reader-header--staff-shell' : ''} ${(menuAberto || adminMenuAberto) ? 'menu-open' : ''}`}
    >
      <div className="nav-container">
        <button
          type="button"
          className="nav-logo"
          onClick={() => pushRoute('/')}
        >
          MangaTeofilo
        </button>

        <WorkspaceNav
          isAdminShell={isAdminShell}
          menuAberto={menuAberto}
          setMenuAberto={setMenuAberto}
          adminMenuAberto={adminMenuAberto}
          setAdminMenuAberto={setAdminMenuAberto}
          primaryNavItems={primaryNavItems}
          primaryNavIsActive={primaryNavIsActive}
          isLanceRouteActive={isLanceRouteActive}
          lanceSuaLinhaPath={lanceSuaLinhaPath}
          showCreatorsNav={showCreatorsNav}
          pushRoute={pushRoute}
          adminShellSections={adminShellSections}
          currentPathname={location.pathname}
        />

        <NotificationCenter
          usuario={usuario}
          isAdminShell={isAdminShell}
          showCreatorsNav={showCreatorsNav}
          pushRoute={pushRoute}
          combinedCartCount={combinedCartCount}
          notificationsOpen={notificationsOpen}
          handleToggleNotifications={handleToggleNotifications}
          unreadNotificationsCount={unreadNotificationsCount}
          allNotifications={allNotifications}
          openNotificationTarget={openNotificationTarget}
          handleMarkAllNotificationsRead={handleMarkAllNotificationsRead}
          handleDeleteAllNotifications={handleDeleteAllNotifications}
          handleDeleteNotification={handleDeleteNotification}
          accountMenuOpen={accountMenuOpen}
          handleToggleAccountMenu={handleToggleAccountMenu}
          headerAvatarSrc={headerAvatarSrc}
          isPremium={isPremium}
          workspaceMenus={workspaceMenus}
          renderWorkspaceAccountSections={renderWorkspaceAccountSections}
          handleLogout={handleLogout}
          selectedNotification={selectedNotification}
          priorityLabel={priorityLabel}
          openSelectedNotificationPath={openSelectedNotificationPath}
          setSelectedNotification={setSelectedNotification}
        />

      </div>

      {selectedNotification ? (
        <div
          className="header-notification-modal"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedNotification(null);
          }}
        >
          <div className="header-notification-modal__panel" role="dialog" aria-modal="true">
            <div className="header-notification-modal__head">
              <div>
                <small>{priorityLabel(selectedNotification)}</small>
                <strong>{selectedNotification.title || 'Atualizacao'}</strong>
              </div>
              <button type="button" onClick={() => setSelectedNotification(null)} aria-label="Fechar detalhes">
                x
              </button>
            </div>
            <div className="header-notification-modal__body">
              <p>{selectedNotification.message || 'Sem detalhes adicionais.'}</p>
              {Number(selectedNotification?.aggregate?.count || 1) > 1 ? (
                <p className="header-notification-modal__meta">
                  {Number(selectedNotification.aggregate.count)} eventos recentes agrupados nesta notificacao.
                </p>
              ) : null}
            </div>
            <div className="header-notification-modal__actions">
              <button type="button" className="header-notification-modal__ghost" onClick={() => setSelectedNotification(null)}>
                Fechar
              </button>
              <button
                type="button"
                className="header-notification-modal__danger"
                onClick={(event) => handleDeleteNotification(selectedNotification, event)}
              >
                Apagar
              </button>
              <button type="button" className="header-notification-modal__primary" onClick={openSelectedNotificationPath}>
                Abrir destino
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {banBlockedModalOpen ? (
        <div
          className="header-notification-modal"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setBanBlockedModalOpen(false);
          }}
        >
          <div className="header-notification-modal__panel" role="dialog" aria-modal="true">
            <div className="header-notification-modal__head">
              <div>
                <small>conta com ban</small>
                <strong>Acesso bloqueado temporariamente</strong>
              </div>
              <button type="button" onClick={() => setBanBlockedModalOpen(false)} aria-label="Fechar aviso de ban">
                x
              </button>
            </div>
            <div className="header-notification-modal__body">
              <p>
                Sua conta está com ban ativo. Você pode entrar na conta para acompanhar notificações e o prazo da punição,
                mas não pode acessar obras, biblioteca, loja nem outras áreas públicas bloqueadas.
              </p>
              <p>
                <strong>Motivo:</strong> {banInfo.reason || 'Não informado pela equipe.'}
              </p>
              <p>
                <strong>Tempo restante:</strong>{' '}
                {banInfo.expiresAt
                  ? `${formatHeaderBanRemaining(banInfo.expiresAt)} (até ${new Date(banInfo.expiresAt).toLocaleString('pt-BR')})`
                  : 'sem prazo definido'}
              </p>
              <p>
                <strong>Bans acumulados:</strong> {banInfo.totalBanCount} de 4.{' '}
                {banInfo.bansRemaining > 0
                  ? `Faltam ${banInfo.bansRemaining} para exclusão permanente da conta.`
                  : 'A conta chegou ao limite de exclusão permanente.'}
              </p>
            </div>
            <div className="header-notification-modal__actions">
              <button
                type="button"
                className="header-notification-modal__ghost"
                onClick={() => setBanBlockedModalOpen(false)}
              >
                Fechar
              </button>
              <button
                type="button"
                className="header-notification-modal__primary"
                onClick={() => {
                  setBanBlockedModalOpen(false);
                  navigate('/perfil?ban=1');
                }}
              >
                Ir para minha conta
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}


