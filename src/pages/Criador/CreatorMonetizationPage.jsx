import React from 'react';
import { useNavigate } from 'react-router-dom';

import CreatorMonetizationDashboard from './CreatorMonetizationDashboardClean.jsx';
import './CreatorFrame.css';

export default function CreatorMonetizationPage({ user }) {
  const navigate = useNavigate();

  return (
    <div className="creator-frame-page">
      <section className="creator-frame-shell">
        <header className="creator-frame-hero">
          <div>
            <p className="creator-frame-eyebrow">Monetização do criador</p>
            <h1>Ganhos, membros e loja</h1>
            <p>
              Acompanhe seus ganhos por tipo, a base de membros e os resultados da loja sem depender do painel
              administrativo da plataforma.
            </p>
          </div>
          <div className="creator-frame-actions">
            <button type="button" className="creator-frame-btn is-primary" onClick={() => navigate('/perfil')}>
              Meu perfil
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Membership</strong>
            <p>Veja o que veio dos membros recorrentes do seu perfil e acompanhe a retenção da base.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Apoios</strong>
            <p>Separação clara entre membros, apoios e loja para facilitar a leitura dos seus ganhos.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Promoções</strong>
            <p>Use promoções para organizar campanhas sem misturar isso com o financeiro global da plataforma.</p>
          </article>
        </section>

        <CreatorMonetizationDashboard user={user} />
      </section>
    </div>
  );
}
