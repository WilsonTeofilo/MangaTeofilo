import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import './KokuinLegacyLandingSection.css';

export default function KokuinLegacyLandingSection({ scrollContainerRef = null, fullViewport = false }) {
  const navigate = useNavigate();
  const scrollRafRef = useRef(null);
  const heroRef = useRef(null);

  const getScrollHost = useCallback(() => {
    return scrollContainerRef?.current || window;
  }, [scrollContainerRef]);

  const getCurrentScrollTop = useCallback(() => {
    const host = getScrollHost();
    if (host === window) return window.scrollY || window.pageYOffset || 0;
    return host?.scrollTop || 0;
  }, [getScrollHost]);

  const getHeroHideThreshold = useCallback(() => {
    const hero = heroRef.current;
    const heroHeight = hero?.offsetHeight || window.visualViewport?.height || window.innerHeight || 0;
    return Math.max(1, Math.round(heroHeight * 0.5));
  }, []);

  const [mostrarSetaScroll, setMostrarSetaScroll] = useState(() => {
    return getCurrentScrollTop() < getHeroHideThreshold();
  });

  const atualizarVisibilidadeSeta = useCallback(() => {
    const proximoValor = getCurrentScrollTop() < getHeroHideThreshold();
    setMostrarSetaScroll((prev) => (prev === proximoValor ? prev : proximoValor));
  }, [getCurrentScrollTop, getHeroHideThreshold]);

  const onScrollOrResize = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      atualizarVisibilidadeSeta();
    });
  }, [atualizarVisibilidadeSeta]);

  const handleScrollCueClick = useCallback(() => {
    const host = getScrollHost();
    const offset = getHeroHideThreshold();
    if (host === window) {
      window.scrollTo({ top: offset, behavior: 'smooth' });
      return;
    }
    host?.scrollTo?.({ top: offset, behavior: 'smooth' });
  }, [getHeroHideThreshold, getScrollHost]);

  useEffect(() => {
    const host = getScrollHost();
    const scrollTarget = host === window ? window : host;
    scrollTarget?.addEventListener?.('scroll', onScrollOrResize, { passive: true });
    window.visualViewport?.addEventListener('resize', onScrollOrResize);
    window.addEventListener('resize', onScrollOrResize);
    atualizarVisibilidadeSeta();
    return () => {
      scrollTarget?.removeEventListener?.('scroll', onScrollOrResize);
      window.visualViewport?.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [atualizarVisibilidadeSeta, getScrollHost, onScrollOrResize]);

  return (
    <div className={`shito-page ${fullViewport ? 'shito-page--immersive' : ''}`}>
      <header ref={heroRef} className={`main-banner ${fullViewport ? 'main-banner--full-viewport' : ''}`}>
        <div className="banner-content">
          <h1 className="game-logo shito-glitch">KOKUIN</h1>
          <h2 className="game-sublogo">HERANÇA DO ABISMO</h2>
        </div>
        <button
          type="button"
          className={`hero-scroll-cue ${mostrarSetaScroll ? '' : 'hero-scroll-cue--hidden'}`}
          aria-label="Rolar para continuar a apresentação"
          onClick={handleScrollCueClick}
        >
          <span className="hero-scroll-cue__text">Role para continuar</span>
          <span className="hero-scroll-cue__arrow" />
        </button>
      </header>

      <section className="lore-summary">
        <div className="lore-copy">
          <span className="lore-date">Kokuin - Herança do Abismo</span>
          <h3>A CICATRIZ DOS DEUSES</h3>
          <p>
            Antes das feridas que retalharam o mundo, Kokuin era uma massa única regida pelas linhagens
            Kiraya e Moshiki. A guerra entre divindades, Yukio, Orochi e Matatabi trouxe o cataclismo
            que fragmentou o planeta, dando origem aos continentes e às novas formas de vida.
          </p>
        </div>
        <div className="lore-banner-image">
          <img src="/assets/fotos/shito.jpg" alt="A Grande Guerra" />
        </div>
        <div className="lore-copy">
          <p className="lore-highlight">
            <span className="lore-date">DEPOIS DO CATACLISMO (D.C.) - KOKUIN, BRAJIRU.</span>
            Na densa selva de Brajiru, a caçadora <strong>Miomya Inpachi</strong> resgata do gelo um homem
            de 350 D.C., que estava há 400 anos congelado. <strong>Naraa</strong> desperta em um futuro
            quebrado, com memórias fragmentadas e um poder latente.
          </p>
        </div>
      </section>

      <section className="characters-section">
        <h3 className="section-title">O ELENCO</h3>
        <div className="character-grid">
          <div className="char-card naraa">
            <div className="gif-box"><img src="/assets/Gifs/NaraaGIF.gif" alt="Naraa" /></div>
            <div className="char-desc">
              <h4>NARAA</h4>
              <p>Com poderes gélidos, Naraa é implacável na caça e veloz contra seus adversários.</p>
            </div>
          </div>

          <div className="char-card miomya">
            <div className="gif-box"><img src="/assets/Gifs/MiomyaGIF.gif" alt="Miomya" /></div>
            <div className="char-desc">
              <h4>MIOMYA</h4>
              <p>Caçadora de elite de Brajiru. Pequena em altura, mas capaz de erguer feras enormes.</p>
            </div>
          </div>

          <div className="char-card rin">
            <div className="gif-box"><img src="/assets/Gifs/RinGIF.gif" alt="Rin" /></div>
            <div className="char-desc">
              <h4>RIN</h4>
              <p>Manipuladora dos raios. Sua pressão espiritual é capaz de mudar a atmosfera ao redor.</p>
            </div>
          </div>

          <div className="char-card kuroi">
            <div className="gif-box"><img src="/assets/Gifs/KuroiGIF.gif" alt="Kuroi" /></div>
            <div className="char-desc">
              <h4>KUROI</h4>
              <p>O mestre do fogo protege o grupo com suas labaredas purificadoras.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-stats">
          <h3>ENTRAR NO UNIVERSO</h3>
          <div className="stats-row">
            <p>Obra fundadora: <span>Kokuin</span></p>
            <p>Status: <span>Em lançamento</span></p>
          </div>
          <button className="btn-read-now" onClick={() => navigate('/works')}>
            COMEÇAR LEITURA
          </button>
        </div>
        <p className="copyright">© 2026 Kokuin: Herança do Abismo - Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}
