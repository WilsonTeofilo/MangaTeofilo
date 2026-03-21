// src/Apoie.jsx (ou src/pages/Apoie.jsx — ajuste o caminho no import do App.jsx se necessário)
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth, signOut } from 'firebase/auth';
import './Apoie.css';  // ← Import do CSS (obrigatório para os estilos aparecerem)

export default function Apoie({ user }) {
  const navigate = useNavigate();
  const auth = getAuth();

  return (
    <div className="apoie-page" style={{ backgroundColor: '#0a0a0a', minHeight: '100vh' }}>
      {/* Header fixo igual ao das outras páginas */}
      <nav className="reader-header">
        <div className="nav-container">
          <div className="nav-logo" onClick={() => navigate('/')}>
            SHITO
          </div>
          <ul className="nav-menu">
            <li onClick={() => navigate('/')}>Início</li>
            <li onClick={() => navigate('/capitulos')}>Capítulos</li>
            <li onClick={() => navigate('/sobre-autor')}>Sobre o Autor</li>
            <li className="active">Apoie a Obra</li> {/* Active aqui */}
          </ul>
          <div className="nav-auth">
            {user ? (
              <div className="user-info-header">
                <span>Olá, {user.displayName || 'Guerreiro'}</span>
                <button onClick={() => signOut(auth)}>Sair</button>
              </div>
            ) : (
              <button
                className="btn-login-header"
                onClick={() => navigate('/login')}
              >
                ENTRAR / CADASTRAR
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Conteúdo principal com espaço pro header fixo */}
      <main style={{ paddingTop: '120px', paddingBottom: '60px' }}>
        <section className="apoie-section">
          <h1>Apoie Shito: Fragmentos da Tempestade</h1>
          <p className="apoie-texto">
            Cada apoio faz diferença real: ajuda com servidor, energia, ferramentas de IA, café e meu tempo pra desenhar mais capítulos.
            <br />
            <strong>Obrigado por acreditar na história e na tempestade!</strong> ❤️
          </p>

          <div className="apoie-opcoes">
            <div className="apoie-card">
              <h3>Apoio P</h3>
              <p className="preco">R$ 7,99</p>
              <p className="descricao">Café e energia garantidos!</p>
              <button
                className="btn-apoie pequeno"
                onClick={() => window.open('https://mpago.la/18VvCLv', '_blank', 'noopener,noreferrer')}
              >
                APOIAR R$ 7,99
              </button>
            </div>

            <div className="apoie-card">
              <h3>Apoio M</h3>
              <p className="preco">R$ 19,00</p>
              <p className="descricao">Fazer a boa para autor comer uma marmita!!</p>
              <button
                className="btn-apoie medio"
                onClick={() => window.open('https://mpago.la/1XLszaM', '_blank', 'noopener,noreferrer')}
              >
                APOIAR R$ 19,00
              </button>
            </div>

            <div className="apoie-card">
              <h3>Apoio G</h3>
              <p className="preco">R$ 35,00</p>
              <p className="descricao">Ao esse valor , automaticamente o autor gira 3 mortais pra trás de felicidade.</p>
              <button
                className="btn-apoie grande"
                onClick={() => window.open('https://mpago.la/16nmTHk', '_blank', 'noopener,noreferrer')}
              >
                APOIAR R$ 35,00
              </button>
            </div>

            {/* Descomente quando tiver o link do GG */}
            {/* 
            <div className="apoie-card destaque">
              <h3>Apoie GG</h3>
              <p className="preco">R$ 55,00</p>
              <p className="descricao">Patrocinador da tempestade!</p>
              <button
                className="btn-apoie gg"
                onClick={() => window.open('https://mpago.la/SEU-LINK-GG', '_blank', 'noopener,noreferrer')}
              >
                APOIAR R$ 55,00
              </button>
            </div>
            */}
          </div>

          <p className="apoie-nota">
            Ao clicar, você vai para o Mercado Pago (seguro e oficial). Lá aparece QR Code Pix + código copia e cola. Pagamento cai na hora!
          </p>

          <div className="apoie-recompensa">
            <h3>Recompensas para apoiadores</h3>
            <ul>
              <li><strong>P/M/G/GG:</strong> Nome nos créditos dos capítulos</li>
         
            </ul>
            <p>Depois de pagar, manda o comprovante no  Discord que irei me lembrar anotarei seu nome para colocar nos agradecimentos</p>
          </div>
        </section>
      </main>
    </div>
  );
}