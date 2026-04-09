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
              Organize seu catalogo, ajuste capa e banner, refine SEO e publique com clareza.
              Esta area existe para o autor operar o proprio universo, nao para administrar a plataforma.
            </p>
          </div>
          <div className="creator-frame-actions">
            <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/capitulos')}>
              Ver capitulos
            </button>
            <button type="button" className="creator-frame-btn is-primary" onClick={() => navigate('/perfil')}>
              Meu perfil
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Identidade editorial</strong>
            <p>Nome, sinopse, capa e banner moldam a primeira impressao da obra no catalogo.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Publicacao</strong>
            <p>Use status e visibilidade para controlar quando a obra esta pronta para leitores reais.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Fluxo creator</strong>
            <p>O criador ve so o proprio catalogo; o admin pode supervisionar tudo no mesmo dominio.</p>
          </article>
        </section>

        <ObrasAdmin adminAccess={adminAccess} workspace="creator" />
      </section>
    </div>
  );
}
