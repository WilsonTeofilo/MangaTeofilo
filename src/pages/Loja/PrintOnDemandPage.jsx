import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../services/firebase';
import { SITE_DEFAULT_IMAGE, SITE_ORIGIN } from '../../config/site';
import { buildLoginUrlWithRedirect } from '../../utils/loginRedirectPath';
import {
  BOOK_FORMAT,
  SALE_MODEL,
  PLATFORM_QUANTITIES,
  PERSONAL_QUANTITIES,
  PLATFORM_RETAIL_UNIT_BRL,
  PERSONAL_UNIT_BRL,
  computePlatformOrder,
  computePersonalOrder,
  computeStorePromoOrder,
  formatBRL,
  getProductionDaysRange,
  computePlatformCreatorProfit,
} from '../../utils/printOnDemandPricingV2';
import { buildPodSaleModeOperation } from '../../utils/podSaleMode';
import PodMetricBar from '../../components/pod/PodMetricBar';
import PodConfirmModal from '../../components/pod/PodConfirmModal';
import { getPodCartDraft, POD_CART_CHANGED_EVENT, setPodCartDraft } from '../../store/podCartStore';
import {
  POD_FORMAT_CARDS,
  POD_STEPS,
  fmtCountPt,
  formatLabel,
  saleModelLabel,
} from './podPageUtils';
import usePodCreatorContext from './hooks/usePodCreatorContext';
import './PrintOnDemandPage.css';

const MAX_PDF_BYTES = 55 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;

export default function PrintOnDemandPage({
  user,
  perfil,
  shellRole = null,
  isMangakaEffective = null,
  obrasVal = null,
  capsVal = null,
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canonicalUrl = `${SITE_ORIGIN}/print-on-demand`;

  const creatorContext = searchParams.get('ctx') === 'creator';
  const podContinueUrl = useMemo(() => {
    const q = new URLSearchParams({ iniciar: '1' });
    if (creatorContext) q.set('ctx', 'creator');
    return `/print-on-demand?${q.toString()}`;
  }, [creatorContext]);
  const loginContinueUrl = podContinueUrl;

  const obraRef = useRef(null);
  const modeloRef = useRef(null);
  const vendaRef = useRef(null);
  const quantidadeRef = useRef(null);
  const arquivosRef = useRef(null);
  const revisaoRef = useRef(null);

  const sectionRefMap = useMemo(
    () => ({
      obra: obraRef,
      modelo: modeloRef,
      venda: vendaRef,
      quantidade: quantidadeRef,
      arquivos: arquivosRef,
      revisao: revisaoRef,
    }),
    []
  );

  const scrollToStep = useCallback((id) => {
    const r = sectionRefMap[id]?.current;
    r?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sectionRefMap]);

  useEffect(() => {
    if (searchParams.get('iniciar') !== '1') return undefined;
    const t = window.setTimeout(() => scrollToStep('modelo'), 120);
    return () => window.clearTimeout(t);
  }, [searchParams, scrollToStep]);

  const [saleModel, setSaleModel] = useState(SALE_MODEL.PLATFORM);
  const podOperation = useMemo(() => buildPodSaleModeOperation(saleModel), [saleModel]);
  const [format, setFormat] = useState(BOOK_FORMAT.TANKOBON);
  const [quantity, setQuantity] = useState(10);
  const [unitSalePrice, setUnitSalePrice] = useState(
    PLATFORM_RETAIL_UNIT_BRL[BOOK_FORMAT.TANKOBON].defaultPrice
  );

  const [pdfFile, setPdfFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [linkedWorkId, setLinkedWorkId] = useState('');
  const [podCartActive, setPodCartActive] = useState(() => Boolean(getPodCartDraft()));
  const {
    isMangakaUser,
    creatorMonetizationActive,
    monetizationGaps,
    platformSaleNeedsMonetization,
    platformSaleLevelHintVisible,
    platformSaleBlocked,
    myWorks,
    storePromoOrderEligible,
    selectedObraRow,
    storePromoMetrics,
  } = usePodCreatorContext({
    user,
    perfil,
    shellRole,
    isMangakaEffective,
    obrasVal,
    capsVal,
    saleModel,
    linkedWorkId,
  });

  useEffect(() => {
    const sync = () => setPodCartActive(Boolean(getPodCartDraft()));
    sync();
    window.addEventListener(POD_CART_CHANGED_EVENT, sync);
    return () => window.removeEventListener(POD_CART_CHANGED_EVENT, sync);
  }, []);

  const flowSteps = useMemo(() => {
    if (podOperation.touchesCatalog && saleModel === SALE_MODEL.STORE_PROMO) {
      return [{ id: 'obra', label: 'Obra na loja' }, ...POD_STEPS];
    }
    return POD_STEPS;
  }, [podOperation.touchesCatalog, saleModel]);

  useEffect(() => {
    if (saleModel !== SALE_MODEL.STORE_PROMO) {
      setLinkedWorkId('');
    }
  }, [saleModel]);

  const coverPreviewUrl = useRef(null);
  const [coverPreviewRev, setCoverPreviewRev] = useState(0);

  useEffect(() => {
    if (coverPreviewUrl.current) {
      URL.revokeObjectURL(coverPreviewUrl.current);
      coverPreviewUrl.current = null;
    }
    if (coverFile && coverFile.type.startsWith('image/')) {
      coverPreviewUrl.current = URL.createObjectURL(coverFile);
      setCoverPreviewRev((n) => n + 1);
    } else {
      setCoverPreviewRev((n) => n + 1);
    }
    return () => {
      if (coverPreviewUrl.current) {
        URL.revokeObjectURL(coverPreviewUrl.current);
        coverPreviewUrl.current = null;
      }
    };
  }, [coverFile]);

  useEffect(() => {
    const retail = PLATFORM_RETAIL_UNIT_BRL[format];
    setUnitSalePrice(retail.defaultPrice);
  }, [format]);

  useEffect(() => {
    if (podOperation.touchesCatalog) {
      setQuantity((q) => (PLATFORM_QUANTITIES.includes(q) ? q : 10));
    } else {
      setQuantity((q) => (PERSONAL_QUANTITIES.includes(q) ? q : 10));
    }
  }, [podOperation.touchesCatalog]);

  const qtyOptions = podOperation.touchesCatalog ? PLATFORM_QUANTITIES : PERSONAL_QUANTITIES;

  const retail = PLATFORM_RETAIL_UNIT_BRL[format];

  const platformCalc = useMemo(() => {
    if (saleModel !== SALE_MODEL.PLATFORM) return null;
    return computePlatformOrder(format, quantity, unitSalePrice);
  }, [saleModel, format, quantity, unitSalePrice]);

  const personalCalc = useMemo(() => {
    if (saleModel !== SALE_MODEL.PERSONAL) return null;
    return computePersonalOrder(format, quantity);
  }, [saleModel, format, quantity]);

  const storePromoCalc = useMemo(() => {
    if (saleModel !== SALE_MODEL.STORE_PROMO) return null;
    return computeStorePromoOrder(format, quantity);
  }, [saleModel, format, quantity]);

  const prodDays = useMemo(
    () => getProductionDaysRange(saleModel, format, quantity),
    [saleModel, format, quantity]
  );

  const unitMarginPlatform = useMemo(() => {
    if (saleModel !== SALE_MODEL.PLATFORM) return null;
    const u = Math.min(retail.max, Math.max(retail.min, Number(unitSalePrice) || retail.min));
    return computePlatformCreatorProfit(u, retail.baseCost);
  }, [saleModel, retail, unitSalePrice]);

  const obraDisplayName = useMemo(() => {
    if (!selectedObraRow) return '';
    return String(
      selectedObraRow.title ||
        selectedObraRow.titulo ||
        selectedObraRow.nome ||
        selectedObraRow.name ||
        'Obra'
    ).trim();
  }, [selectedObraRow]);

  useEffect(() => {
    if (!platformSaleBlocked) return;
    setSaleModel((m) => (m === SALE_MODEL.PLATFORM ? SALE_MODEL.PERSONAL : m));
  }, [platformSaleBlocked]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const showToast = (message, type = 'error') => setToast({ message, type });

  const clampPrice = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return retail.defaultPrice;
    const s = Math.round(n * 2) / 2;
    return Math.min(retail.max, Math.max(retail.min, s));
  };

  const uploadFile = async (file, prefix) => {
    if (!user?.uid) throw new Error('Faça login para enviar arquivos.');
    const safe = String(file.name || 'arquivo').replace(/[^\w.-]+/g, '_').slice(0, 80);
    const path = `print_on_demand/${user.uid}/${Date.now()}_${prefix}_${safe}`;
    const r = storageRef(storage, path);
    const isPdf = prefix === 'miolo';
    const contentType = isPdf
      ? 'application/pdf'
      : file.type && String(file.type).startsWith('image/')
        ? file.type
        : 'image/jpeg';
    await uploadBytes(r, file, { contentType });
    return getDownloadURL(r);
  };

  const validateBeforeSubmit = () => {
    if (!user?.uid) {
      navigate(buildLoginUrlWithRedirect(loginContinueUrl));
      return false;
    }
    if (!pdfFile || !coverFile) {
      showToast('Envie o PDF do miolo e o arquivo da capa.');
      scrollToStep('arquivos');
      return false;
    }
    if (pdfFile.size > MAX_PDF_BYTES) {
      showToast('PDF muito grande (máx. 55 MB).');
      scrollToStep('arquivos');
      return false;
    }
    if (coverFile.size > MAX_COVER_BYTES) {
      showToast('Capa muito grande (máx. 8 MB).');
      scrollToStep('arquivos');
      return false;
    }
    if (saleModel === SALE_MODEL.PLATFORM) {
      if (platformSaleNeedsMonetization) {
        setModal('monetization');
        scrollToStep('modelo');
        return false;
      }
      if (!platformCalc) {
        showToast('Quantidade inválida para venda na plataforma.');
        scrollToStep('quantidade');
        return false;
      }
      const u = clampPrice(unitSalePrice);
      if (u !== unitSalePrice) setUnitSalePrice(u);
    }
    if (saleModel === SALE_MODEL.PERSONAL) {
      if (!personalCalc) {
        showToast('Quantidade inválida.');
        scrollToStep('quantidade');
        return false;
      }
    }
    if (saleModel === SALE_MODEL.STORE_PROMO) {
      if (!user?.uid) {
        showToast('Faça login para enviar o pedido.');
        scrollToStep('revisao');
        return false;
      }
      if (creatorMonetizationActive) {
        showToast('Com monetização ativa, use "Venda pela plataforma".');
        return false;
      }
      if (!isMangakaUser && myWorks.length === 0) {
        showToast('Cadastre uma obra como criador para usar este modo.');
        scrollToStep('obra');
        return false;
      }
      if (!String(linkedWorkId).trim()) {
        showToast('Selecione a obra vinculada.');
        scrollToStep('obra');
        return false;
      }
      if (!storePromoMetrics.ok) {
        showToast('Requisitos de divulgação ainda não atingidos.');
        scrollToStep('obra');
        return false;
      }
      if (!storePromoCalc) {
        showToast('Quantidade inválida para divulgação na loja.');
        scrollToStep('quantidade');
        return false;
      }
    }
    return true;
  };

  const runAddToCartAfterConfirm = async () => {
    if (!validateBeforeSubmit()) {
      setModal(null);
      return;
    }
    setBusy(true);
    try {
      const pdfUrl = await uploadFile(pdfFile, 'miolo');
      const coverUrl = await uploadFile(coverFile, 'capa');
      const amountDue =
        saleModel === SALE_MODEL.PLATFORM
          ? platformCalc?.amountDueBRL
          : saleModel === SALE_MODEL.STORE_PROMO
            ? storePromoCalc?.amountDueBRL
            : personalCalc?.amountDueBRL;
      const labelLine = `${formatLabel(format)} · ${saleModelLabel(saleModel)} · ${quantity} un.`;
      setPodCartDraft({
        saleModel,
        format,
        quantity,
        unitSalePriceBRL: saleModel === SALE_MODEL.PLATFORM ? clampPrice(unitSalePrice) : undefined,
        linkedWorkId: saleModel === SALE_MODEL.STORE_PROMO ? String(linkedWorkId).trim() : null,
        pdfUrl,
        coverUrl,
        amountDueBRL: Number(amountDue) || 0,
        labelLine,
        obraTitle: saleModel === SALE_MODEL.STORE_PROMO ? obraDisplayName || null : null,
        addedAt: Date.now(),
      });
      setPdfFile(null);
      setCoverFile(null);
      setModal(null);
      showToast('Lote no carrinho. Revise e pague no checkout — o pedido só confirma após o pagamento.', 'success');
      navigate('/loja/carrinho');
    } catch (err) {
      const msg = err?.message || 'Não foi possível enviar os arquivos.';
      showToast(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenAddToCartModal = () => {
    if (!validateBeforeSubmit()) return;
    setModal('addCartConfirm');
  };

  const selectSaleModel = (m) => {
    if (m === SALE_MODEL.PLATFORM) {
      if (platformSaleNeedsMonetization) {
        setModal('monetization');
        return;
      }
    }
    if (m === SALE_MODEL.STORE_PROMO) {
      if (creatorMonetizationActive) {
        showToast(
          'Com monetização ativa, use "Vender e ganhar" na loja. O modo vitrine é para quem ainda não monetiza.'
        );
        return;
      }
      setSaleModel(m);
      window.setTimeout(() => scrollToStep('obra'), 80);
      return;
    }
    setSaleModel(m);
  };

  const pickFile = (kind, fileList) => {
    const f = fileList?.[0];
    if (!f) return;
    if (kind === 'pdf') {
      if (f.type !== 'application/pdf' && !f.name?.toLowerCase().endsWith('.pdf')) {
        showToast('O miolo deve ser um PDF.');
        return;
      }
      setPdfFile(f);
    } else {
      if (!f.type.startsWith('image/')) {
        showToast('A capa deve ser imagem (JPG, PNG ou WebP).');
        return;
      }
      setCoverFile(f);
    }
  };

  const onDrop = (e, kind) => {
    e.preventDefault();
    setDragTarget(null);
    pickFile(kind, e.dataTransfer?.files);
  };

  const sidebarTotal =
    saleModel === SALE_MODEL.PLATFORM
      ? platformCalc?.amountDueBRL
      : saleModel === SALE_MODEL.STORE_PROMO
        ? storePromoCalc?.amountDueBRL
        : personalCalc?.amountDueBRL;
  const sidebarLucro =
    saleModel === SALE_MODEL.PLATFORM ? platformCalc?.creatorProfitTotalIfAllSoldBRL ?? null : null;
  const sidebarLucroUnit =
    saleModel === SALE_MODEL.PLATFORM ? platformCalc?.creatorProfitPerSoldUnitBRL ?? null : null;
  const prazoLabel =
    prodDays.low && prodDays.high
      ? saleModel === SALE_MODEL.PLATFORM || saleModel === SALE_MODEL.STORE_PROMO
        ? `até ${prodDays.high} dias úteis para aprovação`
        : `${prodDays.low}–${prodDays.high} dias úteis`
      : '—';

  const shippingLine =
    !podOperation.requiresShippingAddress && saleModel === SALE_MODEL.STORE_PROMO
      ? null
      : !podOperation.requiresShippingAddress && saleModel === SALE_MODEL.PLATFORM
        ? platformCalc?.shippingNote
        : personalCalc?.shippingNote;

  const stepIndex = useCallback(
    (id) => {
      const i = flowSteps.findIndex((s) => s.id === id);
      return i >= 0 ? i + 1 : 1;
    },
    [flowSteps]
  );

  return (
    <main className="pod-page">
      <Helmet>
        <title>Lance sua linha | MangaTeofilo</title>
        <meta
          name="description"
          content="Tankobon e meio-tanko fisico na MangaTeofilo: venda pela plataforma, producao para voce ou vitrine editorial na loja. Catalogo, producao e financeiro em etapas separadas."
        />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Lance sua linha | MangaTeofilo" />
        <meta
          property="og:description"
          content="Tankobon e meio-tanko fisico na MangaTeofilo: venda pela plataforma, producao para voce ou vitrine editorial na loja. Catalogo, producao e financeiro em etapas separadas."
        />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={SITE_DEFAULT_IMAGE} />
        <meta name="twitter:title" content="Lance sua linha | MangaTeofilo" />
        <meta
          name="twitter:description"
          content="Tankobon e meio-tanko fisico na MangaTeofilo: venda pela plataforma, producao para voce ou vitrine editorial na loja. Catalogo, producao e financeiro em etapas separadas."
        />
        <meta name="twitter:image" content={SITE_DEFAULT_IMAGE} />
        <link rel="canonical" href={canonicalUrl} />
      </Helmet>

      {toast ? (
        <div className={`pod-toast pod-toast--${toast.type}`} role="status">
          {toast.message}
        </div>
      ) : null}

      {modal === 'monetization' ? (
        <div
          className="pod-modal-root"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && setModal(null)}
        >
          <div className="pod-modal" role="dialog" aria-modal="true" aria-labelledby="pod-modal-mono-title">
            <h2 id="pod-modal-mono-title" className="pod-modal__title">
              Venda na loja exige area financeira ativa
            </h2>
            <div className="pod-modal__body">
              <p>
                Para colocar mangá físico à venda na MangaTeofilo, você precisa de{' '}
                <strong>monetização ativa</strong> e dados completos para receber pela plataforma (conta, documentação, etc.).
              </p>
              <p>
                Sem isso, a loja não consegue registrar seus ganhos corretamente quando houver venda — por exemplo, em caso de
                menor de idade ou cadastro sem dados bancários.
              </p>
              <p>
                Solicite a monetizacao no seu perfil; apos a <strong>aprovacao do administrador</strong>, voce recebe
                uma notificacao e ai sim pode escolher &quot;Venda pela plataforma&quot; para entrar na fila comercial da loja.
              </p>
              <p className="pod-modal__hint">
                Enquanto isso, voce pode usar <strong>Produzir para mim</strong> e informar o endereco no checkout ao pagar.
              </p>
              {storePromoOrderEligible ? (
                <p className="pod-modal__hint">
                  Quer so divulgar? Use o cartao <strong>Modo vitrine</strong> ao lado — ele funciona como vitrine editorial, sem repasse financeiro.
                </p>
              ) : null}
            </div>
            <div className="pod-modal__actions">
              <button type="button" className="pod-btn pod-btn--ghost" onClick={() => setModal(null)}>
                Fechar
              </button>
              <Link to="/perfil" className="pod-btn pod-btn--primary pod-modal__link-btn" onClick={() => setModal(null)}>
                Abrir perfil
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <PodConfirmModal
        open={modal === 'addCartConfirm'}
        title={saleModel === SALE_MODEL.STORE_PROMO ? 'Enviar este lote ao carrinho?' : 'Adicionar lote ao carrinho?'}
        description={
          saleModel === SALE_MODEL.STORE_PROMO
            ? 'Voce sera levado ao carrinho para revisar e pagar. O pedido so entra na fila depois do pagamento aprovado. No modo vitrine, a loja opera como exposicao editorial e nao gera repasse ao creator.'
            : 'Os arquivos serao enviados ao armazenamento seguro e o lote vai para o carrinho. Na proxima etapa voce informa endereco (se for "Produzir para mim") e paga no Mercado Pago — sem pagamento, nao ha pedido confirmado.'
        }
        confirmLabel="Continuar"
        cancelLabel="Cancelar"
        busy={busy}
        onClose={() => !busy && setModal(null)}
        onConfirm={runAddToCartAfterConfirm}
      />

      <div className="pod-layout">
        <div className="pod-layout__main">
          <header className="pod-hero">
            <h1 className="pod-hero__title">Lance sua linha</h1>
            {user ? (
              <p className="pod-hero__orders-strip">
                <Link className="pod-hero__orders-link" to="/loja/carrinho">
                  Carrinho
                </Link>
                <span className="pod-hero__orders-sep" aria-hidden="true">
                  ·
                </span>
                <Link className="pod-hero__orders-link" to="/pedidos?tab=fisico">
                  Acompanhar pedidos
                </Link>
              </p>
            ) : null}

            {user && podCartActive ? (
              <p className="pod-draft-active-banner" role="status">
                Há um lote no carrinho. Se você montar outro e tocar em «Adicionar ao carrinho», o lote atual será{' '}
                <strong>substituído</strong>.{' '}
                <Link className="pod-draft-active-banner__link" to="/loja/carrinho">
                  Abrir carrinho
                </Link>
              </p>
            ) : null}

            <p className="pod-mode-question">Como você quer publicar?</p>
            <div className="pod-mode-grid pod-mode-grid--three" role="group" aria-label="Modo de pedido">
              <button
                type="button"
                title="Para vender na loja, você precisa crescer sua obra na plataforma."
                className={`pod-mode-card ${saleModel === SALE_MODEL.PLATFORM ? 'is-selected' : ''} ${platformSaleBlocked ? 'pod-mode-card--blocked' : ''}`}
                onClick={() => selectSaleModel(SALE_MODEL.PLATFORM)}
              >
                <span className="pod-mode-card__badge">Recomendado</span>
                <h2 className="pod-mode-card__title">
                  {platformSaleNeedsMonetization ? (
                    <>
                      Vender e ganhar <span className="pod-mode-card__lock-inline">ðŸ”’</span>
                    </>
                  ) : (
                    'Vender e ganhar'
                  )}
                </h2>
                <p className="pod-mode-card__kicker">Venda pela plataforma</p>
                <p className="pod-mode-card__desc">
                  Voce define o preco na faixa da loja, paga o lote agora e recebe repasse por unidade vendida na operacao comercial da plataforma.
                </p>
                {platformSaleNeedsMonetization ? (
                  <p className="pod-mode-card__lock">Disponível com monetização aprovada na plataforma.</p>
                ) : platformSaleLevelHintVisible ? (
                  <div className="pod-platform-gate">
                    <p className="pod-platform-gate__title">Disponível no nível Monetizado</p>
                    <p className="pod-platform-gate__hint">Faltam:</p>
                    {monetizationGaps.length ? (
                      <ul className="pod-platform-gate__list">
                        {monetizationGaps.map((g) => (
                          <li key={g.key}>
                            {new Intl.NumberFormat('pt-BR').format(g.left)} {g.label}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="pod-platform-gate__hint">Continue engajando leitores na plataforma.</p>
                    )}
                    <Link
                      className="pod-platform-gate__cta"
                      to="/creator/monetizacao"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Ver progresso
                    </Link>
                  </div>
                ) : null}
              </button>
              <button
                type="button"
                className={`pod-mode-card ${saleModel === SALE_MODEL.PERSONAL ? 'is-selected' : ''}`}
                onClick={() => selectSaleModel(SALE_MODEL.PERSONAL)}
              >
                <h2 className="pod-mode-card__title">Produzir para mim</h2>
                <p className="pod-mode-card__kicker">Encomenda pessoal</p>
                <p className="pod-mode-card__desc">
                  Encomende os exemplares para um endereco seu — producao e envio direto para voce revender ou presentear.
                </p>
              </button>
              <button
                type="button"
                id="pod-opcao-modo-vitrine"
                className={`pod-mode-card pod-mode-card--store-promo ${saleModel === SALE_MODEL.STORE_PROMO ? 'is-selected' : ''} ${creatorMonetizationActive ? 'pod-mode-card--blocked' : ''}`}
                onClick={() => selectSaleModel(SALE_MODEL.STORE_PROMO)}
              >
                <span className="pod-mode-card__badge pod-mode-card__badge--secondary">Divulgação na loja</span>
                <h2 className="pod-mode-card__title">Vitrine editorial</h2>
                <p className="pod-mode-card__kicker">Publicação para exposição</p>
                <div className="pod-mode-card__body pod-mode-card__body--vitrine">
                  <p className="pod-mode-card__desc">Publique sua obra na loja como vitrine editorial, sem custo de entrada.</p>
                  <p className="pod-mode-card__desc">A MangaTeofilo define o preço e cuida da venda.</p>
                  <p className="pod-mode-card__desc">Ideal para ganhar visibilidade.</p>
                  <p className="pod-mode-card__footnote">(sem repasse financeiro neste modo)</p>
                </div>
                <p className="pod-mode-card__desc pod-mode-card__desc--after">
                  Lotes <strong>10, 20 ou 30</strong> un. · metas de engajamento e aprovação da equipe antes de publicar.
                </p>
                {creatorMonetizationActive ? (
                  <p className="pod-mode-card__lock">Com monetização ativa, use "Vender e ganhar".</p>
                ) : !user ? (
                  <p className="pod-mode-card__tap-hint">
                    Visualização:{' '}
                    <Link to={buildLoginUrlWithRedirect(loginContinueUrl)}>entre na conta</Link> para associar uma obra e
                    ver as metas.
                  </p>
                ) : !storePromoOrderEligible ? (
                  <p className="pod-mode-card__tap-hint">
                    <Link to="/creators">Programa CREATORS</Link> — publique uma obra como criador para solicitar divulgação
                    na loja.
                  </p>
                ) : (
                  <p className="pod-mode-card__tap-hint">
                    Toque aqui — escolha a obra e veja views, likes e seguidores rumo às metas.
                  </p>
                )}
                {saleModel === SALE_MODEL.STORE_PROMO && linkedWorkId && !storePromoMetrics.ok ? (
                  <p className="pod-mode-card__lock">Meta ainda não batida — veja as barras na etapa "Obra na loja".</p>
                ) : null}
              </button>
            </div>
          </header>

          <nav className="pod-stepper" aria-label="Etapas">
            {flowSteps.map((s, i) => (
              <button key={s.id} type="button" className="pod-stepper__step" onClick={() => scrollToStep(s.id)}>
                <span className="pod-stepper__n">{i + 1}</span>
                <span className="pod-stepper__label">{s.label}</span>
              </button>
            ))}
          </nav>

          {saleModel === SALE_MODEL.STORE_PROMO ? (
            <section ref={obraRef} id="pod-step-obra" className="pod-panel pod-panel--obra">
              <h2 className="pod-panel__title">
                {stepIndex('obra')} · Qual obra vai para a vitrine editorial?
              </h2>
              {!user ? (
                <p className="pod-panel__hint">
                  <Link to={buildLoginUrlWithRedirect(loginContinueUrl)}>Faça login</Link> para escolher a obra e ver as
                  metas de desbloqueio.
                </p>
              ) : null}
              {user && !storePromoOrderEligible && !creatorMonetizationActive ? (
                <p className="pod-panel__hint">
                  Precisa de perfil de criador com obra cadastrada. Veja o{' '}
                  <Link to="/creators">programa CREATORS</Link>.
                </p>
              ) : null}
              <p className="pod-panel__hint">
                O pedido de mangá físico precisa estar associado a <strong>uma obra sua</strong>. As métricas de desbloqueio
                (seguidores, views, likes) usam essa obra e os capítulos ligados a ela.
              </p>
              <label className="pod-field pod-field--select">
                <span className="pod-field__label">Selecione a obra</span>
                <select
                  className="pod-select"
                  value={linkedWorkId}
                  onChange={(e) => setLinkedWorkId(e.target.value)}
                  required
                  disabled={!storePromoOrderEligible || myWorks.length === 0}
                >
                  <option value="">Selecione...</option>
                  {myWorks.map((w) => (
                    <option key={w.id} value={w.id}>
                      {String(w.title || w.titulo || w.nome || w.name || w.id).trim()}
                    </option>
                  ))}
                </select>
              </label>
              {linkedWorkId ? (
                <>
                  <div className="pod-obra-quick-stats" aria-live="polite">
                    <p className="pod-obra-quick-stats__title">{obraDisplayName || 'Obra'}</p>
                    <ul className="pod-obra-quick-stats__list">
                      <li>
                        <span className="pod-obra-quick-stats__ico" aria-hidden="true">
                          👁️
                        </span>
                        <span>
                          <strong>{fmtCountPt(storePromoMetrics.views)}</strong> views
                        </span>
                      </li>
                      <li>
                        <span className="pod-obra-quick-stats__ico" aria-hidden="true">
                          ❤️
                        </span>
                        <span>
                          <strong>{fmtCountPt(storePromoMetrics.likes)}</strong> likes
                        </span>
                      </li>
                      <li>
                        <span className="pod-obra-quick-stats__ico" aria-hidden="true">
                          👥
                        </span>
                        <span>
                          <strong>{fmtCountPt(storePromoMetrics.followers)}</strong> seguidores
                        </span>
                      </li>
                    </ul>
                  </div>
                  <p className="pod-panel__hint pod-panel__hint--metrics">
                    Progresso rumo às metas para liberar o envio (Nível 1 — 300 seguidores · 5 mil views · 100 likes):
                  </p>
                  <div className="pod-promo-metrics" aria-live="polite">
                    <PodMetricBar
                      label="Seguidores"
                      current={storePromoMetrics.followers}
                      max={storePromoMetrics.thresholds.followers}
                    />
                    <PodMetricBar
                      label="Views (obra + capítulos)"
                      current={storePromoMetrics.views}
                      max={storePromoMetrics.thresholds.views}
                    />
                    <PodMetricBar
                      label="Likes (obra + capítulos)"
                      current={storePromoMetrics.likes}
                      max={storePromoMetrics.thresholds.likes}
                    />
                  </div>
                  <p className="pod-promo-warn pod-promo-warn--soft" role="note">
                    Neste modo a loja exibe sua obra para descoberta; <strong>nao ha repasse financeiro</strong> para voce.
                  </p>
                  {!storePromoMetrics.ok ? (
                    <div className="pod-promo-gate">
                      <p className="pod-promo-lock">
                        <span aria-hidden="true">ðŸ”’</span> Bloqueado até atingir os requisitos acima.
                      </p>
                      <button type="button" className="pod-btn pod-btn--ghost" disabled>
                        Bloqueado — requisitos não atingidos
                      </button>
                    </div>
                  ) : (
                    <div className="pod-promo-gate">
                      <button type="button" className="pod-btn pod-btn--primary" onClick={() => scrollToStep('modelo')}>
                        Continuar
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="pod-panel__hint">
                  Escolha uma obra acima para ver suas métricas em destaque e o quanto falta para desbloquear o modo
                  vitrine.
                </p>
              )}
            </section>
          ) : null}

          <section ref={modeloRef} id="pod-step-modelo" className="pod-panel">
            <h2 className="pod-panel__title">{stepIndex('modelo')} · Modelo</h2>
            <p className="pod-panel__hint">Escolha o formato do volume.</p>
            <div className="pod-format-grid">
              {POD_FORMAT_CARDS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`pod-format-card ${format === c.id ? 'is-selected' : ''}`}
                  onClick={() => setFormat(c.id)}
                >
                  <span className="pod-format-card__title">{c.title}</span>
                  {c.lines.map((line) => (
                    <span key={line} className="pod-format-card__line">
                      {line}
                    </span>
                  ))}
                </button>
              ))}
            </div>
          </section>

          <section ref={vendaRef} id="pod-step-venda" className="pod-panel">
            <h2 className="pod-panel__title">
              {stepIndex('venda')} · {saleModel === SALE_MODEL.STORE_PROMO ? 'Divulgação na loja' : 'Venda'}
            </h2>
            {saleModel === SALE_MODEL.PLATFORM ? (
              <>
                <p className="pod-panel__hint">Defina o preco comercial dentro da faixa permitida. O lote e pago agora e o seu repasse aparece por unidade vendida.</p>
                <div className="pod-price-block">
                  <div className="pod-price-row">
                    <label className="pod-price-label" htmlFor="pod-unit-price">
                      Preço na loja
                    </label>
                    <div className="pod-price-value">{formatBRL(unitSalePrice)}</div>
                  </div>
                  <input
                    id="pod-unit-price"
                    type="range"
                    className="pod-range"
                    min={retail.min}
                    max={retail.max}
                    step={0.5}
                    value={unitSalePrice}
                    onChange={(e) => setUnitSalePrice(Number(e.target.value))}
                  />
                  <div className="pod-price-input-row">
                    <span className="pod-muted">
                      Mín. {formatBRL(retail.min)} · Máx. {formatBRL(retail.max)}
                    </span>
                    <input
                      type="number"
                      className="pod-num-input"
                      min={retail.min}
                      max={retail.max}
                      step={0.5}
                      value={unitSalePrice}
                      onChange={(e) => setUnitSalePrice(clampPrice(e.target.value))}
                      onBlur={(e) => setUnitSalePrice(clampPrice(e.target.value))}
                    />
                  </div>
                  {unitMarginPlatform ? (
                    <div className="pod-earn-grid">
                      <div className="pod-earn pod-earn--you">
                        <span className="pod-earn__label">Seu custo por unidade no lote</span>
                        <span className="pod-earn__value">{formatBRL(platformCalc?.unitProductionCostBRL ?? 0)}</span>
                      </div>
                      <div className="pod-earn pod-earn--plat">
                        <span className="pod-earn__label">Seu lucro por unidade vendida</span>
                        <span className="pod-earn__value">{formatBRL(unitMarginPlatform.creator)}</span>
                      </div>
                    </div>
                  ) : null}
                  <p className="pod-footnote">
                    {platformCalc?.shippingNote} Depois disso, o produto entra na fila comercial para aparecer na loja.
                  </p>
                </div>
              </>
            ) : saleModel === SALE_MODEL.STORE_PROMO ? (
              <div className="pod-price-block pod-price-block--fixed">
                <p className="pod-panel__hint">
                  Voce publica na loja <strong>sem custos</strong>. A MangaTeofilo define o preco e cuida da venda. Voce{' '}
                  <strong>nao recebe repasse financeiro</strong> nesse modo — ele existe para visibilidade e prova social.
                </p>
                <p className="pod-footnote pod-footnote--tight">
                  Depois do envio, a equipe analisa em até 2 dias úteis antes de publicar.
                </p>
              </div>
            ) : (
              <div className="pod-personal-price">
                <p className="pod-panel__hint">Preço fechado por unidade para você receber o lote em casa.</p>
                <p className="pod-personal-price__big">
                  Preço por unidade:{' '}
                  <strong>
                    {formatBRL(personalCalc?.unitCostBRL ?? PERSONAL_UNIT_BRL[format]?.unitCost ?? 0)}
                  </strong>
                </p>
                <p className="pod-footnote">{personalCalc?.shippingNote}</p>
              </div>
            )}
          </section>

          <section ref={quantidadeRef} id="pod-step-quantidade" className="pod-panel">
            <h2 className="pod-panel__title">{stepIndex('quantidade')} · Quantidade</h2>
            <p className="pod-panel__hint">Toque no lote desejado.</p>
            <div className="pod-qty-grid">
              {qtyOptions.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`pod-qty-btn ${quantity === q ? 'is-selected' : ''}`}
                  onClick={() => setQuantity(q)}
                >
                  {saleModel === SALE_MODEL.PERSONAL && q === 1 ? '1 · teste' : q}
                </button>
              ))}
            </div>
            <div className="pod-qty-feedback">
              {saleModel !== SALE_MODEL.STORE_PROMO ? (
                <div>
                  <span className="pod-muted">Total a pagar agora</span>
                  <strong className="pod-qty-feedback__total">{formatBRL(sidebarTotal ?? 0)}</strong>
                </div>
              ) : null}
              <div>
                <span className="pod-muted">Frete</span>
                <strong>
                  {saleModel === SALE_MODEL.PERSONAL && personalCalc?.freeShipping
                    ? 'Grátis (lote)'
                    : saleModel === SALE_MODEL.PERSONAL
                      ? 'Calculado no checkout'
                      : saleModel === SALE_MODEL.STORE_PROMO
                        ? 'Não se aplica'
                        : 'Não se aplica'}
                </strong>
              </div>
              <div>
                <span className="pod-muted">Prazo estimado</span>
                <strong>{prazoLabel}</strong>
              </div>
            </div>
          </section>

          <section ref={arquivosRef} id="pod-step-arquivos" className="pod-panel">
            <h2 className="pod-panel__title">{stepIndex('arquivos')} · Arquivos</h2>
            <p className="pod-panel__hint">
              {saleModel === SALE_MODEL.STORE_PROMO
                ? 'PDF do miolo e imagem da capa.'
                : 'PDF do miolo e imagem da capa. Arraste ou clique para enviar.'}
            </p>

            <div
              className={`pod-drop ${dragTarget === 'pdf' ? 'is-drag' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragTarget('pdf');
              }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={(e) => onDrop(e, 'pdf')}
            >
              <span className="pod-drop__title">PDF do miolo</span>
              <span className="pod-drop__meta">Até 55 MB</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="pod-drop__input"
                onChange={(e) => pickFile('pdf', e.target.files)}
              />
              {pdfFile ? (
                <div className="pod-file-meta">
                  <span>{pdfFile.name}</span>
                  <span className="pod-muted">{(pdfFile.size / (1024 * 1024)).toFixed(1)} MB</span>
                </div>
              ) : (
                <span className="pod-drop__cta">{saleModel === SALE_MODEL.STORE_PROMO ? 'Soltar PDF' : 'Solte o PDF aqui'}</span>
              )}
            </div>

            <div
              className={`pod-drop ${dragTarget === 'cover' ? 'is-drag' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragTarget('cover');
              }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={(e) => onDrop(e, 'cover')}
            >
              <span className="pod-drop__title">Capa</span>
              <span className="pod-drop__meta">JPG, PNG ou WebP · máx. 8 MB</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                className="pod-drop__input"
                onChange={(e) => pickFile('cover', e.target.files)}
              />
              {coverFile ? (
                <div className="pod-file-meta">
                  <span>{coverFile.name}</span>
                  <span className="pod-muted">{(coverFile.size / 1024).toFixed(0)} KB</span>
                </div>
              ) : (
                <span className="pod-drop__cta">{saleModel === SALE_MODEL.STORE_PROMO ? 'Soltar imagem' : 'Solte a imagem aqui'}</span>
              )}
              {coverPreviewUrl.current ? (
                <img
                  key={coverPreviewRev}
                  src={coverPreviewUrl.current}
                  alt="Prévia da capa"
                  className="pod-cover-preview"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
            </div>
          </section>

          <section ref={revisaoRef} id="pod-step-revisao" className="pod-panel pod-panel--review">
            <h2 className="pod-panel__title">{stepIndex('revisao')} · Revisão</h2>
            <div className="pod-review-card">
              <dl className="pod-review-dl">
                <div>
                  <dt>Modelo</dt>
                  <dd>{formatLabel(format)}</dd>
                </div>
                <div>
                  <dt>Modo</dt>
                  <dd>{saleModelLabel(saleModel)}</dd>
                </div>
                {saleModel === SALE_MODEL.STORE_PROMO && linkedWorkId ? (
                  <div>
                    <dt>Obra</dt>
                    <dd>{obraDisplayName || linkedWorkId}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Quantidade</dt>
                  <dd>{quantity} un.</dd>
                </div>
                {saleModel !== SALE_MODEL.STORE_PROMO ? (
                  <div>
                    <dt>Preço unitário</dt>
                    <dd>
                      {saleModel === SALE_MODEL.PLATFORM
                        ? formatBRL(unitSalePrice)
                        : formatBRL(personalCalc?.unitCostBRL ?? 0)}
                    </dd>
                  </div>
                ) : null}
                {saleModel !== SALE_MODEL.STORE_PROMO ? (
                  <div>
                    <dt>Total de producao agora</dt>
                    <dd className="pod-review-dl__emph">{formatBRL(sidebarTotal ?? 0)}</dd>
                  </div>
                ) : null}
                {saleModel === SALE_MODEL.PLATFORM ? (
                  <>
                    <div>
                      <dt>Custo unitário do lote</dt>
                      <dd>{formatBRL(platformCalc?.unitProductionCostBRL ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Lucro por unidade vendida</dt>
                      <dd className="pod-review-dl__profit">{formatBRL(platformCalc?.creatorProfitPerSoldUnitBRL ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Lucro se vender tudo</dt>
                      <dd className="pod-review-dl__profit">{formatBRL(platformCalc?.creatorProfitTotalIfAllSoldBRL ?? 0)}</dd>
                    </div>
                  </>
                ) : null}
                <div>
                  <dt>Prazo</dt>
                  <dd>
                    {saleModel === SALE_MODEL.PLATFORM || saleModel === SALE_MODEL.STORE_PROMO
                      ? 'Ate 2 dias uteis para aprovacao do admin e liberacao na loja'
                      : `${prazoLabel} (producao + entrega)`}
                  </dd>
                </div>
                {saleModel === SALE_MODEL.PERSONAL ? (
                  <div>
                    <dt>Tempo manual estimado</dt>
                    <dd>{prodDays.totalHours ? `${prodDays.totalHours} h` : '—'}</dd>
                  </div>
                ) : null}
              </dl>
              {shippingLine ? <p className="pod-footnote">{shippingLine}</p> : null}
              {saleModel === SALE_MODEL.STORE_PROMO ? (
                <p className="pod-footnote pod-footnote--tight">
                  O produto sera analisado pelo admin antes de entrar na loja.
                </p>
              ) : null}
            </div>

            <div className="pod-address pod-address--optional">
              <h3 className="pod-address__title">Próximo passo: carrinho e pagamento</h3>
              <p className="pod-panel__hint">
                O endereço (modo <strong>Produzir para mim</strong>) e o pagamento ficam no{' '}
                <strong>checkout</strong>, depois que você adicionar o lote ao carrinho — igual a um e-commerce. Sem
                pagamento aprovado, o pedido não avança.
              </p>
              {saleModel === SALE_MODEL.STORE_PROMO ? (
                <p className="pod-panel__hint pod-footnote--tight">
                  Vitrine editorial (sem repasse): apos o pagamento, a equipe analisa o material em ate 2 dias uteis.
                </p>
              ) : null}
            </div>

            {!user ? (
              <p className="pod-login-hint">
                <Link to={buildLoginUrlWithRedirect(loginContinueUrl)}>Faça login</Link> para enviar arquivos e usar o
                carrinho.
              </p>
            ) : null}

            <button
              type="button"
              className="pod-btn pod-btn--primary pod-btn--cta"
              disabled={
                busy ||
                (saleModel === SALE_MODEL.STORE_PROMO &&
                  (!storePromoOrderEligible || !storePromoMetrics.ok || !String(linkedWorkId).trim()))
              }
              onClick={handleOpenAddToCartModal}
            >
              {busy ? 'Enviando...' : 'Adicionar ao carrinho'}
            </button>
            {saleModel === SALE_MODEL.STORE_PROMO ? (
              <p className="pod-cta-note">O produto sera analisado pelo admin antes de entrar na loja.</p>
            ) : null}
          </section>

        </div>

        <aside className="pod-summary" aria-label="Resumo do pedido">
          <div className="pod-summary__inner">
            <h2 className="pod-summary__title">Resumo operacional</h2>
            <dl className="pod-summary__dl">
              <div>
                <dt>Modelo</dt>
                <dd>{formatLabel(format)}</dd>
              </div>
              <div>
                <dt>Modo</dt>
                <dd>{saleModelLabel(saleModel)}</dd>
              </div>
              <div>
                <dt>Quantidade</dt>
                <dd>{quantity}</dd>
              </div>
              {saleModel !== SALE_MODEL.STORE_PROMO ? (
                <div className="pod-summary__row--big">
                  <dt>Total</dt>
                  <dd>{formatBRL(sidebarTotal ?? 0)}</dd>
                </div>
              ) : null}
              {saleModel === SALE_MODEL.PLATFORM ? (
                <div className="pod-summary__row--profit">
                  <dt>Lucro estimado</dt>
                  <dd>{formatBRL(sidebarLucro ?? 0)}</dd>
                </div>
              ) : null}
              {saleModel === SALE_MODEL.PLATFORM ? (
                <div>
                  <dt>Lucro por unidade</dt>
                  <dd>{formatBRL(sidebarLucroUnit ?? 0)}</dd>
                </div>
              ) : null}
              <div className="pod-summary__row--prazo">
                <dt>Prazo</dt>
                <dd>
                  {saleModel === SALE_MODEL.PLATFORM || saleModel === SALE_MODEL.STORE_PROMO
                    ? 'Aprovacao em ate 2 dias uteis'
                    : `${prazoLabel} (producao + entrega)`}
                </dd>
              </div>
            </dl>
            <button type="button" className="pod-btn pod-btn--ghost pod-summary__jump" onClick={() => scrollToStep('revisao')}>
              Ir para revisão
            </button>
            {user ? (
              <Link className="pod-btn pod-btn--ghost pod-summary__jump" to="/loja/carrinho" style={{ textAlign: 'center' }}>
                Abrir carrinho
              </Link>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}




