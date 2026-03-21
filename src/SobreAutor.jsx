import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './SobreAutor.css'; 

export default function SobreAutor() {
  const navigate = useNavigate();
  const [isPhotoHovered, setIsPhotoHovered] = useState(false);

  return (
    <div className="sobre-autor-page">
      {/* O Header já é injetado pelo App.jsx, não precisamos dele aqui */}

      <main className="sobre-autor-content">
        <div className="split-container">
          
          {/* SEÇÃO DA FOTO (ESQUERDA) */}
          <div className="foto-section">
            <div
              className={`foto-container ${isPhotoHovered ? 'hovered' : ''}`}
              onMouseEnter={() => setIsPhotoHovered(true)}
              onMouseLeave={() => setIsPhotoHovered(false)}
            >
              <img
                src="/assets/fotos/teofilo.jpg"
                className="foto-real"
                alt="Wilson Teofilo - Foto real"
              />
              <img
                src="/assets/fotos/teofilomangá.jpg"
                className="foto-manga"
                alt="Wilson Teofilo - Estilo mangá"
              />
            </div>
            <p className="foto-caption">Wilson Teofilo</p>
          </div>

          {/* SEÇÃO DA BIO (DIREITA) */}
          <div className="bio-section">
            <h1 className="bio-title">Wilson Teofilo</h1>

            <div className="bio-text">
              <p>
                Minha história com a arte começou em meados de 2008, no Grajaú, periferia de São Paulo. Enquanto a TV aberta me apresentava desenhos cartunescos, meu irmão me introduziu a um mundo diferente: <span className="highlight">Pokémon</span>. Ali, me apaixonei instantaneamente pelos traços, pela expressividade e pela emoção que a animação japonesa transmitia. O vício se consolidou com <span className="highlight">Dragon Ball Z</span>, seguido por <span className="highlight">Naruto</span>.
              </p>

              <p>
                Essa paixão foi tão forte que me ensinou a ler. Fui alfabetizado vogal por vogal, impulsionado pelo desejo ardente de entender o que estava escrito naqueles desenhos bonitos. Naquela mesma época, peguei meu primeiro caderno e tentei criar meu próprio mangá. A história estava lá, mas os desenhos... eram péssimos. Eu não sabia desenhar.
              </p>

              <p>
                A vida me testou cedo. Aos 11 anos, perdi minha mãe. Em meio à dor, agarrei-me às lições de <span className="highlight">Naruto</span>: <span className="highlight">nunca desistir</span>, seguir em frente e sorrir. Mas a criação de histórias ficou adormecida; eu acreditava que, sem o talento do desenho, eu só poderia ser um fã.
              </p>

              <p>
                Em 2020, durante a pandemia, a chama reacendeu. Usando referências para dar rosto aos personagens, nasceu o universo de <span className="highlight">Shito</span>. Escrevi 15 capítulos, mas a frustração de não conseguir passar a arte para o papel me fez engavetar o projeto novamente.
              </p>

              <p>
                O "um dia" chegou em <span className="highlight">2026</span>. Com o avanço da Inteligência Artificial, descobri que minha imaginação e habilidade com prompts poderiam, finalmente, dar vida à Shito. Após 6 anos na gaveta, este mangá volta a ser produzido com carinho e dedicação. Esta obra é minha forma de retribuir à cultura japonesa por tudo o que ela me deu.
              </p>
            </div>

            <div className="bio-cta">
              <button className="hn-cta" onClick={() => navigate('/capitulos')}>
                LER SHITO AGORA
              </button>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}