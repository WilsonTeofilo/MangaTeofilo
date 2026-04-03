import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../services/firebase';
import { AVATAR_FALLBACK, isAdminUser } from '../constants';
import { canAccessAdminPath, canAccessCreatorPath } from '../auth/adminPermissions';
import { assinaturaPremiumAtiva } from '../utils/capituloLancamento';
import { effectiveCreatorMonetizationStatus } from '../utils/creatorMonetizationUi';
import { CART_CHANGED_EVENT, cartCount, getCartItems } from '../store/cartStore';
import './HeaderV2.css';

/** Menu hambúrguer só em viewport típica de telemóvel / tablet estreito — não em PC com janela estreita até ~laptop 13". */
const MOBILE_BREAKPOINT = 768;
const WORKSPACE_STORAGE_KEY = 'shito:last-workspace';
const ADMIN_CREATOR_QUEUE_SEEN_KEY = 'shito:admin-creator-queue-seen';
const ADMIN_SUPPORT_QUEUE_SEEN_KEY = 'shito:admin-support-queue-seen';

function readSeenCount(storageKey) {
  if (typeof window === 'undefined') return 0;
  const raw = Number(window.localStorage.getItem(storageKey) || 0);
  return Number.isFinite(raw) ? raw : 0;
}

function writeSeenCount(storageKey, value) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, String(Math.max(0, Number(value || 0))));
}

function getInitialWorkspace(pathname, canSeeAdmin, canSeeCreator) {
  if (pathname.startsWith('/creator')) return 'creator';
  if (pathname.startsWith('/admin')) return 'admin';
  if (typeof window !== 'undefined') {
    const saved = String(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || '').trim().toLowerCase();
    if (saved === 'creator' && canSeeCreator) return 'creator';
    if (saved === 'admin' && canSeeAdmin) return 'admin';
  }
  if (canSeeCreator && !canSeeAdmin) return 'creator';
  if (canSeeAdmin) return 'admin';
  return 'creator';
}

export default function Header({ usuario, perfil, adminAccess }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [headerNotifications, setHeaderNotifications] = useState([]);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [adminCreatorQueueCount, setAdminCreatorQueueCount] = useState(0);
  const [adminSupportQueueCount, setAdminSupportQueueCount] = useState(0);
  const [storeCartItems, setStoreCartItems] = useState(() => getCartItems());
  const workspaceCloseTimer = useRef(null);
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

  const isAdmin = Boolean(adminAccess?.canAccessAdmin ?? isAdminUser(usuario));
  const isMangakaPanel = Boolean(adminAccess?.isMangaka);
  const canSeeAdminWorkspace = !isMangakaPanel && canAccessAdminPath('/admin', adminAccess);
  const canSeeCreatorWorkspace = canAccessCreatorPath('/creator', adminAccess);
  const [preferredWorkspace, setPreferredWorkspace] = useState(() =>
    getInitialWorkspace(location.pathname, canSeeAdminWorkspace, canSeeCreatorWorkspace)
  );

  const storeCartCount = cartCount(storeCartItems);

  const isPremium = !isAdmin && assinaturaPremiumAtiva(perfil);
  const creatorMonetizationIsActive =
    effectiveCreatorMonetizationStatus(
      perfil?.creatorMonetizationPreference,
      perfil?.creatorMonetizationStatus
    ) === 'active';

  /** Candidatura publica: quem ja abre ADMIN (Criadores etc.) nao precisa do atalho CREATORS. */
  const showCreatorsNav = !isMangakaPanel && !canSeeAdminWorkspace;

  const lanceSuaLinhaPath =
    usuario && adminAccess?.isMangaka && creatorMonetizationIsActive ? '/creator/print' : '/print-on-demand';

  const navItems = useMemo(
    () => [
      { label: 'Lista de Mangas', path: '/works' },
      ...(usuario ? [{ label: 'Minha Biblioteca', path: '/biblioteca' }] : []),
      { label: 'Loja', path: '/loja' },
      { label: 'Lance sua linha', path: lanceSuaLinhaPath, podNav: true },
      ...(showCreatorsNav ? [{ label: 'CREATORS', path: '/creators' }] : []),
      { label: 'Sobre nos', path: '/sobre-autor' },
    ],
    [creatorMonetizationIsActive, lanceSuaLinhaPath, showCreatorsNav, usuario]
  );

  const workspaceMenus = useMemo(() => {
    const menus = [];
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
        lojaMenuBits.push({ label: 'Configurações', path: '/admin/store/settings' });
      }

      menus.push({
        id: 'admin',
        label: 'ADMIN',
        items: [
          canAccessAdminPath('/admin/equipe', adminAccess) ? { label: 'Equipe', path: '/admin/equipe' } : null,
          canAccessAdminPath('/admin/criadores', adminAccess) ? { label: 'Criadores', path: '/admin/criadores' } : null,
          canAccessAdminPath('/admin/sessoes', adminAccess) ? { label: 'Sessoes', path: '/admin/sessoes' } : null,
          canAccessAdminPath('/admin/avatares', adminAccess) ? { label: 'Avatares', path: '/admin/avatares' } : null,
          canAccessAdminPath('/admin/dashboard', adminAccess) ? { label: 'Financeiro', path: '/admin/dashboard' } : null,
          canAccessAdminPath('/admin/financeiro', adminAccess) ? { label: 'Promocoes', path: '/admin/financeiro' } : null,
          ...lojaMenuBits,
        ].filter(Boolean),
      });
    }
    if (canSeeCreatorWorkspace) {
      menus.push({
        id: 'creator',
        label: 'CREATOR',
        subtitle: isMangakaPanel ? 'Meu conteudo' : 'Conteudo global',
        items: [
          canAccessCreatorPath('/creator/perfil', adminAccess) ? { label: 'Perfil', path: '/creator/perfil' } : null,
          canAccessCreatorPath('/creator/dashboard', adminAccess) ? { label: 'Workspace', path: '/creator/dashboard' } : null,
          canAccessCreatorPath('/creator/audience', adminAccess) ? { label: 'Analytics', path: '/creator/audience' } : null,
          canAccessCreatorPath('/creator/obras', adminAccess) ? { label: isMangakaPanel ? 'Minhas obras' : 'Obras', path: '/creator/obras' } : null,
          canAccessCreatorPath('/creator/capitulos', adminAccess) ? { label: 'Capitulos', path: '/creator/capitulos' } : null,
          canAccessCreatorPath('/creator/promocoes', adminAccess) && (!isMangakaPanel || creatorMonetizationIsActive)
            ? { label: 'Promocoes', path: '/creator/promocoes' }
            : null,
          canAccessCreatorPath('/creator/loja', adminAccess) && (!isMangakaPanel || creatorMonetizationIsActive)
            ? { label: 'Loja', path: '/creator/loja' }
            : null,
        ].filter(Boolean),
      });
    }
    return menus;
  }, [adminAccess, canSeeAdminWorkspace, canSeeCreatorWorkspace, creatorMonetizationIsActive, isMangakaPanel]);

  const persistWorkspace = (workspaceId) => {
    setPreferredWorkspace(workspaceId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
    }
  };

  const handleLogout = async (e) => {
    e.stopPropagation();
    try {
      await signOut(auth);
      setMenuAberto(false);
      setWorkspaceOpen(null);
      setAccountMenuOpen(false);
      setNotificationsOpen(false);
      navigate('/login');
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
  };

  const pushRoute = (path, workspaceId = null) => {
    if (workspaceId) persistWorkspace(workspaceId);
    navigate(path);
    setMenuAberto(false);
    setWorkspaceOpen(null);
    setAccountMenuOpen(false);
    setNotificationsOpen(false);
  };

  const abrirWorkspace = (workspaceId) => {
    if (workspaceCloseTimer.current) {
      clearTimeout(workspaceCloseTimer.current);
      workspaceCloseTimer.current = null;
    }
    setWorkspaceOpen(workspaceId);
  };

  const fecharWorkspace = () => {
    if (workspaceCloseTimer.current) clearTimeout(workspaceCloseTimer.current);
    workspaceCloseTimer.current = setTimeout(() => {
      setWorkspaceOpen(null);
      workspaceCloseTimer.current = null;
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (workspaceCloseTimer.current) clearTimeout(workspaceCloseTimer.current);
    };
  }, []);

  useEffect(() => {
    // Fechamos os menus ao trocar de rota para evitar overlays presos em navegacao SPA.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuAberto(false);
    setWorkspaceOpen(null);
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
      if (window.innerWidth > MOBILE_BREAKPOINT) {
        setMenuAberto(false);
      }
      if (window.innerWidth <= MOBILE_BREAKPOINT) {
        setWorkspaceOpen(null);
      }
    };
    syncMenuState();
    window.addEventListener('resize', syncMenuState);
    return () => window.removeEventListener('resize', syncMenuState);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('.header-notification-shell')) {
        setNotificationsOpen(false);
      }
      if (!target.closest('.header-account-shell')) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    const mobileOpen = menuAberto && window.innerWidth <= MOBILE_BREAKPOINT;
    document.body.classList.toggle('mobile-menu-open', mobileOpen);
    return () => document.body.classList.remove('mobile-menu-open');
  }, [menuAberto]);

  useEffect(() => {
    const next = getInitialWorkspace(location.pathname, canSeeAdminWorkspace, canSeeCreatorWorkspace);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferredWorkspace((prev) => {
      if (prev === 'admin' && !canSeeAdminWorkspace) return next;
      if (prev === 'creator' && !canSeeCreatorWorkspace) return next;
      return prev || next;
    });
  }, [location.pathname, canSeeAdminWorkspace, canSeeCreatorWorkspace]);

  useEffect(() => {
    const syncCart = () => setStoreCartItems(getCartItems());
    const onVis = () => {
      if (document.visibilityState === 'visible') syncCart();
    };
    window.addEventListener('storage', syncCart);
    window.addEventListener(CART_CHANGED_EVENT, syncCart);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('storage', syncCart);
      window.removeEventListener(CART_CHANGED_EVENT, syncCart);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    setStoreCartItems(getCartItems());
  }, [usuario?.uid]);

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
      setHeaderNotifications(list.slice(0, 12));
    });
    return () => unsub();
  }, [usuario?.uid]);

  useEffect(() => {
    if (!canSeeAdminWorkspace) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAdminCreatorQueueCount(0);
      return () => {};
    }
    const unsub = onValue(ref(db, 'usuarios'), (snapshot) => {
      const rows = snapshot.exists() ? Object.values(snapshot.val() || {}) : [];
      const pending = rows.filter((item) => {
        const s = String(item?.creatorApplicationStatus || '').trim().toLowerCase();
        const mon = String(item?.creatorMonetizationStatus || '').trim().toLowerCase();
        const role = String(item?.role || '').trim().toLowerCase();
        if (s === 'requested') return true;
        if (s === 'approved' && mon === 'pending_review' && role === 'mangaka') return true;
        return false;
      }).length;
      setAdminCreatorQueueCount(pending);
    });
    return () => unsub();
  }, [canSeeAdminWorkspace]);

  useEffect(() => {
    if (!canSeeAdminWorkspace) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAdminSupportQueueCount(0);
      return () => {};
    }
    const supportPaths = ['sac/tickets', 'suporte/tickets', 'support/tickets', 'tickets'];
    const totals = new Map();
    const unsubs = supportPaths.map((path) =>
      onValue(ref(db, path), (snapshot) => {
        const rows = snapshot.exists() ? Object.values(snapshot.val() || {}) : [];
        const openItems = rows.filter((item) => {
          const status = String(item?.status || item?.state || '').trim().toLowerCase();
          return !['closed', 'resolved', 'done', 'archived'].includes(status);
        }).length;
        totals.set(path, openItems);
        setAdminSupportQueueCount([...totals.values()].reduce((sum, value) => sum + Number(value || 0), 0));
      })
    );
    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [canSeeAdminWorkspace]);

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
  const adminQueueNotifications = useMemo(() => {
    if (!canSeeAdminWorkspace) return [];
    const items = [];
    if (adminCreatorQueueCount > 0) {
      const seen = readSeenCount(ADMIN_CREATOR_QUEUE_SEEN_KEY);
      items.push({
        id: 'admin-creator-queue',
        type: 'admin_creator_queue',
        title: adminCreatorQueueCount === 1 ? '1 solicitacao de creator pendente' : `${adminCreatorQueueCount} solicitacoes de creator pendentes`,
        message: 'Clique para abrir a fila de aprovacao de creators.',
        targetPath: '/admin/criadores',
        read: adminCreatorQueueCount <= seen,
        priority: 2,
        createdAt: 9999999999999,
        updatedAt: 9999999999999,
      });
    }
    if (adminSupportQueueCount > 0) {
      const seen = readSeenCount(ADMIN_SUPPORT_QUEUE_SEEN_KEY);
      items.push({
        id: 'admin-support-queue',
        type: 'admin_support_queue',
        title: adminSupportQueueCount === 1 ? '1 chamado de SAC pendente' : `${adminSupportQueueCount} chamados de SAC pendentes`,
        message: 'Clique para revisar a fila de suporte da plataforma.',
        targetPath: '/admin/dashboard',
        read: adminSupportQueueCount <= seen,
        priority: 2,
        createdAt: 9999999999998,
        updatedAt: 9999999999998,
      });
    }
    return items;
  }, [adminCreatorQueueCount, adminSupportQueueCount, canSeeAdminWorkspace]);

  const allNotifications = useMemo(() => {
    const list = [...adminQueueNotifications, ...headerNotifications];
    list.sort((a, b) => {
      const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      return Number(b.createdAt || b.updatedAt || 0) - Number(a.createdAt || a.updatedAt || 0);
    });
    return list.slice(0, 16);
  }, [adminQueueNotifications, headerNotifications]);

  const unreadNotificationsCount = allNotifications.filter((item) => item.read !== true).length;

  const openNotificationTarget = async (item) => {
    if (!item?.id) return;
    if (item.type === 'admin_creator_queue') {
      writeSeenCount(ADMIN_CREATOR_QUEUE_SEEN_KEY, adminCreatorQueueCount);
      navigate(item.targetPath || '/admin/criadores');
      setNotificationsOpen(false);
      setMenuAberto(false);
      return;
    }
    if (item.type === 'admin_support_queue') {
      writeSeenCount(ADMIN_SUPPORT_QUEUE_SEEN_KEY, adminSupportQueueCount);
      navigate(item.targetPath || '/admin/dashboard');
      setNotificationsOpen(false);
      setMenuAberto(false);
      return;
    }
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
      writeSeenCount(ADMIN_CREATOR_QUEUE_SEEN_KEY, adminCreatorQueueCount);
      writeSeenCount(ADMIN_SUPPORT_QUEUE_SEEN_KEY, adminSupportQueueCount);
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
      if (item.type === 'admin_creator_queue') {
        writeSeenCount(ADMIN_CREATOR_QUEUE_SEEN_KEY, adminCreatorQueueCount);
      } else if (item.type === 'admin_support_queue') {
        writeSeenCount(ADMIN_SUPPORT_QUEUE_SEEN_KEY, adminSupportQueueCount);
      } else {
        await deleteUserNotification({ notificationId: item.id });
      }
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
      writeSeenCount(ADMIN_CREATOR_QUEUE_SEEN_KEY, adminCreatorQueueCount);
      writeSeenCount(ADMIN_SUPPORT_QUEUE_SEEN_KEY, adminSupportQueueCount);
      setSelectedNotification(null);
    } catch (error) {
      console.error('Erro ao deletar todas as notificacoes:', error);
    }
  };

  const handleToggleNotifications = async () => {
    setAccountMenuOpen(false);
    setSelectedNotification(null);
    setNotificationsOpen((prev) => !prev);
  };

  const handleToggleAccountMenu = () => {
    setNotificationsOpen(false);
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
    navigate(targetPath);
  };

  const isActivePath = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const navItemIsActive = (item) => {
    if (item.podNav) {
      return (
        location.pathname.startsWith('/print-on-demand') || location.pathname.startsWith('/creator/print')
      );
    }
    return isActivePath(item.path);
  };

  return (
    <nav
      className={`reader-header ${usuario ? 'reader-header--logged' : 'reader-header--guest'} ${isAdmin ? 'reader-header--admin' : ''} ${menuAberto ? 'menu-open' : ''}`}
    >
      <div className="nav-container">
        <button type="button" className="nav-logo" onClick={() => pushRoute('/')}>
          MangaTeofilo
        </button>

        <button
          type="button"
          className={`mobile-menu-icon ${menuAberto ? 'active' : ''}`}
          onClick={() => setMenuAberto(!menuAberto)}
          aria-label="Menu"
          aria-expanded={menuAberto}
        >
          <span className="bar" />
          <span className="bar" />
          <span className="bar" />
        </button>

        {menuAberto && (
          <button
            type="button"
            className="mobile-menu-overlay"
            aria-label="Fechar menu"
            onClick={() => setMenuAberto(false)}
          />
        )}

        <ul className={`nav-menu ${menuAberto ? 'active' : ''}`}>
          {navItems.map((item) => (
            <li key={item.path} className={navItemIsActive(item) ? 'is-active' : ''}>
              <button
                type="button"
                className="nav-link-btn"
                onClick={() => pushRoute(item.path)}
                aria-current={navItemIsActive(item) ? 'page' : undefined}
              >
                {item.label}
              </button>
            </li>
          ))}

          {workspaceMenus.map((workspace) => {
            const isWorkspaceActive =
              preferredWorkspace === workspace.id ||
              (workspace.id === 'admin' && location.pathname.startsWith('/admin')) ||
              (workspace.id === 'creator' && location.pathname.startsWith('/creator'));
            const isOpen = workspaceOpen === workspace.id;
            return (
              <li
                key={workspace.id}
                className={`workspace-menu-item ${isOpen ? 'open' : ''} ${isWorkspaceActive ? 'is-active' : ''}`}
                onMouseEnter={() => abrirWorkspace(workspace.id)}
                onMouseLeave={fecharWorkspace}
              >
                <button
                  type="button"
                  className={`workspace-menu-trigger workspace-menu-trigger--${workspace.id}`}
                  onClick={() => {
                    persistWorkspace(workspace.id);
                    setWorkspaceOpen((prev) => (prev === workspace.id ? null : workspace.id));
                  }}
                  onFocus={() => abrirWorkspace(workspace.id)}
                  aria-expanded={isOpen}
                >
                  <span className="workspace-menu-label">{workspace.label}</span>
                  {workspace.subtitle ? <span className="workspace-menu-subtitle">{workspace.subtitle}</span> : null}
                </button>
                <div className="workspace-dropdown">
                  {workspace.items.map((item, idx) =>
                    item.type === 'heading' ? (
                      <div
                        key={`${item.label}-${idx}`}
                        className="workspace-dropdown-heading"
                        role="presentation"
                      >
                        {item.label}
                      </div>
                    ) : (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => pushRoute(item.path, workspace.id)}
                      >
                        {item.label}
                      </button>
                    )
                  )}
                </div>
              </li>
            );
          })}

          {usuario && menuAberto && (
            <li className="mobile-only-logout">
              <button type="button" className="nav-link-btn" onClick={handleLogout}>
                Sair da Conta
              </button>
            </li>
          )}
        </ul>

        <div className="nav-auth">
          <button
            type="button"
            className="header-store-cart-btn"
            onClick={() => pushRoute('/loja/carrinho')}
            aria-label={
              storeCartCount ? `Carrinho da loja, ${storeCartCount} itens` : 'Carrinho da loja'
            }
            title="Carrinho da loja (disponível sem login; finalize após entrar)"
          >
            <svg
              className="header-store-cart-icon"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 4h2l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 8H6"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {storeCartCount > 0 ? (
              <span className="header-store-cart-badge">
                {storeCartCount > 99 ? '99+' : storeCartCount}
              </span>
            ) : null}
          </button>
          {!usuario ? (
            <button
              className="btn-login-header"
              onClick={() => pushRoute('/login')}
              aria-label="Entrar ou cadastrar"
              title="Entrar ou cadastrar"
            >
              <span className="btn-login-long">ENTRAR / CADASTRAR</span>
              <span className="btn-login-short">ENTRAR</span>
              <span className="btn-login-icon" aria-hidden="true">&#10230;</span>
            </button>
          ) : (
            <div className="user-info-header" title="Acessar Perfil">
              <div className={`header-notification-shell ${notificationsOpen ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className="header-notification-btn"
                  onClick={handleToggleNotifications}
                  aria-label="Abrir notificacoes"
                  aria-expanded={notificationsOpen}
                >
                  <span className="header-notification-icon" aria-hidden="true">&#128276;</span>
                  {unreadNotificationsCount > 0 ? (
                    <span className="header-notification-badge">{unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}</span>
                  ) : null}
                </button>
                {notificationsOpen ? (
                  <div className="header-notification-panel">
                    <div className="header-notification-panel-head">
                      <div>
                        <strong>Notificacoes</strong>
                        <small>Tudo que importa da conta e dos criadores.</small>
                      </div>
                      {allNotifications.length ? (
                        <div className="header-notification-panel-actions">
                          <button type="button" className="header-notification-link" onClick={handleMarkAllNotificationsRead}>
                            Marcar lidas
                          </button>
                          <button type="button" className="header-notification-link header-notification-link--danger" onClick={handleDeleteAllNotifications}>
                            Apagar todas
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="header-notification-panel-body">
                      {!allNotifications.length ? (
                        <p className="header-notification-empty">Nenhuma notificacao por enquanto.</p>
                      ) : (
                        allNotifications.map((item) => (
                          <div
                            key={item.id}
                            className={`header-notification-item-row ${item.read ? 'is-read' : ''} priority-${Number(item.priority || 0)}`}
                          >
                            <button
                              type="button"
                              className="header-notification-item"
                              onClick={() => openNotificationTarget(item)}
                            >
                              <small className="header-notification-meta">{priorityLabel(item)}</small>
                              <strong>{item.title || 'Atualizacao'}</strong>
                              <span>{item.message || 'Sem detalhes.'}</span>
                              {Number(item?.aggregate?.count || 1) > 1 ? (
                                <em className="header-notification-group-count">
                                  {Number(item.aggregate.count)} itens recentes
                                </em>
                              ) : null}
                            </button>
                            <button
                              type="button"
                              className="header-notification-delete"
                              aria-label={`Apagar notificacao ${item.title || 'sem titulo'}`}
                              title="Apagar notificacao"
                              onClick={(event) => handleDeleteNotification(item, event)}
                            >
                              ×
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className={`header-account-shell ${accountMenuOpen ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className="header-avatar-wrapper"
                  onClick={handleToggleAccountMenu}
                  aria-label="Abrir menu da conta"
                  aria-expanded={accountMenuOpen}
                >
                  <img
                    src={usuario.photoURL || AVATAR_FALLBACK}
                    alt="Avatar"
                    className="header-avatar-img"
                    onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
                  />
                </button>
                <div className="user-text-group">
                  <button type="button" className="welcome-text" onClick={handleToggleAccountMenu}>
                    Ola, {usuario.displayName?.split(' ')[0] || 'Guerreiro'}
                    {isPremium ? ' Premium' : ''}
                  </button>
                </div>
                {accountMenuOpen ? (
                  <div className="header-account-menu">
                    <button type="button" onClick={() => pushRoute('/perfil')}>
                      Meu perfil
                    </button>
                    <button type="button" onClick={handleLogout}>
                      Sair
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
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
                ×
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
    </nav>
  );
}
