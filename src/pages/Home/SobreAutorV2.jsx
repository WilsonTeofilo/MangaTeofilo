import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import './SobreAutorV2.css';

const INTRO_METRICS = [
  { label: 'Visao', value: 'Arte + tecnologia' },
  { label: 'Foco', value: 'Autores independentes' },
  { label: 'Projeto', value: 'Kokuin e MangaTeofilo' },
];

const STORY_BLOCKS = [
  {
    title: 'O ponto de virada',
    text:
      'MangaTeofilo nao nasceu para ser so mais um site de leitura. A ideia surgiu como resposta a um vazio real: muita gente tem universo, personagem e conflito, mas para no meio do caminho porque acredita que sem desenho impecavel nao existe historia possivel. A plataforma foi pensada para quebrar essa barreira e transformar criacao autoral em algo mais acessivel, estruturado e viavel.',
  },
  {
    title: 'Como tudo comecou',
    text:
      'Antes de existir codigo, layout ou sistema, existia uma paixao que veio cedo. Pokemon abriu a porta, Dragon Ball Z acelerou o interesse e Naruto consolidou aquela vontade de entender como historias conseguem marcar tanto uma pessoa. Foi nessa fase que ler deixou de ser obrigacao e virou ferramenta para entrar em mundos novos. Entre manutencao, curiosidade tecnica, computador desmontado e estudo, a vontade de criar algo proprio foi crescendo ate encontrar um formato claro.',
    accent: true,
  },
  {
    title: 'O que a plataforma entrega',
    text:
      'Hoje a proposta e unir descoberta, leitura, acompanhamento de autores, publicacao de obras e produtos ligados a essas historias em um mesmo ecossistema. Em vez de tratar o criador como alguem dependente de plataformas fragmentadas, a MangaTeofilo organiza a jornada inteira com identidade, ranking, vitrine e espaco para monetizacao. A ideia central e simples: dar estrutura para que imaginacao tenha continuidade e para que o autor possa evoluir sem perder controle sobre aquilo que construiu.',
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
    setIsPhotoHovered((v) => !v);
  }, [revelarPorToque]);

  return (
    <div className="sobre-autor-page">
      <main className="sobre-autor-content">
        <section className="sobre-hero">
          <div className="sobre-copy">
            <span className="sobre-eyebrow">SOBRE NOS</span>
            <h1 className="sobre-title">Uma plataforma criada para transformar ideia em obra viva.</h1>
            <p className="sobre-lead">
              MangaTeofilo conecta criacao autoral, leitura, descoberta e identidade visual em um unico
              ecossistema. O objetivo nao e apenas publicar mangas, e construir um lugar onde historias
              independentes consigam nascer, crescer e encontrar publico com mais forca.
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
              onKeyDown={(e) => {
                if (!revelarPorToque) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsPhotoHovered((v) => !v);
                }
              }}
            >
              <div className="sobre-portrait-frame">
                <img
                  src="/assets/fotos/teofilo.jpg"
                  className="sobre-portrait sobre-portrait--real"
                  alt="Wilson Teofilo"
                  loading="lazy"
                  onError={(e) => {
                    e.target.src = '/assets/avatares/ava1.webp';
                  }}
                />
                <img
                  src="/assets/fotos/teofilomangá.jpg"
                  className="sobre-portrait sobre-portrait--manga"
                  alt="Wilson Teofilo em estilo manga"
                  loading="lazy"
                  onError={(e) => {
                    e.target.src = '/assets/avatares/ava2.webp';
                  }}
                />
                <div className="sobre-portrait-overlay" />
              </div>

              <div className="sobre-visual-copy">
                <span className="sobre-visual-role">AUTOR E FUNDADOR</span>
                <strong className="sobre-visual-name">Wilson Teofilo</strong>
                <p className="sobre-visual-text">
                  Codigo, manutencao, narrativa e visao de produto andando juntos para dar forma a um
                  projeto autoral que ainda esta so no comeco.
                </p>
              </div>
            </div>

            {revelarPorToque && (
              <p className="sobre-touch-hint" aria-live="polite">
                {isPhotoHovered
                  ? 'Toque de novo para voltar a foto original'
                  : 'Toque na foto para revelar a versao manga'}
              </p>
            )}
          </aside>
        </section>

        <section className="sobre-story-grid">
          <div className="sobre-story-intro">
            <span className="sobre-section-label">Manifesto</span>
            <h2 className="sobre-section-title">Criar nao deveria depender de permissao.</h2>
            <p className="sobre-section-text">
              A proposta do projeto e clara: reduzir friccao, organizar a experiencia e apresentar a obra
              de forma profissional sem abandonar autenticidade. O leitor entende rapido onde esta, o autor
              ganha uma base mais consistente e a historia deixa de parecer perdida no meio da pagina.
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
            <span className="sobre-section-label">Proximo passo</span>
            <h2 className="sobre-cta-title">A melhor forma de entender a proposta ainda e entrando no universo.</h2>
            <p className="sobre-cta-text">
              Kokuin: Heranca do Abismo funciona como a obra-base dessa visao. Ler a historia e ver o
              projeto em movimento ajuda a entender melhor o que a plataforma quer construir daqui para
              frente.
            </p>
          </div>

          <div className="bio-cta">
            <button className="hn-cta" onClick={() => navigate('/works')}>
              LER KOKUIN AGORA
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
