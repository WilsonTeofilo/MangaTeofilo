import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth, signOut } from 'firebase/auth';

import './SobreAutor.css'; // ou o nome que você estiver usando

export default function SobreAutor({ user }) {
  const navigate = useNavigate();
  const auth = getAuth();

  const [isPhotoHovered, setIsPhotoHovered] = useState(false);

  // ─── Helpers ────────────────────────────────────────────────
  const handleSignOut = () => signOut(auth);

  const navigateTo = (path) => () => navigate(path);

  // ─── Render sections ────────────────────────────────────────
  const renderHeader = () => (
    <nav className="reader-header">
      <div className="nav-container">
        <div className="nav-logo" onClick={navigateTo('/')}>
          SHITO
        </div>

        <ul className="nav-menu">
          <li onClick={navigateTo('/')}>Início</li>
          <li onClick={navigateTo('/capitulos')}>Capítulos</li>
          <li className="active">Sobre o Autor</li>
          <li onClick={navigateTo('/apoie')}>Apoie a Obra</li>
        </ul>

        <div className="nav-auth">
          {user ? (
            <div className="user-info-header">
              <span>Olá, {user.displayName || 'Guerreiro'}</span>
              <button onClick={handleSignOut}>Sair</button>
            </div>
          ) : (
            <button
              className="btn-login-header"
              onClick={navigateTo('/login')}
            >
              ENTRAR / CADASTRAR
            </button>
          )}
        </div>
      </div>
    </nav>
  );

  const renderPhotoSection = () => (
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
          src="/assets/fotos/teofilomangá.png"
          className="foto-manga"
          alt="Wilson Teofilo - Estilo mangá"
        />
      </div>

      <p className="foto-caption">Wilson Teofilo</p>
    </div>
  );

  const renderBioSection = () => (
    <div className="bio-section">
      <h1 className="bio-title">Wilson Teofilo</h1>

      <div className="bio-text">
        <p>
          Minha história com a arte começou em meados de 2008, no Grajaú, periferia de São Paulo. Enquanto a TV aberta me apresentava desenhos cartunescos, meu irmão me introduziu a um mundo diferente: <span className="highlight">Pokémon</span>. Ali, me apaixonei instantaneamente pelos traços, pela expressividade e pela emoção que a animação japonesa transmitia. O vício se consolidou com <span className="highlight">Dragon Ball Z</span>, que reassisti incontáveis vezes, seguido por <span className="highlight">Naruto</span>. Eu estava fascinado por aquele estilo de luta e narrativa.
        </p>

        <p>
          Essa paixão foi tão forte que me ensinou a ler. Para me incentivar, meu irmão trazia mangás da Turma da Mônica Jovem. Com a ajuda da mulher que cuidava de mim na época, fui alfabetizado vogal por vogal, impulsionado pelo desejo ardente de entender o que estava escrito naqueles desenhos bonitos. Naquela mesma época, peguei meu primeiro caderno de escola e tentei criar meu próprio mangá. A história estava lá, mas os desenhos... eram péssimos. Eu não sabia desenhar.
        </p>

        <p>
          A vida me testou cedo. Aos 11 anos, perdi minha mãe. Em meio à dor, agarrei-me às lições de <span className="highlight">Naruto</span>: <span className="highlight">nunca desistir</span>, seguir em frente e sorrir para fazer as pessoas ao redor felizes. Tornei-me o pilar emocional da minha família, usando o humor como escudo e cura. Mas a criação de histórias ficou adormecida; eu acreditava que, sem o talento do desenho, eu só poderia ser um fã.
        </p>

        <p>
          Em 2020, durante a pandemia, a chama reacendeu. Usando referências do Pinterest para dar rosto aos personagens, nasceu o universo de <span className="highlight">Shito</span>. Escrevi 15 capítulos satisfatórios, mas a frustração de não conseguir passar a arte para o papel me fez engavetar o projeto novamente. Eu pensava: "Isso está ficando bom, um dia eu volto quando aprender a desenhar".
        </p>

        <p>
          O "um dia" chegou em <span className="highlight">2026</span>. Com o avanço da Inteligência Artificial, descobri que minha imaginação e habilidade com prompts poderiam, finalmente, dar vida à Shito. Após 6 anos na gaveta, este mangá volta a ser produzido com carinho, dedicação e horas de estudo da máquina para realizar meu sonho de criança. Esta obra é minha forma de retribuir à cultura japonesa por tudo o que ela me deu, criando uma história que espero que vocês possam apreciar e se satisfazer com a arte.
        </p>
      </div>

      <div className="bio-cta">
        <button className="hn-cta" onClick={navigateTo('/capitulos')}>
          LER SHITO AGORA
        </button>
      </div>
    </div>
  );

  // ─── Main return ────────────────────────────────────────────
  return (
    <div className="sobre-autor-page">
      {renderHeader()}

      <main className="sobre-autor-content">
        <div className="split-container">
          {renderPhotoSection()}
          {renderBioSection()}
        </div>
      </main>
    </div>
  );
}