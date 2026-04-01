import React from 'react';
import { useNavigate } from 'react-router-dom';

import CapitulosAdminHub from '../Admin/CapitulosAdminHub.jsx';
import './CreatorFrame.css';

export default function CreatorChaptersPage({ adminAccess }) {
  const navigate = useNavigate();

  return (
    <div className="creator-frame-page">
      <section className="creator-frame-shell">
        <header className="creator-frame-hero">
          <div>
            <p className="creator-frame-eyebrow">Creator Chapters</p>
            <h1>Capítulos e publicação</h1>
            <p>
              Escolha a obra, acompanhe a linha editorial e publique capítulos com lançamento normal
              ou early access para membros do seu creatorId.
            </p>
          </div>
          <div className="creator-frame-actions">
            <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/editor')}>
              Novo capítulo
            </button>
            <button type="button" className="creator-frame-btn is-primary" onClick={() => navigate('/creator/dashboard')}>
              Voltar ao workspace
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Cadência</strong>
            <p>Seu ritmo de publicação vive aqui, obra por obra, sem precisar depender do admin.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Early access</strong>
            <p>Capítulos antecipados seguem a regra correta: acesso só para membros do criador correspondente.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Revisão</strong>
            <p>Use este hub para revisar capítulos existentes e entrar rápido no editor quando precisar.</p>
          </article>
        </section>

        <CapitulosAdminHub adminAccess={adminAccess} workspace="creator" />
      </section>
    </div>
  );
}
