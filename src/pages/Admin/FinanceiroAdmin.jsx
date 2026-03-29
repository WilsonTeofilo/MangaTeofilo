import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import './FinanceiroAdmin.css';

const migrateDeprecatedFields = httpsCallable(functions, 'adminMigrateDeprecatedUserFields');

export default function FinanceiroAdmin() {
  const navigate = useNavigate();
  const [migrando, setMigrando] = useState(false);
  const [msgMigracao, setMsgMigracao] = useState('');

  const rodarMigracaoCampos = async () => {
    setMsgMigracao('');
    setMigrando(true);
    try {
      const { data } = await migrateDeprecatedFields();
      setMsgMigracao(
        `OK: usuarios ajustados ${data?.usuariosComPatch ?? 0}, publicos ${data?.publicosComPatch ?? 0}. ${data?.message || ''}`
      );
    } catch (err) {
      setMsgMigracao(err.message || String(err));
    } finally {
      setMigrando(false);
    }
  };

  return (
    <main className="admin-empty-page">
      <section className="admin-empty-card">
        <h1>Financeiro Administrativo</h1>
        <p>Area reservada para planos, promocoes, vendas normais e integracao de pagamentos.</p>

        <div className="financeiro-migracao">
          <h2>Migracao de campos obsoletos (RTDB)</h2>
          <p className="financeiro-migracao-texto">
            Edite as listas em <code>src/config/userDeprecatedFields.js</code> e mantenha{' '}
            <code>functions/deprecatedUserFields.js</code> igual. Depois do deploy da function,
            use o botao para remover essas chaves de <strong>todos</strong> os usuarios de uma vez.
            Quem so entrar de novo no app tambem e limpo automaticamente no login.
          </p>
          <button
            type="button"
            className="financeiro-btn-migrar"
            disabled={migrando}
            onClick={rodarMigracaoCampos}
          >
            {migrando ? 'Rodando...' : 'Rodar migracao (admin)'}
          </button>
          {msgMigracao && <p className="financeiro-migracao-msg">{msgMigracao}</p>}
        </div>

        <button type="button" onClick={() => navigate('/')}>Voltar para inicio</button>
      </section>
    </main>
  );
}
