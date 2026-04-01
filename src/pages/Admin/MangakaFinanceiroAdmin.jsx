import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onValue, push, ref as dbRef, remove, set } from 'firebase/database';

import { db } from '../../services/firebase';
import { formatarDataHoraBr } from '../../utils/datasBr';
import './FinanceiroAdmin.css';

function toList(val) {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val).map(([id, row]) => ({ id, ...(row || {}) }));
}

const PERIODOS = [
  { id: '30', label: '30 dias' },
  { id: '90', label: '90 dias' },
  { id: 'all', label: 'Tudo' },
];

function msCutoff(periodId) {
  if (periodId === 'all') return 0;
  const dias = periodId === '30' ? 30 : 90;
  return Date.now() - dias * 24 * 60 * 60 * 1000;
}

function filtrarPorPeriodo(rows, periodId) {
  const corte = msCutoff(periodId);
  if (!corte) return rows;
  return rows.filter((r) => (Number(r.createdAt) || 0) >= corte);
}

function totaisPorTipo(rows) {
  const map = {};
  for (const r of rows) {
    const t = String(r.type || 'outro');
    map[t] = (map[t] || 0) + Number(r.amount || 0);
  }
  return map;
}

function resumoAssinaturas(rows) {
  const porUsuario = new Map();
  for (const row of rows) {
    const userId = String(row.userId || '').trim();
    if (!userId) continue;
    const atual = porUsuario.get(userId) || {
      userId,
      totalSpent: 0,
      count: 0,
      lastAt: 0,
      memberUntil: 0,
      status: 'inativo',
      type: '',
    };
    atual.totalSpent += Number(row.amount || 0);
    atual.count += 1;
    atual.lastAt = Math.max(atual.lastAt, Number(row.createdAt || 0));
    atual.memberUntil = Math.max(atual.memberUntil, Number(row.memberUntil || 0));
    atual.type = String(row.type || atual.type || '');
    atual.status = atual.memberUntil > Date.now() ? 'ativo' : 'expirado';
    porUsuario.set(userId, atual);
  }
  return [...porUsuario.values()].sort((a, b) => b.lastAt - a.lastAt);
}

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers.join(';'), ...rows.map((row) => row.map(escapeCsv).join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MangakaFinanceiroAdmin({ user, workspace = 'admin' }) {
  const navigate = useNavigate();
  const uid = user?.uid;
  const obrasPath = workspace === 'creator' ? '/creator/obras' : '/admin/obras';
  const capitulosPath = workspace === 'creator' ? '/creator/capitulos' : '/admin/capitulos';
  const isCreatorWorkspace = workspace === 'creator';
  const [payments, setPayments] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [titulo, setTitulo] = useState('');
  const [detalhe, setDetalhe] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [periodo, setPeriodo] = useState('30');
  const [tipoFiltro, setTipoFiltro] = useState('todos');
  const [busca, setBusca] = useState('');

  const base = useMemo(() => (uid ? `creatorData/${uid}` : ''), [uid]);

  const paymentsNoPeriodo = useMemo(() => filtrarPorPeriodo(payments, periodo), [payments, periodo]);
  const subsNoPeriodo = useMemo(() => filtrarPorPeriodo(subscriptions, periodo), [subscriptions, periodo]);
  const buscaNorm = String(busca || '').trim().toLowerCase();
  const pagamentosFiltrados = useMemo(() => {
    return paymentsNoPeriodo.filter((p) => {
      if (tipoFiltro !== 'todos' && String(p.type || 'outro') !== tipoFiltro) return false;
      if (!buscaNorm) return true;
      const bag = [p.paymentId, p.orderId, p.type, p.currency, p.buyerUid, p.note]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return bag.includes(buscaNorm);
    });
  }, [paymentsNoPeriodo, tipoFiltro, buscaNorm]);

  const totalPagamentosPeriodo = useMemo(
    () => pagamentosFiltrados.reduce((acc, p) => acc + Number(p.amount || 0), 0),
    [pagamentosFiltrados]
  );
  const porTipo = useMemo(() => totaisPorTipo(pagamentosFiltrados), [pagamentosFiltrados]);
  const tiposDisponiveis = useMemo(
    () => ['todos', ...new Set(payments.map((p) => String(p.type || 'outro')))],
    [payments]
  );
  const assinaturasResumo = useMemo(() => resumoAssinaturas(subscriptions), [subscriptions]);
  const assinaturasAtivas = useMemo(
    () => assinaturasResumo.filter((row) => row.status === 'ativo'),
    [assinaturasResumo]
  );
  const receitaMembership = useMemo(
    () => payments.filter((p) => String(p.type || '') === 'creator_membership').reduce((acc, p) => acc + Number(p.amount || 0), 0),
    [payments]
  );
  const receitaApoio = useMemo(
    () => payments.filter((p) => String(p.type || '') === 'apoio').reduce((acc, p) => acc + Number(p.amount || 0), 0),
    [payments]
  );
  const receitaLoja = useMemo(
    () => payments.filter((p) => String(p.type || '') === 'loja').reduce((acc, p) => acc + Number(p.amount || 0), 0),
    [payments]
  );

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
      setMsg('Informe um titulo.');
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
      setMsg('Promocao salva.');
    } catch (err) {
      setMsg(err?.message || 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function apagarPromo(id) {
    if (!uid || !base || !id) return;
    if (!window.confirm('Remover esta promocao?')) return;
    await remove(dbRef(db, `${base}/promotions/${id}`));
  }

  function exportarPagamentosCsv() {
    downloadCsv(
      `creator-payments-${uid || 'mangaka'}.csv`,
      ['createdAt', 'type', 'status', 'amount', 'currency', 'paymentId', 'orderId', 'buyerUid'],
      pagamentosFiltrados.map((p) => [
        formatarDataHoraBr(p.createdAt),
        p.type || 'outro',
        p.status || 'approved',
        Number(p.amount || 0).toFixed(2),
        p.currency || 'BRL',
        p.paymentId || '',
        p.orderId || '',
        p.buyerUid || '',
      ])
    );
  }

  function exportarAssinaturasCsv() {
    downloadCsv(
      `creator-subscriptions-${uid || 'mangaka'}.csv`,
      ['createdAt', 'type', 'status', 'amount', 'paymentId', 'userId', 'memberUntil'],
      subsNoPeriodo.map((s) => [
        formatarDataHoraBr(s.createdAt),
        s.type || '',
        s.status || 'approved',
        Number(s.amount || 0).toFixed(2),
        s.paymentId || '',
        s.userId || '',
        formatarDataHoraBr(s.memberUntil),
      ])
    );
  }

  if (!uid) {
    return (
      <main className="admin-empty-page">
        <p>Faca login.</p>
      </main>
    );
  }

  return (
    <main className="admin-empty-page">
      <section className="admin-empty-card financeiro-card">
        <header className="financeiro-header">
          <div>
            <h1>{workspace === 'creator' ? 'Monetizacao do criador' : 'Meu financeiro'}</h1>
            <p>
              Pagamentos e assinaturas vinculados ao seu <code>creatorId</code> aparecem aqui quando o backend
              gravar em <code>creatorData / (seu uid) / payments | subscriptions</code>.
            </p>
            <p>
              {isCreatorWorkspace
                ? 'Veja membership, apoios, promocoes e operacao da sua receita sem depender do admin.'
                : 'Agora o painel separa membership do criador, apoios e loja, para voce operar a propria receita com mais clareza.'}
            </p>
          </div>
          <div className="financeiro-header-actions">
            <button type="button" onClick={() => navigate(obrasPath)}>
              Minhas obras
            </button>
            <button type="button" onClick={() => navigate(capitulosPath)}>
              Capitulos
            </button>
          </div>
        </header>

        {msg ? <p className="financeiro-msg financeiro-msg--ok">{msg}</p> : null}

        <div className="financeiro-tabs" role="group" aria-label="Periodo do resumo">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={periodo === p.id ? 'active' : ''}
              onClick={() => setPeriodo(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <section className="financeiro-migracao">
          <h2>{isCreatorWorkspace ? 'Visao geral da sua receita' : 'Resumo no periodo'}</h2>
          <p className="financeiro-section-hint">
            Pagamentos no filtro: <strong>{pagamentosFiltrados.length}</strong> de {payments.length} • Total:{' '}
            <strong>R$ {totalPagamentosPeriodo.toFixed(2)}</strong>
          </p>
          {Object.keys(porTipo).length ? (
            <ul className="admin-staff-stack">
              {Object.entries(porTipo).map(([tipo, valor]) => (
                <li key={tipo}>
                  <code>{tipo}</code>: R$ {Number(valor).toFixed(2)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="financeiro-section-hint">Sem valores de pagamento neste periodo.</p>
          )}
          <p className="financeiro-section-hint" style={{ marginTop: 12 }}>
            Assinaturas no filtro: <strong>{subsNoPeriodo.length}</strong> de {subscriptions.length}
          </p>
          <ul className="admin-staff-stack" style={{ marginTop: 12 }}>
            <li>Membership do criador: <strong>R$ {receitaMembership.toFixed(2)}</strong></li>
            <li>Apoios e doacoes: <strong>R$ {receitaApoio.toFixed(2)}</strong></li>
            <li>Loja: <strong>R$ {receitaLoja.toFixed(2)}</strong></li>
            <li>Assinantes ativos agora: <strong>{assinaturasAtivas.length}</strong></li>
          </ul>
        </section>

        <section className="financeiro-migracao">
          <h2>{isCreatorWorkspace ? `Entradas registradas (${payments.length})` : `Pagamentos (${payments.length})`}</h2>
          <div className="financeiro-grid">
            <label>
              Tipo
              <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
                {tiposDisponiveis.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </select>
            </label>
            <label className="financeiro-grid-full">
              Buscar por payment, pedido ou comprador
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: 12345, loja, UID..." />
            </label>
          </div>
          <div className="financeiro-acoes">
            <button type="button" className="financeiro-btn-primary" onClick={exportarPagamentosCsv}>
              Exportar pagamentos CSV
            </button>
          </div>
          {!pagamentosFiltrados.length ? (
            <p className="financeiro-section-hint">Nenhum lancamento ainda.</p>
          ) : (
            <ul className="admin-staff-stack">
              {pagamentosFiltrados.map((p) => (
                <li key={p.id}>
                  <strong>{formatarDataHoraBr(p.createdAt)}</strong> • R$ {Number(p.amount || 0).toFixed(2)} • tipo:{' '}
                  <code>{p.type || '-'}</code>
                  {p.status ? <> • status <code>{p.status}</code></> : null}
                  {p.orderId ? <> • pedido <code>{String(p.orderId).slice(-8)}</code></> : null}
                  {p.paymentId ? <> • MP <code>{p.paymentId}</code></> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="financeiro-migracao">
          <h2>{isCreatorWorkspace ? `Membros e recorrencia (${subscriptions.length})` : `Assinaturas (${subscriptions.length})`}</h2>
          <div className="financeiro-acoes">
            <button type="button" className="financeiro-btn-primary" onClick={exportarAssinaturasCsv}>
              Exportar assinaturas CSV
            </button>
          </div>
          {assinaturasResumo.length ? (
            <>
              <p className="financeiro-section-hint">
                Base consolidada: <strong>{assinaturasResumo.length}</strong> apoiadores unicos • ativos agora:{' '}
                <strong>{assinaturasAtivas.length}</strong>
              </p>
              <ul className="admin-staff-stack">
                {assinaturasResumo.map((s) => (
                  <li key={`summary-${s.userId}`}>
                    <strong>{s.userId}</strong> • {s.status} • {s.count} pagamento(s)
                    {s.totalSpent > 0 ? <> • R$ {s.totalSpent.toFixed(2)}</> : null}
                    {s.memberUntil ? <> • valida ate {formatarDataHoraBr(s.memberUntil)}</> : null}
                    {s.type ? <> • <code>{s.type}</code></> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {!subscriptions.length ? (
            <p className="financeiro-section-hint">Nenhuma assinatura ao criador ainda.</p>
          ) : (
            <ul className="admin-staff-stack">
              {subscriptions.map((s) => (
                <li key={s.id}>
                  <strong>{formatarDataHoraBr(s.createdAt)}</strong> • <code>{s.userId || '-'}</code> •{' '}
                  {s.status || s.type || '-'}
                  {Number.isFinite(Number(s.amount)) && Number(s.amount) > 0 ? (
                    <> • R$ {Number(s.amount).toFixed(2)}</>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="financeiro-migracao">
          <h2>{isCreatorWorkspace ? 'Promocoes do criador' : 'Minhas promocoes'}</h2>
          <form onSubmit={adicionarPromocao} className="financeiro-grid">
            <label className="financeiro-grid-full">
              Titulo
              <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} />
            </label>
            <label className="financeiro-grid-full">
              Detalhe (opcional)
              <textarea value={detalhe} onChange={(e) => setDetalhe(e.target.value)} rows={3} maxLength={2000} />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Salvando...' : 'Criar promocao'}
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

