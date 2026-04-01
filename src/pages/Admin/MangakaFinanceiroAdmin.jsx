import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onValue, push, ref as dbRef, remove, set } from 'firebase/database';

import { db } from '../../services/firebase';
import './FinanceiroAdmin.css';

function toList(val) {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val).map(([id, row]) => ({ id, ...(row || {}) }));
}

export default function MangakaFinanceiroAdmin({ user }) {
  const navigate = useNavigate();
  const uid = user?.uid;
  const [payments, setPayments] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [titulo, setTitulo] = useState('');
  const [detalhe, setDetalhe] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const base = useMemo(() => (uid ? `creatorData/${uid}` : ''), [uid]);

  useEffect(() => {
    if (!uid || !base) return () => {};
    const unsubs = [
      onValue(dbRef(db, `${base}/payments`), (snap) => {
        setPayments(toList(snap.exists() ? snap.val() : {}));
      }),
      onValue(dbRef(db, `${base}/subscriptions`), (snap) => {
        setSubscriptions(toList(snap.exists() ? snap.val() : {}));
      }),
      onValue(dbRef(db, `${base}/promotions`), (snap) => {
        setPromotions(toList(snap.exists() ? snap.val() : {}));
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid, base]);

  async function adicionarPromocao(e) {
    e.preventDefault();
    if (!uid || !base) return;
    const t = String(titulo || '').trim();
    if (!t) {
      setMsg('Informe um título.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const id = push(dbRef(db, `${base}/promotions`)).key;
      await set(dbRef(db, `${base}/promotions/${id}`), {
        title: t,
        description: String(detalhe || '').trim(),
        creatorId: uid,
        createdAt: Date.now(),
      });
      setTitulo('');
      setDetalhe('');
      setMsg('Promoção salva.');
    } catch (err) {
      setMsg(err?.message || 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function apagarPromo(id) {
    if (!uid || !base || !id) return;
    if (!window.confirm('Remover esta promoção?')) return;
    await remove(dbRef(db, `${base}/promotions/${id}`));
  }

  if (!uid) {
    return (
      <main className="admin-empty-page">
        <p>Faça login.</p>
      </main>
    );
  }

  return (
    <main className="admin-empty-page">
      <section className="admin-empty-card financeiro-card">
        <header className="financeiro-header">
          <div>
            <h1>Meu financeiro</h1>
            <p>
              Pagamentos e assinaturas vinculados ao seu <code>creatorId</code> aparecem aqui quando o backend
              gravar em <code>creatorData / (seu uid) / payments | subscriptions</code>. Promoções próprias você
              cria abaixo.
            </p>
          </div>
          <div className="financeiro-header-actions">
            <button type="button" onClick={() => navigate('/admin/obras')}>
              Minhas obras
            </button>
            <button type="button" onClick={() => navigate('/admin/capitulos')}>
              Capítulos
            </button>
          </div>
        </header>

        {msg ? <p className="financeiro-msg financeiro-msg--ok">{msg}</p> : null}

        <section className="financeiro-migracao">
          <h2>Pagamentos ({payments.length})</h2>
          {!payments.length ? (
            <p className="financeiro-section-hint">Nenhum lançamento ainda.</p>
          ) : (
            <ul className="admin-staff-stack">
              {payments.map((p) => (
                <li key={p.id}>
                  <strong>{p.id.slice(-8)}</strong> — R$ {Number(p.amount || 0).toFixed(2)} · tipo:{' '}
                  <code>{p.type || '—'}</code>
                  {p.orderId ? (
                    <>
                      {' '}
                      · pedido <code>{String(p.orderId).slice(-8)}</code>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="financeiro-migracao">
          <h2>Assinaturas ({subscriptions.length})</h2>
          {!subscriptions.length ? (
            <p className="financeiro-section-hint">Nenhuma assinatura ao criador ainda.</p>
          ) : (
            <ul className="admin-staff-stack">
              {subscriptions.map((s) => (
                <li key={s.id}>
                  <code>{s.userId || '—'}</code> · {s.status || '—'}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="financeiro-migracao">
          <h2>Minhas promoções</h2>
          <form onSubmit={adicionarPromocao} className="financeiro-grid">
            <label className="financeiro-grid-full">
              Título
              <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} />
            </label>
            <label className="financeiro-grid-full">
              Detalhe (opcional)
              <textarea value={detalhe} onChange={(e) => setDetalhe(e.target.value)} rows={3} maxLength={2000} />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Salvando…' : 'Criar promoção'}
            </button>
          </form>
          {promotions.length ? (
            <ul className="admin-staff-stack">
              {promotions.map((pr) => (
                <li key={pr.id}>
                  <strong>{pr.title}</strong>
                  {pr.description ? <p>{pr.description}</p> : null}
                  <button type="button" className="btn-sec" onClick={() => apagarPromo(pr.id)}>
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </section>
    </main>
  );
}
