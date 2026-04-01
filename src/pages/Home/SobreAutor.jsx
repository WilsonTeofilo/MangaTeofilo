import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import './SobreAutor.css';

export default function SobreAutor() {
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
      {/* O Header já é injetado pelo App.jsx, mantendo o topo livre */}

      <main className="sobre-autor-content">
        <div className="split-container">
          
          {/* SEÇÃO DA FOTO (ESQUERDA) */}
          <section className="foto-section">
            <div
              className={`foto-container ${isPhotoHovered ? 'hovered' : ''}`}
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
              {/* Imagem Real do Autor */}
              <img
                src="/assets/fotos/teofilo.jpg"
                className="foto-real"
                alt="Wilson Teofilo - Real"
                loading="lazy"
                onError={(e) => { e.target.src = '/assets/avatares/ava1.webp'; }}
              />
              {/* Versão Mangá (Aparece no Hover via CSS) */}
              <img
                src="/assets/fotos/teofilomangá.jpg"
                className="foto-manga"
                alt="Wilson Teofilo - Estilo Shito"
                loading="lazy"
                onError={(e) => { e.target.src = '/assets/avatares/ava2.webp'; }}
              />
            </div>
            <p className="foto-caption">Wilson Teofilo</p>
            {revelarPorToque && (
              <p className="foto-tap-hint" aria-live="polite">
                {isPhotoHovered ? 'Toque de novo para voltar à foto real' : 'Toque na foto para ver a versão mangá'}
              </p>
            )}
            <div className="autor-badge">AUTOR & DEV</div>
          </section>

          {/* SEÇÃO DA BIO (DIREITA) */}
          <section className="bio-section">
            <h1 className="bio-title shito-glitch">A Jornada do Autor</h1>

            <div className="bio-text">
              <p>
                Minha história com a arte começou quando eu era criança, em 2008, no Grajaú, periferia de São Paulo. Enquanto a TV me apresentava desenhos comuns, meu irmão me abriu o portal para <span className="highlight">Pokémon</span>. Ali, me apaixonei instantaneamente pelos traços e pela emoção da animação japonesa. O vício se consolidou com <span className="highlight">Dragon Ball Z</span> e <span className="highlight">Naruto</span>.
              </p>

              <p>
                Essa paixão foi tão forte que <strong>me ensinou a ler</strong>. Fui alfabetizado vogal por vogal pelo desejo de entender o que estava escrito naqueles desenhos. Naquela mesma época, tentei criar meu primeiro mangá. A história estava lá, mas os desenhos... eram péssimos. Eu não sabia desenhar.
              </p>

              <p>
                A vida me testou cedo. Aos 11 anos, perdi minha mãe. No meio da dor, agarrei-me às lições de Naruto: <span className="highlight">nunca desistir</span>, seguir em frente e sorrir. Mas a criação de histórias ficou adormecida; eu acreditava que, sem o "talento" do desenho manual, eu seria apenas um fã.
              </p>

              <p>
                Em 2020, na pandemia, a chama reacendeu. Usando referências, nasceu o universo de <span className="highlight">Shito</span>. Escrevi 15 capítulos, mas a frustração de não conseguir passar a arte para o papel me fez engavetar o projeto de novo.
              </p>

              <p>
                O "um dia" chegou em <strong>2026</strong>. Com o avanço da IA, descobri que minha imaginação e minha habilidade com código e prompts poderiam, finalmente, dar vida à Shito. Após 6 anos na gaveta, este mangá volta a ser produzido com o carinho que merece. É minha forma de retribuir à cultura japonesa por tudo o que ela me deu.
              </p>
            </div>

            <div className="bio-cta">
              <button className="hn-cta" onClick={() => navigate('/works')}>
                LER SHITO AGORA
              </button>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}