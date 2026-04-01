import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import './FinanceiroAdmin.css';
import './AdminStaff.css';

const adminRevokeUserSessions = httpsCallable(functions, 'adminRevokeUserSessions');
const adminRevokeAllSessions = httpsCallable(functions, 'adminRevokeAllSessions');

export default function SessoesAdmin({ adminAccess }) {
  const navigate = useNavigate();
  const [revokeEmail, setRevokeEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const isChief = adminAccess?.isChiefAdmin === true;

  const handleRevokeOne = async () => {
    const em = String(revokeEmail || '').trim();
    if (!em) {
      setErr('Informe o e-mail do usuário.');
      return;
    }
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await adminRevokeUserSessions({ email: em });
      setMsg('Sessão revogada. O usuário precisará entrar de novo.');
      setRevokeEmail('');
    } catch (e) {
      setErr(mensagemErroCallable(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeAll = async () => {
    if (
      !window.confirm(
        'Isso desloga TODOS os usuários (incluindo você). Só use em emergência. Continuar?'
      )
    ) {
      return;
    }
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const { data } = await adminRevokeAllSessions();
      setMsg(`Revogado em ${data?.revoked ?? '?'} contas. Faça login novamente.`);
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
            <h1>Sessões</h1>
            <p>
              Revoga refresh tokens no Firebase Auth. Útil para forçar novo login ou destravar conta.
              Quem tem permissão de equipe pode revogar um usuário; revogar todos é só admin chefe.
            </p>
          </div>
          <div className="financeiro-header-actions admin-staff-sessoes-actions">
            {isChief ? (
              <button type="button" className="financeiro-btn-primary" onClick={() => navigate('/admin/equipe')}>
                Equipe (admins)
              </button>
            ) : null}
            <button type="button" onClick={() => navigate('/admin/capitulos')}>
              Voltar
            </button>
          </div>
        </header>

        {err ? <p className="financeiro-msg financeiro-msg--erro">{err}</p> : null}
        {msg ? <p className="financeiro-msg financeiro-msg--ok">{msg}</p> : null}

        <div className="admin-staff-stack">
          <section className="financeiro-migracao">
            <h2>Um usuário (e-mail)</h2>
            <p className="financeiro-migracao-texto">
              Informe o e-mail da conta no Firebase Auth. O usuário perde sessões ativas imediatamente.
            </p>
            <div className="admin-staff-sessoes-row">
              <div className="financeiro-grid">
                <label className="financeiro-grid-full">
                  E-mail
                  <input
                    type="email"
                    placeholder="nome@exemplo.com"
                    value={revokeEmail}
                    onChange={(ev) => setRevokeEmail(ev.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>
              <button
                type="button"
                className="financeiro-btn-primary"
                disabled={busy}
                onClick={handleRevokeOne}
              >
                Deslogar usuário
              </button>
            </div>
          </section>

          {isChief ? (
            <section className="financeiro-migracao admin-staff-danger-block">
              <h2>Todo mundo</h2>
              <p className="financeiro-migracao-texto">
                Revoga tokens de <strong>todas</strong> as contas. Use só em emergência (conta comprometida,
                bug de sessão, etc.).
              </p>
              <div className="financeiro-acoes">
                <button type="button" className="financeiro-btn-encerrar" disabled={busy} onClick={handleRevokeAll}>
                  Revogar todas as sessões
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
