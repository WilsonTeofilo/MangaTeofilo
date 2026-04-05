import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { onValue, ref, remove, update } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../services/firebase';
import {
  normalizeProductCategory,
  STORE_CATEGORY_LABELS,
} from '../../config/store';
import { normalizeStoreStatus } from '../../utils/orderTrackingUi';
import {
  creatorOrderTotal,
  formatBRL,
  INVENTORY_MODE,
  orderBelongsToCreator,
} from './lojaAdminShared';
import './LojaAdmin.css';
import './StoreAdminLayout.css';

export default function LojaProductsListAdmin({ user, adminAccess, workspace = 'admin' }) {
  const navigate = useNavigate();
  const creatorUid = String(user?.uid || '').trim();
  const isMangaka = Boolean(adminAccess?.isMangaka && creatorUid);
  const isCreatorWorkspace = workspace === 'creator';
  const ordersPath = isCreatorWorkspace ? '/pedidos?tab=loja' : '/admin/pedidos';
  const productsBase = isCreatorWorkspace ? '/creator/loja/produtos' : '/admin/products';
  const settingsPath = '/admin/store/settings';

  const listVisibleOrders = useMemo(() => httpsCallable(functions, 'adminListVisibleStoreOrders'), []);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    const unsubProducts = onValue(ref(db, 'loja/produtos'), (snap) => {
      const list = Object.entries(snap.exists() ? snap.val() : {}).map(([id, v]) => ({ id, ...(v || {}) }));
      setProducts(list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));
    });
    let unsubOrders = () => {};
    if (isMangaka) {
      listVisibleOrders()
        .then(({ data }) => {
          const list = Array.isArray(data?.orders) ? data.orders : [];
          setOrders(list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)));
        })
        .catch(() => setOrders([]));
    } else {
      unsubOrders = onValue(ref(db, 'loja/pedidos'), (snap) => {
        const list = Object.entries(snap.exists() ? snap.val() : {}).map(([id, v]) => ({ id, ...(v || {}) }));
        setOrders(list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)));
      });
    }
    return () => {
      unsubProducts();
      unsubOrders();
    };
  }, [isMangaka, listVisibleOrders]);

  const visibleProducts = useMemo(() => {
    if (!isMangaka) return products;
    return products.filter((product) => String(product?.creatorId || '').trim() === creatorUid);
  }, [creatorUid, isMangaka, products]);

  const visibleOrders = useMemo(() => {
    if (!isMangaka) return orders;
    return orders.filter((order) => orderBelongsToCreator(order, creatorUid));
  }, [creatorUid, isMangaka, orders]);

  const totals = useMemo(() => {
    return visibleOrders.reduce(
      (acc, order) => {
        const totalBase = isMangaka ? creatorOrderTotal(order, creatorUid) : Number(order.total || 0);
        const status = normalizeStoreStatus(order.status);
        acc.total += totalBase;
        if (
          status === 'paid' ||
          status === 'in_production' ||
          status === 'shipped' ||
          status === 'delivered'
        ) {
          acc.paid += totalBase;
        }
        if (status === 'pending') acc.pending += 1;
        return acc;
      },
      { total: 0, paid: 0, pending: 0 }
    );
  }, [creatorUid, isMangaka, visibleOrders]);

  const createPath = isCreatorWorkspace ? `${productsBase}/criar` : `${productsBase}/create`;

  return (
    <main className="loja-admin-page">
      <header className="loja-admin-head">
        <div>
          <h1>{isMangaka ? 'Loja do criador' : 'Catálogo da loja'}</h1>
          {isMangaka ? (
            <p>Produtos do seu creatorId, pedidos filtrados e resumo de volume.</p>
          ) : (
            <p>Lista, criação e configuração global em telas separadas.</p>
          )}
        </div>
        <button type="button" className="loja-admin-link-pedidos" onClick={() => navigate(ordersPath)}>
          {isMangaka ? 'Pedidos →' : 'Pedidos da loja →'}
        </button>
      </header>

      <nav className="store-admin-subnav" aria-label="Seções da loja">
        <NavLink to={productsBase} end className={({ isActive }) => (isActive ? 'is-active' : '')}>
          Produtos
        </NavLink>
        <NavLink to={createPath}>Novo produto</NavLink>
        {!isMangaka ? (
          <NavLink to={settingsPath}>Configuração global</NavLink>
        ) : null}
      </nav>

      <section className="loja-admin-kpis">
        <article>
          <span>Pedidos aguardando pagamento</span>
          <strong>{totals.pending}</strong>
        </article>
        <article>
          <span>Volume (todos)</span>
          <strong>R$ {totals.total.toFixed(2)}</strong>
        </article>
        <article>
          <span>Volume pago / em curso</span>
          <strong>R$ {totals.paid.toFixed(2)}</strong>
        </article>
      </section>

      <section className="loja-admin-card loja-admin-card--wide">
        <h2>{isMangaka ? 'Seus produtos' : 'Produtos cadastrados'}</h2>
        <div className="loja-admin-list loja-admin-list--products">
          {!visibleProducts.length ? <p className="loja-admin-hint">Nenhum produto ainda.</p> : null}
          {visibleProducts.map((p) => {
            const img = (Array.isArray(p.images) && p.images[0]) || '/assets/fotos/shito.jpg';
            const cat = normalizeProductCategory(p);
            const basePrice = p.isOnSale === true && Number(p.promoPrice || 0) > 0 ? Number(p.promoPrice || 0) : Number(p.price || 0);
            const profit = basePrice - Number(p.costPrice || 0);
            const editPath = isCreatorWorkspace ? `${productsBase}/${p.id}/editar` : `${productsBase}/${p.id}/edit`;
            return (
              <article key={p.id}>
                <img src={img} alt="" className="loja-admin-thumb" />
                <div>
                  <strong>{p.title}</strong>
                  <span>
                    {formatBRL(basePrice)} · custo {formatBRL(p.costPrice || 0)} · lucro {formatBRL(profit)} · peso{' '}
                    {Number(p.weightGrams || 0)} g
                  </span>
                  <span>
                    {String(p.inventoryMode || '') === INVENTORY_MODE.ON_DEMAND ? 'sob demanda' : `estoque ${Number(p.stock || 0)}`} ·{' '}
                    {STORE_CATEGORY_LABELS[cat] || cat} · {p.isActive === false ? 'inativo' : 'ativo'}
                  </span>
                </div>
                <div>
                  <button type="button" onClick={() => navigate(editPath)}>
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => update(ref(db, `loja/produtos/${p.id}`), { isActive: false, updatedAt: Date.now() })}
                  >
                    Desativar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Excluir este produto?')) remove(ref(db, `loja/produtos/${p.id}`));
                    }}
                  >
                    Excluir
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
