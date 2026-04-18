import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import './KokuinLegacyLandingSection.css';

export default function KokuinLegacyLandingSection({
  scrollContainerRef = null,
  fullViewport = false,
  readPath = '',
}) {
  const navigate = useNavigate();
  const scrollRafRef = useRef(null);
  const heroRef = useRef(null);
  const [mostrarSetaScroll, setMostrarSetaScroll] = useState(true);

  useEffect(() => {
    const getScrollHost = () => scrollContainerRef?.current || window;
    const getCurrentScrollTop = () => {
      const host = getScrollHost();
      if (host === window) return window.scrollY || window.pageYOffset || 0;
      return host?.scrollTop || 0;
    };
    const getHeroHideThreshold = () => {
      const hero = heroRef.current;
      const heroHeight = hero?.offsetHeight || window.visualViewport?.height || window.innerHeight || 0;
      return Math.max(1, Math.round(heroHeight * 0.5));
    };
    const atualizarVisibilidadeSeta = () => {
      const proximoValor = getCurrentScrollTop() < getHeroHideThreshold();
      setMostrarSetaScroll((prev) => (prev === proximoValor ? prev : proximoValor));
    };
    const host = getScrollHost();
    const scrollTarget = host === window ? window : host;
    const onScrollOrResize = () => {
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        atualizarVisibilidadeSeta();
      });
    };

    scrollTarget?.addEventListener?.('scroll', onScrollOrResize, { passive: true });
    window.visualViewport?.addEventListener('resize', onScrollOrResize);
    window.addEventListener('resize', onScrollOrResize);
    const mountFrame = window.requestAnimationFrame(() => {
      atualizarVisibilidadeSeta();
    });
    return () => {
      scrollTarget?.removeEventListener?.('scroll', onScrollOrResize);
      window.visualViewport?.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      window.cancelAnimationFrame(mountFrame);
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [scrollContainerRef]);

  const handleScrollCueClick = () => {
    const host = scrollContainerRef?.current || window;
    const hero = heroRef.current;
    const heroHeight = hero?.offsetHeight || window.visualViewport?.height || window.innerHeight || 0;
    const offset = Math.max(1, Math.round(heroHeight * 0.5));
    if (host === window) {
      window.scrollTo({ top: offset, behavior: 'smooth' });
      return;
    }
    host?.scrollTo?.({ top: offset, behavior: 'smooth' });
  };

  const canReadInstitutionalWork = String(readPath || '').trim().length > 0;

  return (
    <div className={`shito-page ${fullViewport ? 'shito-page--immersive' : ''}`}>
      <header ref={heroRef} className={`main-banner ${fullViewport ? 'main-banner--full-viewport' : ''}`}>
        <div className="banner-content">
          <h1 className="game-logo shito-glitch" data-text="KOKUIN">
            KOKUIN
          </h1>
          <h2 className="game-sublogo">HERANCA DO ABISMO</h2>
        </div>
        <button
          type="button"
          className={`hero-scroll-cue ${mostrarSetaScroll ? '' : 'hero-scroll-cue--hidden'}`}
          aria-label="Rolar para continuar a apresentacao"
          onClick={handleScrollCueClick}
        >
          <span className="hero-scroll-cue__text">Role para continuar</span>
          <span className="hero-scroll-cue__arrow" />
        </button>
      </header>

      <section className="lore-summary">
        <div className="lore-copy">
          <span className="lore-date">Kokuin - Heranca do Abismo</span>
          <h3>A CICATRIZ DOS DEUSES</h3>
          <p>
            Antes das feridas que retalharam o mundo, Kokuin era uma massa unica regida pelas linhagens
            Kiraya e Moshiki. A guerra entre divindades, Yukio, Orochi e Matatabi trouxe o cataclismo
            que rompeu o planeta, dando origem aos continentes e as novas formas de vida.
          </p>
        </div>
        <div className="lore-banner-image">
          <img src="/assets/fotos/shito.jpg" alt="A Grande Guerra" />
        </div>
        <div className="lore-copy">
          <p className="lore-highlight">
            <span className="lore-date">DEPOIS DO CATACLISMO (D.C.) - KOKUIN, BRAJIRU.</span>
            Na densa selva de Brajiru, a cacadora <strong>Miomya Inpachi</strong> resgata do gelo um homem
            de 350 D.C., que estava ha 400 anos congelado. <strong>Naraa</strong> desperta em um futuro
            quebrado, com memorias fragmentadas e um poder latente.
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
              <p>Com poderes gelidos, Naraa e implacavel na caca e veloz contra seus adversarios.</p>
            </div>
          </div>

          <div className="char-card miomya">
            <div className="gif-box"><img src="/assets/Gifs/MiomyaGIF.gif" alt="Miomya" /></div>
            <div className="char-desc">
              <h4>MIOMYA</h4>
              <p>Cacadora de elite de Brajiru. Pequena em altura, mas capaz de erguer feras enormes.</p>
            </div>
          </div>

          <div className="char-card rin">
            <div className="gif-box"><img src="/assets/Gifs/RinGIF.gif" alt="Rin" /></div>
            <div className="char-desc">
              <h4>RIN</h4>
              <p>Manipuladora dos raios. Sua pressao espiritual e capaz de mudar a atmosfera ao redor.</p>
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
            <p>Status: <span>Em lancamento</span></p>
          </div>
          <button
            className="btn-read-now"
            type="button"
            onClick={() => {
              if (!canReadInstitutionalWork) return;
              navigate(readPath);
            }}
            disabled={!canReadInstitutionalWork}
            aria-disabled={!canReadInstitutionalWork}
            title={canReadInstitutionalWork ? 'Abrir a obra Kokuin' : 'Kokuin ainda nao esta publicado como obra'}
          >
            {canReadInstitutionalWork ? 'COMECAR LEITURA' : 'LEITURA EM BREVE'}
          </button>
        </div>
        <p className="copyright">© 2026 Kokuin: Heranca do Abismo - Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}
