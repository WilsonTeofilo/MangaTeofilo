import React from 'react';
import { useNavigate } from 'react-router-dom';

import CreatorStoreOperations from './CreatorStoreOperations.jsx';
import './CreatorFrame.css';

export default function CreatorStorePage({ user }) {
  const navigate = useNavigate();

  return (
    <div className="creator-frame-page">
      <section className="creator-frame-shell">
        <header className="creator-frame-hero">
          <div>
            <p className="creator-frame-eyebrow">Creator Store</p>
            <h1>Produtos, pedidos e operação</h1>
            <p>
              Gerencie sua operação comercial no mesmo contexto do creator. Catálogo completo e criação de produtos
              ficam em telas dedicadas; aqui você vê resumo, pedidos e atalhos.
            </p>
          </div>
          <div className="creator-frame-actions">
            <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/obras')}>
              Ir para obras
            </button>
            <button
              type="button"
              className="creator-frame-btn is-primary"
              onClick={() => navigate('/creator/loja/produtos')}
            >
              Catálogo e produtos
            </button>
            <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/dashboard')}>
              Voltar ao workspace
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Catálogo</strong>
            <p>Lista, novo produto e edição com foco em preço e margem — em /creator/loja/produtos.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Pedidos</strong>
            <p>Você vê só o que pertence ao seu escopo, com volume e status já filtrados para sua rotina.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Escala</strong>
            <p>O admin controla a loja global; você opera apenas o que está ligado ao seu creatorId.</p>
          </article>
        </section>

        <CreatorStoreOperations user={user} />
      </section>
    </div>
  );
}
