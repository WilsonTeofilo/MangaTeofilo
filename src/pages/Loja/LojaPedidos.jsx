import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { db } from '../../services/firebase';
import { formatarDataHoraBr } from '../../utils/datasBr';
import {
  correiosRastreamentoUrl,
  formatLojaOrderStatusPt,
  normalizeStoreConfig,
  STORE_DEFAULT_CONFIG,
} from '../../config/store';
import './Loja.css';

export default function LojaPedidos({ user }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [openId, setOpenId] = useState('');

  const mpOk = searchParams.get('mp') === 'ok';

  useEffect(() => {
    const unsub = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user?.uid) return () => {};
    const unsub = onValue(ref(db, 'loja/pedidos'), (snap) => {
      if (!snap.exists()) {
        setOrders([]);
        return;
      }
      const list = Object.entries(snap.val() || {})
        .map(([id, v]) => ({ id, ...(v || {}) }))
        .filter((order) => order.uid === user.uid)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      setOrders(list);
    });
    return () => unsub();
  }, [user?.uid]);

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

  const totalSpent = useMemo(
    () => orders.filter((o) => o.status !== 'cancelled' && o.status !== 'pending').reduce((sum, o) => sum + Number(o.total || 0), 0),
    [orders]
  );

  if (!user?.uid) {
    return (
      <main className="loja-page">
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
    <main className="loja-page">
      <header className="loja-head">
        <div>
          <h1>Meus pedidos</h1>
          <p className="loja-head-sub">Total confirmado: R$ {totalSpent.toFixed(2)}</p>
        </div>
        <button type="button" className="loja-btn-ghost" onClick={() => navigate('/loja')}>
          Loja
        </button>
      </header>

      {mpOk && config.postPurchaseThanks ? (
        <div className="loja-banner loja-banner--ok">{config.postPurchaseThanks}</div>
      ) : mpOk ? (
        <div className="loja-banner loja-banner--ok">Pagamento recebido. Obrigado por apoiar o projeto.</div>
      ) : null}

      {!orders.length ? (
        <section className="loja-empty">
          <p>Você ainda não possui pedidos.</p>
        </section>
      ) : (
        <section className="loja-order-list">
          {orders.map((o) => {
            const items = Array.isArray(o.items) ? o.items : [];
            const expanded = openId === o.id;
            const track = String(o.trackingCode || o.codigoRastreio || '').trim();
            const trackUrl = correiosRastreamentoUrl(track);
            return (
              <article key={o.id} className="loja-order-card">
                <div className="loja-order-card-main">
                  <div>
                    <h3>Pedido #{o.id.slice(-8).toUpperCase()}</h3>
                    <p>Status: {formatLojaOrderStatusPt(o.status)}</p>
                    <p className="loja-order-date">{formatarDataHoraBr(Number(o.createdAt || Date.now()))}</p>
                    {track && trackUrl ? (
                      <p className="loja-order-tracking-inline">
                        <span className="loja-order-tracking-code">Rastreio: {track}</span>
                        <a className="loja-order-correios" href={trackUrl} target="_blank" rel="noopener noreferrer">
                          Rastrear nos Correios
                        </a>
                      </p>
                    ) : null}
                  </div>
                  <div className="loja-order-card-right">
                    <strong>R$ {Number(o.total || 0).toFixed(2)}</strong>
                    <button type="button" className="loja-btn-ghost loja-btn-small" onClick={() => setOpenId(expanded ? '' : o.id)}>
                      {expanded ? 'Fechar' : 'Detalhes'}
                    </button>
                  </div>
                </div>
                {expanded ? (
                  <div className="loja-order-detail">
                    {track && trackUrl ? (
                      <div className="loja-order-tracking-block">
                        <p>
                          <strong>Código de rastreio:</strong> <code>{track}</code>
                        </p>
                        <a className="loja-btn-ghost loja-btn-small" href={trackUrl} target="_blank" rel="noopener noreferrer">
                          Abrir rastreio nos Correios
                        </a>
                      </div>
                    ) : null}
                    {Number(o.subtotal) > 0 || Number(o.shippingBrl) > 0 ? (
                      <p className="loja-order-lines-meta">
                        Subtotal R$ {Number(o.subtotal ?? o.total).toFixed(2)}
                        {Number(o.shippingBrl) > 0 ? ` · Frete R$ ${Number(o.shippingBrl).toFixed(2)}` : ''}
                      </p>
                    ) : null}
                    <ul>
                      {items.map((it, idx) => (
                        <li key={`${it.productId}-${idx}`}>
                          {it.title || it.productId} × {it.quantity}
                          {it.size ? ` (${it.size})` : ''} — R$ {Number(it.lineTotal || 0).toFixed(2)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
