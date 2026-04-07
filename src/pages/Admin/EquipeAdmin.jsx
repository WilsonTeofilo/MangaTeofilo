import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { STAFF_PERMISSION_FIELDS } from '../../auth/adminPermissions';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import './FinanceiroAdmin.css';
import './AdminStaff.css';

const adminListStaff = httpsCallable(functions, 'adminListStaff');
const adminUpsertStaff = httpsCallable(functions, 'adminUpsertStaff');
const adminRemoveStaff = httpsCallable(functions, 'adminRemoveStaff');

function buildEmptyPermissions() {
  const next = {};
  STAFF_PERMISSION_FIELDS.forEach(({ field }) => {
    next[field] = false;
  });
  return next;
}

function countActivePermissions(permissions) {
  return STAFF_PERMISSION_FIELDS.reduce((total, { field }) => total + (permissions?.[field] === true ? 1 : 0), 0);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function buildPayloadFromPermissions(permissions) {
  const payload = {};
  STAFF_PERMISSION_FIELDS.forEach(({ field }) => {
    if (permissions?.[field] === true) payload[field] = true;
  });
  return payload;
}

export default function EquipeAdmin({ adminAccess }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [formEmail, setFormEmail] = useState('');
  const [formPermissions, setFormPermissions] = useState(() => buildEmptyPermissions());

  const canManageMembers = adminAccess?.superAdmin === true || adminAccess?.isChiefAdmin === true;

  const permissionGroups = useMemo(() => {
    return STAFF_PERMISSION_FIELDS.reduce((groups, item) => {
      const key = item.category || 'Outros';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
      return groups;
    }, {});
  }, []);

  const existingAdminEmails = useMemo(() => {
    const emails = new Set();
    staff.forEach((member) => {
      if (member?.role !== 'admin') return;
      const email = normalizeEmail(member.email);
      if (email) emails.add(email);
    });
    return emails;
  }, [staff]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminListStaff();
      setStaff(Array.isArray(data?.staff) ? data.staff : []);
    } catch (err) {
      setStaff([]);
      setError(mensagemErroCallable(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingMember(null);
    setFormEmail('');
    setFormPermissions(buildEmptyPermissions());
  }, []);

  const openAddModal = () => {
    setMessage('');
    setError('');
    setEditingMember(null);
    setFormEmail('');
    setFormPermissions(buildEmptyPermissions());
    setIsModalOpen(true);
  };

  const openEditModal = (member) => {
    setMessage('');
    setError('');
    setEditingMember(member);
    setFormEmail(member?.email || '');
    setFormPermissions(() => {
      const next = buildEmptyPermissions();
      STAFF_PERMISSION_FIELDS.forEach(({ field }) => {
        next[field] = member?.permissions?.[field] === true;
      });
      return next;
    });
    setIsModalOpen(true);
  };

  const togglePermission = (field) => {
    setFormPermissions((current) => ({ ...current, [field]: !current[field] }));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');

    const email = normalizeEmail(formEmail);
    if (!email) {
      setError('Informe um e-mail valido para continuar.');
      return;
    }

    const currentEditingEmail = normalizeEmail(editingMember?.email);
    const emailAlreadyExists = existingAdminEmails.has(email) && email !== currentEditingEmail;
    if (emailAlreadyExists) {
      setError('Ja existe um admin cadastrado com este e-mail.');
      return;
    }

    setBusy(true);
    try {
      await adminUpsertStaff({
        email,
        role: 'admin',
        permissions: buildPayloadFromPermissions(formPermissions),
      });
      setMessage(editingMember ? 'Membro atualizado com sucesso.' : 'Membro adicionado com sucesso.');
      closeModal();
      await load();
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (member) => {
    if (!member?.uid || member?.role === 'super_admin' || !canManageMembers) return;
    if (!window.confirm(`Remover ${member.name || member.email || 'este admin'} da equipe?`)) {
      return;
    }

    setBusy(true);
    setMessage('');
    setError('');
    try {
      await adminRemoveStaff({ uid: member.uid });
      setMessage('Membro removido com sucesso.');
      await load();
    } catch (err) {
      setError(mensagemErroCallable(err));
    } finally {
      setBusy(false);
    }
  };

  const adminMembers = staff.filter((member) => member?.role === 'admin');
  const superAdmins = staff.filter((member) => member?.role === 'super_admin');

  return (
    <main className="admin-empty-page admin-team-page">
      <section className="admin-empty-card admin-team-shell">
        <header className="financeiro-header admin-team-header">
          <div>
            <p className="admin-team-eyebrow">Administracao</p>
            <h1>Equipe</h1>
            <p>Gerencie administradores da plataforma</p>
          </div>
          {canManageMembers ? (
            <button type="button" className="financeiro-btn-primary" onClick={openAddModal} disabled={busy}>
              + Adicionar membro
            </button>
          ) : null}
        </header>

        {error ? <p className="financeiro-msg financeiro-msg--erro">{error}</p> : null}
        {message ? <p className="financeiro-msg financeiro-msg--ok">{message}</p> : null}

        <section className="admin-team-overview">
          <article className="admin-team-stat-card">
            <span>Total de membros</span>
            <strong>{staff.length}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Super admins</span>
            <strong>{superAdmins.length}</strong>
          </article>
          <article className="admin-team-stat-card">
            <span>Admins</span>
            <strong>{adminMembers.length}</strong>
          </article>
        </section>

        <section className="admin-team-panel">
          <div className="admin-team-panel-head">
            <div>
              <h2>Membros</h2>
              <p>Fonte de verdade: <code>admins/registry</code>; claims so espelham o acesso ja resolvido no backend.</p>
            </div>
          </div>

          {loading ? <p className="admin-staff-loading">Carregando equipe...</p> : null}
          {!loading && staff.length === 0 ? <p className="admin-staff-empty">Nenhum membro encontrado.</p> : null}

          {!loading && staff.length > 0 ? (
            <div className="admin-team-table-wrap">
              <table className="admin-team-table">
                <thead>
                  <tr>
                    <th>Membro</th>
                    <th>Role</th>
                    <th>Permissoes</th>
                    <th className="admin-team-actions-col">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((member) => {
                    const displayName = member?.name || member?.email || member?.uid;
                    const email = member?.email || 'E-mail indisponivel';
                    const permissionCount = countActivePermissions(member?.permissions);
                    const canEdit = canManageMembers && member?.role === 'admin' && Boolean(member?.email);
                    const canRemove = canManageMembers && member?.role === 'admin';

                    return (
                      <tr key={member.uid}>
                        <td>
                          <div className="admin-team-member-cell">
                            <strong>{displayName}</strong>
                            <span>{email}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`admin-team-role-badge admin-team-role-badge--${member.role}`}>
                            {member.role === 'super_admin' ? 'super_admin' : 'admin'}
                          </span>
                        </td>
                        <td>
                          <span className="admin-team-permission-summary">
                            {member.role === 'super_admin'
                              ? 'Acesso total'
                              : `${permissionCount} permiss${permissionCount === 1 ? 'ao ativa' : 'oes ativas'}`}
                          </span>
                        </td>
                        <td>
                          <div className="admin-team-row-actions">
                            {canEdit ? (
                              <button type="button" onClick={() => openEditModal(member)} disabled={busy}>
                                Editar
                              </button>
                            ) : null}
                            {canRemove ? (
                              <button
                                type="button"
                                className="admin-team-danger-btn"
                                onClick={() => handleRemove(member)}
                                disabled={busy}
                              >
                                Remover
                              </button>
                            ) : null}
                            {!canEdit && !canRemove ? <span className="admin-team-muted-action">Protegido</span> : null}
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

        {isModalOpen ? (
          <div className="admin-team-modal-backdrop" role="presentation" onClick={closeModal}>
            <section
              className="admin-team-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-team-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="admin-team-modal-head">
                <div>
                  <p className="admin-team-eyebrow">Equipe</p>
                  <h2 id="admin-team-modal-title">{editingMember ? 'Editar membro' : 'Adicionar membro'}</h2>
                </div>
                <button type="button" className="admin-team-close-btn" onClick={closeModal} disabled={busy}>
                  Fechar
                </button>
              </div>

              <form className="admin-team-form" onSubmit={handleSave}>
                <label>
                  Email
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(event) => setFormEmail(event.target.value)}
                    placeholder="nome@empresa.com"
                    autoComplete="off"
                    readOnly={Boolean(editingMember)}
                  />
                </label>

                <label>
                  Role
                  <input type="text" value="admin" readOnly />
                </label>

                <fieldset className="admin-team-permission-groups">
                  <legend>Permissoes</legend>
                  {Object.entries(permissionGroups).map(([category, items]) => (
                    <div key={category} className="admin-team-permission-group">
                      <h3>{category}</h3>
                      <div className="admin-team-checkbox-list">
                        {items.map((item) => (
                          <label key={item.field} className="admin-team-checkbox">
                            <input
                              type="checkbox"
                              checked={formPermissions[item.field] === true}
                              onChange={() => togglePermission(item.field)}
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </fieldset>

                <div className="admin-team-modal-actions">
                  <button type="button" onClick={closeModal} disabled={busy}>
                    Cancelar
                  </button>
                  <button type="submit" className="financeiro-btn-primary" disabled={busy}>
                    {busy ? 'Salvando...' : editingMember ? 'Salvar alteracoes' : 'Adicionar membro'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
