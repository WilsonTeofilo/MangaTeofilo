import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import CreatorStoreOperations from './CreatorStoreOperations.jsx';
import LojaAdmin from '../Admin/LojaAdmin.jsx';
import './CreatorFrame.css';

export default function CreatorStorePage({ user, adminAccess }) {
  const navigate = useNavigate();
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="creator-frame-page">
      <section className="creator-frame-shell">
        <header className="creator-frame-hero">
          <div>
            <p className="creator-frame-eyebrow">Creator Store</p>
            <h1>Produtos, pedidos e operação</h1>
            <p>
              Gerencie sua operação comercial no mesmo contexto do creator. Aqui entram produtos, estoque
              e pedidos ligados ao seu catálogo, sem misturar configuração global da plataforma.
            </p>
          </div>
          <div className="creator-frame-actions">
            <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/obras')}>
              Ir para obras
            </button>
            <button type="button" className="creator-frame-btn is-primary" onClick={() => navigate('/creator/dashboard')}>
              Voltar ao workspace
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Catálogo</strong>
            <p>Cadastre produtos conectados ao seu universo e mantenha a operação sob seu creatorId.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Pedidos</strong>
            <p>Você vê só o que pertence ao seu escopo, com volume e status já filtrados para sua rotina.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Escala</strong>
            <p>O admin segue controlando a loja global, enquanto você opera apenas seu lado da estrutura.</p>
          </article>
        </section>

        <CreatorStoreOperations
          user={user}
          showAdvanced={showAdvanced}
          onToggleAdvanced={() => setShowAdvanced((value) => !value)}
        />

        {showAdvanced ? <LojaAdmin user={user} adminAccess={adminAccess} workspace="creator" /> : null}
      </section>
    </div>
  );
}
