import React from 'react';
import { useNavigate } from 'react-router-dom';

import ObrasAdmin from '../Admin/ObrasAdmin.jsx';
import './CreatorFrame.css';

export default function CreatorWorksPage({ adminAccess }) {
  const navigate = useNavigate();

  return (
    <div className="creator-frame-page">
      <section className="creator-frame-shell">
        <header className="creator-frame-hero">
          <div>
            <p className="creator-frame-eyebrow">Creator Works</p>
            <h1>Minhas obras</h1>
            <p>
              Organize seu catálogo, ajuste capa e banner, refine SEO e publique com clareza.
              Esta área existe para o autor operar o próprio universo, não para administrar a plataforma.
            </p>
          </div>
          <div className="creator-frame-actions">
            <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/capitulos')}>
              Ver capítulos
            </button>
            <button type="button" className="creator-frame-btn is-primary" onClick={() => navigate('/perfil')}>
              Meu perfil
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Identidade editorial</strong>
            <p>Nome, sinopse, capa e banner moldam a primeira impressão da obra no catálogo.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Publicação</strong>
            <p>Use status e visibilidade para controlar quando a obra está pronta para leitores reais.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Fluxo creator</strong>
            <p>O criador vê só o próprio catálogo; o admin pode supervisionar tudo no mesmo domínio.</p>
          </article>
        </section>

        <ObrasAdmin adminAccess={adminAccess} workspace="creator" />
      </section>
    </div>
  );
}
