import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { formatarDataHoraBr } from '../../utils/datasBr';
import './FinanceiroAdmin.css';
import './AdminStaff.css';

const adminListCreatorApplications = httpsCallable(functions, 'adminListCreatorApplications');
const adminApproveCreatorApplication = httpsCallable(functions, 'adminApproveCreatorApplication');
const adminRejectCreatorApplication = httpsCallable(functions, 'adminRejectCreatorApplication');
const adminApproveCreatorMonetization = httpsCallable(functions, 'adminApproveCreatorMonetization');
const adminRejectCreatorMonetization = httpsCallable(functions, 'adminRejectCreatorMonetization');

function socialSummary(row) {
  const items = [];
  if (row?.creatorInstagramUrl) items.push('Instagram');
  if (row?.creatorYoutubeUrl) items.push('YouTube');
  return items.length ? items.join(' + ') : 'Sem rede';
}

function statusLabel(status) {
  const norm = String(status || '').trim().toLowerCase();
  if (norm === 'requested') return 'pendente';
  if (norm === 'approved') return 'aprovado';
  if (norm === 'rejected') return 'rejeitado';
  if (norm === 'draft') return 'rascunho';
  return norm || 'indefinido';
}

function monetizationLabel(status, preference) {
  const pref = String(preference || '').trim().toLowerCase();
  const norm = String(status || '').trim().toLowerCase();
  if (pref !== 'monetize') return 'apenas publicar';
  if (norm === 'pending_review') return 'aguardando revisao';
  if (norm === 'active') return 'monetizacao ativa';
  if (norm === 'blocked_underage') return 'bloqueado por idade';
  if (norm === 'disabled') return 'desativada';
  return norm || 'indefinido';
}

export default function CriadoresAdmin() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rejectReasons, setRejectReasons] = useState({});
  const [rejectAsBan, setRejectAsBan] = useState({});
  const [monetizationReasons, setMonetizationReasons] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminListCreatorApplications();
      setApplications(Array.isArray(data?.applications) ? data.applications : []);
    } catch (err) {
      setApplications([]);
      setError(mensagemErroCallable(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const pending = applications.filter((item) => item.creatorApplicationStatus === 'requested').length;
    const approved = applications.filter((item) => item.creatorApplicationStatus === 'approved').length;
    const onboarding = applications.filter((item) => item.creatorStatus === 'onboarding').length;
    const monetizationReview = applications.filter((item) => item.creatorMonetizationStatus === 'pending_review').length;
    return { pending, approved, onboarding, monetizationReview };
  }, [applications]);

  const handleApprove = async (uid) => {
    if (!uid) return;
    setBusyUid(uid);
    setMessage('');
    setError('');
    try {
      await adminApproveCreatorApplication({ uid });
      setMessage('Criador aprovado. O perfil entrou em onboarding guiado.');
      await load();
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusyUid('');
    }
  };

  const handleReject = async (uid) => {
    if (!uid) return;
    const reason = String(rejectReasons[uid] || '').trim();
    const banUser = rejectAsBan[uid] === true;
    if (reason.length < 8) {
      setError('Informe um motivo com pelo menos 8 caracteres para reprovar o criador.');
      return;
    }
    setBusyUid(uid);
    setMessage('');
    setError('');
    try {
      await adminRejectCreatorApplication({ uid, reason, banUser });
      setMessage(banUser ? 'Conta bloqueada e solicitacao encerrada.' : 'Solicitacao rejeitada.');
      setRejectReasons((prev) => ({ ...prev, [uid]: '' }));
      setRejectAsBan((prev) => ({ ...prev, [uid]: false }));
      await load();
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusyUid('');
    }
  };

  const handleApproveMonetization = async (uid) => {
    if (!uid) return;
    setBusyUid(uid);
    setMessage('');
    setError('');
    try {
      const { data } = await adminApproveCreatorMonetization({ uid });
      setMessage(
        data?.monetizationStatus === 'blocked_underage'
          ? 'Criador mantido em publicacao apenas. Monetizacao bloqueada por idade.'
          : 'Monetizacao aprovada com sucesso.'
      );
      await load();
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusyUid('');
    }
  };

  const handleRejectMonetization = async (uid) => {
    if (!uid) return;
    const reason = String(monetizationReasons[uid] || '').trim();
    if (reason.length < 8) {
      setError('Explique com pelo menos 8 caracteres por que a monetizacao vai ficar em apenas publicar.');
      return;
    }
    setBusyUid(uid);
    setMessage('');
    setError('');
    try {
      await adminRejectCreatorMonetization({ uid, reason });
      setMessage('Criador segue em modo apenas publicar.');
      setMonetizationReasons((prev) => ({ ...prev, [uid]: '' }));
      await load();
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusyUid('');
    }
  };

  return (
    <main className="admin-empty-page admin-team-page">
      <section className="admin-empty-card admin-team-shell">
        <header className="financeiro-header admin-team-header">
          <div>
            <p className="admin-team-eyebrow">Criadores</p>
            <h1>Solicitacoes de criador</h1>
            <p>Aprove, rejeite e acompanhe quem ainda esta em onboarding.</p>
          </div>
        </header>

        {error ? <p className="financeiro-msg financeiro-msg--erro">{error}</p> : null}
        {message ? <p className="financeiro-msg financeiro-msg--ok">{message}</p> : null}

        <section className="admin-team-overview">
          <article className="admin-team-stat-card">
            <span>Pendentes</span>
            <strong>{summary.pending}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Aprovados</span>
            <strong>{summary.approved}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Em onboarding</span>
            <strong>{summary.onboarding}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Monetizacao pendente</span>
            <strong>{summary.monetizationReview}</strong>
          </article>
        </section>

        <section className="admin-team-panel">
          <div className="admin-team-panel-head">
            <div>
              <h2>Pipeline</h2>
              <p>Solicitacao minima - aprovacao - onboarding guiado - criador ativo.</p>
            </div>
          </div>

          {loading ? <p className="admin-staff-loading">Carregando solicitacoes...</p> : null}
          {!loading && applications.length === 0 ? (
            <p className="admin-staff-empty">Nenhuma solicitacao de criador encontrada.</p>
          ) : null}

          {!loading && applications.length > 0 ? (
            <div className="admin-team-table-wrap">
              <table className="admin-team-table">
                <thead>
                  <tr>
                    <th>Candidato</th>
                    <th>Solicitacao</th>
                    <th>Status</th>
                    <th className="admin-team-actions-col">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((item) => {
                    const isPending = item.creatorApplicationStatus === 'requested';
                    const monetizationPending =
                      item.creatorApplicationStatus === 'approved' &&
                      item.creatorMonetizationStatus === 'pending_review';
                    const rowBusy = busyUid === item.uid;
                    const creatorName = item.creatorDisplayName || item.userName || item.email || item.uid;
                    return (
                      <tr key={item.uid}>
                        <td>
                          <div className="admin-team-member-cell">
                            <strong>{creatorName}</strong>
                            <span>{item.email || 'E-mail indisponivel'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="admin-team-member-cell">
                            <strong>{item.creatorBioShort || item.creatorBio || 'Sem bio curta'}</strong>
                            <span>{socialSummary(item)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="admin-team-member-cell">
                            <strong>{statusLabel(item.creatorApplicationStatus)}</strong>
                            <span>
                              {item.creatorRequestedAt
                                ? `Pedido em ${formatarDataHoraBr(item.creatorRequestedAt)}`
                                : 'Sem data de solicitacao'}
                            </span>
                            {item.creatorStatus ? (
                              <span>Pipeline: {item.creatorStatus}</span>
                            ) : null}
                            <span>
                              Monetizacao: {monetizationLabel(item.creatorMonetizationStatus, item.creatorMonetizationPreference)}
                            </span>
                            {item.creatorReviewReason ? <span>Motivo da decisao: {item.creatorReviewReason}</span> : null}
                            {item.creatorMonetizationReviewReason ? <span>Motivo monetizacao: {item.creatorMonetizationReviewReason}</span> : null}
                          </div>
                        </td>
                        <td>
                          <div className="admin-team-actions">
                            <button
                              type="button"
                              className="admin-team-action-link"
                              disabled={!isPending || rowBusy}
                              onClick={() => handleApprove(item.uid)}
                            >
                              {rowBusy && isPending ? 'Salvando...' : 'Aprovar'}
                            </button>
                            <button
                              type="button"
                              className="admin-team-action-link is-danger"
                              disabled={!isPending || rowBusy}
                              onClick={() => handleReject(item.uid)}
                            >
                              Rejeitar
                            </button>
                            {isPending ? (
                              <>
                                <textarea
                                  className="perfil-input"
                                  rows={3}
                                  value={rejectReasons[item.uid] || ''}
                                  onChange={(e) => setRejectReasons((prev) => ({ ...prev, [item.uid]: e.target.value }))}
                                  placeholder="Motivo da aprovacao negada ou perfil troll"
                                />
                                <label className="notify-label">
                                  <input
                                    type="checkbox"
                                    checked={rejectAsBan[item.uid] === true}
                                    onChange={(e) => setRejectAsBan((prev) => ({ ...prev, [item.uid]: e.target.checked }))}
                                  />
                                  Bloquear conta por perfil troll
                                </label>
                              </>
                            ) : null}
                            {monetizationPending ? (
                              <>
                                <button
                                  type="button"
                                  className="admin-team-action-link"
                                  disabled={rowBusy}
                                  onClick={() => handleApproveMonetization(item.uid)}
                                >
                                  Liberar monetizacao
                                </button>
                                <button
                                  type="button"
                                  className="admin-team-action-link is-danger"
                                  disabled={rowBusy}
                                  onClick={() => handleRejectMonetization(item.uid)}
                                >
                                  Manter so publicacao
                                </button>
                                <textarea
                                  className="perfil-input"
                                  rows={3}
                                  value={monetizationReasons[item.uid] || ''}
                                  onChange={(e) => setMonetizationReasons((prev) => ({ ...prev, [item.uid]: e.target.value }))}
                                  placeholder="Motivo para nao liberar monetizacao agora"
                                />
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
