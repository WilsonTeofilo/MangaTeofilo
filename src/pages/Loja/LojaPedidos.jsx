import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db } from '../../services/firebase';
import './Loja.css';

function normalizeStatus(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'paid') return 'Pago';
  if (v === 'processing') return 'Em separação';
  if (v === 'shipped') return 'Enviado';
  if (v === 'delivered') return 'Entregue';
  if (v === 'cancelled') return 'Cancelado';
  return 'Pendente';
}

export default function LojaPedidos({ user }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);

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

  const totalSpent = useMemo(
    () => orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.total || 0), 0),
    [orders]
  );

  if (!user?.uid) {
    return (
      <main className="loja-page">
        <section className="loja-empty">
          <h1>Faça login para ver seus pedidos</h1>
          <button type="button" onClick={() => navigate('/login')}>Entrar</button>
        </section>
      </main>
    );
  }

  return (
    <main className="loja-page">
      <header className="loja-head">
        <h1>Meus pedidos</h1>
        <p>Total em produtos: R$ {totalSpent.toFixed(2)}</p>
      </header>
      {!orders.length ? (
        <section className="loja-empty">
          <p>Você ainda não possui pedidos.</p>
        </section>
      ) : (
        <section className="loja-order-list">
          {orders.map((o) => (
            <article key={o.id} className="loja-order-card">
              <div>
                <h3>Pedido #{o.id.slice(-8).toUpperCase()}</h3>
                <p>Status: {normalizeStatus(o.status)}</p>
                <p>Data: {new Date(Number(o.createdAt || Date.now())).toLocaleString('pt-BR')}</p>
              </div>
              <strong>R$ {Number(o.total || 0).toFixed(2)}</strong>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

