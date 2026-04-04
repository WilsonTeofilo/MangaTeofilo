import React, { useEffect, useMemo, useState } from 'react';
import { onValue, push, ref as dbRef, remove, set } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db } from '../../services/firebase';
import { resolveCreatorMonetizationStatusFromDb } from '../../utils/creatorMonetizationUi';
import { formatarDataHoraBr } from '../../utils/datasBr';
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

function monetizationModeLabel(preference, status) {
  const pref = String(preference || 'publish_only').trim().toLowerCase();
  const norm = String(status || 'disabled').trim().toLowerCase();
  if (pref !== 'monetize') return 'Apenas publicar';
  if (norm === 'active') return 'Monetizacao ativa';
  if (norm === 'pending_review') return 'Em validacao';
  if (norm === 'blocked_underage') return 'Bloqueada por idade';
  return 'Configuracao pendente';
}

export default function CreatorMonetizationDashboard({ user }) {
  const navigate = useNavigate();
  const uid = String(user?.uid || '').trim();
  const [perfil, setPerfil] = useState(null);
  const [payments, setPayments] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [promoTitle, setPromoTitle] = useState('');
  const [promoDescription, setPromoDescription] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return () => {};
    const unsubs = [
      onValue(dbRef(db, `usuarios/${uid}`), (snap) => setPerfil(snap.exists() ? snap.val() : null)),
      onValue(dbRef(db, `creatorData/${uid}/payments`), (snap) => setPayments(toList(snap.exists() ? snap.val() : {}))),
      onValue(dbRef(db, `creatorData/${uid}/subscriptions`), (snap) => setSubscriptions(toList(snap.exists() ? snap.val() : {}))),
      onValue(dbRef(db, `creatorData/${uid}/promotions`), (snap) => setPromotions(toList(snap.exists() ? snap.val() : {}))),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [uid]);

  const monetizationPreference = String(perfil?.creatorMonetizationPreference || 'publish_only').trim().toLowerCase();
  const monetizationStatusResolved = resolveCreatorMonetizationStatusFromDb(perfil || {});
  const monetizationStatus = (
    monetizationStatusResolved !== ''
      ? monetizationStatusResolved
      : String(perfil?.creatorMonetizationStatus || 'disabled').trim().toLowerCase()
  );
  const monetizationReviewReason = String(perfil?.creatorMonetizationReviewReason || '').trim();
  const modeLabel = monetizationModeLabel(monetizationPreference, monetizationStatus);

  const paymentSummary = useMemo(() => {
    const summary = {
      total: 0,
      membership: 0,
      support: 0,
      store: 0,
      premiumAttribution: 0,
      refunds: 0,
    };
    for (const row of payments) {
      const amount = Number(row.amount || 0);
      summary.total += amount;
      const type = String(row.type || 'other').trim().toLowerCase();
      if (type === 'creator_membership') summary.membership += amount;
      else if (type === 'apoio') summary.support += amount;
      else if (type === 'loja') summary.store += amount;
      else if (type === 'premium_attribution') summary.premiumAttribution += amount;
      else if (amount < 0) summary.refunds += amount;
    }
    return summary;
  }, [payments]);

  const memberSummary = useMemo(() => {
    const grouped = new Map();
    for (const row of subscriptions) {
      const userId = String(row.userId || '').trim();
      if (!userId) continue;
      const current = grouped.get(userId) || {
        userId,
        count: 0,
        totalSpent: 0,
        memberUntil: 0,
        lastAt: 0,
      };
      current.count += 1;
      current.totalSpent += Number(row.amount || 0);
      current.memberUntil = Math.max(current.memberUntil, Number(row.memberUntil || 0));
      current.lastAt = Math.max(current.lastAt, Number(row.createdAt || 0));
      grouped.set(userId, current);
    }
    return [...grouped.values()]
      .map((row) => ({
        ...row,
        status: row.memberUntil > Date.now() ? 'ativo' : 'expirado',
      }))
      .sort((a, b) => b.lastAt - a.lastAt);
  }, [subscriptions]);

  const latestPayments = useMemo(
    () => [...payments].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 8),
    [payments]
  );

  const latestPromotions = useMemo(
    () => [...promotions].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
    [promotions]
  );

  async function handleCreatePromotion(e) {
    e.preventDefault();
    const title = String(promoTitle || '').trim();
    if (!uid || title.length < 3) {
      setMessage('Defina um titulo de promocao com pelo menos 3 caracteres.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const newKey = push(dbRef(db, `creatorData/${uid}/promotions`)).key;
      await set(dbRef(db, `creatorData/${uid}/promotions/${newKey}`), {
        title,
        description: String(promoDescription || '').trim(),
        creatorId: uid,
        createdAt: Date.now(),
      });
      setPromoTitle('');
      setPromoDescription('');
      setMessage('Promocao salva no seu workspace.');
    } catch (err) {
      setMessage(err?.message || 'Nao foi possivel salvar a promocao.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePromotion(id) {
    if (!uid || !id) return;
    await remove(dbRef(db, `creatorData/${uid}/promotions/${id}`));
  }

  return (
    <>
      <section className={`creator-state-card is-${monetizationStatus || 'disabled'}`}>
        <div>
          <p className="creator-state-card__eyebrow">Estado atual</p>
          <h2>{modeLabel}</h2>
          <p>
            {monetizationStatus === 'active'
              ? 'Seu creatorId ja pode operar membership, membros e ganhos com visibilidade completa.'
              : monetizationStatus === 'pending_review'
                ? 'Sua configuracao foi enviada. Enquanto a equipe revisa, o painel mostra operacao sem liberar recebimento.'
                : monetizationStatus === 'blocked_underage'
                  ? 'Sua conta pode publicar normalmente, mas a monetizacao fica bloqueada por idade.'
                  : 'Sua conta esta em modo publicacao. Quando quiser monetizar, ajuste o perfil e envie para revisao.'}
          </p>
          {monetizationReviewReason ? (
            <p className="creator-state-card__reason">Motivo registrado: {monetizationReviewReason}</p>
          ) : null}
        </div>
        <div className="creator-frame-actions">
          <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/perfil')}>
            Ajustar perfil
          </button>
        </div>
      </section>

      <section className="creator-metrics-grid">
        <article className="creator-metric-card">
          <span>Receita total registrada</span>
          <strong>{formatCurrency(paymentSummary.total)}</strong>
        </article>
        <article className="creator-metric-card">
          <span>Membership</span>
          <strong>{formatCurrency(paymentSummary.membership)}</strong>
        </article>
        <article className="creator-metric-card">
          <span>Apoios</span>
          <strong>{formatCurrency(paymentSummary.support)}</strong>
        </article>
        <article className="creator-metric-card">
          <span>Membros ativos</span>
          <strong>{memberSummary.filter((row) => row.status === 'ativo').length}</strong>
        </article>
      </section>

      <section className="creator-grid-two">
        <article className="creator-panel-card">
          <div className="creator-panel-head">
            <div>
              <p className="creator-frame-eyebrow">Ganhos por origem</p>
              <h2>Composicao da receita</h2>
            </div>
          </div>
          <ul className="creator-data-list">
            <li><span>Membership do criador</span><strong>{formatCurrency(paymentSummary.membership)}</strong></li>
            <li><span>Apoios e doacoes</span><strong>{formatCurrency(paymentSummary.support)}</strong></li>
            <li><span>Loja</span><strong>{formatCurrency(paymentSummary.store)}</strong></li>
            <li><span>Atribuicao de Premium</span><strong>{formatCurrency(paymentSummary.premiumAttribution)}</strong></li>
            <li><span>Ajustes / estornos</span><strong>{formatCurrency(paymentSummary.refunds)}</strong></li>
          </ul>
        </article>

        <article className="creator-panel-card">
          <div className="creator-panel-head">
            <div>
              <p className="creator-frame-eyebrow">Base recorrente</p>
              <h2>Membros e validade</h2>
            </div>
          </div>
          {!memberSummary.length ? (
            <p className="creator-empty-copy">
              {monetizationStatus === 'active'
                ? 'Sua monetizacao esta pronta, mas nenhum membro entrou ainda.'
                : 'A base de membros aparece aqui quando a monetizacao estiver ativa e os primeiros apoios chegarem.'}
            </p>
          ) : (
            <ul className="creator-activity-list">
              {memberSummary.slice(0, 8).map((row) => (
                <li key={row.userId}>
                  <div>
                    <strong>{row.userId}</strong>
                    <span>{row.status === 'ativo' ? 'membro ativo' : 'membership expirada'}</span>
                  </div>
                  <div>
                    <strong>{formatCurrency(row.totalSpent)}</strong>
                    <span>ate {formatarDataHoraBr(row.memberUntil, { seVazio: 'sem validade' })}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="creator-grid-two">
        <article className="creator-panel-card">
          <div className="creator-panel-head">
            <div>
              <p className="creator-frame-eyebrow">Entradas recentes</p>
              <h2>Ultimos registros financeiros</h2>
            </div>
          </div>
          {!latestPayments.length ? (
            <p className="creator-empty-copy">Nenhum lancamento registrado ainda.</p>
          ) : (
            <ul className="creator-activity-list">
              {latestPayments.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{String(row.type || 'outro')}</strong>
                    <span>{formatarDataHoraBr(row.createdAt, { seVazio: 'agora' })}</span>
                  </div>
                  <div>
                    <strong>{formatCurrency(row.amount)}</strong>
                    <span>{row.paymentId ? `MP ${row.paymentId}` : row.orderId ? `pedido ${row.orderId}` : 'creatorData'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="creator-panel-card">
          <div className="creator-panel-head">
            <div>
              <p className="creator-frame-eyebrow">Promocoes</p>
              <h2>Campanhas do creator</h2>
            </div>
          </div>
          <form className="creator-inline-form" onSubmit={handleCreatePromotion}>
            <input value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)} placeholder="Titulo da promocao" />
            <textarea rows={3} value={promoDescription} onChange={(e) => setPromoDescription(e.target.value)} placeholder="Detalhe opcional para sua equipe e sua rotina" />
            <button type="submit" className="creator-frame-btn is-primary" disabled={busy}>
              {busy ? 'Salvando...' : 'Criar promocao'}
            </button>
          </form>
          {message ? <p className="creator-inline-feedback">{message}</p> : null}
          {!latestPromotions.length ? (
            <p className="creator-empty-copy">Nenhuma promocao criada ainda.</p>
          ) : (
            <ul className="creator-activity-list">
              {latestPromotions.map((promo) => (
                <li key={promo.id}>
                  <div>
                    <strong>{promo.title}</strong>
                    <span>{promo.description || 'Sem detalhe adicional'}</span>
                  </div>
                  <div>
                    <strong>{formatarDataHoraBr(promo.createdAt, { seVazio: 'agora' })}</strong>
                    <button type="button" className="creator-link-btn" onClick={() => handleDeletePromotion(promo.id)}>
                      Remover
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </>
  );
}
