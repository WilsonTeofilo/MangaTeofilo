import React from 'react';
import { AVATAR_FALLBACK } from '../../constants';

export default function NotificationCenter({
  usuario,
  showCreatorsNav,
  pushRoute,
  combinedCartCount,
  notificationsOpen,
  handleToggleNotifications,
  unreadNotificationsCount,
  allNotifications,
  openNotificationTarget,
  handleMarkAllNotificationsRead,
  handleDeleteAllNotifications,
  handleDeleteNotification,
  accountMenuOpen,
  handleToggleAccountMenu,
  headerAvatarSrc,
  isPremium,
  workspaceMenus,
  renderWorkspaceAccountSections,
  handleLogout,
  selectedNotification,
  priorityLabel,
  openSelectedNotificationPath,
  setSelectedNotification,
}) {
  return (
    <>
      <div className="nav-auth">
        <button
          type="button"
          className="header-store-cart-btn"
          onClick={() => pushRoute('/loja/carrinho')}
          aria-label={
            combinedCartCount
              ? `Carrinho: ${combinedCartCount} itens (loja + lote fisico se houver)`
              : 'Carrinho'
          }
          title="Carrinho - loja e manga fisico no mesmo lugar; cada tipo tem seu checkout"
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
          {combinedCartCount > 0 ? (
            <span className="header-store-cart-badge">
              {combinedCartCount > 99 ? '99+' : combinedCartCount}
            </span>
          ) : null}
        </button>
        {!usuario ? (
          <>
            {showCreatorsNav ? (
              <button
                type="button"
                className="header-guest-creators"
                onClick={() => pushRoute('/creators')}
              >
                CREATORS
              </button>
            ) : null}
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
          </>
        ) : (
          <div className="user-info-header" title="Notificacoes e menu da conta">
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
                  <span className="header-notification-badge">
                    {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
                  </span>
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
                aria-label={`Menu da conta${isPremium ? ' - Premium' : ''}`}
                aria-expanded={accountMenuOpen}
                title={usuario.displayName || 'Conta'}
              >
                <img
                  src={headerAvatarSrc}
                  alt=""
                  className="header-avatar-img"
                  referrerPolicy="no-referrer"
                  decoding="async"
                  onError={(e) => { e.target.src = AVATAR_FALLBACK; }}
                />
              </button>
              {accountMenuOpen ? (
                <div className="header-account-menu">
                  <button type="button" onClick={() => pushRoute('/perfil')}>
                    Minha conta
                  </button>
                  <button type="button" onClick={() => pushRoute('/pedidos')}>
                    Meus pedidos
                  </button>
                  {workspaceMenus.length ? (
                    <>
                      {renderWorkspaceAccountSections()}
                      <div className="header-account-menu__divider" role="presentation" />
                    </>
                  ) : null}
                  <div className="header-account-menu__divider" role="presentation" />
                  <button type="button" className="header-account-menu__logout" onClick={handleLogout}>
                    Sair
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
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
    </>
  );
}
