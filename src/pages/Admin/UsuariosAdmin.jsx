import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import './FinanceiroAdmin.css';
import './AdminStaff.css';

const adminListUsers = httpsCallable(functions, 'adminListUsers');
const adminModerateUser = httpsCallable(functions, 'adminModerateUser');
const adminDeleteUserByUid = httpsCallable(functions, 'adminDeleteUserByUid');

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'writer', label: 'Escritores' },
  { id: 'reader', label: 'Leitores' },
  { id: 'banned', label: 'Banidos' },
];

function formatBanTimeRemaining(expiresAt, nowTs = Date.now()) {
  const end = Number(expiresAt || 0);
  if (!Number.isFinite(end) || end <= 0) return 'Sem prazo definido';
  const diff = Math.max(0, end - Number(nowTs || Date.now()));
  const totalSeconds = Math.floor(diff / 1000);
  const dias = Math.floor(totalSeconds / 86400);
  const horas = Math.floor((totalSeconds % 86400) / 3600);
  const minutos = Math.floor((totalSeconds % 3600) / 60);
  const segundos = totalSeconds % 60;
  return [
    dias > 0 ? `${dias}d` : null,
    horas > 0 || dias > 0 ? `${horas}h` : null,
    minutos > 0 || horas > 0 || dias > 0 ? `${minutos}m` : null,
    `${segundos}s`,
  ]
    .filter(Boolean)
    .join(' ');
}

function avatarFallback(label) {
  const base = String(label || '?').trim().charAt(0).toUpperCase();
  return base || '?';
}

export default function UsuariosAdmin({ adminAccess }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [actionModal, setActionModal] = useState(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [banClockNow, setBanClockNow] = useState(() => Date.now());

  const canManageUsers = adminAccess?.isChiefAdmin === true || adminAccess?.superAdmin === true;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminListUsers();
      setRows(Array.isArray(data?.users) ? data.users : []);
    } catch (err) {
      setRows([]);
      setError(mensagemErroCallable(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hasActiveBan = rows.some((row) => row.moderation?.isBanned === true);
    if (!hasActiveBan) return undefined;
    const intervalId = window.setInterval(() => setBanClockNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [rows]);

  const visibleRows = useMemo(() => {
    const term = String(query || '').trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'writer' && row.accountKind !== 'writer') return false;
      if (filter === 'reader' && row.accountKind !== 'reader') return false;
      if (filter === 'banned' && row.moderation?.isBanned !== true) return false;
      if (!term) return true;
      const haystack = [
        row.displayName,
        row.username,
        row.email,
        row.uid,
      ]
        .map((item) => String(item || '').toLowerCase())
        .join(' ');
      return haystack.includes(term);
    });
  }, [filter, query, rows]);

  const selectedUser = useMemo(
    () => rows.find((row) => row.uid === selectedUserId) || visibleRows[0] || null,
    [rows, selectedUserId, visibleRows]
  );

  useEffect(() => {
    if (selectedUser && selectedUser.uid !== selectedUserId) {
      setSelectedUserId(selectedUser.uid);
    }
  }, [selectedUser, selectedUserId]);

  const overview = useMemo(() => {
    const writers = rows.filter((row) => row.accountKind === 'writer').length;
    const readers = rows.filter((row) => row.accountKind === 'reader').length;
    const banned = rows.filter((row) => row.moderation?.isBanned === true).length;
    return { total: rows.length, writers, readers, banned };
  }, [rows]);

  const closeModal = () => {
    setActionModal(null);
    setReasonDraft('');
  };

  const openModal = (kind, payload = {}) => {
    setMessage('');
    setError('');
    setActionModal({ kind, ...payload });
    setReasonDraft('');
  };

  const handleBan = async () => {
    if (!selectedUser) return;
    if (!reasonDraft.trim()) {
      setError('Informe o motivo do ban.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { data } = await adminModerateUser({
        action: 'ban',
        uid: selectedUser.uid,
        reason: reasonDraft,
      });
      setMessage(
        data?.deleted
          ? 'Conta removida automaticamente apos atingir 4 bans.'
          : `Ban aplicado com sucesso. Agora a conta soma ${Number(data?.totalBanCount || 0)} ban(s) e faltam ${Number(data?.bansRemaining || 0)} para exclusao permanente.`
      );
      closeModal();
      await load();
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRevertBan = async () => {
    if (!selectedUser || !actionModal?.historyId) return;
    if (!reasonDraft.trim()) {
      setError('Informe o motivo da reversao.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { data } = await adminModerateUser({
        action: 'revert_ban',
        uid: selectedUser.uid,
        historyId: actionModal.historyId,
        reason: reasonDraft,
      });
      setMessage(
        `Strike removido com sucesso. Agora a conta soma ${Number(data?.totalBanCount || 0)} ban(s) e faltam ${Number(data?.bansRemaining || 0)} para exclusao permanente.`
      );
      closeModal();
      await load();
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser?.uid) {
      setError('Selecione uma conta valida para exclusao.');
      return;
    }
    if (!reasonDraft.trim()) {
      setError('Informe o motivo da exclusao.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await adminDeleteUserByUid({
        uid: selectedUser.uid,
        reason: reasonDraft,
      });
      setMessage('Conta excluida com sucesso.');
      closeModal();
      await load();
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusy(false);
    }
  };

  if (!canManageUsers) {
    return (
      <main className="admin-empty-page admin-team-page">
        <section className="admin-empty-card admin-team-shell">
          <header className="financeiro-header admin-team-header">
            <div>
              <p className="admin-team-eyebrow">Usuarios</p>
              <h1>Moderacao</h1>
              <p>Esta area fica restrita para admins chefes da plataforma.</p>
            </div>
          </header>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-empty-page admin-team-page">
      <section className="admin-empty-card admin-team-shell admin-users-shell">
        <header className="financeiro-header admin-team-header">
          <div>
            <p className="admin-team-eyebrow">Usuarios</p>
            <h1>Moderacao</h1>
            <p>Ban com motivo, historico, reversao e exclusao por e-mail sem misturar com equipe.</p>
          </div>
        </header>

        {error ? <p className="financeiro-msg financeiro-msg--erro">{error}</p> : null}
        {message ? <p className="financeiro-msg financeiro-msg--ok">{message}</p> : null}

        <section className="admin-team-overview">
          <article className="admin-team-stat-card">
            <span>Total</span>
            <strong>{overview.total}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Escritores</span>
            <strong>{overview.writers}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Leitores</span>
            <strong>{overview.readers}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Banidos</span>
            <strong>{overview.banned}</strong>
          </article>
        </section>

        <section className="admin-team-panel admin-users-panel">
          <div className="admin-team-panel-head admin-users-panel-head">
            <div>
              <h2>Usuarios</h2>
              <p>Equipe ADM, criadores e sessoes ficam separados no shell. Aqui entra moderacao de conta.</p>
            </div>
            <div className="admin-users-toolbar">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nome, @username, email ou uid"
              />
              <div className="admin-users-filter-row">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`admin-users-filter ${filter === item.id ? 'is-active' : ''}`}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? <p className="admin-staff-loading">Carregando usuarios...</p> : null}
          {!loading && !visibleRows.length ? <p className="admin-staff-empty">Nenhuma conta encontrada.</p> : null}

          {!loading && visibleRows.length ? (
            <div className="admin-users-layout">
              <div className="admin-team-table-wrap admin-users-table-wrap">
                <table className="admin-team-table">
                  <thead>
                    <tr>
                      <th>Conta</th>
                      <th>Tipo</th>
                      <th>Status</th>
                      <th>Bans</th>
                      <th className="admin-team-actions-col">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const isSelected = row.uid === selectedUser?.uid;
                      const activeBanCount = Number(row.moderation?.activeBanCount || 0);
                      return (
                        <tr
                          key={row.uid}
                          className={isSelected ? 'admin-users-row is-selected' : 'admin-users-row'}
                          onClick={() => setSelectedUserId(row.uid)}
                        >
                          <td>
                            <div className="admin-users-member">
                              <div className="admin-users-avatar">
                                {row.avatarUrl ? (
                                  <img src={row.avatarUrl} alt="" referrerPolicy="no-referrer" />
                                ) : (
                                  <span>{avatarFallback(row.displayName || row.email)}</span>
                                )}
                              </div>
                              <div className="admin-team-member-cell">
                                <strong>{row.displayName || row.email || row.uid}</strong>
                                <span>{row.username ? `@${String(row.username).replace(/^@/, '')}` : row.email || row.uid}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`admin-users-kind-badge admin-users-kind-badge--${row.accountKind}`}>
                              {row.accountKind === 'writer' ? 'escritor' : row.accountKind === 'reader' ? 'leitor' : 'staff'}
                            </span>
                          </td>
                          <td>
                            <span className={`admin-users-status-badge ${row.moderation?.isBanned ? 'is-banned' : 'is-active'}`}>
                              {row.moderation?.isBanned ? 'banido' : 'ativo'}
                            </span>
                          </td>
                          <td>
                            <span className="admin-team-permission-summary">
                              {row.moderation?.totalBanCount || 0} total / {activeBanCount} ativo
                            </span>
                          </td>
                          <td>
                            <div className="admin-team-row-actions">
                              <button type="button" onClick={() => setSelectedUserId(row.uid)}>
                                Ver ficha
                              </button>
                              {!row.protected ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedUserId(row.uid);
                                    openModal('ban');
                                  }}
                                >
                                  Banir
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {selectedUser ? (
                <aside className="admin-users-detail">
                  <div className="admin-users-detail__head">
                    <div className="admin-users-member">
                      <div className="admin-users-avatar admin-users-avatar--large">
                        {selectedUser.avatarUrl ? (
                          <img src={selectedUser.avatarUrl} alt="" referrerPolicy="no-referrer" />
                        ) : (
                          <span>{avatarFallback(selectedUser.displayName || selectedUser.email)}</span>
                        )}
                      </div>
                      <div className="admin-team-member-cell">
                        <strong>{selectedUser.displayName || selectedUser.email || selectedUser.uid}</strong>
                        <span>{selectedUser.username ? `@${String(selectedUser.username).replace(/^@/, '')}` : selectedUser.email || selectedUser.uid}</span>
                      </div>
                    </div>
                    <div className="admin-users-detail__meta">
                      <span>{selectedUser.accountKind === 'writer' ? 'Escritor' : selectedUser.accountKind === 'reader' ? 'Leitor' : 'Staff'}</span>
                      <span>{selectedUser.email || 'Sem e-mail'}</span>
                    </div>
                  </div>

                  <div className="admin-users-detail__actions">
                    {!selectedUser.protected ? (
                      <>
                        <button type="button" onClick={() => openModal('ban')}>
                          Aplicar ban
                        </button>
                        <button
                          type="button"
                          className="admin-team-danger-btn"
                          onClick={() => openModal('delete')}
                        >
                          Excluir conta
                        </button>
                      </>
                    ) : (
                      <p className="admin-team-muted-action">Conta protegida. Remova o papel de staff antes de moderar.</p>
                    )}
                  </div>

                  {selectedUser.moderation?.isBanned ? (
                    <p className="admin-team-muted-action">
                      Ban ativo: {formatBanTimeRemaining(selectedUser.moderation?.currentBanExpiresAt, banClockNow)} restante.
                    </p>
                  ) : null}

                  <section className="admin-users-history">
                    <h3>Historico de moderacao</h3>
                    {!selectedUser.moderation?.history?.length ? (
                      <p className="admin-staff-empty">Nenhum evento de moderacao ainda.</p>
                    ) : (
                      <div className="admin-users-history__list">
                        {selectedUser.moderation.history.map((item) => (
                          <article key={item.id} className="admin-users-history__item">
                            <div>
                              <strong>{item.type === 'ban' ? 'Ban aplicado' : item.type}</strong>
                              <p>{item.reason || 'Sem motivo registrado.'}</p>
                              <small>
                                {new Date(Number(item.createdAt || 0)).toLocaleString('pt-BR')}
                                {item.active === true ? ' · ativo' : ' · revertido'}
                              </small>
                            </div>
                            {item.active === true && !selectedUser.protected ? (
                              <button
                                type="button"
                                onClick={() => openModal('revert', { historyId: item.id })}
                              >
                                Desfazer strike
                              </button>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="admin-users-summary">
                    <p><strong>Bans ativos:</strong> {selectedUser.moderation?.activeBanCount || 0}</p>
                    <p><strong>Total de bans:</strong> {selectedUser.moderation?.totalBanCount || 0}</p>
                    <p><strong>Ultimo motivo:</strong> {selectedUser.moderation?.lastBanReason || 'Nenhum'}</p>
                    <p><strong>Regra:</strong> no 4º ban a conta e removida.</p>
                  </section>
                </aside>
              ) : null}
            </div>
          ) : null}
        </section>

        {actionModal ? (
          <div className="admin-team-modal-backdrop" role="presentation" onClick={closeModal}>
            <section
              className="admin-team-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-users-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="admin-team-modal-head">
                <div>
                  <p className="admin-team-eyebrow">Moderacao</p>
                  <h2 id="admin-users-modal-title">
                    {actionModal.kind === 'ban' && 'Aplicar ban'}
                    {actionModal.kind === 'revert' && 'Desfazer strike'}
                    {actionModal.kind === 'delete' && 'Excluir conta'}
                  </h2>
                </div>
                <button type="button" className="admin-team-close-btn" onClick={closeModal} disabled={busy}>
                  Fechar
                </button>
              </div>

              <div className="admin-team-form">
                <label>
                  Conta
                  <input
                    type="text"
                    value={
                      selectedUser
                        ? `${selectedUser.displayName || selectedUser.email || selectedUser.uid}${selectedUser.username ? ` (@${String(selectedUser.username).replace(/^@/, '')})` : ''}`
                        : ''
                    }
                    readOnly
                  />
                </label>

                {actionModal.kind === 'delete' ? (
                  <label>
                    E-mail da exclusao
                    <input type="text" value={selectedUser?.email || ''} readOnly />
                  </label>
                ) : null}

                <label>
                  Motivo
                  <textarea
                    value={reasonDraft}
                    onChange={(event) => setReasonDraft(event.target.value)}
                    rows={5}
                    placeholder={
                      actionModal.kind === 'revert'
                        ? 'Explique por que este strike precisa ser removido'
                        : actionModal.kind === 'delete'
                          ? 'Explique por que a conta sera excluida'
                          : 'Explique por que a conta sera bloqueada'
                    }
                  />
                </label>

                {actionModal.kind === 'ban' ? (
                  <p className="admin-team-muted-action">
                    Escada atual: 1º ban = 10 horas, 2º = 24 horas, 3º = 4 dias e 4º = exclusão permanente.
                    Antes do 4º ban a conta continua existindo, mas fica travada nas áreas bloqueadas.
                  </p>
                ) : null}

                <div className="admin-team-modal-actions">
                  <button type="button" onClick={closeModal} disabled={busy}>
                    Cancelar
                  </button>
                  {actionModal.kind === 'ban' ? (
                    <button type="button" className="financeiro-btn-primary" onClick={handleBan} disabled={busy}>
                      {busy ? 'Aplicando...' : 'Confirmar ban'}
                    </button>
                  ) : null}
                  {actionModal.kind === 'revert' ? (
                    <button type="button" className="financeiro-btn-primary" onClick={handleRevertBan} disabled={busy}>
                      {busy ? 'Desfazendo...' : 'Confirmar undo'}
                    </button>
                  ) : null}
                  {actionModal.kind === 'delete' ? (
                    <button type="button" className="financeiro-btn-encerrar" onClick={handleDelete} disabled={busy}>
                      {busy ? 'Excluindo...' : 'Excluir conta'}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
