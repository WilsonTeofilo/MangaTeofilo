import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { onValue, ref } from 'firebase/database';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import PodOrderCard from '../../components/orders/PodOrderCard';
import StoreOrderCard from '../../components/orders/StoreOrderCard';
import { db, functions } from '../../services/firebase';
import {
  ORDER_FILTER_OPTIONS,
  podOrderFilterBucket,
  podOrderMatchesSearch,
  storeOrderFilterBucket,
  storeOrderMatchesSearch,
  normalizeStoreStatus,
} from '../../utils/orderTrackingUi';
import { normalizeStoreConfig, STORE_DEFAULT_CONFIG } from '../../config/store';
import './Loja.css';
import './MeusPedidosHub.css';

const listMyStoreOrders = httpsCallable(functions, 'listMyStoreOrders');
const listMyPrintOnDemandOrders = httpsCallable(functions, 'listMyPrintOnDemandOrders');
const listVisibleStoreOrders = httpsCallable(functions, 'adminListVisibleStoreOrders');

const TAB_COMPRAS = 'compras';
const TAB_VENDAS = 'vendas';
const TAB_FISICO = 'fisico';

/**
 * Pedidos unificados: compras (loja), vendas do criador, mangá físico.
 * @param {{ user: import('firebase/auth').User | null, showCreatorSalesTab?: boolean }} props
 */
export default function MeusPedidosHub({ user, showCreatorSalesTab = false }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [storeOrders, setStoreOrders] = useState([]);
  const [sellerOrders, setSellerOrders] = useState([]);
  const [podOrders, setPodOrders] = useState([]);
  const [podLoading, setPodLoading] = useState(false);
  const [sellerLoading, setSellerLoading] = useState(false);
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [productImages, setProductImages] = useState({});
  const [searchDraft, setSearchDraft] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const mpOk = searchParams.get('mp') === 'ok';
  const tabParam = String(searchParams.get('tab') || '').trim().toLowerCase();

  const activeTab = useMemo(() => {
    if (tabParam === TAB_FISICO) return TAB_FISICO;
    if (tabParam === TAB_VENDAS && showCreatorSalesTab) return TAB_VENDAS;
    if (tabParam === 'loja') return TAB_COMPRAS;
    if (tabParam === TAB_COMPRAS) return TAB_COMPRAS;
    return TAB_COMPRAS;
  }, [tabParam, showCreatorSalesTab]);

  const setActiveTab = useCallback(
    (next) => {
      const t =
        next === TAB_FISICO ? TAB_FISICO : next === TAB_VENDAS && showCreatorSalesTab ? TAB_VENDAS : TAB_COMPRAS;
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set('tab', t);
          return n;
        },
        { replace: true }
      );
    },
    [setSearchParams, showCreatorSalesTab]
  );

  useEffect(() => {
    if (tabParam === TAB_VENDAS && !showCreatorSalesTab) {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set('tab', TAB_COMPRAS);
          return n;
        },
        { replace: true }
      );
    }
  }, [tabParam, showCreatorSalesTab, setSearchParams]);

  useEffect(() => {
    const unsub = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(db, 'loja/produtos'), (snap) => {
      const raw = snap.exists() ? snap.val() : {};
      const map = {};
      Object.entries(raw).forEach(([pid, p]) => {
        const imgs = Array.isArray(p?.images) ? p.images : [];
        const u = String(imgs[0] || '').trim();
        if (u) map[pid] = u;
      });
      setProductImages(map);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let active = true;
    async function loadStore() {
      if (!user?.uid) {
        setStoreOrders([]);
        return;
      }
      try {
        const { data } = await listMyStoreOrders();
        if (!active) return;
        const list = Array.isArray(data?.orders) ? data.orders : [];
        setStoreOrders(list);
      } catch {
        if (active) setStoreOrders([]);
      }
    }
    loadStore();
    return () => {
      active = false;
    };
  }, [user?.uid, mpOk]);

  const loadSeller = useCallback(async () => {
    if (!user?.uid || !showCreatorSalesTab) {
      setSellerOrders([]);
      return;
    }
    setSellerLoading(true);
    try {
      const { data } = await listVisibleStoreOrders();
      setSellerOrders(Array.isArray(data?.orders) ? data.orders : []);
    } catch {
      setSellerOrders([]);
    } finally {
      setSellerLoading(false);
    }
  }, [user?.uid, showCreatorSalesTab]);

  useEffect(() => {
    if (activeTab === TAB_VENDAS) loadSeller();
  }, [activeTab, loadSeller]);

  const loadPod = useCallback(async () => {
    if (!user?.uid) {
      setPodOrders([]);
      return;
    }
    setPodLoading(true);
    try {
      const { data } = await listMyPrintOnDemandOrders();
      setPodOrders(Array.isArray(data?.orders) ? data.orders : []);
    } catch {
      setPodOrders([]);
    } finally {
      setPodLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (activeTab === TAB_FISICO) loadPod();
  }, [activeTab, loadPod]);

  useEffect(() => {
    if (!mpOk) return undefined;
    const t = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('mp');
          return next;
        },
        { replace: true }
      );
    }, 8000);
    return () => clearTimeout(t);
  }, [mpOk, setSearchParams]);

  const q = searchDraft.trim().toLowerCase();
  const filter = statusFilter;

  const filteredStoreOrders = useMemo(() => {
    return storeOrders.filter((o) => {
      if (!storeOrderMatchesSearch(o, q)) return false;
      if (filter === 'all') return true;
      return storeOrderFilterBucket(o) === filter;
    });
  }, [storeOrders, q, filter]);

  const filteredSellerOrders = useMemo(() => {
    return sellerOrders.filter((o) => {
      if (!storeOrderMatchesSearch(o, q)) return false;
      if (filter === 'all') return true;
      return storeOrderFilterBucket(o) === filter;
    });
  }, [sellerOrders, q, filter]);

  const filteredPodOrders = useMemo(() => {
    return podOrders.filter((o) => {
      if (!podOrderMatchesSearch(o, q)) return false;
      if (filter === 'all') return true;
      return podOrderFilterBucket(o) === filter;
    });
  }, [podOrders, q, filter]);

  const totalSpent = useMemo(
    () =>
      storeOrders
        .filter((o) => {
          const status = normalizeStoreStatus(o?.status);
          return status !== 'cancelled' && status !== 'pending';
        })
        .reduce((sum, o) => sum + Number(o.total || 0), 0),
    [storeOrders]
  );

  const mangakaPodPath = '/print-on-demand?ctx=creator';

  if (!user?.uid) {
    return (
      <main className="loja-page meus-pedidos-hub">
        <section className="loja-empty">
          <h1>Faça login para ver seus pedidos</h1>
          <button type="button" onClick={() => navigate('/login')}>
            Entrar
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="loja-page meus-pedidos-hub">
      <header className="loja-head meus-pedidos-hub__head">
        <div>
          <h1>Pedidos</h1>
          <p className="loja-head-sub">Compras, vendas do seu catálogo e mangá físico num só lugar.</p>
        </div>
        <button type="button" className="loja-btn-ghost" onClick={() => navigate('/loja')}>
          Loja
        </button>
      </header>

      <nav className="meus-pedidos-tabs" aria-label="Tipo de pedido">
        <button
          type="button"
          className={`meus-pedidos-tab ${activeTab === TAB_COMPRAS ? 'is-active' : ''}`}
          onClick={() => setActiveTab(TAB_COMPRAS)}
        >
          Minhas compras
          {storeOrders.length > 0 ? <span className="meus-pedidos-tab__count">{storeOrders.length}</span> : null}
        </button>
        {showCreatorSalesTab ? (
          <button
            type="button"
            className={`meus-pedidos-tab ${activeTab === TAB_VENDAS ? 'is-active' : ''}`}
            onClick={() => setActiveTab(TAB_VENDAS)}
          >
            Pedidos dos meus produtos
            {sellerOrders.length > 0 ? <span className="meus-pedidos-tab__count">{sellerOrders.length}</span> : null}
          </button>
        ) : null}
        <button
          type="button"
          className={`meus-pedidos-tab ${activeTab === TAB_FISICO ? 'is-active' : ''}`}
          onClick={() => setActiveTab(TAB_FISICO)}
        >
          Mangá físico
          {podOrders.length > 0 ? <span className="meus-pedidos-tab__count">{podOrders.length}</span> : null}
        </button>
      </nav>

      <div className="meus-pedidos-toolbar">
        <label className="meus-pedidos-toolbar__search">
          <span className="visually-hidden">Buscar por ID ou nome do produto</span>
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Buscar por ID do pedido ou nome do produto"
            autoComplete="off"
          />
        </label>
        <label className="meus-pedidos-toolbar__filter">
          <span className="visually-hidden">Filtrar por status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {ORDER_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {activeTab === TAB_COMPRAS ? (
        <>
          {mpOk && config.postPurchaseThanks ? (
            <div className="loja-banner loja-banner--ok">{config.postPurchaseThanks}</div>
          ) : mpOk ? (
            <div className="loja-banner loja-banner--ok">Pagamento recebido. Obrigado por apoiar o projeto.</div>
          ) : null}

          <p className="meus-pedidos-tab-desc">
            Compras na vitrine. Total pago (pedidos confirmados):{' '}
            <strong>{totalSpent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
          </p>

          {!filteredStoreOrders.length ? (
            <section className="loja-empty">
              <p>{storeOrders.length ? 'Nenhum pedido combina com a busca ou filtro.' : 'Você ainda não possui pedidos na loja.'}</p>
              <Link className="meus-pedidos-cta" to="/loja">
                Ver vitrine
              </Link>
            </section>
          ) : (
            <section className="meus-pedidos-ot-list" aria-label="Lista de compras">
              {filteredStoreOrders.map((o) => (
                <StoreOrderCard key={o.id} order={o} productImages={productImages} perspective="buyer" />
              ))}
            </section>
          )}
        </>
      ) : null}

      {activeTab === TAB_VENDAS && showCreatorSalesTab ? (
        <>
          <p className="meus-pedidos-tab-desc">
            Pedidos que incluem produtos do seu catálogo. Atualize rastreio e status no{' '}
            <Link to="/creator">painel do creator</Link> quando o pedido for só seu; pedidos mistos seguem com a equipe.
          </p>
          {sellerLoading ? (
            <p className="meus-pedidos-loading" role="status">
              Carregando vendas…
            </p>
          ) : !filteredSellerOrders.length ? (
            <section className="loja-empty">
              <p>{sellerOrders.length ? 'Nenhum pedido combina com a busca ou filtro.' : 'Ainda não há vendas do seu catálogo.'}</p>
              <Link className="meus-pedidos-cta meus-pedidos-cta--ghost" to="/creator">
                Ir ao painel do creator
              </Link>
            </section>
          ) : (
            <section className="meus-pedidos-ot-list" aria-label="Pedidos dos seus produtos">
              {filteredSellerOrders.map((o) => (
                <StoreOrderCard key={o.id} order={o} productImages={productImages} perspective="seller" />
              ))}
            </section>
          )}
        </>
      ) : null}

      {activeTab === TAB_FISICO ? (
        <>
          <p className="meus-pedidos-tab-desc">
            Lotes de mangá físico. Criadores acompanham após enviar arquivos em{' '}
            <Link to={mangakaPodPath}>Lance sua linha</Link>.
          </p>
          {podLoading ? (
            <p className="meus-pedidos-loading" role="status">
              Carregando pedidos físicos…
            </p>
          ) : !filteredPodOrders.length ? (
            <section className="loja-empty">
              <p>{podOrders.length ? 'Nenhum pedido combina com a busca ou filtro.' : 'Você ainda não tem pedidos de mangá físico.'}</p>
              <Link className="meus-pedidos-cta" to={mangakaPodPath}>
                Fazer um pedido
              </Link>
            </section>
          ) : (
            <section className="meus-pedidos-ot-list" aria-label="Pedidos de mangá físico">
              {filteredPodOrders.map((o) => (
                <PodOrderCard key={o.id} order={o} newOrderPath={mangakaPodPath} onPaymentLinkReady={loadPod} />
              ))}
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}
