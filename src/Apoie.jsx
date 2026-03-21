import React from 'react';
import './Apoie.css'; 

export default function Apoie() {
  // O Header já vem do App.jsx, então não precisamos de imports de Firebase ou useNavigate aqui.

  return (
    <div className="apoie-page">
      {/* O main agora começa direto, o padding do CSS garante que ele não fique sob o Header */}
      <main className="apoie-main">
        <section className="apoie-section">
          <h1>Apoie Shito: Fragmentos da Tempestade</h1>
          <p className="apoie-texto">
            Cada apoio faz diferença real: ajuda com servidor, energia, ferramentas de IA, café e meu tempo pra desenhar mais capítulos.
            <br />
            <strong>Obrigado por acreditar na história e na tempestade!</strong> ❤️
          </p>

          <div className="apoie-opcoes">
            {/* Apoio P */}
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

            {/* Apoio M */}
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

            {/* Apoio G */}
            <div className="apoie-card">
              <h3>Apoio G</h3>
              <p className="preco">R$ 35,00</p>
              <p className="descricao">Ao esse valor, automaticamente o autor gira 3 mortais pra trás de felicidade.</p>
              <button
                className="btn-apoie grande"
                onClick={() => window.open('https://mpago.la/16nmTHk', '_blank', 'noopener,noreferrer')}
              >
                APOIAR R$ 35,00
              </button>
            </div>
          </div>

          <p className="apoie-nota">
            Ao clicar, você vai para o Mercado Pago (seguro e oficial). Lá aparece QR Code Pix + código copia e cola. Pagamento cai na hora!
          </p>

          <div className="apoie-recompensa">
            <h3>Recompensas para apoiadores</h3>
            <ul>
              <li><strong>P/M/G:</strong> Nome nos créditos dos capítulos</li>
            </ul>
            <p className="discord-notice">
              Depois de pagar, manda o comprovante no <strong>Discord</strong> que irei anotar seu nome para colocar nos agradecimentos.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}