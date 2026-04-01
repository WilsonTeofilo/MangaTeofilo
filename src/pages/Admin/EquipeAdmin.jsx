import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { STAFF_PERMISSION_FIELDS } from '../../auth/adminPermissions';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import './FinanceiroAdmin.css';
import './AdminStaff.css';

const adminListStaff = httpsCallable(functions, 'adminListStaff');
const adminUpsertStaff = httpsCallable(functions, 'adminUpsertStaff');
const adminRemoveStaff = httpsCallable(functions, 'adminRemoveStaff');
const adminBackfillObraCreatorIds = httpsCallable(functions, 'adminBackfillObraCreatorIds');
const adminBackfillChapterCreatorIds = httpsCallable(functions, 'adminBackfillChapterCreatorIds');

function emptyPermState() {
  const o = {};
  STAFF_PERMISSION_FIELDS.forEach(({ field }) => {
    o[field] = false;
  });
  return o;
}

export default function EquipeAdmin() {
  const navigate = useNavigate();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [emailNovo, setEmailNovo] = useState('');
  const [staffRoleForm, setStaffRoleForm] = useState('admin');
  const [permForm, setPermForm] = useState(() => emptyPermState());
  const [busy, setBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const { data } = await adminListStaff();
      setStaff(Array.isArray(data?.staff) ? data.staff : []);
    } catch (e) {
      setErr(mensagemErroCallable(e));
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const togglePerm = (field) => {
    setPermForm((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const permissoesPayload = useMemo(() => {
    const o = {};
    STAFF_PERMISSION_FIELDS.forEach(({ field }) => {
      if (permForm[field]) o[field] = true;
    });
    return o;
  }, [permForm]);

  const handleUpsert = async (e) => {
    e.preventDefault();
    setMsg('');
    setErr('');
    const em = String(emailNovo || '').trim();
    if (!em) {
      setErr('Informe o e-mail do usuário (conta já existente no Firebase Auth).');
      return;
    }
    setBusy(true);
    try {
      await adminUpsertStaff({
        email: em,
        permissions: staffRoleForm === 'mangaka' ? {} : permissoesPayload,
        role: staffRoleForm,
      });
      setMsg(
        'Conta atualizada. O usuário precisa renovar a sessão (sair e entrar, ou aguardar e recarregar) para o token refletir o novo papel.'
      );
      setEmailNovo('');
      setPermForm(emptyPermState());
      await load();
    } catch (e) {
      setErr(mensagemErroCallable(e));
    } finally {
      setBusy(false);
    }
  };

  const runBackfillObras = async () => {
    setBackfillMsg('');
    setBusy(true);
    try {
      const { data } = await adminBackfillObraCreatorIds();
      setBackfillMsg(`Obras atualizadas: ${Number(data?.updated || 0)}.`);
    } catch (e) {
      setBackfillMsg(mensagemErroCallable(e));
    } finally {
      setBusy(false);
    }
  };

  const runBackfillCaps = async () => {
    setBackfillMsg('');
    setBusy(true);
    try {
      const { data } = await adminBackfillChapterCreatorIds();
      setBackfillMsg(`Capítulos atualizados: ${Number(data?.updated || 0)}.`);
    } catch (e) {
      setBackfillMsg(mensagemErroCallable(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (uid) => {
    if (!uid) return;
    if (!window.confirm('Remover este registro (admin ou mangaká)? Claims e role no RTDB serão limpos.')) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await adminRemoveStaff({ uid });
      setMsg('Admin removido.');
      await load();
    } catch (e) {
      setErr(mensagemErroCallable(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-empty-page">
      <section className="admin-empty-card financeiro-card">
        <header className="financeiro-header">
          <div>
            <h1>Equipe (admins e mangakás)</h1>
            <p>
              Só admin chefe cria ou remove contas do registro. Mangaká acessa o mesmo painel com dados filtrados
              (multi-tenant). Admins personalizados não removem uns aos outros nem o chefe.
            </p>
          </div>
          <div className="financeiro-header-actions">
            <button type="button" onClick={() => navigate('/admin/sessoes')}>
              Sessões
            </button>
            <button type="button" onClick={() => navigate('/admin/capitulos')}>
              Voltar
            </button>
          </div>
        </header>

        {err ? <p className="financeiro-msg financeiro-msg--erro">{err}</p> : null}
        {msg ? <p className="financeiro-msg financeiro-msg--ok">{msg}</p> : null}
        {backfillMsg ? <p className="financeiro-msg financeiro-msg--ok">{backfillMsg}</p> : null}

        <section className="financeiro-migracao">
          <h2>Multi-tenant (migração)</h2>
          <p className="financeiro-section-hint">
            Preenche <code>creatorId</code> em obras/capítulos antigos (dono legado = primeiro super-admin). Rode
            obras primeiro, depois capítulos.
          </p>
          <div className="admin-staff-submit-row financeiro-acoes">
            <button type="button" className="financeiro-btn-primary" disabled={busy} onClick={runBackfillObras}>
              Backfill obras
            </button>
            <button type="button" className="financeiro-btn-primary" disabled={busy} onClick={runBackfillCaps}>
              Backfill capítulos
            </button>
          </div>
        </section>

        <div className="admin-staff-stack">
          <section className="financeiro-migracao">
            <h2>Nova conta no registro (por e-mail)</h2>
            <form onSubmit={handleUpsert}>
              <div className="financeiro-grid">
                <label className="financeiro-grid-full">
                  E-mail (conta Firebase Auth)
                  <input
                    type="email"
                    value={emailNovo}
                    onChange={(ev) => setEmailNovo(ev.target.value)}
                    autoComplete="off"
                    placeholder="nome@exemplo.com"
                  />
                </label>
              </div>

              <fieldset className="admin-staff-perms">
                <legend>Tipo</legend>
                <label className="admin-staff-perm-label">
                  <input
                    type="radio"
                    name="staff-role"
                    checked={staffRoleForm === 'admin'}
                    onChange={() => setStaffRoleForm('admin')}
                  />
                  <span>Admin da plataforma (permissões abaixo + claim admin)</span>
                </label>
                <label className="admin-staff-perm-label">
                  <input
                    type="radio"
                    name="staff-role"
                    checked={staffRoleForm === 'mangaka'}
                    onChange={() => setStaffRoleForm('mangaka')}
                  />
                  <span>Mangaká (painel com obras/capítulos/financeiro só do criador)</span>
                </label>
              </fieldset>

              {staffRoleForm === 'admin' ? (
                <fieldset className="admin-staff-perms">
                  <legend>Permissões</legend>
                  <div className="admin-staff-perms-grid">
                    {STAFF_PERMISSION_FIELDS.map(({ field, label }) => (
                      <label key={field} className="admin-staff-perm-label">
                        <input
                          type="checkbox"
                          checked={Boolean(permForm[field])}
                          onChange={() => togglePerm(field)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              <div className="admin-staff-submit-row financeiro-acoes">
                <button type="submit" className="financeiro-btn-primary" disabled={busy}>
                  {staffRoleForm === 'mangaka' ? 'Salvar mangaká' : 'Salvar admin'}
                </button>
              </div>
            </form>
          </section>

          <section className="financeiro-migracao">
            <h2>Registro (admins e mangakás)</h2>
            {loading ? <p className="admin-staff-loading">Carregando…</p> : null}
            {!loading && staff.length === 0 ? (
              <p className="admin-staff-empty">
                Nenhum registro em <code>admins/registry</code>.
              </p>
            ) : null}
            {!loading && staff.length > 0 ? (
              <ul className="admin-staff-member-list">
                {staff.map((row) => (
                  <li key={row.uid} className="admin-staff-member-card">
                    <div className="admin-staff-member-email">{row.email || row.uid}</div>
                    <div className="admin-staff-member-uid">
                      {row.uid}{' '}
                      <span className="admin-staff-role-pill">
                        {row.role === 'mangaka' ? 'mangaká' : 'admin'}
                      </span>
                    </div>
                    <div className="admin-staff-member-actions">
                      <button
                        type="button"
                        className="financeiro-btn-encerrar"
                        disabled={busy}
                        onClick={() => handleRemove(row.uid)}
                      >
                        Remover
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}
