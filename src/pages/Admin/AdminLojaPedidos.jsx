import React, { useEffect, useMemo, useState } from 'react';
import { get, onValue, ref, update } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import { formatarDataHoraBr } from '../../utils/datasBr';
import { formatLojaOrderStatusPt } from '../../config/store';
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

  useEffect(() => {
    if (isMangaka) {
      let mounted = true;
      listVisibleOrders()
        .then(({ data }) => {
          if (!mounted) return;
          const list = Array.isArray(data?.orders) ? data.orders : [];
          setOrders(list);
        })
        .catch(() => {
          if (!mounted) return;
          setOrders([]);
          setMsg('Nao foi possivel carregar pedidos visiveis do criador.');
        });
      return () => {
        mounted = false;
      };
    }
    const unsub = onValue(ref(db, 'loja/pedidos'), (snap) => {
      const list = Object.entries(snap.exists() ? snap.val() : {})
        .map(([id, v]) => ({ id, ...(v || {}) }))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      setOrders(list);
    });
    return () => unsub();
  }, [isMangaka, listVisibleOrders]);

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
      if (!cancelled) {
        setNames((prev) => ({ ...prev, ...updates }));
      }
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
      const bag = [
        o.id,
        o.uid,
        o.paymentId,
        o.trackingCode,
        o.codigoRastreio,
        names[o.uid],
      ]
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

  async function setStatus(orderId, status) {
    if (isMangaka && !canMutateDetail) {
      setMsg('Pedido com itens de outros criadores: status global fica com o admin.');
      setTimeout(() => setMsg(''), 3200);
      return;
    }
    setMsg('');
    if (isMangaka) {
      await updateVisibleOrder({ orderId, status });
      setOrders((prev) => prev.map((order) => (order.id === orderId ? { ...order, status, updatedAt: Date.now() } : order)));
    } else {
      await update(ref(db, `loja/pedidos/${orderId}`), { status, updatedAt: Date.now() });
    }
    setMsg('Status atualizado.');
    setTimeout(() => setMsg(''), 2500);
  }

  async function saveTracking() {
    if (!detail) return;
    if (isMangaka && !canMutateDetail) {
      setMsg('Pedido misto: rastreio global fica com o admin.');
      setTimeout(() => setMsg(''), 3200);
      return;
    }
    setMsg('');
    const code = String(trackingDraft || '').trim();
    if (isMangaka) {
      await updateVisibleOrder({ orderId: detail.id, trackingCode: code });
      setOrders((prev) => prev.map((order) => (order.id === detail.id ? { ...order, trackingCode: code, updatedAt: Date.now() } : order)));
    } else {
      await update(ref(db, `loja/pedidos/${detail.id}`), { trackingCode: code, updatedAt: Date.now() });
    }
    setMsg('Rastreio salvo.');
    setTimeout(() => setMsg(''), 2500);
  }

  return (
    <main className="admin-loja-pedidos">
      <header className="admin-loja-pedidos__head">
        <div>
          <h1>{isMangaka ? 'Pedidos dos meus produtos' : 'Pedidos da loja'}</h1>
          <p className="admin-loja-pedidos__sub">
            {isMangaka
              ? 'Voce ve so pedidos com itens seus. Pedidos mistos ficam em modo protegido.'
              : 'Lista completa, valores e rastreio manual de envio.'}
          </p>
        </div>
        <div className="admin-loja-pedidos__actions">
          <button type="button" onClick={() => navigate('/admin/loja')}>
            Voltar à loja (produtos)
          </button>
        </div>
      </header>

      {msg ? <p className="admin-loja-pedidos__msg">{msg}</p> : null}
      <div className="admin-loja-pedidos__actions">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar pedido, UID, MP payment ou cliente"
        />
      </div>

      <div className="admin-loja-pedidos__layout">
        <section className="admin-loja-pedidos__list">
          {!filteredOrders.length ? <p className="admin-loja-pedidos__empty">Nenhum pedido.</p> : null}
          {filteredOrders.map((o) => (
            <article
              key={o.id}
              className={`admin-loja-pedidos__row ${detailId === o.id ? 'admin-loja-pedidos__row--active' : ''}`}
            >
              <button
                type="button"
                className="admin-loja-pedidos__row-hit"
                onClick={() => {
                  setDetailId(o.id);
                  setTrackingDraft(String(o.trackingCode || o.codigoRastreio || '').trim());
                }}
              >
                <div>
                  <strong>#{o.id.slice(-8).toUpperCase()}</strong>
                  <span className="admin-loja-pedidos__buyer">{names[o.uid] || o.uid}</span>
                  <span className="admin-loja-pedidos__status">{formatLojaOrderStatusPt(o.status)}</span>
                </div>
                <div className="admin-loja-pedidos__row-meta">
                  <span>{formatarDataHoraBr(Number(o.createdAt || 0))}</span>
                  <strong>R$ {(isMangaka ? creatorTotal(o, creatorUid) : Number(o.total || 0)).toFixed(2)}</strong>
                </div>
              </button>
            </article>
          ))}
        </section>

        <aside className="admin-loja-pedidos__detail">
          {!detail ? (
            <p className="admin-loja-pedidos__hint">Selecione um pedido para ver detalhes e alterar status.</p>
          ) : (
            <>
              <h2>Pedido #{detail.id.slice(-8).toUpperCase()}</h2>
              <p>
                <strong>Cliente:</strong> {names[detail.uid] || detail.uid}
              </p>
              <p>
                <strong>UID:</strong> <code>{detail.uid}</code>
              </p>
              <p>
                <strong>Status:</strong> {formatLojaOrderStatusPt(detail.status)}
              </p>
              <p>
                <strong>Criado:</strong> {formatarDataHoraBr(Number(detail.createdAt || 0))}
              </p>
              {detail.paidAt ? (
                <p>
                  <strong>Pago em:</strong> {formatarDataHoraBr(Number(detail.paidAt))}
                </p>
              ) : null}
              {detail.refundedAt ? (
                <p>
                  <strong>Estornado em:</strong> {formatarDataHoraBr(Number(detail.refundedAt))}
                </p>
              ) : null}
              {detail.paymentStatus ? (
                <p>
                  <strong>Status MP:</strong> <code>{detail.paymentStatus}</code>
                </p>
              ) : null}
              {detail.paymentId ? (
                <p>
                  <strong>MP payment:</strong> <code>{detail.paymentId}</code>
                </p>
              ) : null}
              <div className="admin-loja-pedidos__money">
                <div>Subtotal: R$ {(isMangaka ? creatorTotal(detail, creatorUid) : Number(detail.subtotal ?? detail.total ?? 0)).toFixed(2)}</div>
                {!isMangaka && Number(detail.shippingBrl) > 0 ? <div>Frete: R$ {Number(detail.shippingBrl).toFixed(2)}</div> : null}
                <div className="admin-loja-pedidos__total">Total: R$ {(isMangaka ? creatorTotal(detail, creatorUid) : Number(detail.total || 0)).toFixed(2)}</div>
                {detail.vipApplied ? <div className="admin-loja-pedidos__vip">Desconto VIP aplicado no checkout</div> : null}
              </div>
              {detailTemItensDeOutroCriador ? (
                <p className="admin-loja-pedidos__hint-small">
                  Este pedido tem itens de outros criadores. Voce ve apenas a sua parte e nao pode alterar o status global.
                </p>
              ) : null}
              <h3>Itens</h3>
              <ul className="admin-loja-pedidos__items">
                {detailItems.map((it, i) => (
                  <li key={`${it.productId}-${i}`}>
                    {it.title} × {it.quantity}
                    {it.size ? ` (${it.size})` : ''} — R$ {Number(it.lineTotal || 0).toFixed(2)}
                  </li>
                ))}
              </ul>
              <h3>Rastreio (Correios)</h3>
              <p className="admin-loja-pedidos__hint-small">Salvo em <code>trackingCode</code> — o cliente vê o link em Meus pedidos.</p>
              <div className="admin-loja-pedidos__tracking-row">
                <input
                  type="text"
                  className="admin-loja-pedidos__tracking-input"
                  value={trackingDraft}
                  onChange={(e) => setTrackingDraft(e.target.value)}
                  placeholder="Ex.: AA123456789BR"
                  autoComplete="off"
                  disabled={!canMutateDetail}
                />
                <button type="button" onClick={() => saveTracking()} disabled={!canMutateDetail}>
                  Salvar rastreio
                </button>
              </div>
              <h3>Alterar status</h3>
              <div className="admin-loja-pedidos__status-btns">
                <button type="button" onClick={() => setStatus(detail.id, 'pending')} disabled={!canMutateDetail}>
                  Pendente
                </button>
                <button type="button" onClick={() => setStatus(detail.id, 'paid')} disabled={!canMutateDetail}>
                  Confirmado (pago)
                </button>
                <button type="button" onClick={() => setStatus(detail.id, 'processing')} disabled={!canMutateDetail}>
                  Em separação
                </button>
                <button type="button" onClick={() => setStatus(detail.id, 'shipped')} disabled={!canMutateDetail}>
                  Enviado
                </button>
                <button type="button" onClick={() => setStatus(detail.id, 'delivered')} disabled={!canMutateDetail}>
                  Entregue
                </button>
                <button type="button" className="admin-loja-pedidos__btn-cancel" onClick={() => setStatus(detail.id, 'cancelled')} disabled={!canMutateDetail}>
                  Cancelado
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
