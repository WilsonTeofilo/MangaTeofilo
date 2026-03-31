import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { APOIO_PLANOS_UI } from '../../config/apoioPlanos';
import {
  MENSAGEM_POR_PLANO,
  MENSAGEM_PREMIUM_RETORNO,
  mensagemDoacaoLivre,
  montarTituloModalAgradecimento,
} from '../../config/apoieMensagens';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { assinaturaPremiumAtiva } from '../../utils/capituloLancamento';
import { labelPrecoPremium } from '../../config/premiumAssinatura';
import {
  getAttribution,
  parseAttributionFromSearch,
  persistAttribution,
} from '../../utils/trafficAttribution';
import './Apoie.css';

const criarCheckoutApoio = httpsCallable(functions, 'criarCheckoutApoio');
const criarCheckoutPremium = httpsCallable(functions, 'criarCheckoutPremium');
const obterOfertaPremiumPublica = httpsCallable(functions, 'obterOfertaPremiumPublica');
const registrarAttributionEvento = httpsCallable(functions, 'registrarAttributionEvento');

function formatarDataFimAssinatura(ms) {
  if (typeof ms !== 'number') return '';
  try {
    return new Date(ms).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return '';
  }
}

export default function Apoie({ user, perfil }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mpRetorno = searchParams.get('mp');
  const [carregandoId, setCarregandoId] = useState(null);
  const [valorLivre, setValorLivre] = useState('');
  const [erroValorLivre, setErroValorLivre] = useState('');
  const [erroCheckoutPlanos, setErroCheckoutPlanos] = useState('');
  const [erroPremium, setErroPremium] = useState('');
  const [ofertaPremium, setOfertaPremium] = useState({
    loading: true,
    currentPriceBRL: null,
    basePriceBRL: null,
    isPromoActive: false,
    promoStatus: 'none',
    promo: null,
    now: Date.now(),
  });
  const [modalAgradecimento, setModalAgradecimento] = useState({
    aberto: false,
    titulo: '',
    texto: '',
  });
  const [acompanhamentoPremium, setAcompanhamentoPremium] = useState({
    ativo: false,
    baselineUntil: 0,
    confirmado: false,
    confirmadoAt: 0,
    tipoConfirmacao: '',
    novoUntil: 0,
    diasGanho: 0,
  });
  const [celebracaoPremium, setCelebracaoPremium] = useState({
    show: false,
    pendingReveal: false,
  });
  const jaMostrouAgradecimento = useRef(false);
  const modalAgradecimentoRef = useRef(null);
  const modalFecharBtnRef = useRef(null);
  const modalLastFocusedRef = useRef(null);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add('apoie-scroll-safe');
    body.classList.add('apoie-scroll-safe');
    body.style.overflowY = 'auto';
    body.style.overscrollBehaviorY = 'auto';
    html.style.overflowY = 'auto';
    return () => {
      html.classList.remove('apoie-scroll-safe');
      body.classList.remove('apoie-scroll-safe');
      body.style.overflowY = '';
      body.style.overscrollBehaviorY = '';
      html.style.overflowY = '';
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchOffer = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const { data } = await obterOfertaPremiumPublica();
        if (!mounted) return;
        setOfertaPremium({
          loading: false,
          currentPriceBRL: Number(data?.currentPriceBRL),
          basePriceBRL: Number(data?.basePriceBRL),
          isPromoActive: data?.isPromoActive === true,
          promoStatus: String(data?.promoStatus || 'none'),
          promo: data?.promo || null,
          now: Number(data?.now || Date.now()),
        });
      } catch {
        if (!mounted) return;
        setOfertaPremium((prev) => ({ ...prev, loading: false, now: Date.now() }));
      }
    };
    fetchOffer();
    const refreshId = setInterval(fetchOffer, 30000);
    const tickId = setInterval(() => {
      if (!mounted || document.visibilityState !== 'visible') return;
      setOfertaPremium((prev) => {
        if (!prev?.promo) return prev;
        return { ...prev, now: Date.now() };
      });
    }, 1000);
    return () => {
      mounted = false;
      clearInterval(refreshId);
      clearInterval(tickId);
    };
  }, []);

  useEffect(() => {
    const fromUrl = parseAttributionFromSearch(searchParams);
    if (!fromUrl) return;
    persistAttribution(fromUrl);
    if (fromUrl.source === 'promo_email') {
      registrarAttributionEvento({
        eventType: 'promo_landing',
        source: fromUrl.source,
        campaignId: fromUrl.campaignId || null,
        clickId: fromUrl.clickId || null,
      }).catch(() => {});
    }
  }, [searchParams]);

  useEffect(() => {
    if (mpRetorno !== 'ok' || jaMostrouAgradecimento.current) return;
    jaMostrouAgradecimento.current = true;

    const planId = searchParams.get('planId');
    const tipo = searchParams.get('tipo');
    const vRaw = searchParams.get('v');
    const tipoPremium = tipo === 'premium';

    let texto;
    if (tipoPremium) {
      texto = MENSAGEM_PREMIUM_RETORNO;
    } else if (planId && MENSAGEM_POR_PLANO[planId]) {
      texto = MENSAGEM_POR_PLANO[planId];
    } else if (tipo === 'custom' && vRaw != null && vRaw !== '') {
      texto = mensagemDoacaoLivre(parseFloat(String(vRaw).replace(',', '.')));
    } else {
      texto =
        'Pagamento recebido ou aprovado. Obrigado por apoiar a tempestade!';
    }

    const titulo = montarTituloModalAgradecimento({
      planId,
      valorCustom: tipo === 'custom' ? vRaw : null,
      tipoPremium,
    });

    setModalAgradecimento({ aberto: true, titulo, texto });
  }, [mpRetorno, searchParams]);

  const fecharModalELimparUrl = () => {
    setModalAgradecimento((m) => ({ ...m, aberto: false }));
    navigate('/apoie', { replace: true });
    jaMostrouAgradecimento.current = false;
  };

  useEffect(() => {
    if (!modalAgradecimento.aberto) return undefined;
    modalLastFocusedRef.current = document.activeElement;
    const focusables = () =>
      modalAgradecimentoRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) || [];
    const focusInitial = () => {
      if (modalFecharBtnRef.current) {
        modalFecharBtnRef.current.focus();
        return;
      }
      const els = focusables();
      if (els.length) els[0].focus();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        fecharModalELimparUrl();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = Array.from(focusables()).filter((el) => !el.disabled);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    focusInitial();
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (modalLastFocusedRef.current && typeof modalLastFocusedRef.current.focus === 'function') {
        modalLastFocusedRef.current.focus();
      }
    };
  }, [modalAgradecimento.aberto]);

  useEffect(() => {
    if (!acompanhamentoPremium.ativo || acompanhamentoPremium.confirmado) return;
    const premiumAgoraAtivo = assinaturaPremiumAtiva(perfil);
    const currentUntil = typeof perfil?.memberUntil === 'number' ? perfil.memberUntil : 0;
    if (!premiumAgoraAtivo || currentUntil <= 0) return;

    const renovou =
      acompanhamentoPremium.baselineUntil > 0 &&
      currentUntil > acompanhamentoPremium.baselineUntil + 1000;
    const primeiraAtivacao =
      acompanhamentoPremium.baselineUntil <= 0 && currentUntil > Date.now();
    if (!renovou && !primeiraAtivacao) return;

    const tabVisivel = typeof document !== 'undefined' && document.visibilityState === 'visible';
    const baselineValido = Math.max(acompanhamentoPremium.baselineUntil || 0, Date.now());
    const diasGanho = Math.max(
      0,
      Math.round((currentUntil - baselineValido) / (24 * 60 * 60 * 1000))
    );
    const tipoConfirmacao =
      acompanhamentoPremium.baselineUntil > Date.now() + 1000 ? 'renovacao' : 'novo';

    setAcompanhamentoPremium((prev) => ({
      ...prev,
      confirmado: true,
      confirmadoAt: Date.now(),
      tipoConfirmacao,
      novoUntil: currentUntil,
      diasGanho,
    }));
    setCelebracaoPremium({
      show: tabVisivel,
      pendingReveal: !tabVisivel,
    });
  }, [
    acompanhamentoPremium.ativo,
    acompanhamentoPremium.confirmado,
    acompanhamentoPremium.baselineUntil,
    perfil,
  ]);

  useEffect(() => {
    if (!celebracaoPremium.pendingReveal) return;
    const tentarRevelar = () => {
      if (document.visibilityState !== 'visible') return;
      setCelebracaoPremium({
        show: true,
        pendingReveal: false,
      });
    };
    document.addEventListener('visibilitychange', tentarRevelar);
    window.addEventListener('focus', tentarRevelar);
    return () => {
      document.removeEventListener('visibilitychange', tentarRevelar);
      window.removeEventListener('focus', tentarRevelar);
    };
  }, [celebracaoPremium.pendingReveal]);

  useEffect(() => {
    if (!celebracaoPremium.show) return;
    const t = setTimeout(() => {
      setCelebracaoPremium((prev) => ({ ...prev, show: false }));
    }, 5500);
    return () => clearTimeout(t);
  }, [celebracaoPremium.show]);

  const abrirPagamento = async (plano) => {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
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
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    setErroValorLivre('');
    const normalizado = String(valorLivre).trim().replace(',', '.');
    const n = parseFloat(normalizado);
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

  const premiumAtivo = assinaturaPremiumAtiva(perfil);
  const fimPremium = formatarDataFimAssinatura(perfil?.memberUntil);
  const precoBase = Number.isFinite(ofertaPremium.basePriceBRL) ? ofertaPremium.basePriceBRL : null;
  const precoAtual = Number.isFinite(ofertaPremium.currentPriceBRL) ? ofertaPremium.currentPriceBRL : null;
  const precoSeguro = Number.isFinite(precoAtual) && precoAtual > 0
    ? precoAtual
    : (Number.isFinite(precoBase) && precoBase > 0 ? precoBase : 23);
  const promoStartsAt = Number(ofertaPremium?.promo?.startsAt || 0);
  const promoEndsAt = Number(ofertaPremium?.promo?.endsAt || 0);
  const promoProgramada = ofertaPremium.promoStatus === 'scheduled' && promoStartsAt > ofertaPremium.now;
  const segundosAteInicio = promoProgramada
    ? Math.floor((promoStartsAt - ofertaPremium.now) / 1000)
    : 0;
  const segundosRestantes =
    ofertaPremium.isPromoActive && promoEndsAt > ofertaPremium.now
      ? Math.floor((promoEndsAt - ofertaPremium.now) / 1000)
      : 0;
  const hs = String(Math.floor((segundosAteInicio % 86400) / 3600)).padStart(2, '0');
  const ms = String(Math.floor((segundosAteInicio % 3600) / 60)).padStart(2, '0');
  const ssStart = String(segundosAteInicio % 60).padStart(2, '0');
  const hh = String(Math.floor((segundosRestantes % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((segundosRestantes % 3600) / 60)).padStart(2, '0');
  const ss = String(segundosRestantes % 60).padStart(2, '0');

  const abrirAssinaturaPremium = async () => {
    setErroPremium('');
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    const baselineUntil = typeof perfil?.memberUntil === 'number' ? perfil.memberUntil : 0;
    const attribution = getAttribution();
    setCarregandoId('premium');
    try {
      const { data } = await criarCheckoutPremium({
        attribution: attribution
          ? {
              source: attribution.source,
              campaignId: attribution.campaignId || null,
              clickId: attribution.clickId || null,
            }
          : null,
      });
      if (data?.url) {
        setAcompanhamentoPremium({
          ativo: true,
          baselineUntil,
          confirmado: false,
          confirmadoAt: 0,
          tipoConfirmacao: '',
          novoUntil: 0,
          diasGanho: 0,
        });
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('criarCheckoutPremium', err);
      setErroPremium(mensagemErroCallable(err));
    } finally {
      setCarregandoId(null);
    }
  };

  return (
    <div className="apoie-page">
      <main className="apoie-main">
        <section className="apoie-section">
          <h1 className="apoie-title-discord">Apoie Shito: Fragmentos da Tempestade</h1>

          {celebracaoPremium.show && (
            <div className="apoie-celebracao-backdrop" role="status" aria-live="polite">
              <div className="apoie-celebracao-card">
                <div className="apoie-celebracao-icone" aria-hidden="true">⚡</div>
                <h2>
                  {acompanhamentoPremium.tipoConfirmacao === 'renovacao'
                    ? 'Assinatura renovada com sucesso'
                    : 'Pagamento confirmado'}
                </h2>
                <p>
                  {acompanhamentoPremium.tipoConfirmacao === 'renovacao'
                    ? `+${acompanhamentoPremium.diasGanho || 30} dias adicionados. Agora sua assinatura vai até ${formatarDataFimAssinatura(acompanhamentoPremium.novoUntil)}.`
                    : 'Seus poderes Premium foram liberados. Bem-vindo à Elite da Tempestade.'}
                </p>
                <button
                  type="button"
                  className="apoie-modal-fechar"
                  onClick={() => setCelebracaoPremium((prev) => ({ ...prev, show: false }))}
                >
                  Continuar
                </button>
              </div>
            </div>
          )}

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
                ref={modalAgradecimentoRef}
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="apoie-modal-titulo" className="apoie-modal-titulo">
                  {modalAgradecimento.titulo}
                </h2>
                <p className="apoie-modal-texto">{modalAgradecimento.texto}</p>
                <button
                  type="button"
                  className="apoie-modal-fechar"
                  ref={modalFecharBtnRef}
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

          <div className="apoie-premium-card">
            <div className="apoie-premium-badge">MEMBRO SHITO</div>
            {ofertaPremium.loading ? (
              <div className="apoie-premium-skeleton" aria-hidden="true">
                <div className="apoie-skeleton-line lg" />
                <div className="apoie-skeleton-line md" />
                <div className="apoie-skeleton-line sm" />
              </div>
            ) : (
              <>
                <h2 className="apoie-premium-titulo">
                  Assinatura Premium — {labelPrecoPremium(precoSeguro)} / 30 dias
                </h2>
                {ofertaPremium.isPromoActive && (
                  <div className="apoie-premium-oferta">
                    <p>
                      Promo ativa: <strong>{ofertaPremium?.promo?.name || 'Oferta limitada'}</strong>
                    </p>
                    {precoBase != null && precoAtual != null && precoBase > precoAtual && (
                      <p>
                        De <span>{labelPrecoPremium(precoBase)}</span> por <strong>{labelPrecoPremium(precoAtual)}</strong>
                      </p>
                    )}
                    <p className="apoie-premium-timer">
                      Termina em: <strong>{hh}:{mm}:{ss}</strong>
                    </p>
                  </div>
                )}
                {promoProgramada && (
                  <div className="apoie-premium-oferta">
                    <p>
                      <strong>{ofertaPremium?.promo?.name || 'Promoção relâmpago'}</strong> programada.
                    </p>
                    <p>
                      Entrará em: <strong>{hs}:{ms}:{ssStart}</strong>
                    </p>
                    <p>
                      Quando iniciar, o valor muda automaticamente para{' '}
                      <strong>{labelPrecoPremium(ofertaPremium?.promo?.priceBRL || precoSeguro)}</strong>.
                    </p>
                  </div>
                )}
              </>
            )}
            <p className="apoie-premium-desc">
              Só quem assina desbloqueia as regalias abaixo. Doações (P / M / G ou valor livre) ajudam a obra,
              mas <strong>não</strong> ativam Premium — combinado no Discord para créditos nos capítulos.
            </p>
            <ul className="apoie-premium-lista">
              <li>
                <i className="fa-solid fa-bolt" /> Acesso antecipado a capítulos novos (24h a 48h antes do
                público geral), quando o lançamento estiver marcado com antecipação para membros.
              </li>
              <li>
                <i className="fa-solid fa-crown" /> Distintivo dourado nos comentários e destaque de presença.
              </li>
              <li>
                <i className="fa-solid fa-eye" /> Leitura sem anúncios (quando houver espaços de mídia no site).
              </li>
              <li>
                <i className="fa-solid fa-user-pen" /> Perfil: avatares exclusivos e cor de nome (em evolução no
                painel).
              </li>
            </ul>
            {premiumAtivo && fimPremium && (
              <p className="apoie-premium-status" role="status">
                Sua assinatura está <strong>ativa</strong> até <strong>{fimPremium}</strong>. Você pode renovar
                antes do fim para somar mais 30 dias a partir do último dia válido.
              </p>
            )}
            {!user && (
              <p className="apoie-premium-login-hint">
                <button type="button" className="apoie-link-login" onClick={() => navigate('/login')}>
                  Entre na sua conta
                </button>{' '}
                para assinar — precisamos saber quem é você para liberar o Premium.
              </p>
            )}
            {erroPremium && (
              <p className="apoie-premium-erro" role="alert">
                {erroPremium}
              </p>
            )}
            {acompanhamentoPremium.ativo && (
              <div
                className={`apoie-premium-tracker${acompanhamentoPremium.confirmado ? ' confirmado' : ''}`}
                role="status"
                aria-live="polite"
              >
                <h3>
                  {acompanhamentoPremium.confirmado
                    ? 'Pagamento confirmado na tempestade'
                    : 'Aguardando confirmação do pagamento'}
                </h3>
                {!acompanhamentoPremium.confirmado ? (
                  <>
                    <p>
                      QR/Pix aberto no Mercado Pago. Assim que o webhook confirmar, esta tela atualiza
                      automaticamente sem precisar refresh.
                    </p>
                    <div className="apoie-premium-tracker-pulse" aria-hidden="true" />
                  </>
                ) : (
                  <p>
                    {acompanhamentoPremium.tipoConfirmacao === 'renovacao'
                      ? `Renovacao confirmada (+${acompanhamentoPremium.diasGanho || 30} dias). Novo prazo: ${formatarDataFimAssinatura(acompanhamentoPremium.novoUntil)}.`
                      : (
                        <>
                          Assinatura detectada com sucesso em{' '}
                          <strong>
                            {new Date(acompanhamentoPremium.confirmadoAt).toLocaleTimeString('pt-BR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </strong>
                          . Pode fechar com segurança.
                        </>
                      )}
                  </p>
                )}
                <div className="apoie-premium-tracker-actions">
                  <button
                    type="button"
                    className="apoie-link-login"
                    onClick={() =>
                      {
                        setAcompanhamentoPremium({
                          ativo: false,
                          baselineUntil: 0,
                          confirmado: false,
                          confirmadoAt: 0,
                          tipoConfirmacao: '',
                          novoUntil: 0,
                          diasGanho: 0,
                        });
                        setCelebracaoPremium({
                          show: false,
                          pendingReveal: false,
                        });
                      }
                    }
                  >
                    {acompanhamentoPremium.confirmado ? 'Fechar confirmação' : 'Parar acompanhamento'}
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              className="btn-apoie btn-apoie-premium"
              disabled={carregandoId !== null || !user}
              onClick={abrirAssinaturaPremium}
            >
              {carregandoId === 'premium'
                ? 'Abrindo checkout…'
                : premiumAtivo
                  ? 'Renovar Premium (30 dias)'
                  : `Assinar Premium — ${labelPrecoPremium(precoSeguro)}`}
            </button>
          </div>

          <div className="apoie-doacao-livre">
            <h2 className="apoie-doacao-livre-titulo">Doação livre (Pix / checkout)</h2>
            <p className="apoie-doacao-livre-desc">
              Escolha o valor (mínimo <strong>R$ 1,00</strong>). Abre o mesmo checkout seguro do Mercado Pago.
            </p>
            {!user && (
              <p className="apoie-premium-login-hint">
                <button type="button" className="apoie-link-login" onClick={() => navigate('/login')}>
                  Entre na sua conta
                </button>{' '}
                para doar. Assim o sistema registra quem ajudou no ranking e no dashboard.
              </p>
            )}
            <div className="apoie-doacao-livre-row">
              <span className="apoie-doacao-prefix">R$</span>
              <input
                type="text"
                inputMode="decimal"
                className="apoie-doacao-input"
                placeholder="1,00"
                value={valorLivre}
                onChange={(e) => setValorLivre(e.target.value)}
                disabled={carregandoId !== null || !user}
                aria-label="Valor da doação em reais"
              />
              <button
                type="button"
                className="btn-apoie btn-apoie-livre"
                disabled={carregandoId !== null || !user}
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
                  disabled={carregandoId !== null || !user}
                  onClick={() => abrirPagamento(plano)}
                >
                  {carregandoId === plano.id ? 'Abrindo…' : `APOIAR ${plano.precoLabel}`}
                </button>
              </div>
            ))}
          </div>

          <p className="apoie-nota">
            <i className="fa-solid fa-shield-check" /> Checkout oficial do Mercado Pago.{' '}
            <strong>Premium:</strong> após o pagamento aprovado você recebe e-mail de confirmação e, perto do
            fim dos 30 dias, um lembrete para renovar. <strong>Doações:</strong> agradecimento no site (modal),
            sem e-mail automático.
          </p>

          <div className="apoie-recompensa">
            <h3>RECOMPENSAS</h3>
            <ul>
              <li>
                <i className="fa-solid fa-crown" /> <strong>Assinatura Premium ({labelPrecoPremium()}):</strong>{' '}
                regalias de
                membro (lista acima), por 30 dias renováveis.
              </li>
              <li>
                <i className="fa-solid fa-heart" /> <strong>P / M / G e doação livre:</strong> apoio à obra —
                sem regalias automáticas no site; seu nome pode entrar nos créditos combinando no Discord.
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
