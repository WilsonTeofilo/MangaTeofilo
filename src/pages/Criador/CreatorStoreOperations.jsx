import React, { useEffect, useMemo, useState } from 'react';
import { equalTo, onValue, orderByChild, query, ref as dbRef, remove, update } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import { formatarDataHoraBr } from '../../utils/datasBr';
import { normalizeStoreStatus } from '../../utils/orderTrackingUi';
import './CreatorFrame.css';

function toList(val) {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val).map(([id, row]) => ({ id, ...(row || {}) }));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function statusLabel(status) {
  const norm = normalizeStoreStatus(status || 'pending');
  if (norm === 'paid') return 'Pago';
  if (norm === 'in_production') return 'Em preparo';
  if (norm === 'shipped') return 'Enviado';
  if (norm === 'delivered') return 'Entregue';
  if (norm === 'cancelled') return 'Cancelado';
  return 'Aguardando pagamento';
}

const ORDER_STATUS_OPTIONS = [
  { id: 'pending', label: 'Aguardando pagamento' },
  { id: 'paid', label: 'Pago' },
  { id: 'in_production', label: 'Em preparo' },
  { id: 'shipped', label: 'Enviado' },
  { id: 'delivered', label: 'Entregue' },
  { id: 'cancelled', label: 'Cancelado' },
];

export default function CreatorStoreOperations({ user }) {
  const navigate = useNavigate();
  const uid = String(user?.uid || '').trim();
  const listVisibleOrders = useMemo(() => httpsCallable(functions, 'creatorListOwnStoreOrders'), []);
  const updateVisibleOrder = useMemo(() => httpsCallable(functions, 'creatorUpdateOwnStoreOrder'), []);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [trackingDrafts, setTrackingDrafts] = useState({});
  const [statusDrafts, setStatusDrafts] = useState({});
  const [feedback, setFeedback] = useState('');
  const [busyOrderId, setBusyOrderId] = useState('');

  useEffect(() => {
    if (!uid) return () => {};
    const creatorProductsQuery = query(dbRef(db, 'loja/produtos'), orderByChild('creatorId'), equalTo(uid));
    const unsubProducts = onValue(creatorProductsQuery, (snap) => {
      const rows = toList(snap.exists() ? snap.val() : {});
      setProducts(rows.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));
    });
    return () => unsubProducts();
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    let active = true;
    listVisibleOrders()
      .then(({ data }) => {
        if (!active) return;
        const rows = Array.isArray(data?.orders) ? data.orders : [];
        const sorted = rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        setOrders(sorted);
        setTrackingDrafts(
          sorted.reduce((acc, row) => {
            acc[row.id] = String(row?.trackingCode || '');
            return acc;
          }, {})
        );
        setStatusDrafts(
          sorted.reduce((acc, row) => {
            acc[row.id] = normalizeStoreStatus(row?.status || 'pending');
            return acc;
          }, {})
        );
      })
      .catch((err) => {
        if (!active) return;
        setOrders([]);
        setFeedback(err?.message || 'Nao foi possivel carregar os pedidos do creator.');
      });
    return () => {
      active = false;
    };
  }, [listVisibleOrders, uid]);

  const metrics = useMemo(() => {
    return {
      activeProducts: products.filter((row) => row?.isActive !== false).length,
      inactiveProducts: products.filter((row) => row?.isActive === false).length,
      lowStock: products.filter((row) => Number(row?.stock || 0) > 0 && Number(row?.stock || 0) <= 3).length,
      noStock: products.filter((row) => Number(row?.stock || 0) <= 0).length,
      openOrders: orders.filter((row) => ['pending', 'paid', 'in_production', 'shipped'].includes(normalizeStoreStatus(row?.status || 'pending'))).length,
      paidVolume: orders.reduce((sum, row) => {
        const status = normalizeStoreStatus(row?.status || 'pending');
        if (!['paid', 'in_production', 'shipped', 'delivered'].includes(status)) return sum;
        return sum + Number(row?.creatorSubtotal || row?.total || 0);
      }, 0),
    };
  }, [orders, products]);

  const lowStockProducts = useMemo(
    () =>
      products
        .filter((row) => Number(row?.stock || 0) <= 3)
        .sort((a, b) => Number(a?.stock || 0) - Number(b?.stock || 0))
        .slice(0, 6),
    [products]
  );

  const recentOrders = useMemo(() => orders.slice(0, 8), [orders]);

  async function handleToggleProduct(product) {
    const id = String(product?.id || '').trim();
    if (!id) return;
    try {
      await update(dbRef(db, `loja/produtos/${id}`), {
        isActive: product?.isActive === false,
        updatedAt: Date.now(),
      });
      setFeedback(product?.isActive === false ? 'Produto reativado.' : 'Produto desativado.');
    } catch (err) {
      setFeedback(err?.message || 'Nao foi possivel atualizar o produto.');
    }
  }

  async function handleDeleteProduct(id) {
    if (!id) return;
    if (!window.confirm('Excluir este produto do seu catalogo?')) return;
    try {
      await remove(dbRef(db, `loja/produtos/${id}`));
      setFeedback('Produto removido do catalogo.');
    } catch (err) {
      setFeedback(err?.message || 'Nao foi possivel excluir o produto.');
    }
  }

  async function handleSaveOrder(orderId) {
    const id = String(orderId || '').trim();
    if (!id) return;
    setBusyOrderId(id);
    setFeedback('');
    try {
      await updateVisibleOrder({
        orderId: id,
        status: String(statusDrafts[id] || 'pending'),
        trackingCode: String(trackingDrafts[id] || '').trim(),
      });
      setOrders((current) =>
        current.map((row) =>
          row.id === id
            ? {
                ...row,
                status: normalizeStoreStatus(statusDrafts[id] || row.status || 'pending'),
                trackingCode: String(trackingDrafts[id] || '').trim(),
                updatedAt: Date.now(),
              }
            : row
        )
      );
      setFeedback('Pedido atualizado no seu workspace.');
    } catch (err) {
      setFeedback(err?.message || 'Nao foi possivel atualizar o pedido.');
    } finally {
      setBusyOrderId('');
    }
  }

  return (
    <>
      <section className="creator-state-card is-store">
        <div>
          <p className="creator-state-card__eyebrow">Operacao da loja do creator</p>
          <h2>Catalogo proprio, pedidos e estoque no seu escopo</h2>
          <p>
            A vitrine global continua na plataforma, mas a operacao do seu catalogo fica aqui:
            pedidos, rastreio e saude do estoque sem cair no painel admin.
          </p>
        </div>
        <div className="creator-frame-actions">
          <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/obras')}>
            Conectar com obras
          </button>
          <button type="button" className="creator-frame-btn is-primary" onClick={() => navigate('/creator/promocoes')}>
            Abrir promocoes
          </button>
        </div>
      </section>

      <section className="creator-metrics-grid">
        <article className="creator-metric-card">
          <span>Produtos ativos</span>
          <strong>{metrics.activeProducts}</strong>
        </article>
        <article className="creator-metric-card">
          <span>Pedidos em andamento</span>
          <strong>{metrics.openOrders}</strong>
        </article>
        <article className="creator-metric-card">
          <span>Estoque critico</span>
          <strong>{metrics.lowStock}</strong>
        </article>
        <article className="creator-metric-card">
          <span>Volume pago / em curso</span>
          <strong>{formatCurrency(metrics.paidVolume)}</strong>
        </article>
      </section>

      <section className="creator-grid-two">
        <article className="creator-panel-card">
          <div className="creator-panel-head">
            <div>
              <p className="creator-frame-eyebrow">Estoque</p>
            </div>
          </div>
          <ul className="creator-data-list">
            <li><span>Produtos ativos</span><strong>{metrics.activeProducts}</strong></li>
            <li><span>Produtos inativos</span><strong>{metrics.inactiveProducts}</strong></li>
            <li><span>Baixo estoque</span><strong>{metrics.lowStock}</strong></li>
            <li><span>Sem estoque</span><strong>{metrics.noStock}</strong></li>
          </ul>
          {!lowStockProducts.length ? (
            <p className="creator-empty-copy">Seu catÃ¡logo nÃ£o tem alerta imediato de estoque.</p>
          ) : (
            <ul className="creator-activity-list">
              {lowStockProducts.map((product) => (
                <li key={product.id}>
                  <div>
                    <strong>{product.title || product.id}</strong>
                    <span>{product.isActive === false ? 'produto inativo' : 'produto visivel'}</span>
                  </div>
                  <div>
                    <strong>{Number(product.stock || 0)} un.</strong>
                    <span>{Number(product.stock || 0) <= 0 ? 'repor agora' : 'estoque curto'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="creator-panel-card">
          <div className="creator-panel-head">
            <div>
              <p className="creator-frame-eyebrow">Catalogo</p>
              <h2>Produtos do creator</h2>
            </div>
          </div>
          {!products.length ? (
            <p className="creator-empty-copy">
              Nenhum produto vinculado ao seu creatorId ainda. Abra o catÃ¡logo completo e crie seu primeiro item.
            </p>
          ) : (
            <ul className="creator-activity-list">
              {products.slice(0, 8).map((product) => (
                <li key={product.id}>
                  <div>
                    <strong>{product.title || product.id}</strong>
                    <span>
                      {formatCurrency(product.isOnSale ? product.promoPrice || product.price : product.price)} Â· estoque{' '}
                      {Number(product.stock || 0)}
                    </span>
                  </div>
                  <div className="creator-inline-actions">
                    <button type="button" className="creator-link-btn" onClick={() => handleToggleProduct(product)}>
                      {product.isActive === false ? 'Reativar' : 'Desativar'}
                    </button>
                    <button type="button" className="creator-link-btn" onClick={() => handleDeleteProduct(product.id)}>
                      Excluir
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="creator-panel-card">
        <div className="creator-panel-head">
          <div>
            <p className="creator-frame-eyebrow">Pedidos</p>
            <h2>Fila de operacao</h2>
          </div>
        </div>
        {feedback ? <p className="creator-inline-feedback">{feedback}</p> : null}
        {!recentOrders.length ? (
          <p className="creator-empty-copy">Nenhum pedido ligado ao seu catalogo ainda.</p>
        ) : (
          <div className="creator-orders-stack">
            {recentOrders.map((order) => (
              <article key={order.id} className="creator-order-card">
                <div className="creator-order-head">
                  <div>
                    <strong>Pedido {String(order.id || '').slice(-8)}</strong>
                    <span>
                      {statusLabel(order.status)} Â· {formatarDataHoraBr(order.createdAt, { seVazio: 'agora' })}
                    </span>
                  </div>
                  <div>
                    <strong>{formatCurrency(order.creatorSubtotal || order.total)}</strong>
                    <span>{order.containsForeignItems ? 'pedido misto' : 'pedido do creator'}</span>
                  </div>
                </div>

                <ul className="creator-order-items">
                  {(Array.isArray(order.items) ? order.items : []).map((item, index) => (
                    <li key={`${order.id}-${index}`}>
                      <span>{item?.title || item?.name || 'Item'}</span>
                      <strong>{Number(item?.qty || item?.quantity || 1)}x</strong>
                    </li>
                  ))}
                </ul>

                {order.containsForeignItems ? (
                  <p className="creator-inline-feedback">
                    Pedido misto: acompanhe a leitura aqui, mas a atualizacao final fica com o admin global.
                  </p>
                ) : (
                  <div className="creator-order-form">
                    <label>
                      Status
                      <select
                        value={statusDrafts[order.id] || 'pending'}
                        onChange={(e) =>
                          setStatusDrafts((current) => ({ ...current, [order.id]: e.target.value }))
                        }
                      >
                        {ORDER_STATUS_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Codigo de rastreio
                      <input
                        value={trackingDrafts[order.id] || ''}
                        onChange={(e) =>
                          setTrackingDrafts((current) => ({ ...current, [order.id]: e.target.value }))
                        }
                        placeholder="Opcional"
                      />
                    </label>
                    <button
                      type="button"
                      className="creator-frame-btn is-primary"
                      disabled={busyOrderId === order.id}
                      onClick={() => handleSaveOrder(order.id)}
                    >
                      {busyOrderId === order.id ? 'Salvando...' : 'Salvar pedido'}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

    </>
  );
}

