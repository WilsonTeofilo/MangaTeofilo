import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { onValue, push, ref as dbRef, remove, set } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import {
  resolveCreatorMonetizationPreferenceFromDb,
  resolveCreatorMonetizationStatusFromDb,
} from '../../utils/creatorMonetizationUi';
import { formatarDataHoraBr } from '../../utils/datasBr';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import './CreatorFrame.css';

const creatorRequestPixPayout = httpsCallable(functions, 'creatorRequestPixPayout');

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
  if (norm === 'active') return 'Ganhos liberados';
  if (norm === 'blocked_underage') return 'Bloqueada por idade';
  return 'Solicitação em análise';
}

function describeMonetizationStatus(status) {
  if (status === 'active') {
    return 'Sua conta já pode receber por apoios, membros e vendas da loja.';
  }
  if (status === 'blocked_underage') {
    return 'Sua conta pode publicar normalmente, mas os ganhos ficam bloqueados por idade.';
  }
  return 'Sua conta está no modo apenas publicar. Quando bater as metas, você poderá enviar sua solicitação de monetização.';
}

export default function CreatorMonetizationDashboardClean({ user }) {
  const navigate = useNavigate();
  const uid = String(user?.uid || '').trim();
  const [perfil, setPerfil] = useState(null);
  const [payments, setPayments] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [balance, setBalance] = useState(null);
  const [payoutRequests, setPayoutRequests] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [promoTitle, setPromoTitle] = useState('');
  const [promoDescription, setPromoDescription] = useState('');
  const [payoutAmountDraft, setPayoutAmountDraft] = useState('');
  const [payoutNotesDraft, setPayoutNotesDraft] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return () => {};
    const unsubs = [
      onValue(dbRef(db, `usuarios/${uid}`), (snap) => setPerfil(snap.exists() ? snap.val() : null)),
      onValue(dbRef(db, `creatorData/${uid}/payments`), (snap) =>
        setPayments(toList(snap.exists() ? snap.val() : {}))
      ),
      onValue(dbRef(db, `creatorData/${uid}/subscriptions`), (snap) =>
        setSubscriptions(toList(snap.exists() ? snap.val() : {}))
      ),
      onValue(dbRef(db, `creatorData/${uid}/balance`), (snap) =>
        setBalance(snap.exists() ? snap.val() || null : null)
      ),
      onValue(dbRef(db, `creatorData/${uid}/payoutRequests`), (snap) =>
        setPayoutRequests(toList(snap.exists() ? snap.val() : {}))
      ),
      onValue(dbRef(db, `creatorData/${uid}/promotions`), (snap) =>
        setPromotions(toList(snap.exists() ? snap.val() : {}))
      ),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [uid]);

  const monetizationPreference = resolveCreatorMonetizationPreferenceFromDb(perfil);
  const monetizationStatus = resolveCreatorMonetizationStatusFromDb(perfil || {}) || 'disabled';

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

  const pendingPayoutRequests = useMemo(
    () =>
      payoutRequests
        .filter((row) => String(row.status || '').trim().toLowerCase() === 'pending')
        .sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0)),
    [payoutRequests]
  );

  const availableForPayout = Number(balance?.availableBRL || 0);

  async function handleRequestPayout(e) {
    e.preventDefault();
    if (!uid) return;
    const parsed = String(payoutAmountDraft || '').trim().replace(',', '.');
    const amount = parsed ? Number(parsed) : availableForPayout;
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Informe um valor valido para solicitar o repasse.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { data } = await creatorRequestPixPayout({
        amount,
        notes: String(payoutNotesDraft || '').trim() || null,
      });
      setPayoutAmountDraft('');
      setPayoutNotesDraft('');
      setMessage(
        `Solicitacao enviada em ${formatCurrency(data?.amount || amount)}. A equipe vai revisar esse pedido.`
      );
    } catch (err) {
      setMessage(mensagemErroCallable(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreatePromotion(e) {
    e.preventDefault();
    const title = String(promoTitle || '').trim();
    if (!uid || title.length < 3) {
      setMessage('Defina um título de promoção com pelo menos 3 caracteres.');
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
      setMessage('Promoção salva no seu workspace.');
    } catch (err) {
      setMessage(err?.message || 'Não foi possível salvar a promoção.');
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
      <section className={`creator-state-card is-${monetizationStatus}`}>
        <div>
          <p className="creator-state-card__eyebrow">Estado atual</p>
          <h2>{monetizationModeLabel(monetizationPreference, monetizationStatus)}</h2>
          <p>{describeMonetizationStatus(monetizationStatus)}</p>
        </div>
        <div className="creator-frame-actions">
          <button type="button" className="creator-frame-btn" onClick={() => navigate('/perfil')}>
            Ajustar perfil
          </button>
        </div>
      </section>

      <section className="creator-grid-two">
        <article className="creator-panel-card">
          <div className="creator-panel-head">
            <div>
              <p className="creator-frame-eyebrow">Repasse</p>
              <h2>Solicitar saque</h2>
            </div>
          </div>
          <ul className="creator-data-list">
            <li><span>Saldo disponivel</span><strong>{formatCurrency(availableForPayout)}</strong></li>
            <li><span>Pendente para repasse</span><strong>{formatCurrency(balance?.pendingPayoutBRL || 0)}</strong></li>
            <li><span>Ja pago</span><strong>{formatCurrency(balance?.paidOutBRL || 0)}</strong></li>
          </ul>
          <form className="creator-inline-form" onSubmit={handleRequestPayout}>
            <input
              value={payoutAmountDraft}
              onChange={(e) => setPayoutAmountDraft(e.target.value)}
              inputMode="decimal"
              placeholder={availableForPayout > 0 ? String(availableForPayout.toFixed(2)) : '0.00'}
              disabled={busy || monetizationStatus !== 'active' || pendingPayoutRequests.length > 0 || availableForPayout <= 0}
            />
            <textarea
              rows={3}
              value={payoutNotesDraft}
              onChange={(e) => setPayoutNotesDraft(e.target.value)}
              placeholder="Observacao opcional para a equipe"
              disabled={busy || monetizationStatus !== 'active' || pendingPayoutRequests.length > 0 || availableForPayout <= 0}
            />
            <button
              type="submit"
              className="creator-frame-btn is-primary"
              disabled={busy || monetizationStatus !== 'active' || pendingPayoutRequests.length > 0 || availableForPayout <= 0}
            >
              {busy ? 'Enviando...' : 'Solicitar repasse'}
            </button>
          </form>
          {message ? <p className="creator-inline-feedback">{message}</p> : null}
          {monetizationStatus !== 'active' ? (
            <p className="creator-empty-copy">O saque so libera quando sua monetizacao estiver aprovada e ativa.</p>
          ) : null}
          {pendingPayoutRequests.length ? (
            <p className="creator-empty-copy">Ja existe uma solicitacao pendente. Aguarde a revisao da equipe.</p>
          ) : null}
          {!pendingPayoutRequests.length && monetizationStatus === 'active' && !(availableForPayout > 0) ? (
            <p className="creator-empty-copy">Seu saldo ainda nao atingiu valor disponivel para repasse.</p>
          ) : null}
        </article>

        <article className="creator-panel-card">
          <div className="creator-panel-head">
            <div>
              <p className="creator-frame-eyebrow">Fila atual</p>
              <h2>Solicitacoes de repasse</h2>
            </div>
          </div>
          {!payoutRequests.length ? (
            <p className="creator-empty-copy">Nenhuma solicitacao registrada ainda.</p>
          ) : (
            <ul className="creator-activity-list">
              {[...payoutRequests]
                .sort((a, b) => Number(b.requestedAt || b.reviewedAt || 0) - Number(a.requestedAt || a.reviewedAt || 0))
                .slice(0, 8)
                .map((row) => (
                  <li key={row.id}>
                    <div>
                      <strong>{formatCurrency(row.amount || 0)}</strong>
                      <span>{String(row.status || 'pending')}</span>
                    </div>
                    <div>
                      <strong>{formatarDataHoraBr(row.requestedAt || row.reviewedAt, { seVazio: 'agora' })}</strong>
                      <span>{row.payoutId ? `PIX ${row.payoutId}` : 'aguardando equipe'}</span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </article>
      </section>

      <section className="creator-metrics-grid">
        <article className="creator-metric-card">
          <span>Receita total registrada</span>
          <strong>{formatCurrency(paymentSummary.total)}</strong>
        </article>
        <article className="creator-metric-card">
          <span>Membros</span>
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
              <h2>Composição dos ganhos</h2>
            </div>
          </div>
          <ul className="creator-data-list">
            <li><span>Membros do criador</span><strong>{formatCurrency(paymentSummary.membership)}</strong></li>
            <li><span>Apoios e doações</span><strong>{formatCurrency(paymentSummary.support)}</strong></li>
            <li><span>Loja</span><strong>{formatCurrency(paymentSummary.store)}</strong></li>
            <li><span>Bônus de Premium</span><strong>{formatCurrency(paymentSummary.premiumAttribution)}</strong></li>
            <li><span>Ajustes e estornos</span><strong>{formatCurrency(paymentSummary.refunds)}</strong></li>
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
                ? 'Seus ganhos já estão liberados, mas nenhum membro entrou ainda.'
                : 'A base de membros aparece aqui quando seus ganhos estiverem liberados e os primeiros apoios chegarem.'}
            </p>
          ) : (
            <ul className="creator-activity-list">
              {memberSummary.slice(0, 8).map((row) => (
                <li key={row.userId}>
                  <div>
                    <strong>{row.userId}</strong>
                    <span>{row.status === 'ativo' ? 'membro ativo' : 'assinatura encerrada'}</span>
                  </div>
                  <div>
                    <strong>{formatCurrency(row.totalSpent)}</strong>
                    <span>até {formatarDataHoraBr(row.memberUntil, { seVazio: 'sem validade' })}</span>
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
              <h2>Últimos registros financeiros</h2>
            </div>
          </div>
          {!latestPayments.length ? (
            <p className="creator-empty-copy">Nenhum lançamento registrado ainda.</p>
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
              <p className="creator-frame-eyebrow">Promoções</p>
              <h2>Campanhas do criador</h2>
            </div>
          </div>
          <form className="creator-inline-form" onSubmit={handleCreatePromotion}>
            <input
              value={promoTitle}
              onChange={(e) => setPromoTitle(e.target.value)}
              placeholder="Título da promoção"
            />
            <textarea
              rows={3}
              value={promoDescription}
              onChange={(e) => setPromoDescription(e.target.value)}
              placeholder="Detalhe opcional para sua equipe e sua rotina"
            />
            <button type="submit" className="creator-frame-btn is-primary" disabled={busy}>
              {busy ? 'Salvando...' : 'Criar promoção'}
            </button>
          </form>
          {message ? <p className="creator-inline-feedback">{message}</p> : null}
          {!latestPromotions.length ? (
            <p className="creator-empty-copy">Nenhuma promoção criada ainda.</p>
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
                    <button
                      type="button"
                      className="creator-link-btn"
                      onClick={() => handleDeletePromotion(promo.id)}
                    >
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
