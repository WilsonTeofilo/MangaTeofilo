import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref, set } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { Link, useNavigate } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import { descontoVipLojaAtivo } from '../../utils/capituloLancamento';
import { applyVipDiscount, normalizeStoreConfig, STORE_DEFAULT_CONFIG } from '../../config/store';
import { clearCart, getCartItems, removeFromCart, updateCartQuantity } from '../../store/cartStore';
import { openStoreCheckout } from '../../utils/storeCheckout';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { PERFIL_LOJA_DADOS_HASH } from '../../utils/brazilianStates';
import { formatStoreShippingEtaLabel } from '../../utils/storeShipping';
import { buildLoginUrlWithRedirect } from '../../utils/loginRedirectPath';
import { getStoreBuyerProfileMissingFields } from '../../utils/storeBuyerProfile';
import { describePodLeadTimePt, formatPodBookFormatPt, formatPodSaleModelPt } from '../../utils/printOnDemandOrderUi';
import { formatBRL } from '../../utils/printOnDemandPricingV2';
import { clearPodCartDraft, getPodCartDraft, POD_CART_CHANGED_EVENT } from '../../store/podCartStore';
import './Loja.css';
import './PrintOnDemandCartCheckout.css';

function mapProducts(data) {
  const src = data && typeof data === 'object' ? data : {};
  return Object.entries(src).reduce((acc, [id, item]) => {
    acc[id] = { id, ...(item || {}) };
    return acc;
  }, {});
}

function lineKey(productId, size) {
  return `${productId}::${size || ''}`;
}

function maxCartQtyForProduct(p) {
  if (!p) return 99;
  if (String(p.inventoryMode || '').toLowerCase() === 'on_demand') return 99;
  return Math.max(1, Number(p.stock || 1));
}

export default function LojaCarrinho({ user, perfil }) {
  const navigate = useNavigate();
  const quoteStoreShipping = useMemo(() => httpsCallable(functions, 'quoteStoreShipping'), []);
  const [cartItems, setCartItems] = useState(getCartItems());
  const [firebaseProducts, setFirebaseProducts] = useState({});
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [shippingQuote, setShippingQuote] = useState(null);
  /** Preços por linha e subtotal devolvidos por `quoteStoreShipping` (autoridade para exibição). */
  const [serverCartPricing, setServerCartPricing] = useState(null);
  const [shippingLoading, setShippingLoading] = useState(false);
  const [shippingService, setShippingService] = useState('PAC');
  const [podDraft, setPodDraft] = useState(() => getPodCartDraft());

  const vip = descontoVipLojaAtivo(perfil, user);
  const buyerMissingFields = useMemo(
    () => getStoreBuyerProfileMissingFields(perfil?.buyerProfile),
    [perfil?.buyerProfile]
  );
  const products = useMemo(() => firebaseProducts, [firebaseProducts]);

  useEffect(() => {
    const unsubProducts = onValue(ref(db, 'loja/produtos'), (snap) => {
      setFirebaseProducts(mapProducts(snap.exists() ? snap.val() : {}));
    });
    const unsubCfg = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    return () => {
      unsubProducts();
      unsubCfg();
    };
  }, []);

  useEffect(() => {
    const syncPod = () => setPodDraft(getPodCartDraft());
    syncPod();
    window.addEventListener(POD_CART_CHANGED_EVENT, syncPod);
    return () => window.removeEventListener(POD_CART_CHANGED_EVENT, syncPod);
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    set(ref(db, `loja/carrinhos/${user.uid}`), {
      items: cartItems,
      updatedAt: Date.now(),
    }).catch(() => {});
  }, [cartItems, user?.uid]);

  const detailed = useMemo(() => {
    return cartItems
      .map((item) => {
        const p = products[item.productId];
        if (!p) return null;
        const basePrice = Number(p.isOnSale && Number(p.promoPrice) > 0 ? p.promoPrice : p.price || 0);
        const unitPrice = applyVipDiscount(basePrice, p, config.vipDiscountPct, vip);
        const sz = item.size || '';
        const type = String(p.type || 'manga').toLowerCase();
        const sizes = Array.isArray(p.sizes) ? p.sizes.map((s) => String(s || '').trim()).filter(Boolean) : [];
        if (type === 'roupa' && sizes.length && !sizes.includes(sz)) {
          return { ...item, product: p, unitPrice, lineTotal: 0, invalidSize: true };
        }
        return {
          ...item,
          product: p,
          unitPrice,
          lineTotal: Math.round(unitPrice * item.quantity * 100) / 100,
          invalidSize: false,
        };
      })
      .filter(Boolean);
  }, [cartItems, products, config.vipDiscountPct, vip]);

  const hasInvalid = detailed.some((l) => l.invalidSize);
  const selectedShippingOption = useMemo(
    () => shippingQuote?.options?.find((option) => option.serviceCode === shippingService) || null,
    [shippingQuote, shippingService]
  );
  const priceByLineKey = useMemo(() => {
    const m = new Map();
    for (const row of serverCartPricing?.pricedLines || []) {
      m.set(lineKey(row.productId, row.size || ''), row);
    }
    return m;
  }, [serverCartPricing]);

  const subtotal = useMemo(() => {
    const clientSub = detailed.filter((l) => !l.invalidSize).reduce((sum, line) => sum + line.lineTotal, 0);
    if (
      serverCartPricing != null &&
      Number.isFinite(Number(serverCartPricing.subtotal)) &&
      shippingQuote &&
      !hasInvalid &&
      detailed.length > 0
    ) {
      return Number(serverCartPricing.subtotal);
    }
    return clientSub;
  }, [detailed, serverCartPricing, shippingQuote, hasInvalid]);

  const shipping = Number(selectedShippingOption?.priceBrl || 0);
  const total = Math.round((subtotal + shipping) * 100) / 100;

  const hasStore = detailed.length > 0;
  const hasPod = Boolean(podDraft);

  useEffect(() => {
    let active = true;
    async function loadQuote() {
      if (!user?.uid || !detailed.length || hasInvalid || buyerMissingFields.length) {
        setShippingQuote(null);
        setServerCartPricing(null);
        return;
      }
      setShippingLoading(true);
      try {
        const items = detailed.map((line) => {
          const o = { productId: line.productId, quantity: line.quantity };
          if (line.size) o.size = line.size;
          return o;
        });
        const { data } = await quoteStoreShipping({ items });
        if (!active) return;
        const quote = data?.quote || null;
        setShippingQuote(quote);
        setShippingService(quote?.defaultServiceCode || 'PAC');
        if (data?.subtotal != null && Array.isArray(data?.pricedLines)) {
          setServerCartPricing({ subtotal: data.subtotal, pricedLines: data.pricedLines });
        } else {
          setServerCartPricing(null);
        }
      } catch {
        if (active) {
          setShippingQuote(null);
          setServerCartPricing(null);
        }
      } finally {
        if (active) setShippingLoading(false);
      }
    }
    loadQuote();
    return () => {
      active = false;
    };
  }, [buyerMissingFields.length, detailed, hasInvalid, quoteStoreShipping, user?.uid]);

  async function handleCheckout() {
    if (!user?.uid) {
      navigate(buildLoginUrlWithRedirect('/loja/carrinho'));
      return;
    }
    if (!detailed.length || hasInvalid) return;
    if (buyerMissingFields.length) {
      setErro(`Complete seu perfil de compra antes de pagar: ${buyerMissingFields.join(', ')}.`);
      return;
    }
    if (!selectedShippingOption) {
      setErro('Escolha PAC ou SEDEX antes de finalizar.');
      return;
    }
    if (!config.acceptingOrders) {
      setErro('Pedidos estao temporariamente fechados.');
      return;
    }
    setLoading(true);
    setErro('');
    try {
      const items = detailed.map((line) => {
        const o = { productId: line.productId, quantity: line.quantity };
        if (line.size) o.size = line.size;
        return o;
      });
      const url = await openStoreCheckout(functions, items, shippingService);
      clearCart();
      setCartItems([]);
      window.location.href = url;
    } catch (e) {
      setErro(mensagemErroCallable(e));
      setLoading(false);
    }
  }

  return (
    <main className="loja-page">
      <header className="loja-head">
        <h1>Carrinho</h1>
        <button type="button" className="loja-btn-ghost" onClick={() => navigate('/loja')}>
          Continuar comprando
        </button>
      </header>

      {!user?.uid ? (
        <p className="loja-shipping-hint">
            Voc? pode montar o carrinho da loja sem conta. Para calcular frete e pagar produtos, entre e complete os dados de
          entrega no perfil. O lote de mang? f?sico exige login para pagar.
        </p>
      ) : null}

      {!hasPod && !hasStore ? (
        <section className="loja-empty">
          <p>Seu carrinho est? vazio.</p>
          <p className="loja-shipping-hint" style={{ marginTop: 12 }}>
            <Link to="/loja">Ir ? loja</Link>
            {' ? '}
            <Link to="/print-on-demand?iniciar=1">Montar mang? f?sico</Link>
          </p>
        </section>
      ) : null}

      {hasPod ? (
        <section className="pod-checkout-card" style={{ marginBottom: 22 }}>
          <h2 className="pod-checkout-section-title" style={{ marginTop: 0 }}>
            Mang? f?sico (lote sob demanda)
          </h2>
          {!user?.uid ? (
            <p className="loja-shipping-hint">
              H? um lote salvo neste aparelho.{' '}
              <Link to={buildLoginUrlWithRedirect('/loja/carrinho')}>Entre na conta</Link> para revisar e pagar com
              seguran?a.
            </p>
          ) : (
            <>
              <div className="pod-cart-line">
                <div className="pod-cart-line__thumb">
                  {podDraft.coverUrl ? (
                    <img src={podDraft.coverUrl} alt="" className="pod-cart-line__thumb-img" />
                  ) : (
                    <span className="pod-cart-line__thumb-fallback" aria-hidden="true">
                      ??
                    </span>
                  )}
                </div>
                <div className="pod-cart-line__body">
                  <h3 className="pod-cart-line__title" style={{ fontSize: '1.02rem' }}>
                    {podDraft.labelLine}
                  </h3>
                  <ul className="pod-cart-line__details">
                    <li>
                      <span className="pod-cart-line__k">Modelo</span>
                      <span className="pod-cart-line__v">{formatPodBookFormatPt(podDraft.format)}</span>
                    </li>
                    <li>
                      <span className="pod-cart-line__k">Tipo</span>
                      <span className="pod-cart-line__v">{formatPodSaleModelPt(podDraft.saleModel)}</span>
                    </li>
                    <li>
                      <span className="pod-cart-line__k">Qtd</span>
                      <span className="pod-cart-line__v">{podDraft.quantity} un.</span>
                    </li>
                  </ul>
                </div>
                <div className="pod-cart-line__priceCol">
                  <span className="pod-cart-line__priceLabel">Total do lote</span>
                  <div className="pod-cart-line__price">{formatBRL(podDraft.amountDueBRL ?? 0)}</div>
                </div>
              </div>
              <p className="pod-checkout-hint pod-checkout-hint--compact">
                {describePodLeadTimePt(podDraft.saleModel, podDraft.format, podDraft.quantity)}
              </p>
              <div className="pod-cart-actions pod-cart-actions--split">
                <button type="button" className="pod-checkout-btn pod-checkout-btn--ghost" onClick={() => clearPodCartDraft()}>
                  Remover lote
                </button>
                <Link className="pod-checkout-btn pod-checkout-btn--ghost" to="/print-on-demand?iniciar=1">
                  Editar configura??o
                </Link>
              </div>
              <Link
                className="pod-checkout-btn pod-checkout-btn--primary pod-checkout-btn--block"
                style={{ marginTop: 14 }}
                to="/print-on-demand/checkout"
              >
                Ir para pagamento do lote
              </Link>
            </>
          )}
        </section>
      ) : null}

      {hasStore && hasPod ? (
        <p className="loja-shipping-hint" role="status">
          Loja e mang? f?sico usam checkouts diferentes (cada um com seu pagamento no Mercado Pago).
        </p>
      ) : null}

      {hasStore ? (
        <section className="loja-cart-list">
          <h2 className="pod-checkout-section-title" style={{ margin: '0 0 14px', fontSize: '1.05rem' }}>
            Produtos da loja
          </h2>
          {detailed.map((line) => {
            const pk = lineKey(line.productId, line.size);
            const srv = priceByLineKey.get(pk);
            const unitPrice = srv ? srv.unitPrice : line.unitPrice;
            const lineTotal = srv ? srv.lineTotal : line.lineTotal;
            return (
            <article key={pk} className="loja-cart-item">
              <img
                src={(Array.isArray(line.product.images) && line.product.images[0]) || '/assets/fotos/shito.jpg'}
                alt=""
              />
              <div>
                <h3>{line.product.title}</h3>
                {line.size ? <p className="loja-cart-size">Tam.: {line.size}</p> : null}
                {line.invalidSize ? <p className="loja-error">Escolha tamanho valido (edite no produto).</p> : null}
                <p>R$ {unitPrice.toFixed(2)} / un</p>
              </div>
              <input
                type="number"
                min={1}
                max={maxCartQtyForProduct(line.product)}
                value={line.quantity}
                onChange={(e) =>
                  setCartItems(updateCartQuantity(line.productId, Number(e.target.value || 1), line.size || ''))
                }
              />
              <strong>R$ {line.invalidSize ? '--' : lineTotal.toFixed(2)}</strong>
              <button type="button" onClick={() => setCartItems(removeFromCart(line.productId, line.size || ''))}>
                Remover
              </button>
            </article>
            );
          })}
          <footer className="loja-cart-footer">
            <div className="loja-cart-totals">
              <div>
                Subtotal: R$ {subtotal.toFixed(2)}
                {serverCartPricing && shippingQuote ? (
                  <span className="loja-shipping-hint" style={{ display: 'block', marginTop: 4 }}>
                    Valores das linhas e subtotal conferidos pelo servidor na cotação de frete; total cobrado segue o checkout.
                  </span>
                ) : null}
              </div>
              {selectedShippingOption ? (
                <div>
                  {selectedShippingOption.label}: R$ {Number(selectedShippingOption.priceBrl || 0).toFixed(2)}
                  {Number(selectedShippingOption.discountBrl || 0) > 0
                    ? ` ? Voc? economizou R$ ${Number(selectedShippingOption.discountBrl || 0).toFixed(2)}`
                    : ''}
                </div>
              ) : null}
              <div className="loja-cart-total-final">Total: R$ {total.toFixed(2)}</div>
            </div>
            <p className="loja-shipping-hint">
              Frete por UF (tabela fixa) + R$ 2 por unidade extra; SEDEX usa acréscimo sobre a mesma base. Prazo conforme UF.
              Sudeste, Sul e Centro-Oeste: com subtotal a partir de R$ 165 ou 3+ unidades, até 30% de desconto só no frete (teto
              R$ 20).
            </p>
            {shippingQuote ? (
              <div className="loja-shipping-options">
                {shippingQuote.options.map((option) => (
                  <button
                    key={option.serviceCode}
                    type="button"
                    className={`loja-shipping-option ${shippingService === option.serviceCode ? 'loja-shipping-option--active' : ''}`}
                    onClick={() => setShippingService(option.serviceCode)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.regionLabel}</span>
                    <span>Entrega: {formatStoreShippingEtaLabel(option)}</span>
                    <span>
                      Frete: R$ {Number(option.priceBrl || 0).toFixed(2)}
                      {Number(option.discountBrl || 0) > 0 ? ` (de R$ ${Number(option.originalPriceBrl || 0).toFixed(2)})` : ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {shippingLoading ? <p className="loja-shipping-hint">Calculando PAC e SEDEX...</p> : null}
            {erro ? <p className="loja-error">{erro}</p> : null}
            {user?.uid && buyerMissingFields.length ? (
              <div className="loja-banner loja-banner--erro loja-banner--with-cta loja-cart__buyer-hint" role="status">
                <p className="loja-banner__text">
                  Para comprar, complete no perfil: {buyerMissingFields.join(', ')}.
                </p>
                <Link className="loja-banner__cta" to={`/perfil#${PERFIL_LOJA_DADOS_HASH}`}>
                  Completar cadastro
                </Link>
              </div>
            ) : null}
            <button
              type="button"
              className="loja-btn-buy"
              disabled={loading || hasInvalid || shippingLoading || !selectedShippingOption}
              onClick={handleCheckout}
            >
              {loading ? 'Abrindo checkout...' : 'Finalizar compra da loja'}
            </button>
          </footer>
        </section>
      ) : null}
    </main>
  );
}
