import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ref, onValue, increment, update } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db } from '../../services/firebase';

import './ShitoManga.css';

export default function ShitoManga() {
  const [visitas, setVisitas] = useState(0);
  const [mostrarSetaScroll, setMostrarSetaScroll] = useState(() => {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const limiar = Math.max(48, Math.min(vh * 0.06, 100));
    return window.scrollY <= limiar;
  });
  const hasIncremented = useRef(false);
  const navigate = useNavigate();

  const atualizarVisibilidadeSeta = useCallback(() => {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const limiar = Math.max(48, Math.min(vh * 0.06, 100));
    setMostrarSetaScroll(window.scrollY <= limiar);
  }, []);

  useEffect(() => {
    if (!hasIncremented.current) {
      const statsRef = ref(db, 'stats');
      update(statsRef, { contador: increment(1) })
        .catch((err) => console.error('Erro ao atualizar stats:', err));
      hasIncremented.current = true;
    }

    const contadorRef = ref(db, 'stats/contador');
    const unsubVisitas = onValue(contadorRef, (snapshot) => {
      setVisitas(snapshot.val() || 0);
    });

    return () => {
      unsubVisitas();
    };
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', atualizarVisibilidadeSeta, { passive: true });
    window.visualViewport?.addEventListener('resize', atualizarVisibilidadeSeta);
    window.addEventListener('resize', atualizarVisibilidadeSeta);
    return () => {
      window.removeEventListener('scroll', atualizarVisibilidadeSeta);
      window.visualViewport?.removeEventListener('resize', atualizarVisibilidadeSeta);
      window.removeEventListener('resize', atualizarVisibilidadeSeta);
    };
  }, [atualizarVisibilidadeSeta]);

  return (
      <div className="shito-page">
        {/* BANNER PRINCIPAL — ocupa a viewport; seta convida a rolar */}
        <header className="main-banner">
          <div className="banner-content">
            <h1 className="game-logo shito-glitch">SHITO</h1>
            <h2 className="game-sublogo">FRAGMENTOS DA TEMPESTADE</h2>
          </div>
          <div
            className={`hero-scroll-cue ${mostrarSetaScroll ? '' : 'hero-scroll-cue--hidden'}`}
            aria-hidden="true"
          >
            <span className="hero-scroll-cue__text">Role para continuar</span>
            <span className="hero-scroll-cue__arrow" />
          </div>
        </header>

        {/* SINOPSE DETALHADA */}
        <section className="lore-summary">
          <span className="lore-date">Shito - Antes do cataclismo</span>
          <h3>A CICATRIZ DOS DEUSES</h3>
          <p>
            Antes das feridas que retalharam o mundo, Shito era uma massa única regida pelas linhagens Kiraya e Moshiki.
           A guerra entre divindades, Yukio , Orochi e Matatabi trouxeram o cataclismo
            que fragmentou o planeta, danddo origem aos continentes e as novas formas de vidas. A humanidade, antes subjugada, emergiu como a raça dominante, mas as cicatrizes da guerra divina ainda ecoam em cada canto do mundo.
          </p>
          <div className="lore-banner-image">
            {/* Certifique-se que esta imagem está em public/assets/fotos/ */}
            <img src="/assets/fotos/shito.jpg" alt="A Grande Guerra" />
          </div>
          <p className="lore-highlight">
                <span className="lore-date">DEPOIS DO CATACLISMO (D.C) - SHITO, BRAJIRU.</span>
            Na densa selva de Brajiru, a caçadora <strong>Miomya Inpachi</strong> resgata do gelo
            um homem de 350 D.C, que estava a 400 anos congelado. <strong>Naraa</strong> Desperta em um futuro quebrado, portando memórias fragmentadas, sem se lembrar de seu nome ou passado, mas com um poder latente que o torna uma peça-chave em um mundo onde a luta por sobrevivência é constante. Juntos, eles enfrentam as ameaças do mundo repleto por guerras, monstros e segredos antigos, em uma jornada que os levará a confrontar as forças misteriosas.
     
          </p>
        </section>

        {/* ELENCO DETALHADO */}
        <section className="characters-section">
          <h3 className="section-title">O ELENCO</h3>
          <div className="character-grid">
            <div className="char-card naraa">
              <div className="gif-box"><img src="/assets/Gifs/NaraaGIF.gif" alt="Naraa" /></div>
              <div className="char-desc">
                <h4>NARAA</h4>
                <p>Com Poderes gélidos , Naraa é implacável na caça e veloz contra seus adversários.</p>
              </div>
            </div>
            
            <div className="char-card miomya">
              <div className="gif-box"><img src="/assets/Gifs/MiomyaGIF.gif" alt="Miomya" /></div>
              <div className="char-desc">
                <h4>MIOMYA</h4>
                <p>Caçadora de elite de Brajiru. Pequena em altura, mas capaz de erguer feras enormes e de nocautear gigantes.</p>
              </div>
            </div>

            <div className="char-card rin">
              <div className="gif-box"><img src="/assets/Gifs/RinGIF.gif" alt="Rin" /></div>
              <div className="char-desc">
                <h4>RIN </h4>
                <p>Manipuladora dos raios. Sua pressão espiritual é capaz de mudar a atmosfera ao seu redor.</p>
              </div>
            </div>

            <div className="char-card kuroi">
              <div className="gif-box"><img src="/assets/Gifs/KuroiGIF.gif" alt="Kuroi" /></div>
              <div className="char-desc">
                <h4>KUROI</h4>
                <p>O mestre do fogo, da manipulação da chama. Amigo leal que protege o grupo com suas labaredas purificadoras.</p>
              </div>
            </div>
          </div>
        </section>

        {/* FOOTER INTERNO (Estatísticas rápidas) */}
        <footer className="site-footer">
          <div className="footer-stats">
            <h3>ESTATÍSTICAS DA OBRA</h3>
            <div className="stats-row">
              <p>Visualizações Totais: <span>{visitas}</span></p>
              <p>Status: <span>Em Lançamento</span></p>
            </div>
            <button className="btn-read-now" onClick={() => navigate('/capitulos')}>
              COMEÇAR LEITURA
            </button>
          </div>
          <p className="copyright">© 2026 Shito: Fragmentos da Tempestade - Todos os direitos reservados para Wilson Teofilo.</p>
        </footer>
  </div>
  );
}