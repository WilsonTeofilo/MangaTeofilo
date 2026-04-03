import React, { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { canAccessAdminPath } from '../../auth/adminPermissions';
import AdminLojaPedidos from './AdminLojaPedidos.jsx';
import PrintOnDemandAdmin from './PrintOnDemandAdmin.jsx';
import './AdminPedidosHub.css';

const TAB_LOJA = 'loja';
const TAB_PRODUCAO = 'producao';

export default function AdminPedidosHub({ user, adminAccess }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isMangaka = Boolean(adminAccess?.isMangaka);
  const canProducaoPod = useMemo(
    () => canAccessAdminPath('/admin/orders', adminAccess),
    [adminAccess]
  );

  const rawTab = String(searchParams.get('tab') || '').toLowerCase();
  const tab =
    rawTab === TAB_PRODUCAO && canProducaoPod && !isMangaka ? TAB_PRODUCAO : TAB_LOJA;

  const tabParam = searchParams.get('tab');
  useEffect(() => {
    if ((isMangaka || !canProducaoPod) && tabParam === TAB_PRODUCAO) {
      setSearchParams({}, { replace: true });
    }
  }, [canProducaoPod, isMangaka, setSearchParams, tabParam]);

  function setTab(next) {
    if (next === TAB_LOJA) {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: TAB_PRODUCAO }, { replace: true });
    }
  }

  return (
    <div className="admin-pedidos-hub">
      {canProducaoPod && !isMangaka ? (
        <nav className="admin-pedidos-hub__nav" aria-label="Área de pedidos da loja">
          <div
            className="admin-pedidos-hub__tabs"
            role="tablist"
            aria-label="Escolher vista: pedidos da vitrine ou produção de mangá físico"
          >
            <button
              id="admin-pedidos-hub-tab-loja"
              type="button"
              role="tab"
              aria-selected={tab === TAB_LOJA}
              aria-controls="admin-pedidos-hub-panel-loja"
              tabIndex={tab === TAB_LOJA ? 0 : -1}
              className={`admin-pedidos-hub__tab${tab === TAB_LOJA ? ' is-active' : ''}`}
              onClick={() => setTab(TAB_LOJA)}
              title="Pedidos de produtos vendidos na vitrine: pagamento, envio e repasse"
            >
              Pedidos da loja
            </button>
            <button
              id="admin-pedidos-hub-tab-producao"
              type="button"
              role="tab"
              aria-selected={tab === TAB_PRODUCAO}
              aria-controls="admin-pedidos-hub-panel-producao"
              tabIndex={tab === TAB_PRODUCAO ? 0 : -1}
              className={`admin-pedidos-hub__tab${tab === TAB_PRODUCAO ? ' is-active' : ''}`}
              onClick={() => setTab(TAB_PRODUCAO)}
              title="Fila de print-on-demand: produção e envio de mangá físico"
            >
              Produção (POD)
            </button>
          </div>
        </nav>
      ) : null}

      <div
        id="admin-pedidos-hub-panel-loja"
        className="admin-pedidos-hub__panel"
        role="tabpanel"
        aria-labelledby={canProducaoPod && !isMangaka ? 'admin-pedidos-hub-tab-loja' : undefined}
        hidden={tab !== TAB_LOJA}
        aria-hidden={tab !== TAB_LOJA}
      >
        {tab === TAB_LOJA ? <AdminLojaPedidos user={user} adminAccess={adminAccess} /> : null}
      </div>

      {canProducaoPod && !isMangaka ? (
        <div
          id="admin-pedidos-hub-panel-producao"
          className="admin-pedidos-hub__panel"
          role="tabpanel"
          aria-labelledby="admin-pedidos-hub-tab-producao"
          hidden={tab !== TAB_PRODUCAO}
          aria-hidden={tab !== TAB_PRODUCAO}
        >
          {tab === TAB_PRODUCAO ? <PrintOnDemandAdmin embedded /> : null}
        </div>
      ) : null}
    </div>
  );
}
