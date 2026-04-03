import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

import { functions, storage } from '../../services/firebase';
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
  formatBRL,
  getProductionDaysRange,
  computePlatformCreatorProfit,
} from '../../utils/printOnDemandPricingV2';
import { effectiveCreatorMonetizationStatus } from '../../utils/creatorMonetizationUi';
import './PrintOnDemandPage.css';

const MAX_PDF_BYTES = 55 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;

const STEPS = [
  { id: 'modelo', label: 'Modelo' },
  { id: 'venda', label: 'Venda' },
  { id: 'quantidade', label: 'Quantidade' },
  { id: 'arquivos', label: 'Arquivos' },
  { id: 'revisao', label: 'Revisão' },
];

const FORMAT_CARDS = [
  {
    id: BOOK_FORMAT.TANKOBON,
    title: 'Tankōbon',
    lines: ['180–220 páginas', 'Mais completo e profissional'],
  },
  {
    id: BOOK_FORMAT.MEIO_TANKO,
    title: 'Meio-Tankō',
    lines: ['80–100 páginas', 'Mais rápido e barato'],
  },
];

function formatLabel(id) {
  return id === BOOK_FORMAT.TANKOBON ? 'Tankōbon' : 'Meio-Tankō';
}

function saleModelLabel(m) {
  return m === SALE_MODEL.PLATFORM ? 'Venda pela plataforma' : 'Comprar para mim';
}

export default function PrintOnDemandPage({ user, perfil, adminAccess }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const canonicalUrl = 'https://mangateofilo.com/print-on-demand';

  const creatorContext = searchParams.get('ctx') === 'creator';
  const podContinueUrl = useMemo(() => {
    const q = new URLSearchParams({ iniciar: '1' });
    if (creatorContext) q.set('ctx', 'creator');
    return `/print-on-demand?${q.toString()}`;
  }, [creatorContext]);
  const loginContinueUrl = podContinueUrl;

  const modeloRef = useRef(null);
  const vendaRef = useRef(null);
  const quantidadeRef = useRef(null);
  const arquivosRef = useRef(null);
  const revisaoRef = useRef(null);

  const sectionRefMap = useMemo(
    () => ({
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
  const [format, setFormat] = useState(BOOK_FORMAT.TANKOBON);
  const [quantity, setQuantity] = useState(10);
  const [unitSalePrice, setUnitSalePrice] = useState(
    PLATFORM_RETAIL_UNIT_BRL[BOOK_FORMAT.TANKOBON].defaultPrice
  );

  const [pdfFile, setPdfFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);

  const [addrName, setAddrName] = useState('');
  const [addrStreet, setAddrStreet] = useState('');
  const [addrCity, setAddrCity] = useState('');
  const [addrState, setAddrState] = useState('');
  const [addrZip, setAddrZip] = useState('');
  const [addrComp, setAddrComp] = useState('');

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [myOrders, setMyOrders] = useState([]);
  const [modal, setModal] = useState(null);
  const [successOrderId, setSuccessOrderId] = useState('');
  const pendingNavRef = useRef(null);

  const isMangakaUser = useMemo(
    () =>
      String(perfil?.role || '').trim().toLowerCase() === 'mangaka' ||
      Boolean(adminAccess?.isMangaka),
    [adminAccess?.isMangaka, perfil?.role]
  );
  const creatorMonetizationActive = useMemo(
    () =>
      effectiveCreatorMonetizationStatus(
        perfil?.creatorMonetizationPreference,
        perfil?.creatorMonetizationStatus
      ) === 'active',
    [perfil?.creatorMonetizationPreference, perfil?.creatorMonetizationStatus]
  );
  const platformSaleBlocked =
    isMangakaUser && (perfil == null || !creatorMonetizationActive);

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

  const submitFn = useMemo(() => httpsCallable(functions, 'submitPrintOnDemandOrder'), []);
  const listMineFn = useMemo(() => httpsCallable(functions, 'listMyPrintOnDemandOrders'), []);

  useEffect(() => {
    const retail = PLATFORM_RETAIL_UNIT_BRL[format];
    setUnitSalePrice(retail.defaultPrice);
  }, [format]);

  useEffect(() => {
    if (saleModel === SALE_MODEL.PLATFORM) {
      setQuantity((q) => (PLATFORM_QUANTITIES.includes(q) ? q : 10));
    } else {
      setQuantity((q) => (PERSONAL_QUANTITIES.includes(q) ? q : 10));
    }
  }, [saleModel]);

  const qtyOptions = saleModel === SALE_MODEL.PLATFORM ? PLATFORM_QUANTITIES : PERSONAL_QUANTITIES;

  const retail = PLATFORM_RETAIL_UNIT_BRL[format];

  const platformCalc = useMemo(() => {
    if (saleModel !== SALE_MODEL.PLATFORM) return null;
    return computePlatformOrder(format, quantity, unitSalePrice);
  }, [saleModel, format, quantity, unitSalePrice]);

  const personalCalc = useMemo(() => {
    if (saleModel !== SALE_MODEL.PERSONAL) return null;
    return computePersonalOrder(format, quantity);
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

  useEffect(() => {
    if (saleModel === SALE_MODEL.PERSONAL) return;
    setAddrName('');
    setAddrStreet('');
    setAddrCity('');
    setAddrState('');
    setAddrZip('');
    setAddrComp('');
  }, [saleModel]);

  useEffect(() => {
    if (!platformSaleBlocked) return;
    setSaleModel((m) => (m === SALE_MODEL.PLATFORM ? SALE_MODEL.PERSONAL : m));
  }, [platformSaleBlocked]);

  const loadMine = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const { data } = await listMineFn();
      setMyOrders(Array.isArray(data?.orders) ? data.orders : []);
    } catch {
      setMyOrders([]);
    }
  }, [listMineFn, user?.uid]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

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
      if (platformSaleBlocked) {
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
      if (addrStreet.trim().length < 4 || addrCity.trim().length < 2 || addrState.trim().length < 2) {
        showToast('Preencha endereço completo para entrega.');
        scrollToStep('revisao');
        return false;
      }
      if (addrZip.replace(/\D/g, '').length < 5 || addrName.trim().length < 3) {
        showToast('Nome e CEP são obrigatórios.');
        scrollToStep('revisao');
        return false;
      }
    }
    return true;
  };

  const runSubmit = async () => {
    if (!validateBeforeSubmit()) return;
    setBusy(true);
    try {
      const pdfUrl = await uploadFile(pdfFile, 'miolo');
      const coverUrl = await uploadFile(coverFile, 'capa');
      const payload = {
        saleModel,
        format,
        quantity,
        pdfUrl,
        coverUrl,
        unitSalePriceBRL: saleModel === SALE_MODEL.PLATFORM ? clampPrice(unitSalePrice) : undefined,
        shippingAddress:
          saleModel === SALE_MODEL.PERSONAL
            ? {
                name: addrName.trim(),
                street: addrStreet.trim(),
                city: addrCity.trim(),
                state: addrState.trim(),
                zip: addrZip.trim(),
                complement: addrComp.trim(),
              }
            : null,
      };
      const { data } = await submitFn(payload);
      if (!data?.orderId) throw new Error('Resposta inválida do servidor.');
      const oid = String(data.orderId);
      setSuccessOrderId(oid);
      const dest =
        creatorContext && searchParams.get('stay') !== '1'
          ? '/creator/loja?printPedido=ok'
          : podContinueUrl;
      pendingNavRef.current = dest;
      setPdfFile(null);
      setCoverFile(null);
      await loadMine();
      setModal(saleModel === SALE_MODEL.PLATFORM ? 'success_platform' : 'success_personal');
    } catch (err) {
      const code = String(err?.code || '');
      const msg = err?.message || 'Não foi possível enviar o pedido.';
      if (
        code.includes('failed-precondition') ||
        /monetiz|repasse|Venda na loja/i.test(msg)
      ) {
        setModal('monetization');
      } else {
        showToast(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmProduction = () => {
    if (!validateBeforeSubmit()) return;
    const ok = window.confirm(
      'Confirmar pedido de produção? Em seguida você verá o resumo e poderá seguir para o pagamento quando o checkout estiver disponível.'
    );
    if (!ok) return;
    runSubmit();
  };

  const closeSuccessModal = () => {
    setModal(null);
    setSuccessOrderId('');
    const dest = pendingNavRef.current;
    pendingNavRef.current = null;
    if (dest) navigate(dest);
  };

  const selectSaleModel = (m) => {
    if (m === SALE_MODEL.PLATFORM && platformSaleBlocked) {
      setModal('monetization');
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
    saleModel === SALE_MODEL.PLATFORM ? platformCalc?.amountDueBRL : personalCalc?.amountDueBRL;
  const sidebarLucro =
    saleModel === SALE_MODEL.PLATFORM ? platformCalc?.creatorProfitTotalIfAllSoldBRL ?? null : null;
  const sidebarLucroUnit =
    saleModel === SALE_MODEL.PLATFORM ? platformCalc?.creatorProfitPerSoldUnitBRL ?? null : null;
  const prazoLabel =
    prodDays.low && prodDays.high
      ? saleModel === SALE_MODEL.PLATFORM
        ? `até ${prodDays.high} dias úteis para aprovação`
        : `${prodDays.low}–${prodDays.high} dias úteis`
      : '—';

  const shippingLine =
    saleModel === SALE_MODEL.PLATFORM
      ? platformCalc?.shippingNote
      : personalCalc?.shippingNote;

  return (
    <main className="pod-page">
      <Helmet>
        <title>Produzir mangá físico | MangaTeofilo</title>
        <meta
          name="description"
          content="Configure tankōbon ou meio-tankō físico: venda na loja ou encomende para você, com preço e lucro claros."
        />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Produzir mangá físico | MangaTeofilo" />
        <meta
          property="og:description"
          content="Configure tankōbon ou meio-tankō físico: venda na loja ou encomende para você, com preço e lucro claros."
        />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content="https://mangateofilo.com/assets/fotos/shito.jpg" />
        <meta name="twitter:title" content="Produzir mangá físico | MangaTeofilo" />
        <meta
          name="twitter:description"
          content="Configure tankōbon ou meio-tankō físico: venda na loja ou encomende para você, com preço e lucro claros."
        />
        <meta name="twitter:image" content="https://mangateofilo.com/assets/fotos/shito.jpg" />
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
              Venda na loja exige perfil monetizado
            </h2>
            <div className="pod-modal__body">
              <p>
                Para colocar mangá físico à venda na MangaTeofilo, você precisa de{' '}
                <strong>monetização ativa</strong> e dados completos para repasse (conta, documentação, etc.).
              </p>
              <p>
                Sem isso, a loja não consegue registrar repasses legais quando houver venda — por exemplo, em caso de
                menor de idade ou cadastro sem dados bancários.
              </p>
              <p>
                Solicite a monetização no seu perfil; após a <strong>aprovação do administrador</strong>, você recebe
                uma notificação e aí sim pode escolher &quot;Venda pela plataforma&quot; e produzir o lote para a vitrine.
              </p>
              <p className="pod-modal__hint">
                Enquanto isso, você pode usar <strong>Comprar para mim</strong> e receber o lote no seu endereço.
              </p>
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

      {modal === 'success_platform' && successOrderId ? (
        <div className="pod-modal-root" role="presentation" onClick={(e) => e.target === e.currentTarget && closeSuccessModal()}>
          <div className="pod-modal" role="dialog" aria-modal="true" aria-labelledby="pod-modal-ok-plat-title">
            <h2 id="pod-modal-ok-plat-title" className="pod-modal__title">
              Pedido registrado
            </h2>
            <div className="pod-modal__body">
              <p>
                Seu pedido para <strong>venda na loja</strong> foi criado com sucesso (
                <strong>#{successOrderId.slice(-8).toUpperCase()}</strong>).
              </p>
              <p>
                Próximos passos: concluir o <strong>pagamento</strong> quando o checkout estiver disponível. Depois disso,
                a equipe tem até <strong>2 dias úteis</strong> para analisar e liberar o produto na vitrine.
              </p>
              <p className="pod-modal__hint">Você será avisado por notificação quando houver atualização.</p>
            </div>
            <div className="pod-modal__actions">
              <button type="button" className="pod-btn pod-btn--primary" onClick={closeSuccessModal}>
                Continuar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'success_personal' && successOrderId ? (
        <div className="pod-modal-root" role="presentation" onClick={(e) => e.target === e.currentTarget && closeSuccessModal()}>
          <div className="pod-modal" role="dialog" aria-modal="true" aria-labelledby="pod-modal-ok-per-title">
            <h2 id="pod-modal-ok-per-title" className="pod-modal__title">
              Pedido para você registrado
            </h2>
            <div className="pod-modal__body">
              <p>
                Seu pedido <strong>#{successOrderId.slice(-8).toUpperCase()}</strong> foi criado. O lote será produzido e
                enviado para o endereço informado.
              </p>
              <p>
                <strong>Prazo estimado:</strong>{' '}
                {prodDays.low && prodDays.high
                  ? `${prodDays.low} a ${prodDays.high} dias úteis (produção e envio), conforme fila e transportadora.`
                  : 'Os prazos aparecem no resumo do pedido; a equipe confirma após o pagamento.'}
              </p>
              <p className="pod-modal__hint">
                Acompanhe o status em &quot;Meus pedidos físicos&quot; abaixo e nas notificações da conta.
              </p>
            </div>
            <div className="pod-modal__actions">
              <button type="button" className="pod-btn pod-btn--primary" onClick={closeSuccessModal}>
                Continuar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="pod-layout">
        <div className="pod-layout__main">
          <header className="pod-hero">
            <h1 className="pod-hero__title">Lance sua linha conosco</h1>
            <p className="pod-hero__sub">Escolha o formato, veja quanto custa produzir e decida se quer vender na MangaTeofilo ou pedir seu lote para casa.</p>

            <div className="pod-mode-grid" role="group" aria-label="Modo de pedido">
              <button
                type="button"
                className={`pod-mode-card ${saleModel === SALE_MODEL.PLATFORM ? 'is-selected' : ''} ${platformSaleBlocked ? 'pod-mode-card--blocked' : ''}`}
                onClick={() => selectSaleModel(SALE_MODEL.PLATFORM)}
              >
                <span className="pod-mode-card__badge">Recomendado</span>
                <h2 className="pod-mode-card__title">Venda pela plataforma</h2>
                <p className="pod-mode-card__desc">
                  Você paga o lote, a loja vende depois e seu lucro vem da diferença entre seu custo por unidade e o preço final na vitrine.
                </p>
                {platformSaleBlocked ? (
                  <p className="pod-mode-card__lock">Disponível com monetização ativa na plataforma.</p>
                ) : null}
              </button>
              <button
                type="button"
                className={`pod-mode-card ${saleModel === SALE_MODEL.PERSONAL ? 'is-selected' : ''}`}
                onClick={() => selectSaleModel(SALE_MODEL.PERSONAL)}
              >
                <h2 className="pod-mode-card__title">Comprar para mim</h2>
                <p className="pod-mode-card__desc">
                  Você encomenda direto com a gente para receber em um único endereço e vender por conta própria.
                </p>
              </button>
            </div>
          </header>

          <nav className="pod-stepper" aria-label="Etapas">
            {STEPS.map((s, i) => (
              <button key={s.id} type="button" className="pod-stepper__step" onClick={() => scrollToStep(s.id)}>
                <span className="pod-stepper__n">{i + 1}</span>
                <span className="pod-stepper__label">{s.label}</span>
              </button>
            ))}
          </nav>

          <section ref={modeloRef} id="pod-step-modelo" className="pod-panel">
            <h2 className="pod-panel__title">1 · Modelo</h2>
            <p className="pod-panel__hint">Escolha o formato do volume.</p>
            <div className="pod-format-grid">
              {FORMAT_CARDS.map((c) => (
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
            <h2 className="pod-panel__title">2 · Venda</h2>
            {saleModel === SALE_MODEL.PLATFORM ? (
              <>
                <p className="pod-panel__hint">Defina o preço da vitrine dentro da faixa permitida. O lote já é pago agora e o seu lucro aparece por unidade vendida.</p>
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
                    {platformCalc?.shippingNote} Depois disso, o produto entra na fila para aparecer na loja.
                  </p>
                </div>
              </>
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
            <h2 className="pod-panel__title">3 · Quantidade</h2>
            <p className="pod-panel__hint">Toque no lote desejado.</p>
            <div className="pod-qty-grid">
              {qtyOptions.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`pod-qty-btn ${quantity === q ? 'is-selected' : ''}`}
                  onClick={() => setQuantity(q)}
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="pod-qty-feedback">
              <div>
                <span className="pod-muted">Total a pagar agora</span>
                <strong className="pod-qty-feedback__total">{formatBRL(sidebarTotal ?? 0)}</strong>
              </div>
              <div>
                <span className="pod-muted">Frete</span>
                <strong>
                  {saleModel === SALE_MODEL.PERSONAL && personalCalc?.freeShipping
                    ? 'Grátis (lote)'
                    : saleModel === SALE_MODEL.PERSONAL
                      ? 'Calculado no checkout'
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
            <h2 className="pod-panel__title">4 · Arquivos</h2>
            <p className="pod-panel__hint">PDF do miolo e imagem da capa. Arraste ou clique para enviar.</p>

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
                <span className="pod-drop__cta">Solte o PDF aqui</span>
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
                <span className="pod-drop__cta">Solte a imagem aqui</span>
              )}
              {coverPreviewUrl.current ? (
                <img
                  key={coverPreviewRev}
                  src={coverPreviewUrl.current}
                  alt="Prévia da capa"
                  className="pod-cover-preview"
                />
              ) : null}
            </div>
          </section>

          <section ref={revisaoRef} id="pod-step-revisao" className="pod-panel pod-panel--review">
            <h2 className="pod-panel__title">5 · Revisão</h2>
            <div className="pod-review-card">
              <dl className="pod-review-dl">
                <div>
                  <dt>Modelo</dt>
                  <dd>{formatLabel(format)}</dd>
                </div>
                <div>
                  <dt>Tipo</dt>
                  <dd>{saleModelLabel(saleModel)}</dd>
                </div>
                <div>
                  <dt>Quantidade</dt>
                  <dd>{quantity} un.</dd>
                </div>
                <div>
                  <dt>Preço unitário</dt>
                  <dd>
                    {saleModel === SALE_MODEL.PLATFORM
                      ? formatBRL(unitSalePrice)
                      : formatBRL(personalCalc?.unitCostBRL ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt>Total (produção agora)</dt>
                  <dd className="pod-review-dl__emph">{formatBRL(sidebarTotal ?? 0)}</dd>
                </div>
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
                    {saleModel === SALE_MODEL.PLATFORM
                      ? 'Até 2 dias úteis para aprovação do admin e liberação na loja'
                      : `${prazoLabel} (produção + entrega)`}
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
            </div>

            {saleModel === SALE_MODEL.PERSONAL ? (
              <div className="pod-address">
                <h3 className="pod-address__title">Endereço de entrega</h3>
                <input
                  className="pod-input"
                  placeholder="Nome completo"
                  value={addrName}
                  onChange={(e) => setAddrName(e.target.value)}
                />
                <input
                  className="pod-input"
                  placeholder="Logradouro e número"
                  value={addrStreet}
                  onChange={(e) => setAddrStreet(e.target.value)}
                />
                <div className="pod-input-row">
                  <input
                    className="pod-input"
                    placeholder="Cidade"
                    value={addrCity}
                    onChange={(e) => setAddrCity(e.target.value)}
                  />
                  <input
                    className="pod-input"
                    placeholder="UF"
                    value={addrState}
                    onChange={(e) => setAddrState(e.target.value)}
                    maxLength={2}
                  />
                </div>
                <input
                  className="pod-input"
                  placeholder="CEP"
                  value={addrZip}
                  onChange={(e) => setAddrZip(e.target.value)}
                />
                <input
                  className="pod-input"
                  placeholder="Complemento (opcional)"
                  value={addrComp}
                  onChange={(e) => setAddrComp(e.target.value)}
                />
              </div>
            ) : (
              <div className="pod-address pod-address--optional">
                <h3 className="pod-address__title">Sem endereço neste modo</h3>
                <p className="pod-panel__hint">Aqui você só solicita e paga o lote para a MangaTeofilo colocar na loja depois. A equipe confirma o pagamento e aprova em até 2 dias úteis.</p>
              </div>
            )}

            {!user ? (
              <p className="pod-login-hint">
                <Link to={buildLoginUrlWithRedirect(loginContinueUrl)}>Faça login</Link> para confirmar a produção.
              </p>
            ) : null}

            <button
              type="button"
              className="pod-btn pod-btn--primary pod-btn--cta"
              disabled={busy}
              onClick={handleConfirmProduction}
            >
              {busy ? 'Enviando…' : 'Confirmar produção'}
            </button>
          </section>

          {user && myOrders.length > 0 ? (
            <section className="pod-my-orders" aria-labelledby="pod-mine-title">
              <h2 id="pod-mine-title" className="pod-panel__title">
                Meus pedidos físicos
              </h2>
              <ul className="pod-order-list">
                {myOrders.map((o) => (
                  <li key={o.id}>
                    <strong>#{String(o.id).slice(-8).toUpperCase()}</strong>
                    <span>{o.status}</span>
                    <span>{new Date(o.createdAt || 0).toLocaleDateString('pt-BR')}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="pod-summary" aria-label="Resumo do pedido">
          <div className="pod-summary__inner">
            <h2 className="pod-summary__title">Resumo</h2>
            <dl className="pod-summary__dl">
              <div>
                <dt>Modelo</dt>
                <dd>{formatLabel(format)}</dd>
              </div>
              <div>
                <dt>Modo</dt>
                <dd>{saleModel === SALE_MODEL.PLATFORM ? 'Venda pela plataforma' : 'Comprar para mim'}</dd>
              </div>
              <div>
                <dt>Quantidade</dt>
                <dd>{quantity}</dd>
              </div>
              <div className="pod-summary__row--big">
                <dt>Total</dt>
                <dd>{formatBRL(sidebarTotal ?? 0)}</dd>
              </div>
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
                  {saleModel === SALE_MODEL.PLATFORM
                    ? 'Aprovação em até 2 dias úteis'
                    : `${prazoLabel} (produção + entrega)`}
                </dd>
              </div>
            </dl>
            <button type="button" className="pod-btn pod-btn--ghost pod-summary__jump" onClick={() => scrollToStep('revisao')}>
              Ir para revisão
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
