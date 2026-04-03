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
        <div className="admin-pedidos-hub__tabs" role="tablist" aria-label="Pedidos">
          <button
            type="button"
            role="tab"
            aria-selected={tab === TAB_LOJA}
            className={`admin-pedidos-hub__tab${tab === TAB_LOJA ? ' is-active' : ''}`}
            onClick={() => setTab(TAB_LOJA)}
          >
            Pedidos da loja
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === TAB_PRODUCAO}
            className={`admin-pedidos-hub__tab${tab === TAB_PRODUCAO ? ' is-active' : ''}`}
            onClick={() => setTab(TAB_PRODUCAO)}
          >
            Produção
          </button>
        </div>
      ) : null}

      <div
        className="admin-pedidos-hub__panel"
        role="tabpanel"
        hidden={tab !== TAB_LOJA}
        aria-hidden={tab !== TAB_LOJA}
      >
        {tab === TAB_LOJA ? <AdminLojaPedidos user={user} adminAccess={adminAccess} /> : null}
      </div>

      {canProducaoPod && !isMangaka ? (
        <div
          className="admin-pedidos-hub__panel"
          role="tabpanel"
          hidden={tab !== TAB_PRODUCAO}
          aria-hidden={tab !== TAB_PRODUCAO}
        >
          {tab === TAB_PRODUCAO ? <PrintOnDemandAdmin embedded /> : null}
        </div>
      ) : null}
    </div>
  );
}
