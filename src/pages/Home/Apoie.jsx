import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
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
import { obterEntitlementPremiumGlobal } from '../../utils/capituloLancamento';
import { labelPrecoPremium } from '../../config/premiumAssinatura';
import {
  getAttribution,
  parseAttributionFromSearch,
  persistAttribution,
} from '../../utils/trafficAttribution';
import { formatarDataLongaBr, formatarHoraBr } from '../../utils/datasBr';
import { buildLoginUrlWithRedirect } from '../../utils/loginRedirectPath';
import {
  formatarPrecoBrl,
} from './apoieUtils';
import useApoieEntitlementsAndAttribution from './hooks/useApoieEntitlementsAndAttribution';
import './Apoie.css';

const criarCheckoutApoio = httpsCallable(functions, 'criarCheckoutApoio');
const criarCheckoutPremium = httpsCallable(functions, 'criarCheckoutPremium');
const obterOfertaPremiumPublica = httpsCallable(functions, 'obterOfertaPremiumPublica');
const registrarAttributionEvento = httpsCallable(functions, 'registrarAttributionEvento');

export default function Apoie({ user, perfil, initialView = 'support' }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const viewParam = String(searchParams.get('view') || '').trim().toLowerCase();
  const premiumOnlyView =
    initialView === 'premium' || location.pathname === '/premium' || viewParam === 'premium';
  const irLoginComRetorno = () =>
    navigate(buildLoginUrlWithRedirect(location.pathname, location.search));
  const mpRetorno = searchParams.get('mp');
  const [carregandoId, setCarregandoId] = useState(null);
  const [valorLivre, setValorLivre] = useState('');
  const [erroValorLivre, setErroValorLivre] = useState('');
  const [erroCheckoutPlanos, setErroCheckoutPlanos] = useState('');
  const [erroPremium, setErroPremium] = useState('');
  const [erroMembershipCriador, setErroMembershipCriador] = useState('');
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
    if (fromUrl.source === 'chapter_email') {
      const capId = searchParams.get('capId');
      registrarAttributionEvento({
        eventType: 'chapter_landing',
        source: fromUrl.source,
        campaignId: fromUrl.campaignId || null,
        clickId: fromUrl.clickId || null,
        chapterId: capId || null,
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

  const fecharModalELimparUrl = useCallback(() => {
    setModalAgradecimento((m) => ({ ...m, aberto: false }));
    navigate(premiumOnlyView ? '/premium' : '/apoie', { replace: true });
    jaMostrouAgradecimento.current = false;
  }, [navigate, premiumOnlyView]);

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
  }, [fecharModalELimparUrl, modalAgradecimento.aberto]);

  useEffect(() => {
    if (!acompanhamentoPremium.ativo || acompanhamentoPremium.confirmado) return;
    const premiumEntitlementAtual = obterEntitlementPremiumGlobal(perfil);
    const premiumAgoraAtivo = premiumEntitlementAtual.isPremium;
    const currentUntil = premiumEntitlementAtual.memberUntil || 0;
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
      irLoginComRetorno();
      return;
    }
    setErroCheckoutPlanos('');
    setCarregandoId(plano.id);
    try {
      if (creatorAttributionId) {
        registrarAttributionEvento({
          eventType: 'creator_support_checkout_started',
          source: 'normal',
          campaignId: `apoio_${plano.id}`,
          clickId: creatorAttributionId,
        }).catch(() => {});
      }
      const { data } = await criarCheckoutApoio({
        planId: plano.id,
        ...(creatorAttributionId
          ? { attributionCreatorId: creatorAttributionId }
          : {}),
      });
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        return;
      }
      setErroCheckoutPlanos('O checkout nao retornou uma URL valida. Tente novamente em alguns instantes.');
    } catch (err) {
      console.error('criarCheckoutApoio', err);
      setErroCheckoutPlanos(mensagemErroCallable(err));
    } finally {
      setCarregandoId(null);
    }
  };

  const abrirDoacaoLivre = async () => {
    if (!user?.uid) {
      irLoginComRetorno();
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
      if (creatorAttributionId) {
        registrarAttributionEvento({
          eventType: 'creator_support_checkout_started',
          source: 'normal',
          campaignId: 'apoio_custom',
          clickId: creatorAttributionId,
        }).catch(() => {});
      }
      const { data } = await criarCheckoutApoio({
        customAmount: n,
        ...(creatorAttributionId
          ? { attributionCreatorId: creatorAttributionId }
          : {}),
      });
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

  const abrirMembershipCriador = async () => {
    if (!user?.uid) {
      irLoginComRetorno();
      return;
    }
    if (!creatorAttributionId || creatorOffer?.creatorSupportOffer?.membershipEnabled !== true) {
      setErroMembershipCriador('Este criador ainda não ativou a membership pública.');
      return;
    }
    if (creatorAttributionId === user.uid) {
      setErroMembershipCriador('Você não pode assinar a própria membership de criador.');
      return;
    }
    setErroMembershipCriador('');
    setCarregandoId('creator-membership');
    try {
      registrarAttributionEvento({
        eventType: 'creator_support_checkout_started',
        source: 'normal',
        campaignId: 'creator_membership',
        clickId: creatorAttributionId,
      }).catch(() => {});
      const { data } = await criarCheckoutApoio({
        creatorMembership: true,
        creatorMembershipCreatorId: creatorAttributionId,
        attributionCreatorId: creatorAttributionId,
      });
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('criarCheckoutApoio membership criador', err);
      setErroMembershipCriador(mensagemErroCallable(err));
    } finally {
      setCarregandoId(null);
    }
  };

  const {
    premiumAtivo,
    premiumEntitlement,
    attributionCreatorIdParaCheckout,
    membershipCriadorAtiva,
    membershipAtualDoCriador,
    membershipsAtivas,
    fimPremium,
    precoBase,
    precoAtual,
    precoSeguro,
    promoProgramada,
    textoAteInicioPromo,
    textoTerminaPromo,
    creatorOffer,
  } = useApoieEntitlementsAndAttribution({
    perfil,
    searchParams,
    ofertaPremium,
    setValorLivre,
    ignoreCreatorAttribution: premiumOnlyView,
  });
  const creatorAttributionId = premiumOnlyView ? null : attributionCreatorIdParaCheckout;
  const creatorOfferVisible = !premiumOnlyView && creatorOffer;

  const capIdFromEmail = searchParams.get('capId');
  const fromChapterEmail =
    String(searchParams.get('src') || '').toLowerCase() === 'chapter_email' && Boolean(capIdFromEmail);
  const hrefLerCapEmail = fromChapterEmail
    ? `/ler/${encodeURIComponent(capIdFromEmail)}?${searchParams.toString()}`
    : '';

  const abrirAssinaturaPremium = async () => {
    setErroPremium('');
    if (!user?.uid) {
      irLoginComRetorno();
      return;
    }
    const baselineUntil = premiumEntitlement.memberUntil || 0;
    const attribution = getAttribution();
    setCarregandoId('premium');
    try {
      if (creatorAttributionId) {
        registrarAttributionEvento({
          eventType: 'creator_support_checkout_started',
          source: attribution?.source || 'normal',
          campaignId: 'premium_creator_attribution',
          clickId: creatorAttributionId,
        }).catch(() => {});
      }
      const { data } = await criarCheckoutPremium({
        attribution: attribution
          ? {
              source: attribution.source,
              campaignId: attribution.campaignId || null,
              clickId: attribution.clickId || null,
            }
          : null,
        ...(creatorAttributionId
          ? { attributionCreatorId: creatorAttributionId }
          : {}),
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
          <h1 className="apoie-title-discord">
            {premiumOnlyView ? 'Premium da plataforma' : 'Apoie Kokuin: Heranca do Abismo'}
          </h1>

          {!premiumOnlyView && creatorAttributionId ? (
            <p className="apoie-attrib-hint" role="status">
              Voce entrou por um link de criador: os apoios desta sessao podem ser atribuidos a esse perfil.
            </p>
          ) : null}
          {!premiumOnlyView && creatorAttributionId ? (
            <p className="apoie-attrib-hint" role="note">
              A atribuicao vale para metrica interna e repasse futuro, quando a regra estiver ativa. O valor cobrado nao muda por causa disso.
            </p>
          ) : null}

          {celebracaoPremium.show && (
            <div className="apoie-celebracao-backdrop" role="status" aria-live="polite">
              <div className="apoie-celebracao-card">
                <div className="apoie-celebracao-icone" aria-hidden="true">âš¡</div>
                <h2>
                  {acompanhamentoPremium.tipoConfirmacao === 'renovacao'
                    ? 'Assinatura renovada com sucesso'
                    : 'Pagamento confirmado'}
                </h2>
                <p>
                  {acompanhamentoPremium.tipoConfirmacao === 'renovacao'
                    ? `+${acompanhamentoPremium.diasGanho || 30} dias adicionados. Agora sua assinatura vai ate ${formatarDataLongaBr(acompanhamentoPremium.novoUntil)}.`
                    : 'Seus poderes Premium foram liberados. Bem-vindo a Elite da Tempestade.'}
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
              Pagamento pendente. Quando o Mercado Pago confirmar, voce vera a cobranca finalizada.
            </p>
          )}
          {mpRetorno === 'erro' && (
            <p className="apoie-flash apoie-flash--erro" role="alert">
              Nao foi possivel concluir o pagamento. Voce pode tentar de novo abaixo.
            </p>
          )}

          <p className="apoie-texto">
            {premiumOnlyView ? (
              <>
                Esta pagina e dedicada ao <strong>Premium da plataforma</strong>. Aqui voce assina a membership oficial do site,
                sem misturar doacao de autor nem apoio individual.
              </>
            ) : (
              <>
                Cada apoio faz diferenca real: ajuda com servidor, energia, ferramentas de IA, cafe e meu
                tempo para desenhar mais capitulos.
                <br />
                <strong>Obrigado por acreditar na historia e na tempestade!</strong>
              </>
            )}
          </p>

          {creatorAttributionId && creatorOfferVisible && (
            <div className="apoie-premium-card">
              <div className="apoie-premium-badge">MEMBERSHIP DO CRIADOR</div>
              <h2 className="apoie-premium-titulo">
                {creatorOffer.creatorName} - {formatarPrecoBrl(creatorOffer.creatorSupportOffer?.membershipPriceBRL || 12)} / 30 dias
              </h2>
              <p className="apoie-premium-desc">
                Esta assinatura e do criador. Ela libera acesso antecipado so aos capitulos ligados a{' '}
                <strong>{creatorOffer.creatorName}</strong> - o valor e apoio direto a esse autor.
              </p>
              <ul className="apoie-premium-lista">
                <li>
                  <i className="fa-solid fa-book-open-reader" /> Early access apenas nas obras ligadas a {creatorOffer.creatorName}.
                </li>
                <li>
                  <i className="fa-solid fa-heart" /> O valor desta assinatura vai para o criador indicado.
                </li>
                <li>
                  <i className="fa-solid fa-layer-group" /> Nao substitui o Premium da plataforma nem libera beneficios globais.
                </li>
              </ul>
              {membershipCriadorAtiva && (
                <p className="apoie-premium-status" role="status">
                  Sua membership deste criador esta <strong>ativa</strong>
                  {typeof membershipAtualDoCriador?.memberUntil === 'number'
                    ? ` ate ${formatarDataLongaBr(membershipAtualDoCriador.memberUntil)}`
                    : ''}
                  .
                </p>
              )}
              {erroMembershipCriador && (
                <p className="apoie-premium-erro" role="alert">
                  {erroMembershipCriador}
                </p>
              )}
              <button
                type="button"
                className="btn-apoie btn-apoie-premium"
                disabled={
                  carregandoId !== null ||
                  !user ||
                  creatorOffer?.creatorSupportOffer?.membershipEnabled !== true
                }
                onClick={abrirMembershipCriador}
              >
                {carregandoId === 'creator-membership'
                  ? 'Abrindo checkout...'
                  : membershipCriadorAtiva
                    ? 'Renovar membership deste criador'
                    : `Virar membro de ${creatorOffer.creatorName}`}
              </button>
            </div>
          )}

          {!premiumOnlyView && fromChapterEmail && (
            <div className="apoie-cap-email-banner" role="region" aria-label="Novo capitulo por e-mail">
              <p>
                Voce abriu o link do aviso de capitulo novo. Esta pagina e o <strong>checkout</strong> para
                apoiar a obra; se preferir ler antes, use o botao abaixo. O rastreio do e-mail continua igual.
              </p>
              <button
                type="button"
                className="apoie-cap-email-banner-btn"
                onClick={() => navigate(hrefLerCapEmail)}
              >
                Ir ler o capitulo
              </button>
            </div>
          )}

          <div className="apoie-premium-card">
            <div className="apoie-premium-badge">PREMIUM DA PLATAFORMA</div>
            {ofertaPremium.loading ? (
              <div className="apoie-premium-skeleton" aria-hidden="true">
                <div className="apoie-skeleton-line lg" />
                <div className="apoie-skeleton-line md" />
                <div className="apoie-skeleton-line sm" />
              </div>
            ) : (
              <>
                <h2 className="apoie-premium-titulo">
                  Assinatura Premium - {labelPrecoPremium(precoSeguro)} / 30 dias
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
                    <p
                      className="apoie-premium-timer"
                      title="Dias (quando houver), depois horas:minutos:segundos. Ex.: 1d 01:00:00 = um dia e uma hora."
                    >
                      Termina em: <strong>{textoTerminaPromo}</strong>
                    </p>
                  </div>
                )}
                {promoProgramada && (
                  <div className="apoie-premium-oferta">
                    <p>
                      <strong>{ofertaPremium?.promo?.name || 'Promocao relampago'}</strong> programada.
                    </p>
                    <p>
                      Entrara em: <strong>{textoAteInicioPromo}</strong>
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
              Esta e a assinatura global da plataforma. Ela cobre beneficios gerais da conta e <strong>nao</strong> libera conteudo antecipado de criadores.
            </p>
            <ul className="apoie-premium-lista">

              <li>
                <i className="fa-solid fa-crown" /> Distintivo dourado nos comentarios e destaque de presenca.
              </li>
              <li>
                <i className="fa-solid fa-eye" /> Leitura sem anuncios (quando houver espacos de midia no site).
              </li>
              <li>
                <i className="fa-solid fa-user-pen" /> Perfil: avatares exclusivos e cor de nome (em evolucao no
                painel).
              </li>
              <li>
                <i className="fa-solid fa-ban" /> Early access de obra continua sendo desbloqueado apenas pela membership do respectivo criador.
              </li>
            </ul>
            {premiumAtivo && fimPremium && (
              <p className="apoie-premium-status" role="status">
                Sua assinatura esta <strong>ativa</strong> ate <strong>{fimPremium}</strong>. Voce pode renovar
                antes do fim para somar mais 30 dias a partir do ultimo dia valido.
              </p>
            )}
            {!user && (
              <p className="apoie-premium-login-hint">
                <button type="button" className="apoie-link-login" onClick={irLoginComRetorno}>
                  Entre na sua conta
                </button>{' '}
                para assinar - precisamos saber quem e voce para liberar o Premium.
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
                      ? `Renovacao confirmada (+${acompanhamentoPremium.diasGanho || 30} dias). Novo prazo: ${formatarDataLongaBr(acompanhamentoPremium.novoUntil)}.`
                      : (
                        <>
                          Assinatura detectada com sucesso em{' '}
                          <strong>
                            {formatarHoraBr(acompanhamentoPremium.confirmadoAt, { seVazio: '' })}
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
                ? 'Abrindo checkout...'
                : premiumAtivo
                  ? 'Renovar Premium (30 dias)'
                  : `Assinar Premium — ${labelPrecoPremium(precoSeguro)}`}
            </button>
          </div>

          {!premiumOnlyView && user && membershipsAtivas.length > 0 && !creatorAttributionId ? (
            <p className="apoie-attrib-hint" role="status">
              Voce tem {membershipsAtivas.length} membership{membershipsAtivas.length > 1 ? 's' : ''} ativa{membershipsAtivas.length > 1 ? 's' : ''} de criador no seu perfil.
            </p>
          ) : null}

          {!premiumOnlyView ? (
          <div className="apoie-doacao-livre">
            <h2 className="apoie-doacao-livre-titulo">
              {creatorOffer
                ? `Doação livre para ${creatorOffer.creatorName} (Pix / checkout)`
                : 'Doação livre (Pix / checkout)'}
            </h2>
            <p className="apoie-doacao-livre-desc">
              Escolha o valor (mínimo <strong>R$ 1,00</strong>). Abre o mesmo checkout seguro do Mercado Pago.
              {creatorOffer ? ` Nesta sessão o apoio vai para ${creatorOffer.creatorName}.` : ''}
            </p>
            {!user && (
              <p className="apoie-premium-login-hint">
                <button type="button" className="apoie-link-login" onClick={irLoginComRetorno}>
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
                {carregandoId === 'livre' ? 'Abrindo...' : 'Doar este valor'}
              </button>
            </div>
            {erroValorLivre && (
              <p className="apoie-doacao-erro" role="alert">
                {erroValorLivre}
              </p>
            )}
          </div>
          ) : null}

          {!premiumOnlyView && erroCheckoutPlanos && (
            <p className="apoie-checkout-erro" role="alert">
              <strong>API:</strong> {erroCheckoutPlanos}
            </p>
          )}

          {!premiumOnlyView ? (
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
                  {carregandoId === plano.id ? 'Abrindo...' : `APOIAR ${plano.precoLabel}`}
                </button>
              </div>
            ))}
          </div>
          ) : null}

          {!premiumOnlyView ? (
          <p className="apoie-nota">
            <i className="fa-solid fa-shield-check" /> Checkout oficial do Mercado Pago.{' '}
            <strong>Premium:</strong> após o pagamento aprovado você recebe e-mail de confirmação e, perto do
            fim dos 30 dias, um lembrete para renovar. <strong>Doações:</strong> agradecimento no site (modal),
            sem e-mail automatico. <strong>Membership do criador:</strong> ativa acesso antecipado somente para o autor assinado.
          </p>
          ) : null}

          {!premiumOnlyView ? (
          <div className="apoie-recompensa">
            <h3>RECOMPENSAS</h3>
            <ul>
              <li>
                <i className="fa-solid fa-crown" /> <strong>Assinatura Premium ({labelPrecoPremium()}):</strong>{' '}
                regalias de
                membro (lista acima), por 30 dias renováveis.
              </li>
              <li>
                <i className="fa-solid fa-heart" /> <strong>P / M / G e doacao livre:</strong> apoio a obra -
                sem regalias automaticas no site; seu nome pode entrar nos creditos combinando no Discord.
              </li>
            </ul>
            <div className="discord-notice-box">
              <p>
                Após o apoio, envie o comprovante no nosso <strong>Discord</strong>. Irei anotar sua alma
                para os agradecimentos oficiais.
              </p>
            </div>
          </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}




