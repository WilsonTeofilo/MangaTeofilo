import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import './SobreAutorV2.css';

const INTRO_METRICS = [
  { label: 'Visão', value: 'Arte + tecnologia' },
  { label: 'Foco', value: 'Autores independentes' },
  { label: 'Projeto', value: 'Kokuin e MangaTeofilo' },
];

const STORY_BLOCKS = [
  {
    title: 'O ponto de virada',
    text:
      'A MangaTeofilo não nasceu para ser só mais um site de leitura. Veio de um incômodo real: muita gente tem universo, personagem e conflito, mas trava no meio do caminho porque acha que, sem desenho impecável, não há história possível. Queremos derrubar essa ideia e tornar a criação autoral mais acessível, organizada e viável.',
  },
  {
    title: 'Como tudo começou',
    text:
      'Antes de código, layout ou sistema, veio a paixão cedo. Pokémon abriu a porta, Dragon Ball Z acelerou o interesse e Naruto mostrou como histórias marcam a gente. Ler deixou de ser obrigação e virou porta para mundos novos. Entre manutenção, curiosidade técnica, computador desmontado e estudo, a vontade de criar algo próprio foi crescendo até virar um formato claro.',
    accent: true,
  },
  {
    title: 'O que a plataforma entrega',
    text:
      'Hoje a proposta é juntar descoberta, leitura, acompanhamento de autores, publicação de obras e produtos ligados a essas histórias no mesmo lugar. Em vez de espalhar o criador em ferramentas soltas, a MangaTeofilo organiza a jornada com identidade, vitrine, ranking e caminhos para monetização, sempre com o autor no centro do que construiu.',
  },
];

export default function SobreAutorV2() {
  const navigate = useNavigate();
  const [isPhotoHovered, setIsPhotoHovered] = useState(false);
  const [revelarPorToque, setRevelarPorToque] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(hover: none), (pointer: coarse)');
    const apply = () => setRevelarPorToque(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const handleFotoClick = useCallback(() => {
    if (!revelarPorToque) return;
    setIsPhotoHovered((value) => !value);
  }, [revelarPorToque]);

  return (
    <div className="sobre-autor-page">
      <main className="sobre-autor-content">
        <section className="sobre-hero">
          <div className="sobre-copy">
            <span className="sobre-eyebrow">SOBRE NÓS</span>
            <h1 className="sobre-title">Uma plataforma para transformar ideia em obra viva.</h1>
            <p className="sobre-lead">
              A MangaTeofilo conecta criação autoral, leitura, descoberta e identidade visual em um único
              ecossistema. O objetivo não é só publicar mangá: é dar um lugar onde histórias independentes
              nasçam, cresçam e encontrem leitores de verdade.
            </p>

            <div className="sobre-metrics" aria-label="Resumo da proposta">
              {INTRO_METRICS.map((item) => (
                <article key={item.label} className="sobre-metric-card">
                  <span className="sobre-metric-label">{item.label}</span>
                  <strong className="sobre-metric-value">{item.value}</strong>
                </article>
              ))}
            </div>
          </div>

          <aside className="sobre-visual">
            <div
              className={`sobre-portrait-shell ${isPhotoHovered ? 'is-hovered' : ''}`}
              onMouseEnter={() => {
                if (!revelarPorToque) setIsPhotoHovered(true);
              }}
              onMouseLeave={() => {
                if (!revelarPorToque) setIsPhotoHovered(false);
              }}
              onClick={handleFotoClick}
              role={revelarPorToque ? 'button' : 'presentation'}
              tabIndex={revelarPorToque ? 0 : undefined}
              onKeyDown={(event) => {
                if (!revelarPorToque) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setIsPhotoHovered((value) => !value);
                }
              }}
            >
              <div className="sobre-portrait-frame">
                <img
                  src="/assets/fotos/teofilo.jpg"
                  className="sobre-portrait sobre-portrait--real"
                  alt="Wilson Teofilo"
                  loading="lazy"
                  onError={(event) => {
                    event.target.src = '/assets/avatares/ava1.webp';
                  }}
                />
                <img
                  src="/assets/fotos/teofilomangá.jpg"
                  className="sobre-portrait sobre-portrait--manga"
                  alt="Wilson Teofilo em estilo mangá"
                  loading="lazy"
                  onError={(event) => {
                    event.target.src = '/assets/avatares/ava2.webp';
                  }}
                />
                <div className="sobre-portrait-overlay" />
              </div>

              <div className="sobre-visual-copy">
                <span className="sobre-visual-role">AUTOR E FUNDADOR</span>
                <strong className="sobre-visual-name">Wilson Teofilo</strong>
                <p className="sobre-visual-text">
                  Código, manutenção, narrativa e visão de produto caminhando juntos para dar forma a um
                  projeto autoral que ainda está só no começo.
                </p>
              </div>
            </div>

            {revelarPorToque && (
              <p className="sobre-touch-hint" aria-live="polite">
                {isPhotoHovered
                  ? 'Toque de novo para voltar à foto original.'
                  : 'Toque na foto para revelar a versão mangá.'}
              </p>
            )}
          </aside>
        </section>

        <section className="sobre-story-grid">
          <div className="sobre-story-intro">
            <span className="sobre-section-label">Manifesto</span>
            <h2 className="sobre-section-title">Criar não deveria depender de permissão.</h2>
            <p className="sobre-section-text">
              A proposta é clara: menos atrito, experiência organizada e obra apresentada com capricho, sem
              perder a cara de quem criou. O leitor acha rápido o que busca, o autor ganha base sólida e a
              história deixa de parecer perdida no meio da página.
            </p>
          </div>

          <div className="sobre-story-stack">
            {STORY_BLOCKS.map((block) => (
              <article
                key={block.title}
                className={`sobre-story-card ${block.accent ? 'sobre-story-card--accent' : ''}`}
              >
                <h3 className={`sobre-story-title ${block.accent ? 'sobre-story-title--neon' : ''}`}>
                  {block.title}
                </h3>
                <p className="sobre-story-text">{block.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="sobre-cta-panel">
          <div>
            <span className="sobre-section-label">Próximo passo</span>
            <h2 className="sobre-cta-title">A melhor forma de sentir a proposta ainda é entrando no universo.</h2>
            <p className="sobre-cta-text">
              Kokuin: Herança do Abismo é a obra-base dessa visão. Ler e ver o projeto em movimento ajuda a
              entender o que a plataforma quer construir daqui para frente.
            </p>
          </div>

          <div className="bio-cta bio-cta--stacked">
            <button
              className="hn-cta hn-cta--ghost"
              onClick={() => navigate('/kokuin', { state: { from: '/sobre-autor' } })}
            >
              DETALHES DA OBRA
            </button>
            <button
              className="hn-cta"
              onClick={() => navigate('/kokuin', { state: { from: '/sobre-autor' } })}
            >
              LER KOKUIN AGORA
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
