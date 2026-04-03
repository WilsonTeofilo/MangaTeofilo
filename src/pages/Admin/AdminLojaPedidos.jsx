import React, { useEffect, useMemo, useState } from 'react';
import { get, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import { formatarDataHoraBr } from '../../utils/datasBr';
import { formatLojaOrderStatusPt, formatLojaPayoutStatusPt } from '../../config/store';
import './AdminLojaPedidos.css';

function orderBelongsToCreator(order, creatorUid) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.some((item) => String(item?.creatorId || '').trim() === creatorUid);
}

function creatorItems(order, creatorUid) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.filter((item) => String(item?.creatorId || '').trim() === creatorUid);
}

function creatorTotal(order, creatorUid) {
  return creatorItems(order, creatorUid).reduce((sum, item) => sum + Number(item?.lineTotal || 0), 0);
}

const CHECK_KEYS = [
  ['printing', 'Imprimir'],
  ['organizing', 'Organizar'],
  ['gluing', 'Colar'],
  ['pressing', 'Prensar'],
  ['cutting', 'Cortar'],
  ['finishing', 'Finalizar'],
];

export default function AdminLojaPedidos({ user, adminAccess }) {
  const navigate = useNavigate();
  const creatorUid = String(user?.uid || '').trim();
  const isMangaka = Boolean(adminAccess?.isMangaka && creatorUid);
  const listVisibleOrders = useMemo(() => httpsCallable(functions, 'adminListVisibleStoreOrders'), []);
  const updateVisibleOrder = useMemo(() => httpsCallable(functions, 'adminUpdateVisibleStoreOrder'), []);
  const [orders, setOrders] = useState([]);
  const [names, setNames] = useState({});
  const [detailId, setDetailId] = useState('');
  const [msg, setMsg] = useState('');
  const [trackingDraft, setTrackingDraft] = useState('');
  const [search, setSearch] = useState('');
  const [checklist, setChecklist] = useState({});

  async function loadOrders() {
    try {
      const { data } = await listVisibleOrders();
      const list = Array.isArray(data?.orders) ? data.orders : [];
      setOrders(list);
    } catch {
      setOrders([]);
      setMsg('Nao foi possivel carregar pedidos.');
    }
  }

  useEffect(() => {
    void loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uids = useMemo(() => [...new Set(orders.map((o) => String(o.uid || '').trim()).filter(Boolean))], [orders]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updates = {};
      for (const uid of uids) {
        try {
          const s = await get(ref(db, `usuarios_publicos/${uid}`));
          updates[uid] = s.exists() ? String(s.val()?.userName || uid) : uid;
        } catch {
          updates[uid] = uid;
        }
      }
      if (!cancelled) setNames((prev) => ({ ...prev, ...updates }));
    })();
    return () => {
      cancelled = true;
    };
  }, [uids]);

  const visibleOrders = useMemo(() => {
    if (!isMangaka) return orders;
    return orders.filter((order) => orderBelongsToCreator(order, creatorUid));
  }, [creatorUid, isMangaka, orders]);

  const detail = useMemo(() => visibleOrders.find((o) => o.id === detailId) || null, [visibleOrders, detailId]);
  const filteredOrders = useMemo(() => {
    const q = String(search || '').trim().toLowerCase();
    if (!q) return visibleOrders;
    return visibleOrders.filter((o) => {
      const bag = [o.id, o.uid, o.paymentId, o.trackingCode, o.codigoRastreio, names[o.uid], o.shippingMethod]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return bag.includes(q);
    });
  }, [visibleOrders, search, names]);

  const detailItems = useMemo(() => {
    if (!detail) return [];
    if (!isMangaka) return Array.isArray(detail.items) ? detail.items : [];
    return creatorItems(detail, creatorUid);
  }, [creatorUid, detail, isMangaka]);

  const detailTemItensDeOutroCriador = useMemo(() => {
    if (!detail || !isMangaka) return false;
    const allItems = Array.isArray(detail.items) ? detail.items : [];
    return allItems.some((item) => String(item?.creatorId || '').trim() !== creatorUid);
  }, [creatorUid, detail, isMangaka]);

  const canMutateDetail = Boolean(detail) && (!isMangaka || !detailTemItensDeOutroCriador);

  const stats = useMemo(() => {
    return filteredOrders.reduce(
      (acc, order) => {
        const total = isMangaka ? creatorTotal(order, creatorUid) : Number(order.total || 0);
        acc.revenue += total;
        if (String(order.status) === 'in_production' || String(order.status) === 'processing') acc.inProduction += 1;
        if (String(order.status) === 'shipped') acc.shipped += 1;
        if (String(order.status) === 'pending_payment' || String(order.status) === 'order_received') acc.pending += 1;
        return acc;
      },
      { revenue: 0, inProduction: 0, shipped: 0, pending: 0 }
    );
  }, [creatorUid, filteredOrders, isMangaka]);

  useEffect(() => {
    if (!detail) return;
    setTrackingDraft(String(detail.trackingCode || detail.codigoRastreio || '').trim());
    setChecklist(detail.productionChecklist && typeof detail.productionChecklist === 'object' ? detail.productionChecklist : {});
  }, [detail]);

  async function setStatus(orderId, status) {
    if (isMangaka && !canMutateDetail) {
      setMsg('Pedido com itens de outros criadores: status global fica com o admin.');
      return;
    }
    setMsg('');
    await updateVisibleOrder({ orderId, status });
    await loadOrders();
    setMsg('Status atualizado.');
    setTimeout(() => setMsg(''), 2400);
  }

  async function saveTracking() {
    if (!detail || !canMutateDetail) return;
    await updateVisibleOrder({ orderId: detail.id, trackingCode: String(trackingDraft || '').trim() });
    await loadOrders();
    setMsg('Rastreio salvo.');
    setTimeout(() => setMsg(''), 2400);
  }

  async function saveChecklist(nextChecklist) {
    if (!detail || !canMutateDetail) return;
    setChecklist(nextChecklist);
    await updateVisibleOrder({ orderId: detail.id, productionChecklist: nextChecklist });
  }

  return (
    <main className="admin-loja-pedidos">
      <header className="admin-loja-pedidos__head">
        <div>
          <h1>{isMangaka ? 'Pedidos dos meus produtos' : 'Operacao da loja'}</h1>
          <p className="admin-loja-pedidos__sub">
            {isMangaka
              ? 'Voce acompanha so a sua parte. Pedido misto fica protegido para o admin geral.'
              : 'Painel operacional para produzir, enviar e liberar repasse sem abrir pagina nova.'}
          </p>
        </div>
        <div className="admin-loja-pedidos__actions">
          <button type="button" onClick={() => navigate('/admin/loja')}>
            Voltar para produtos
          </button>
        </div>
      </header>

      <section className="admin-loja-pedidos__kpis">
        <article><span>Aguardando</span><strong>{stats.pending}</strong></article>
        <article><span>Em producao</span><strong>{stats.inProduction}</strong></article>
        <article><span>Enviados</span><strong>{stats.shipped}</strong></article>
        <article><span>Receita</span><strong>R$ {stats.revenue.toFixed(2)}</strong></article>
      </section>

      {msg ? <p className="admin-loja-pedidos__msg">{msg}</p> : null}
      <div className="admin-loja-pedidos__actions">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pedido, cliente, rastreio ou servico" />
      </div>

      <div className="admin-loja-pedidos__layout">
        <section className="admin-loja-pedidos__list">
          {!filteredOrders.length ? <p className="admin-loja-pedidos__empty">Nenhum pedido.</p> : null}
          {filteredOrders.map((o) => (
            <article key={o.id} className={`admin-loja-pedidos__row ${detailId === o.id ? 'admin-loja-pedidos__row--active' : ''}`}>
              <button type="button" className="admin-loja-pedidos__row-hit" onClick={() => setDetailId(o.id)}>
                <div>
                  <strong>#{o.id.slice(-8).toUpperCase()}</strong>
                  <span className="admin-loja-pedidos__buyer">{names[o.uid] || o.uid}</span>
                  <span className={`admin-loja-pedidos__status admin-loja-pedidos__status--${String(o.status || '').toLowerCase()}`}>{formatLojaOrderStatusPt(o.status)}</span>
                </div>
                <div className="admin-loja-pedidos__row-meta">
                  <span>{formatarDataHoraBr(Number(o.createdAt || 0))}</span>
                  <span>{o.shippingMethod || 'PAC'}</span>
                  <strong>R$ {(isMangaka ? creatorTotal(o, creatorUid) : Number(o.total || 0)).toFixed(2)}</strong>
                </div>
              </button>
            </article>
          ))}
        </section>

        <aside className="admin-loja-pedidos__detail">
          {!detail ? (
            <p className="admin-loja-pedidos__hint">Selecione um pedido para abrir o drawer lateral.</p>
          ) : (
            <>
              <h2>Pedido #{detail.id.slice(-8).toUpperCase()}</h2>
              <p><strong>Cliente:</strong> {names[detail.uid] || detail.uid}</p>
              <p><strong>Status:</strong> {formatLojaOrderStatusPt(detail.status)}</p>
              <p><strong>Repasse:</strong> {formatLojaPayoutStatusPt(detail.payoutStatus)}</p>
              <p><strong>Criado:</strong> {formatarDataHoraBr(Number(detail.createdAt || 0))}</p>
              {detail.shippingAddress ? <p><strong>Endereco:</strong> {detail.shippingAddress.addressLine1}, {detail.shippingAddress.neighborhood} - {detail.shippingAddress.city}/{detail.shippingAddress.state}</p> : null}
              <div className="admin-loja-pedidos__money">
                <div>Subtotal: R$ {(isMangaka ? creatorTotal(detail, creatorUid) : Number(detail.subtotal ?? detail.total ?? 0)).toFixed(2)}</div>
                {!isMangaka ? <div>{detail.shippingMethod || 'PAC'}: R$ {Number(detail.shippingBrl || 0).toFixed(2)}</div> : null}
                {!isMangaka && Number(detail.shippingCostInternal) > 0 ? <div>Custo interno do frete: R$ {Number(detail.shippingCostInternal).toFixed(2)}</div> : null}
                {!isMangaka && Number(detail.shippingDeliveryDays) > 0 ? <div>Prazo estimado: {Number(detail.shippingDeliveryDays)} dias</div> : null}
                <div className="admin-loja-pedidos__total">Total: R$ {(isMangaka ? creatorTotal(detail, creatorUid) : Number(detail.total || 0)).toFixed(2)}</div>
              </div>
              {detailTemItensDeOutroCriador ? <p className="admin-loja-pedidos__hint-small">Pedido misto: leitura liberada, mutacao global bloqueada.</p> : null}
              <h3>Itens</h3>
              <ul className="admin-loja-pedidos__items">
                {detailItems.map((it, i) => (<li key={`${it.productId}-${i}`}>{it.title} x {it.quantity}{it.size ? ` (${it.size})` : ''} - R$ {Number(it.lineTotal || 0).toFixed(2)}</li>))}
              </ul>
              <h3>Producao</h3>
              <div className="admin-loja-pedidos__checklist">
                {CHECK_KEYS.map(([key, label]) => (
                  <label key={key} className="admin-loja-pedidos__checkitem">
                    <input type="checkbox" checked={checklist[key] === true} disabled={!canMutateDetail} onChange={(e) => saveChecklist({ ...checklist, [key]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
              <h3>Envio</h3>
              <div className="admin-loja-pedidos__tracking-row">
                <input type="text" className="admin-loja-pedidos__tracking-input" value={trackingDraft} onChange={(e) => setTrackingDraft(e.target.value)} placeholder="Ex.: AA123456789BR" autoComplete="off" disabled={!canMutateDetail} />
                <button type="button" onClick={() => saveTracking()} disabled={!canMutateDetail}>Salvar rastreio</button>
              </div>
              <h3>Acoes</h3>
              <div className="admin-loja-pedidos__status-btns">
                <button type="button" onClick={() => setStatus(detail.id, 'order_received')} disabled={!canMutateDetail}>Recebido</button>
                <button type="button" onClick={() => setStatus(detail.id, 'in_production')} disabled={!canMutateDetail}>Iniciar producao</button>
                <button type="button" onClick={() => setStatus(detail.id, 'shipped')} disabled={!canMutateDetail}>Marcar como enviado</button>
                <button type="button" onClick={() => setStatus(detail.id, 'delivered')} disabled={!canMutateDetail}>Marcar como entregue</button>
                <button type="button" className="admin-loja-pedidos__btn-cancel" onClick={() => setStatus(detail.id, 'cancelled')} disabled={!canMutateDetail}>Cancelar</button>
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
