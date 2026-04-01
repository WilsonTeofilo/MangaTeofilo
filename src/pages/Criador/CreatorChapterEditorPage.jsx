import React from 'react';
import { useNavigate } from 'react-router-dom';

import AdminPanel from '../Admin/AdminPanel.jsx';
import './CreatorFrame.css';

export default function CreatorChapterEditorPage({ adminAccess }) {
  const navigate = useNavigate();

  return (
    <div className="creator-frame-page">
      <section className="creator-frame-shell">
        <header className="creator-frame-hero">
          <div>
            <p className="creator-frame-eyebrow">Creator Editor</p>
            <h1>Estúdio de capítulo</h1>
            <p>
              Monte páginas, ajuste capa, revise o lançamento e publique sem sair do contexto creator.
              O editor continua poderoso, mas agora entra com cara de estúdio autoral.
            </p>
          </div>
          <div className="creator-frame-actions">
            <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/capitulos')}>
              Voltar para capítulos
            </button>
            <button type="button" className="creator-frame-btn is-primary" onClick={() => navigate('/creator/dashboard')}>
              Voltar ao workspace
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Upload e organização</strong>
            <p>Suba páginas, reordene e revise tudo antes de publicar o capítulo.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Capa do capítulo</strong>
            <p>O enquadramento final replica o que o leitor realmente verá no site.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Lançamento</strong>
            <p>Defina publicação imediata ou agendada e use membership antecipada quando fizer sentido.</p>
          </article>
        </section>

        <AdminPanel adminAccess={adminAccess} workspace="creator" />
      </section>
    </div>
  );
}
