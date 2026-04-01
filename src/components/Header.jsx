import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../services/firebase';
import { AVATAR_FALLBACK, isAdminUser } from '../constants';
import { canAccessAdminPath, canAccessCreatorPath } from '../auth/adminPermissions';
import { assinaturaPremiumAtiva } from '../utils/capituloLancamento';
import './Header.css';

const MOBILE_BREAKPOINT = 1360;
const WORKSPACE_STORAGE_KEY = 'shito:last-workspace';

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
  const workspaceCloseTimer = useRef(null);
  const notificationIdsSeenRef = useRef(new Set());
  const notificationsInitializedRef = useRef(false);
  const markUserNotificationRead = useMemo(
    () => httpsCallable(functions, 'markUserNotificationRead'),
    []
  );

  const isAdmin = Boolean(adminAccess?.canAccessAdmin ?? isAdminUser(usuario));
  const isMangakaPanel = Boolean(adminAccess?.isMangaka);
  const canSeeAdminWorkspace = !isMangakaPanel && canAccessAdminPath('/admin', adminAccess);
  const canSeeCreatorWorkspace = canAccessCreatorPath('/creator', adminAccess);
  const [preferredWorkspace, setPreferredWorkspace] = useState(() =>
    getInitialWorkspace(location.pathname, canSeeAdminWorkspace, canSeeCreatorWorkspace)
  );

  const isPremium = !isAdmin && assinaturaPremiumAtiva(perfil);

  const navItems = [
    { label: 'Lista de Mangas', path: '/works' },
    { label: 'Loja', path: '/loja' },
    ...(usuario ? [{ label: 'Minha Biblioteca', path: '/biblioteca' }] : []),
    { label: 'Sobre nos', path: '/sobre-autor' },
  ];

  const workspaceMenus = useMemo(() => {
    const menus = [];
    if (canSeeAdminWorkspace) {
      menus.push({
        id: 'admin',
        label: 'ADMIN',
        items: [
          canAccessAdminPath('/admin/equipe', adminAccess) ? { label: 'Equipe', path: '/admin/equipe' } : null,
          canAccessAdminPath('/admin/criadores', adminAccess) ? { label: 'Criadores', path: '/admin/criadores' } : null,
          canAccessAdminPath('/admin/sessoes', adminAccess) ? { label: 'Sessoes', path: '/admin/sessoes' } : null,
          canAccessAdminPath('/admin/avatares', adminAccess) ? { label: 'CRUD de Avatares', path: '/admin/avatares' } : null,
          canAccessAdminPath('/admin/dashboard', adminAccess) ? { label: 'Financeiro global', path: '/admin/dashboard' } : null,
          canAccessAdminPath('/admin/financeiro', adminAccess) ? { label: 'Promocoes e financeiro', path: '/admin/financeiro' } : null,
          canAccessAdminPath('/admin/loja', adminAccess) ? { label: 'Loja global', path: '/admin/loja' } : null,
          canAccessAdminPath('/admin/pedidos', adminAccess) ? { label: 'Pedidos globais', path: '/admin/pedidos' } : null,
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
          canAccessCreatorPath('/creator/dashboard', adminAccess) ? { label: 'Dashboard', path: '/creator/dashboard' } : null,
          canAccessCreatorPath('/creator/obras', adminAccess) ? { label: isMangakaPanel ? 'Minhas obras' : 'Obras', path: '/creator/obras' } : null,
          canAccessCreatorPath('/creator/capitulos', adminAccess) ? { label: 'Capitulos', path: '/creator/capitulos' } : null,
          canAccessCreatorPath('/creator/promocoes', adminAccess) ? { label: 'Promocoes', path: '/creator/promocoes' } : null,
          canAccessCreatorPath('/creator/loja', adminAccess) ? { label: 'Loja', path: '/creator/loja' } : null,
        ].filter(Boolean),
      });
    }
    return menus;
  }, [adminAccess, canSeeAdminWorkspace, canSeeCreatorWorkspace, isMangakaPanel]);

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
    setMenuAberto(false);
    setWorkspaceOpen(null);
    setNotificationsOpen(false);
    setAccountMenuOpen(false);
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
    setPreferredWorkspace((prev) => {
      if (prev === 'admin' && !canSeeAdminWorkspace) return next;
      if (prev === 'creator' && !canSeeCreatorWorkspace) return next;
      return prev || next;
    });
  }, [location.pathname, canSeeAdminWorkspace, canSeeCreatorWorkspace]);

  useEffect(() => {
    if (!usuario?.uid) {
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

  const unreadNotificationsCount = headerNotifications.filter((item) => item.read !== true).length;

  const openNotificationTarget = async (item) => {
    if (!item?.id) return;
    try {
      if (item.read !== true) {
        await markUserNotificationRead({ notificationId: item.id });
      }
    } catch (error) {
      console.error('Erro ao marcar notificacao:', error);
    }
    const targetPath = item?.targetPath || item?.data?.readPath || item?.data?.creatorPath || '/perfil';
    navigate(targetPath);
    setNotificationsOpen(false);
    setMenuAberto(false);
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      await markUserNotificationRead({ markAll: true });
    } catch (error) {
      console.error('Erro ao marcar notificacoes como lidas:', error);
    }
  };

  const handleToggleNotifications = async () => {
    setAccountMenuOpen(false);
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

  const isActivePath = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

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
            <li key={item.path} className={isActivePath(item.path) ? 'is-active' : ''}>
              <button
                type="button"
                className="nav-link-btn"
                onClick={() => pushRoute(item.path)}
                aria-current={isActivePath(item.path) ? 'page' : undefined}
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
                  {workspace.items.map((item) => (
                    <button key={item.path} type="button" onClick={() => pushRoute(item.path, workspace.id)}>
                      {item.label}
                    </button>
                  ))}
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
                      {headerNotifications.length ? (
                        <button type="button" className="header-notification-link" onClick={handleMarkAllNotificationsRead}>
                          Limpar nao lidas
                        </button>
                      ) : null}
                    </div>
                    <div className="header-notification-panel-body">
                      {!headerNotifications.length ? (
                        <p className="header-notification-empty">Nenhuma notificacao por enquanto.</p>
                      ) : (
                        headerNotifications.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`header-notification-item ${item.read ? 'is-read' : ''} priority-${Number(item.priority || 0)}`}
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
    </nav>
  );
}
