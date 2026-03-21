import React, { useState, useEffect, useRef } from 'react';
import { getDatabase, ref, onValue, increment, update } from "firebase/database";
import { useNavigate } from 'react-router-dom';
import './App.css';

export default function ShitoGame() {
  const [visitas, setVisitas] = useState(0);
  const hasIncremented = useRef(false);
  const navigate = useNavigate();
  const db = getDatabase(); // Pega a instância já inicializada no App.jsx

  useEffect(() => {
    // 1. Contador de visualizações (Executa apenas uma vez ao carregar a home)
    if (!hasIncremented.current) {
      update(ref(db, 'stats'), { contador: increment(1) });
      hasIncremented.current = true;
    }
    
    // 2. Escuta o valor das visitas em tempo real
    const unsubVisitas = onValue(ref(db, 'stats/contador'), (s) => {
      setVisitas(s.val() || 0);
    });

    return () => unsubVisitas();
  }, [db]);

  return (
    <div className="shito-page">
      {/* O HEADER SUMIU DAQUI! 
         Ele agora é renderizado pelo App.jsx automaticamente.
      */}

      {/* BANNER PRINCIPAL */}
      <header className="main-banner">
        <div className="banner-content">
          <h1 className="game-logo">SHITO</h1>
          <h2 className="game-sublogo">FRAGMENTOS DA TEMPESTADE</h2>
        </div>
      </header>

      {/* SINOPSE DETALHADA */}
      <section className="lore-summary">
        <span className="lore-date">750 D.C. — CONTINENTE DE BRAJIRU</span>
        <h3>A CICATRIZ DOS DEUSES</h3>
        <p>
          Antes das feridas que retalharam o mundo, Shito era uma massa única regida pelas linhagens Kiraya e Moshiki.
          O Cataclisma (226-252 D.C.) trouxe a guerra entre divindades: Yukio, Orochi e Matatabi.
          Dessa era de agonia, restou o <strong>Miasma</strong>, uma névoa tóxica que isola os continentes e corrompe as almas.
        </p>
        <div className="lore-banner-image">
          <img src="/assets/fotos/shito.jpg" alt="A Grande Guerra" />
        </div>
        <p className="lore-highlight">
          Quatro séculos depois, na densa selva de Brajiru, a caçadora <strong>Miomya Inpachi</strong> resgata do gelo
          um homem de 350 D.C. <strong>Naraa</strong> desperta em um futuro quebrado, portando memórias de um tempo
          onde deuses sangravam e a esperança ainda tinha nome.
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
              <p>O Fantasma de 350 D.C. Criado por lobos, ele é o "espécime raro" que detém segredos do passado antigo.</p>
            </div>
          </div>
          
          <div className="char-card miomya">
            <div className="gif-box"><img src="/assets/Gifs/MiomyaGIF.gif" alt="Miomya" /></div>
            <div className="char-desc">
              <h4>MIOMYA</h4>
              <p>Caçadora de elite de Brajiru. Pequena em altura, mas capaz de erguer feras de 4 metros acima da cabeça.</p>
            </div>
          </div>

          <div className="char-card rin">
            <div className="gif-box"><img src="/assets/Gifs/RinGIF.gif" alt="Rin" /></div>
            <div className="char-desc">
              <h4>RIN</h4>
              <p>Manipuladora de gravidade. Sua pressão espiritual é capaz de congelar a atmosfera ao seu redor.</p>
            </div>
          </div>

          <div className="char-card kuroi">
            <div className="gif-box"><img src="/assets/Gifs/KuroiGIF.gif" alt="Kuroi" /></div>
            <div className="char-desc">
              <h4>KUROI</h4>
              <p>O mestre do degelo e da combustão. Amigo leal que protege o grupo com suas chamas purificadoras.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
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
        <p className="copyright">© 2026 Shito: Fragmentos da Tempestade - Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}