import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { buildLoginUrlWithRedirect } from '../../utils/loginRedirectPath';
import {
  SALE_MODEL,
  formatBRL,
  computePersonalOrderTotalWithShipping,
  REGIONAL_FREIGHT_DISCOUNT_CAP_BRL,
  REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY,
  REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL,
  REGIONAL_FREIGHT_DISCOUNT_RATE,
} from '../../utils/printOnDemandPricingV2';
import {
  describePodLeadTimePt,
  formatPodBookFormatPt,
  formatPodSaleModelPt,
} from '../../utils/printOnDemandOrderUi';
import { BRAZILIAN_STATES } from '../../utils/brazilianStates';
import { fetchViaCep } from '../../utils/viaCep';
import { clearPodCartDraft, getPodCartDraft, POD_CART_CHANGED_EVENT } from '../../store/podCartStore';
import './PrintOnDemandCartCheckout.css';

const BRAZIL_UF_SET = new Set(BRAZILIAN_STATES.map((s) => s.uf));
const createPrintOnDemandCheckout = httpsCallable(functions, 'createPrintOnDemandCheckout');

function formatAddressOneLine(name, logradouro, numero, bairro, city, state, zip, complement) {
  const z = String(zip || '').replace(/\D/g, '');
  const line1 = [logradouro?.trim(), numero?.trim()].filter(Boolean).join(', ');
  const parts = [
    name?.trim(),
    line1,
    bairro?.trim(),
    [city?.trim(), state?.trim().toUpperCase()].filter(Boolean).join(' / '),
    z ? `CEP ${z}` : '',
    complement?.trim(),
  ].filter(Boolean);
  return parts.join(' · ');
}

export default function PrintOnDemandCheckoutPage({ user }) {
  const [searchParams] = useSearchParams();
  const mpErro = searchParams.get('mp') === 'erro';

  const [draft, setDraft] = useState(() => getPodCartDraft());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [payChoice, setPayChoice] = useState('pix');

  const [addrName, setAddrName] = useState('');
  const [addrLogradouro, setAddrLogradouro] = useState('');
  const [addrNumero, setAddrNumero] = useState('');
  const [addrBairro, setAddrBairro] = useState('');
  const [addrCity, setAddrCity] = useState('');
  const [addrState, setAddrState] = useState('');
  const [addrZip, setAddrZip] = useState('');
  const [addrComp, setAddrComp] = useState('');
  const [cepLookupBusy, setCepLookupBusy] = useState(false);
  const [cepValidated, setCepValidated] = useState(false);
  const [addressConfirmed, setAddressConfirmed] = useState(false);

  const sync = useCallback(() => setDraft(getPodCartDraft()), []);

  useEffect(() => {
    sync();
    const onCh = () => sync();
    window.addEventListener(POD_CART_CHANGED_EVENT, onCh);
    return () => window.removeEventListener(POD_CART_CHANGED_EVENT, onCh);
  }, [sync]);

  const needAddress = draft?.saleModel === SALE_MODEL.PERSONAL;

  useEffect(() => {
    if (!needAddress) {
      setAddressConfirmed(true);
      return;
    }
    setAddressConfirmed(false);
  }, [needAddress, draft?.addedAt, draft?.saleModel]);

  const loginUrl = buildLoginUrlWithRedirect('/print-on-demand/checkout');

  const leadTimeLine = useMemo(() => {
    if (!draft) return '';
    return describePodLeadTimePt(draft.saleModel, draft.format, draft.quantity);
  }, [draft]);

  const addressDisplayLine = useMemo(
    () =>
      formatAddressOneLine(
        addrName,
        addrLogradouro,
        addrNumero,
        addrBairro,
        addrCity,
        addrState,
        addrZip,
        addrComp
      ),
    [addrName, addrLogradouro, addrNumero, addrBairro, addrCity, addrState, addrZip, addrComp]
  );

  const personalPricingPreview = useMemo(() => {
    if (!draft || draft.saleModel !== SALE_MODEL.PERSONAL) return null;
    return computePersonalOrderTotalWithShipping(draft.format, draft.quantity, addrState);
  }, [draft, addrState]);

  const showToast = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 5000);
  };

  const handleLookupCep = async () => {
    const digits = addrZip.replace(/\D/g, '');
    if (digits.length !== 8) {
      showToast('Digite o CEP com 8 dígitos.');
      return;
    }
    setCepLookupBusy(true);
    try {
      const r = await fetchViaCep(digits);
      if (!r.ok) {
        showToast(r.error);
        return;
      }
      if (r.state && BRAZIL_UF_SET.has(r.state)) setAddrState(r.state);
      if (r.city) setAddrCity(r.city);
      if (r.neighborhood && !addrBairro.trim()) setAddrBairro(r.neighborhood);
      if (r.street && !addrLogradouro.trim()) setAddrLogradouro(r.street);
      setCepValidated(true);
    } finally {
      setCepLookupBusy(false);
    }
  };

  const validateAddress = () => {
    const uf = addrState.trim().toUpperCase();
    const zipDigits = addrZip.replace(/\D/g, '');
    if (zipDigits.length !== 8) {
      showToast('CEP inválido: são obrigatórios 8 dígitos.');
      return false;
    }
    if (!cepValidated) {
      showToast('Valide o CEP com «Buscar CEP» antes de salvar o endereço.');
      return false;
    }
    if (
      addrName.trim().length < 3 ||
      addrLogradouro.trim().length < 3 ||
      addrNumero.trim().length < 1 ||
      !/\d/.test(addrNumero) ||
      addrBairro.trim().length < 2 ||
      addrCity.trim().length < 2 ||
      !BRAZIL_UF_SET.has(uf)
    ) {
      showToast('Preencha nome, logradouro, número, bairro, cidade e UF.');
      return false;
    }
    return true;
  };

  const clearAddressForm = () => {
    setAddrName('');
    setAddrLogradouro('');
    setAddrNumero('');
    setAddrBairro('');
    setAddrCity('');
    setAddrState('');
    setAddrZip('');
    setAddrComp('');
    setCepValidated(false);
    setAddressConfirmed(false);
  };

  const handleConfirmAddress = () => {
    if (!validateAddress()) return;
    setAddressConfirmed(true);
  };

  const handlePay = async () => {
    if (!draft || !user?.uid) return;
    if (needAddress && !addressConfirmed) {
      showToast('Salve o endereço antes de pagar — toque em «Salvar endereço».');
      return;
    }
    if (needAddress && !validateAddress()) return;
    setBusy(true);
    try {
      const payload = {
        saleModel: draft.saleModel,
        format: draft.format,
        quantity: draft.quantity,
        pdfUrl: draft.pdfUrl,
        coverUrl: draft.coverUrl,
        unitSalePriceBRL: draft.unitSalePriceBRL,
        linkedWorkId: draft.linkedWorkId || undefined,
        shippingAddress: needAddress
          ? {
              name: addrName.trim(),
              street: `${addrLogradouro.trim()}, ${addrNumero.trim()}`,
              streetBase: addrLogradouro.trim(),
              streetNumber: addrNumero.trim(),
              neighborhood: addrBairro.trim(),
              city: addrCity.trim(),
              state: addrState.trim().toUpperCase(),
              zip: addrZip.replace(/\D/g, ''),
              complement: addrComp.trim(),
            }
          : null,
      };
      const { data } = await createPrintOnDemandCheckout(payload);
      const url = data?.url ? String(data.url) : '';
      if (!url) throw new Error('Resposta sem link de pagamento.');
      clearPodCartDraft();
      window.location.href = url;
    } catch (e) {
      showToast(e?.message || 'Não foi possível iniciar o pagamento.');
      setBusy(false);
    }
  };

  if (!user?.uid) {
    return (
      <main className="pod-checkout-page">
        <Helmet>
          <title>Finalizar pedido — mangá físico | MangaTeofilo</title>
        </Helmet>
        <section className="pod-checkout-card pod-checkout-card--empty">
          <h1>Finalizar pedido</h1>
          <p>Entre na conta para escolher o pagamento com segurança no Mercado Pago.</p>
          <Link className="pod-checkout-btn pod-checkout-btn--primary" to={loginUrl}>
            Entrar
          </Link>
        </section>
      </main>
    );
  }

  if (!draft) {
    return (
      <main className="pod-checkout-page">
        <Helmet>
          <title>Finalizar pedido — mangá físico | MangaTeofilo</title>
        </Helmet>
        <section className="pod-checkout-card pod-checkout-card--empty">
          <h1>Nada para pagar</h1>
          <p>Adicione um lote ao carrinho antes do checkout.</p>
          <Link className="pod-checkout-btn pod-checkout-btn--primary" to="/loja/carrinho">
            Ir ao carrinho
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="pod-checkout-page">
      <Helmet>
        <title>Finalizar pedido — mangá físico | MangaTeofilo</title>
      </Helmet>

      {busy ? (
        <div className="pod-checkout-processing" role="status" aria-live="polite">
          <div className="pod-checkout-processing__card">
            <div className="pod-checkout-processing__spinner" aria-hidden="true" />
            <p className="pod-checkout-processing__title">Processando pagamento…</p>
            <p className="pod-checkout-processing__sub">Abrindo o Mercado Pago com segurança.</p>
          </div>
        </div>
      ) : null}

      <Link className="pod-checkout-link-back" to="/loja/carrinho">
        ← Voltar ao carrinho
      </Link>
      <header className="pod-checkout-head">
        <h1>Finalizar pedido</h1>
        <p className="pod-checkout-head__sub">
          Endereço (se for «Produzir para mim») → escolha Pix ou cartão no passo seguinte → só após aprovação o pedido entra na
          fila. Produto sob demanda: após pagamento o endereço fica travado; sem devolução por arrependimento, salvo defeito
          analisado pelo suporte.
        </p>
      </header>

      {mpErro ? (
        <p className="pod-checkout-banner pod-checkout-banner--warn" role="status">
          O pagamento não foi concluído. Tente de novo abaixo ou abra o pedido em «Mangá físico» em Pedidos.
        </p>
      ) : null}
      {toast ? (
        <p className="pod-checkout-banner pod-checkout-banner--err" role="alert">
          {toast}
        </p>
      ) : null}

      <div className="pod-checkout-layout">
        <div className="pod-checkout-stack">
          {needAddress ? (
            <section className="pod-checkout-card">
              <h2 className="pod-checkout-section-title">
                <span className="pod-checkout-section-ico" aria-hidden="true">
                  📍
                </span>
                Endereço de entrega
              </h2>
              {addressConfirmed ? (
                <div className="pod-checkout-address-review">
                  <p className="pod-checkout-address-review__label">Endereço selecionado</p>
                  <p className="pod-checkout-address-review__line">{addressDisplayLine}</p>
                  <div className="pod-checkout-address-review__actions">
                    <button type="button" className="pod-checkout-btn pod-checkout-btn--ghost" onClick={() => setAddressConfirmed(false)}>
                      Alterar
                    </button>
                    <button type="button" className="pod-checkout-btn pod-checkout-btn--ghost" onClick={clearAddressForm}>
                      Adicionar novo
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="pod-checkout-hint">
                    CEP com 8 dígitos. É obrigatório usar «Buscar CEP» (ViaCEP) antes de salvar — ajuste só número e
                    complemento se precisar.
                  </p>
                  <label className="pod-checkout-field">
                    <span>Nome completo</span>
                    <input
                      value={addrName}
                      onChange={(e) => setAddrName(e.target.value)}
                      className="pod-checkout-input"
                      autoComplete="name"
                    />
                  </label>
                  <div className="pod-checkout-cep-row">
                    <label className="pod-checkout-field pod-checkout-field--grow">
                      <span>CEP (8 números)</span>
                      <input
                        value={addrZip}
                        onChange={(e) => {
                          setAddrZip(e.target.value.replace(/\D/g, '').slice(0, 8));
                          setCepValidated(false);
                        }}
                        className="pod-checkout-input"
                        inputMode="numeric"
                        maxLength={8}
                        placeholder="00000000"
                      />
                    </label>
                    <button
                      type="button"
                      className="pod-checkout-btn pod-checkout-btn--ghost"
                      disabled={cepLookupBusy}
                      onClick={handleLookupCep}
                    >
                      {cepLookupBusy ? '…' : 'Buscar CEP'}
                    </button>
                  </div>
                  {cepValidated ? (
                    <p className="pod-checkout-hint pod-checkout-hint--compact" role="status">
                      CEP validado ✓
                    </p>
                  ) : null}
                  <label className="pod-checkout-field">
                    <span>Logradouro (rua/avenida)</span>
                    <input
                      value={addrLogradouro}
                      onChange={(e) => setAddrLogradouro(e.target.value)}
                      className="pod-checkout-input"
                      autoComplete="street-address"
                    />
                  </label>
                  <label className="pod-checkout-field">
                    <span>Número</span>
                    <input
                      value={addrNumero}
                      onChange={(e) => setAddrNumero(e.target.value)}
                      className="pod-checkout-input"
                      inputMode="text"
                      placeholder="Ex.: 120 ou S/N 45"
                    />
                  </label>
                  <label className="pod-checkout-field">
                    <span>Bairro</span>
                    <input
                      value={addrBairro}
                      onChange={(e) => setAddrBairro(e.target.value)}
                      className="pod-checkout-input"
                      autoComplete="address-level2"
                    />
                  </label>
                  <div className="pod-checkout-row2">
                    <label className="pod-checkout-field">
                      <span>Cidade</span>
                      <input value={addrCity} onChange={(e) => setAddrCity(e.target.value)} className="pod-checkout-input" />
                    </label>
                    <label className="pod-checkout-field">
                      <span>UF</span>
                      <select value={addrState} onChange={(e) => setAddrState(e.target.value)} className="pod-checkout-input">
                        <option value="">UF</option>
                        {BRAZILIAN_STATES.map(({ uf, name }) => (
                          <option key={uf} value={uf}>
                            {uf} — {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="pod-checkout-field">
                    <span>Complemento (opcional)</span>
                    <input value={addrComp} onChange={(e) => setAddrComp(e.target.value)} className="pod-checkout-input" />
                  </label>
                  <button type="button" className="pod-checkout-btn pod-checkout-btn--primary" onClick={handleConfirmAddress}>
                    Salvar endereço
                  </button>
                </>
              )}
            </section>
          ) : (
            <section className="pod-checkout-card">
              <h2 className="pod-checkout-section-title">
                <span className="pod-checkout-section-ico" aria-hidden="true">
                  📍
                </span>
                Envio
              </h2>
              <p className="pod-checkout-hint">
                Este tipo de venda não exige endereço seu na plataforma. O envio ao leitor final segue o fluxo da loja após a
                produção.
              </p>
            </section>
          )}

          <section className="pod-checkout-card">
            <h2 className="pod-checkout-section-title">
              <span className="pod-checkout-section-ico" aria-hidden="true">
                💳
              </span>
              Pagamento
            </h2>
            <p className="pod-checkout-hint">Escolha como prefere pagar — no Mercado Pago você confirma com o meio selecionado.</p>
            <div className="pod-pay-choice" role="radiogroup" aria-label="Forma de pagamento">
              <label className={`pod-pay-choice__opt ${payChoice === 'pix' ? 'is-on' : ''}`}>
                <input
                  type="radio"
                  name="pod-pay"
                  checked={payChoice === 'pix'}
                  onChange={() => setPayChoice('pix')}
                />
                <span>Pix</span>
              </label>
              <label className={`pod-pay-choice__opt ${payChoice === 'card' ? 'is-on' : ''}`}>
                <input
                  type="radio"
                  name="pod-pay"
                  checked={payChoice === 'card'}
                  onChange={() => setPayChoice('card')}
                />
                <span>Cartão</span>
              </label>
            </div>
            <p className="pod-checkout-hint pod-checkout-hint--compact">
              Outros meios podem aparecer na página do Mercado Pago conforme sua conta.
            </p>
          </section>
        </div>

        <aside className="pod-checkout-summary">
          <div className="pod-checkout-card pod-checkout-card--sticky">
            <h2 className="pod-checkout-summary__title">
              <span className="pod-checkout-section-ico" aria-hidden="true">
                📦
              </span>
              Resumo do pedido
            </h2>
            <p className="pod-cart-line__meta" style={{ marginTop: 0 }}>
              <strong>{formatPodBookFormatPt(draft.format)}</strong> · {draft.quantity} un.
            </p>
            <p className="pod-cart-line__meta">{formatPodSaleModelPt(draft.saleModel)}</p>
            {draft.obraTitle ? <p className="pod-cart-line__meta">Obra: {draft.obraTitle}</p> : null}
            <dl className="pod-checkout-summary__dl">
              {needAddress && personalPricingPreview && addrState.trim().length === 2 ? (
                <>
                  <div className="pod-checkout-summary__row">
                    <dt>Subtotal (lote)</dt>
                    <dd>{formatBRL(personalPricingPreview.goodsTotalBRL ?? 0)}</dd>
                  </div>
                  {personalPricingPreview.freeShipping ? (
                    <div className="pod-checkout-summary__row">
                      <dt>Frete</dt>
                      <dd>Grátis (quantidade)</dd>
                    </div>
                  ) : personalPricingPreview.regionalFreightDiscountApplied ? (
                    <>
                      <div className="pod-checkout-summary__row">
                        <dt>Frete ({addrState})</dt>
                        <dd>{formatBRL(personalPricingPreview.shippingOriginalBRL ?? 0)}</dd>
                      </div>
                      <div className="pod-checkout-summary__row">
                        <dt>Desconto no frete</dt>
                        <dd>-{formatBRL(personalPricingPreview.shippingDiscountBRL ?? 0)}</dd>
                      </div>
                      <div className="pod-checkout-summary__row">
                        <dt>Total frete</dt>
                        <dd>{formatBRL(personalPricingPreview.shippingBRL ?? 0)}</dd>
                      </div>
                      <p className="pod-checkout-hint pod-checkout-hint--compact" style={{ marginTop: 8 }}>
                        Sudeste, Sul e Centro-Oeste: com subtotal {formatBRL(REGIONAL_FREIGHT_DISCOUNT_MIN_SUBTOTAL_BRL)}+ ou{' '}
                        {REGIONAL_FREIGHT_DISCOUNT_MIN_QUANTITY}+ un., até {Math.round(REGIONAL_FREIGHT_DISCOUNT_RATE * 100)}% de
                        desconto no frete (máx. {formatBRL(REGIONAL_FREIGHT_DISCOUNT_CAP_BRL)}).
                      </p>
                    </>
                  ) : personalPricingPreview.shippingBRL != null ? (
                    <div className="pod-checkout-summary__row">
                      <dt>Frete ({addrState})</dt>
                      <dd>{formatBRL(personalPricingPreview.shippingBRL)}</dd>
                    </div>
                  ) : (
                    <div className="pod-checkout-summary__row">
                      <dt>Frete</dt>
                      <dd>Informe a UF</dd>
                    </div>
                  )}
                </>
              ) : null}
              <div className="pod-checkout-summary__total">
                <dt>Total</dt>
                <dd>
                  {needAddress && personalPricingPreview && personalPricingPreview.amountDueBRL != null && addrState.length === 2
                    ? formatBRL(personalPricingPreview.amountDueBRL)
                    : formatBRL(draft.amountDueBRL ?? 0)}
                </dd>
              </div>
            </dl>
            <p className="pod-checkout-hint pod-checkout-hint--compact">{leadTimeLine}</p>
            <button
              type="button"
              className="pod-checkout-btn pod-checkout-btn--primary pod-checkout-btn--block"
              disabled={busy}
              onClick={handlePay}
            >
              {busy ? 'Abrindo…' : 'Confirmar e pagar'}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
