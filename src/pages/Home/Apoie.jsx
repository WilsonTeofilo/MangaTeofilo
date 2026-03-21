  import React from 'react';

  // 1. CSS COM CAMINHO LOCAL (Certifique-se que Apoie.css está na mesma pasta pages/Home)
  import './Apoie.css'; 

  export default function Apoie() {
    // O Header já vem do App.jsx, então este componente foca 100% no conteúdo de apoio.

    const handleApoioClick = (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
      <div className="apoie-page">
        {/* O main começa direto, o padding-top no CSS deve compensar a altura do Header fixo */}
        <main className="apoie-main">
          <section className="apoie-section">
            <h1 className="shito-glitch">Apoie Shito: Fragmentos da Tempestade</h1>
            
            <p className="apoie-texto">
              Cada apoio faz diferença real: ajuda com servidor, energia, ferramentas de IA, café e meu tempo pra desenhar mais capítulos.
              <br />
              <strong>Obrigado por acreditar na história e na tempestade!</strong> ❤️
            </p>

            <div className="apoie-opcoes">
              {/* Apoio P */}
              <div className="apoie-card">
                <div className="card-badge">P</div>
                <h3>CAFÉ DO AUTOR</h3>
                <p className="preco">R$ 7,99</p>
                <p className="descricao">Café e energia garantidos para mais uma página!</p>
                <button
                  className="btn-apoie pequeno"
                  onClick={() => handleApoioClick('https://mpago.la/18VvCLv')}
                >
                  APOIAR R$ 7,99
                </button>
              </div>

              {/* Apoio M */}
              <div className="apoie-card">
                <div className="card-badge">M</div>
                <h3>MARMITA DO GUERREIRO</h3>
                <p className="preco">R$ 19,00</p>
                <p className="descricao">Fazer a boa para o autor comer uma marmita de respeito!</p>
                <button
                  className="btn-apoie medio"
                  onClick={() => handleApoioClick('https://mpago.la/1XLszaM')}
                >
                  APOIAR R$ 19,00
                </button>
              </div>

              {/* Apoio G */}
              <div className="apoie-card">
                <div className="card-badge">G</div>
                <h3>O LENDÁRIO MORTAL</h3>
                <p className="preco">R$ 35,00</p>
                <p className="descricao">Nesse valor, o autor gira 3 mortais pra trás de felicidade!</p>
                <button
                  className="btn-apoie grande"
                  onClick={() => handleApoioClick('https://mpago.la/16nmTHk')}
                >
                  APOIAR R$ 35,00
                </button>
              </div>
            </div>

            <p className="apoie-nota">
              <i className="fa-solid fa-shield-check"></i> Ao clicar, você vai para o Mercado Pago (seguro e oficial). Lá aparece QR Code Pix + código copia e cola. Pagamento cai na hora!
            </p>

            <div className="apoie-recompensa">
              <h3>RECOMPENSAS</h3>
              <ul>
                <li>
                  <i className="fa-solid fa-crown"></i> <strong>P/M/G:</strong> Seu nome eternizado nos créditos dos próximos capítulos.
                </li>
              </ul>
              <div className="discord-notice-box">
                <p>
                  Após o apoio, envie o comprovante no nosso <strong>Discord</strong>. Irei anotar sua alma para os agradecimentos oficiais.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }