import React from 'react';
import { useNavigate } from 'react-router-dom';

import Perfil from '../Perfil/Perfil.jsx';
import './CreatorFrame.css';

export default function CreatorProfilePage({ user, adminAccess }) {
  const navigate = useNavigate();

  return (
    <div className="creator-frame-page">
      <section className="creator-frame-shell">
        <header className="creator-frame-hero">
          <div>
            <p className="creator-frame-eyebrow">Creator Identity</p>
            <h1>Perfil e presença pública</h1>
            <p>
              Ajuste seu nome artístico, bio, redes, avatar e configuração de apoio no mesmo lugar.
              Esta é a base do seu perfil público e também do onboarding do criador.
            </p>
          </div>
          <div className="creator-frame-actions">
            <button type="button" className="creator-frame-btn" onClick={() => navigate(`/criador/${encodeURIComponent(user?.uid || '')}`)}>
              Ver página pública
            </button>
            <button type="button" className="creator-frame-btn is-primary" onClick={() => navigate('/creator/dashboard')}>
              Voltar ao workspace
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Identidade</strong>
            <p>Seu nome, bio e redes definem como leitores e apoiadores percebem seu trabalho.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Monetização</strong>
            <p>A escolha entre apenas publicar e monetizar fica aqui, junto com a configuração de apoio.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Onboarding</strong>
            <p>O progresso do criador depende da qualidade desse perfil, não só da aprovação inicial.</p>
          </article>
        </section>

        <Perfil user={user} adminAccess={adminAccess} />
      </section>
    </div>
  );
}
