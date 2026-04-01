import React, { useEffect, useMemo, useState } from 'react';
import { get, onValue, ref, update } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db } from '../../services/firebase';
import { formatarDataHoraBr } from '../../utils/datasBr';
import { formatLojaOrderStatusPt } from '../../config/store';
import './AdminLojaPedidos.css';

export default function AdminLojaPedidos() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [names, setNames] = useState({});
  const [detailId, setDetailId] = useState('');
  const [msg, setMsg] = useState('');
  const [trackingDraft, setTrackingDraft] = useState('');

  useEffect(() => {
    const unsub = onValue(ref(db, 'loja/pedidos'), (snap) => {
      const list = Object.entries(snap.exists() ? snap.val() : {})
        .map(([id, v]) => ({ id, ...(v || {}) }))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      setOrders(list);
    });
    return () => unsub();
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
      if (!cancelled) {
        setNames((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uids]);

  const detail = useMemo(() => orders.find((o) => o.id === detailId) || null, [orders, detailId]);

  useEffect(() => {
    if (!detail) {
      setTrackingDraft('');
      return;
    }
    setTrackingDraft(String(detail.trackingCode || detail.codigoRastreio || '').trim());
  }, [detail?.id, detail?.trackingCode, detail?.codigoRastreio]);

  async function setStatus(orderId, status) {
    setMsg('');
    await update(ref(db, `loja/pedidos/${orderId}`), { status, updatedAt: Date.now() });
    setMsg('Status atualizado.');
    setTimeout(() => setMsg(''), 2500);
  }

  async function saveTracking() {
    if (!detail) return;
    setMsg('');
    const code = String(trackingDraft || '').trim();
    await update(ref(db, `loja/pedidos/${detail.id}`), { trackingCode: code, updatedAt: Date.now() });
    setMsg('Rastreio salvo.');
    setTimeout(() => setMsg(''), 2500);
  }

  return (
    <main className="admin-loja-pedidos">
      <header className="admin-loja-pedidos__head">
        <div>
          <h1>Pedidos da loja</h1>
          <p className="admin-loja-pedidos__sub">Lista completa, valores e rastreio manual de envio.</p>
        </div>
        <div className="admin-loja-pedidos__actions">
          <button type="button" onClick={() => navigate('/admin/loja')}>
            Voltar à loja (produtos)
          </button>
        </div>
      </header>

      {msg ? <p className="admin-loja-pedidos__msg">{msg}</p> : null}

      <div className="admin-loja-pedidos__layout">
        <section className="admin-loja-pedidos__list">
          {!orders.length ? <p className="admin-loja-pedidos__empty">Nenhum pedido.</p> : null}
          {orders.map((o) => (
            <article
              key={o.id}
              className={`admin-loja-pedidos__row ${detailId === o.id ? 'admin-loja-pedidos__row--active' : ''}`}
            >
              <button type="button" className="admin-loja-pedidos__row-hit" onClick={() => setDetailId(o.id)}>
                <div>
                  <strong>#{o.id.slice(-8).toUpperCase()}</strong>
                  <span className="admin-loja-pedidos__buyer">{names[o.uid] || o.uid}</span>
                  <span className="admin-loja-pedidos__status">{formatLojaOrderStatusPt(o.status)}</span>
                </div>
                <div className="admin-loja-pedidos__row-meta">
                  <span>{formatarDataHoraBr(Number(o.createdAt || Date.now()))}</span>
                  <strong>R$ {Number(o.total || 0).toFixed(2)}</strong>
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
                <strong>Criado:</strong> {formatarDataHoraBr(Number(detail.createdAt || Date.now()))}
              </p>
              {detail.paidAt ? (
                <p>
                  <strong>Pago em:</strong> {formatarDataHoraBr(Number(detail.paidAt))}
                </p>
              ) : null}
              {detail.paymentId ? (
                <p>
                  <strong>MP payment:</strong> <code>{detail.paymentId}</code>
                </p>
              ) : null}
              <div className="admin-loja-pedidos__money">
                <div>Subtotal: R$ {Number(detail.subtotal ?? detail.total ?? 0).toFixed(2)}</div>
                {Number(detail.shippingBrl) > 0 ? <div>Frete: R$ {Number(detail.shippingBrl).toFixed(2)}</div> : null}
                <div className="admin-loja-pedidos__total">Total: R$ {Number(detail.total || 0).toFixed(2)}</div>
                {detail.vipApplied ? <div className="admin-loja-pedidos__vip">Desconto VIP aplicado no checkout</div> : null}
              </div>
              <h3>Itens</h3>
              <ul className="admin-loja-pedidos__items">
                {(Array.isArray(detail.items) ? detail.items : []).map((it, i) => (
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
                />
                <button type="button" onClick={() => saveTracking()}>
                  Salvar rastreio
                </button>
              </div>
              <h3>Alterar status</h3>
              <div className="admin-loja-pedidos__status-btns">
                <button type="button" onClick={() => setStatus(detail.id, 'pending')}>
                  Pendente
                </button>
                <button type="button" onClick={() => setStatus(detail.id, 'paid')}>
                  Confirmado (pago)
                </button>
                <button type="button" onClick={() => setStatus(detail.id, 'processing')}>
                  Em separação
                </button>
                <button type="button" onClick={() => setStatus(detail.id, 'shipped')}>
                  Enviado
                </button>
                <button type="button" onClick={() => setStatus(detail.id, 'delivered')}>
                  Entregue
                </button>
                <button type="button" className="admin-loja-pedidos__btn-cancel" onClick={() => setStatus(detail.id, 'cancelled')}>
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
