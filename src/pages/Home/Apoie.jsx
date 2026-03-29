import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { APOIO_PLANOS_UI } from '../../config/apoioPlanos';
import {
  MENSAGEM_POR_PLANO,
  mensagemDoacaoLivre,
  montarTituloModalAgradecimento,
} from '../../config/apoieMensagens';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import './Apoie.css';

const criarCheckoutApoio = httpsCallable(functions, 'criarCheckoutApoio');

export default function Apoie() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mpRetorno = searchParams.get('mp');
  const [carregandoId, setCarregandoId] = useState(null);
  const [valorLivre, setValorLivre] = useState('');
  const [erroValorLivre, setErroValorLivre] = useState('');
  const [erroCheckoutPlanos, setErroCheckoutPlanos] = useState('');
  const [modalAgradecimento, setModalAgradecimento] = useState({
    aberto: false,
    titulo: '',
    texto: '',
  });
  const jaMostrouAgradecimento = useRef(false);

  useEffect(() => {
    if (mpRetorno !== 'ok' || jaMostrouAgradecimento.current) return;
    jaMostrouAgradecimento.current = true;

    const planId = searchParams.get('planId');
    const tipo = searchParams.get('tipo');
    const vRaw = searchParams.get('v');

    let texto;
    if (planId && MENSAGEM_POR_PLANO[planId]) {
      texto = MENSAGEM_POR_PLANO[planId];
    } else if (tipo === 'custom' && vRaw != null && vRaw !== '') {
      texto = mensagemDoacaoLivre(parseFloat(String(vRaw).replace(',', '.'), 10));
    } else {
      texto =
        'Pagamento recebido ou aprovado. Obrigado por apoiar a tempestade!';
    }

    const titulo = montarTituloModalAgradecimento({
      planId,
      valorCustom: tipo === 'custom' ? vRaw : null,
    });

    setModalAgradecimento({ aberto: true, titulo, texto });
  }, [mpRetorno, searchParams]);

  const fecharModalELimparUrl = () => {
    setModalAgradecimento((m) => ({ ...m, aberto: false }));
    navigate('/apoie', { replace: true });
    jaMostrouAgradecimento.current = false;
  };

  const abrirPagamento = async (plano) => {
    setErroCheckoutPlanos('');
    setCarregandoId(plano.id);
    let abriuPelaApi = false;
    try {
      const { data } = await criarCheckoutApoio({ planId: plano.id });
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        abriuPelaApi = true;
      }
    } catch (err) {
      console.error('criarCheckoutApoio', err);
      setErroCheckoutPlanos(mensagemErroCallable(err));
    } finally {
      setCarregandoId(null);
    }
    if (!abriuPelaApi) {
      window.open(plano.fallbackLink, '_blank', 'noopener,noreferrer');
    }
  };

  const abrirDoacaoLivre = async () => {
    setErroValorLivre('');
    const normalizado = String(valorLivre).trim().replace(',', '.');
    const n = parseFloat(normalizado, 10);
    if (!Number.isFinite(n) || n < 1) {
      setErroValorLivre('Informe um valor mínimo de R$ 1,00.');
      return;
    }
    if (n > 5000) {
      setErroValorLivre('Valor máximo neste fluxo: R$ 5.000,00.');
      return;
    }

    setCarregandoId('livre');
    try {
      const { data } = await criarCheckoutApoio({ customAmount: n });
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        return;
      }
    } catch (err) {
      console.error('criarCheckoutApoio livre', err);
      setErroValorLivre(mensagemErroCallable(err));
    } finally {
      setCarregandoId(null);
    }
  };

  return (
    <div className="apoie-page">
      <main className="apoie-main">
        <section className="apoie-section">
          <h1 className="shito-glitch">Apoie Shito: Fragmentos da Tempestade</h1>

          {modalAgradecimento.aberto && (
            <div
              className="apoie-modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="apoie-modal-titulo"
              onClick={fecharModalELimparUrl}
            >
              <div
                className="apoie-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="apoie-modal-titulo" className="apoie-modal-titulo">
                  {modalAgradecimento.titulo}
                </h2>
                <p className="apoie-modal-texto">{modalAgradecimento.texto}</p>
                <button
                  type="button"
                  className="apoie-modal-fechar"
                  onClick={fecharModalELimparUrl}
                >
                  Fechar
                </button>
              </div>
            </div>
          )}

          {mpRetorno === 'pending' && (
            <p className="apoie-flash apoie-flash--pending" role="status">
              Pagamento pendente. Quando o Mercado Pago confirmar, você verá a cobrança finalizada.
            </p>
          )}
          {mpRetorno === 'erro' && (
            <p className="apoie-flash apoie-flash--erro" role="alert">
              Não foi possível concluir o pagamento. Você pode tentar de novo abaixo.
            </p>
          )}

          <p className="apoie-texto">
            Cada apoio faz diferença real: ajuda com servidor, energia, ferramentas de IA, café e meu
            tempo pra desenhar mais capítulos.
            <br />
            <strong>Obrigado por acreditar na história e na tempestade!</strong>
          </p>

          <div className="apoie-doacao-livre">
            <h2 className="apoie-doacao-livre-titulo">Doação livre (Pix / checkout)</h2>
            <p className="apoie-doacao-livre-desc">
              Escolha o valor (mínimo <strong>R$ 1,00</strong>). Abre o mesmo checkout seguro do Mercado Pago.
            </p>
            <div className="apoie-doacao-livre-row">
              <span className="apoie-doacao-prefix">R$</span>
              <input
                type="text"
                inputMode="decimal"
                className="apoie-doacao-input"
                placeholder="1,00"
                value={valorLivre}
                onChange={(e) => setValorLivre(e.target.value)}
                disabled={carregandoId !== null}
                aria-label="Valor da doação em reais"
              />
              <button
                type="button"
                className="btn-apoie btn-apoie-livre"
                disabled={carregandoId !== null}
                onClick={abrirDoacaoLivre}
              >
                {carregandoId === 'livre' ? 'Abrindo…' : 'Doar este valor'}
              </button>
            </div>
            {erroValorLivre && (
              <p className="apoie-doacao-erro" role="alert">
                {erroValorLivre}
              </p>
            )}
          </div>

          {erroCheckoutPlanos && (
            <p className="apoie-checkout-erro" role="alert">
              <strong>API:</strong> {erroCheckoutPlanos}
              <span className="apoie-checkout-erro-hint">
                {' '}
                Se abriu outra aba com o link <code>mpago.la</code>, esse é o plano B. Token: gere de novo em
                Mercado Pago → Credenciais → Access Token (produção ou teste) e rode{' '}
                <code>firebase functions:secrets:set MP_ACCESS_TOKEN</code> + deploy da function.
              </span>
            </p>
          )}

          <div className="apoie-opcoes">
            {APOIO_PLANOS_UI.map((plano) => (
              <div key={plano.id} className="apoie-card">
                <div className="card-badge">{plano.badge}</div>
                <h3>{plano.titulo}</h3>
                <p className="preco">{plano.precoLabel}</p>
                <p className="descricao">{plano.descricao}</p>
                <button
                  type="button"
                  className={`btn-apoie ${plano.id === 'cafe' ? 'pequeno' : plano.id === 'marmita' ? 'medio' : 'grande'}`}
                  disabled={carregandoId !== null}
                  onClick={() => abrirPagamento(plano)}
                >
                  {carregandoId === plano.id ? 'Abrindo…' : `APOIAR ${plano.precoLabel}`}
                </button>
              </div>
            ))}
          </div>

          <p className="apoie-nota">
            <i className="fa-solid fa-shield-check" /> Checkout oficial do Mercado Pago. Mensagem de
            agradecimento no site após pagamento aprovado (modal) — sem e-mail automático; mais simples e
            imediato.
          </p>

          <div className="apoie-recompensa">
            <h3>RECOMPENSAS</h3>
            <ul>
              <li>
                <i className="fa-solid fa-crown" /> <strong>P / M / G:</strong> seu nome eternizado
                nos créditos dos próximos capítulos.
              </li>
            </ul>
            <div className="discord-notice-box">
              <p>
                Após o apoio, envie o comprovante no nosso <strong>Discord</strong>. Irei anotar sua alma
                para os agradecimentos oficiais.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
