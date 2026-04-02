import React from 'react';
import { useNavigate } from 'react-router-dom';

import CreatorMonetizationDashboard from './CreatorMonetizationDashboard.jsx';
import './CreatorFrame.css';

export default function CreatorMonetizationPage({ user }) {
  const navigate = useNavigate();

  return (
    <div className="creator-frame-page">
      <section className="creator-frame-shell">
        <header className="creator-frame-hero">
          <div>
            <p className="creator-frame-eyebrow">Creator Monetization</p>
            <h1>Ganhos, membros e promoções</h1>
            <p>
              Acompanhe entradas por tipo, recorrência de membros, campanhas e o efeito da sua monetização
              sem depender do painel administrativo da plataforma.
            </p>
          </div>
          <div className="creator-frame-actions">
            <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/perfil')}>
              Configurar apoio
            </button>
            <button
              type="button"
              className="creator-frame-btn is-primary"
              onClick={() => navigate('/creator/dashboard')}
            >
              Voltar ao workspace
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Membership</strong>
            <p>Veja o que veio de membros recorrentes do seu creatorId e acompanhe a retenção da base.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Apoios</strong>
            <p>Separação clara entre membership, apoios e loja para facilitar leitura de receita real.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Promoções</strong>
            <p>Use promoções como ferramenta operacional sua, sem misturar com o financeiro global da plataforma.</p>
          </article>
        </section>

        <CreatorMonetizationDashboard user={user} />
      </section>
    </div>
  );
}
