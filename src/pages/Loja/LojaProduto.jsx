import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import { addToCart, cartCount, getCartItems } from '../../store/cartStore';
import {
  getProductCollectionKey,
  getProductDropLabel,
  getStoreProductBadges,
  normalizeStoreConfig,
  STORE_DEFAULT_CONFIG,
} from '../../config/store';
import { openStoreCheckout } from '../../utils/storeCheckout';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { getStoreBuyerProfileMissingFields } from '../../utils/storeBuyerProfile';
import { PERFIL_LOJA_DADOS_HASH } from '../../utils/brazilianStates';
import { formatStoreShippingEtaLabel } from '../../utils/storeShipping';
import './Loja.css';

export default function LojaProduto({ user, perfil }) {
  const { productId } = useParams();
  const navigate = useNavigate();
  const quoteStoreShipping = useMemo(() => httpsCallable(functions, 'quoteStoreShipping'), []);
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [product, setProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState('');
  const [cartItems, setCartItems] = useState(getCartItems());
  const [err, setErr] = useState('');
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const [shippingQuote, setShippingQuote] = useState(null);
  const [serverPricing, setServerPricing] = useState(null);
  const [shippingService, setShippingService] = useState('PAC');

  const buyerMissingFields = useMemo(
    () => getStoreBuyerProfileMissingFields(perfil?.buyerProfile),
    [perfil?.buyerProfile]
  );
  const id = useMemo(() => decodeURIComponent(String(productId || '')), [productId]);
  const type = String(product?.type || 'manga').toLowerCase();
  const inventoryMode = String(product?.inventoryMode || 'stock').trim().toLowerCase();
  const sizes = Array.isArray(product?.sizes)
    ? product.sizes.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const resolvedSize = sizes.includes(size) ? size : sizes[0] || '';
  const managedStock = inventoryMode !== 'on_demand';
  const stock = Math.max(0, Number(product?.stock || 0));
  const maxQty = managedStock ? Math.max(1, stock) : 99;

  useEffect(() => {
    const unsubCfg = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    return () => unsubCfg();
  }, []);

  useEffect(() => {
    const unsubProd = onValue(ref(db, `loja/produtos/${id}`), (snap) => {
      setProduct(snap.exists() ? { id, ...(snap.val() || {}) } : null);
    });
    return () => unsubProd();
  }, [id]);

  const images = useMemo(() => {
    if (!product || !Array.isArray(product.images)) return [];
    return product.images.map((url) => String(url || '').trim()).filter(Boolean);
  }, [product]);

  useEffect(() => {
    let active = true;
    async function loadQuote() {
      if (!user?.uid || !product || buyerMissingFields.length) {
        setShippingQuote(null);
        setServerPricing(null);
        return;
      }
      try {
        const items = [{ productId: product.id, quantity: qty }];
        if (type === 'roupa' && resolvedSize) items[0].size = resolvedSize;
        const { data } = await quoteStoreShipping({ items });
        if (!active) return;
        const quote = data?.quote || null;
        setShippingQuote(quote);
        setShippingService(quote?.defaultServiceCode || 'PAC');
        if (data?.subtotal != null && Array.isArray(data?.pricedLines)) {
          setServerPricing({
            subtotal: Number(data.subtotal),
            pricedLine: data.pricedLines[0] || null,
          });
        } else {
          setServerPricing(null);
        }
      } catch {
        if (active) {
          setShippingQuote(null);
          setServerPricing(null);
        }
      }
    }
    loadQuote();
    return () => {
      active = false;
    };
  }, [buyerMissingFields.length, product, qty, quoteStoreShipping, resolvedSize, type, user?.uid]);

  if (!product) {
    return (
      <main className="loja-page">
        <section className="loja-empty">
          <h1>Produto nao encontrado</h1>
          <button type="button" onClick={() => navigate('/loja')}>
            Voltar para loja
          </button>
        </section>
      </main>
    );
  }

  if (product.isActive === false || product.isStoreDemo === true) {
    return (
      <main className="loja-page">
        <section className="loja-empty">
          <h1>Produto indisponivel</h1>
          <p>Este item nao esta liberado para venda publica.</p>
          <button type="button" onClick={() => navigate('/loja')}>
            Voltar para loja
          </button>
        </section>
      </main>
    );
  }

  const basePrice = Number(product.isOnSale && Number(product.promoPrice) > 0 ? product.promoPrice : product.price || 0);
  const finalPrice = Number(serverPricing?.pricedLine?.unitPrice ?? basePrice);
  const finalSubtotal = Number.isFinite(Number(serverPricing?.subtotal)) ? Number(serverPricing.subtotal) : null;
  const badges = getStoreProductBadges(product);
  const resolvedImgIdx = images.length ? Math.min(imgIdx, images.length - 1) : 0;
  const mainImg = images.length ? images[resolvedImgIdx] : '/assets/fotos/shito.jpg';
  const collectionLine = getProductCollectionKey(product);
  const dropLine = getProductDropLabel(product);
  const selectedShippingOption = shippingQuote?.options?.find((option) => option.serviceCode === shippingService) || null;
  const checkoutPricingReady = Boolean(serverPricing?.pricedLine && finalSubtotal != null && selectedShippingOption);
  const canBuyNow =
    config.acceptingOrders &&
    !loadingCheckout &&
    checkoutPricingReady &&
    (!managedStock || stock > 0);

  async function handleComprarAgora() {
    setErr('');
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    if (buyerMissingFields.length) {
      setErr(`Complete seu perfil de compra antes de pagar: ${buyerMissingFields.join(', ')}.`);
      return;
    }
    if (!selectedShippingOption) {
      setErr('Escolha PAC ou SEDEX antes de finalizar.');
      return;
    }
    if (!checkoutPricingReady) {
      setErr('Aguarde a cotacao do frete para o servidor confirmar subtotal e total finais.');
      return;
    }
    if (!config.acceptingOrders) {
      setErr('Pedidos estao fechados.');
      return;
    }
    if (type === 'roupa' && sizes.length && !resolvedSize) {
      setErr('Escolha um tamanho.');
      return;
    }
    setLoadingCheckout(true);
    try {
      const item = { productId: product.id, quantity: managedStock ? Math.min(qty, stock) : qty };
      if (type === 'roupa' && resolvedSize) item.size = resolvedSize;
      const url = await openStoreCheckout(functions, [item], shippingService);
      window.location.assign(url);
    } catch (e) {
      setErr(mensagemErroCallable(e));
      setLoadingCheckout(false);
    }
  }

  return (
    <main className="loja-page loja-product-page loja-page--product-premium">
      <button type="button" className="loja-back-btn" onClick={() => navigate('/loja')}>
        Voltar
      </button>
      <section className="loja-product loja-product--premium">
        <div className="loja-product-media">
          <div className="loja-product-mainimg">
            <img src={mainImg} alt="" referrerPolicy="no-referrer" crossOrigin="anonymous" />
          </div>
          {images.length > 1 ? (
            <div className="loja-product-thumbs" role="tablist" aria-label="Imagens do produto">
              {images.map((src, index) => (
                <button
                  key={src}
                  type="button"
                  role="tab"
                  aria-selected={index === resolvedImgIdx}
                  className={`loja-product-thumb ${index === resolvedImgIdx ? 'loja-product-thumb--active' : ''}`}
                  onClick={() => setImgIdx(index)}
                >
                  <img src={src} alt="" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                </button>
              ))}
            </div>
          ) : null}
          <div className="loja-card-badges loja-card-badges--product">
            {badges.map((badge) => (
              <span key={badge.key} className={`loja-badge loja-badge--${badge.key}`}>
                {badge.label}
              </span>
            ))}
          </div>
        </div>
        <div className="loja-product-body">
          {collectionLine ? <p className="loja-product-kicker">{collectionLine}</p> : null}
          {dropLine ? <p className="loja-product-drop">{dropLine}</p> : null}
          <h1 className="loja-product-title">{product.title}</h1>
          <p className="loja-product-desc">{product.description || 'Sem descricao'}</p>
          <ul className="loja-product-trust" aria-label="Informacoes do produto">
            <li>Edicao artesanal com producao limitada.</li>
            <li>Envio pelos Correios apos a confirmacao do pagamento.</li>
            {managedStock && stock > 0 && stock <= 12 ? (
              <li className="loja-product-trust--scarcity">Restam poucas unidades: {stock} em estoque.</li>
            ) : null}
            {!managedStock ? (
              <li className="loja-product-trust--scarcity">Produto sob demanda, sem limite por estoque local.</li>
            ) : null}
          </ul>
          {product.obra ? (
            <p className="loja-product-meta">
              Obra: <strong>{product.obra}</strong>
            </p>
          ) : null}
          <div className="loja-price">
            {product.isOnSale === true && Number(product.promoPrice) > 0 && Number(product.price) > Number(product.promoPrice) ? (
              <span className="loja-price-old">R$ {Number(product.price).toFixed(2)}</span>
            ) : null}
            <strong>R$ {finalPrice.toFixed(2)}</strong>
            {product.isVIPDiscountEnabled && serverPricing?.pricedLine && finalPrice < basePrice ? (
              <span className="loja-price-vip">VIP</span>
            ) : null}
          </div>
          <p className="loja-shipping-hint">
            {finalSubtotal != null
              ? `Subtotal confirmado pelo servidor: R$ ${finalSubtotal.toFixed(2)}`
              : 'Subtotal e frete finais sao calculados pelo servidor depois da cotacao.'}
          </p>
          <p className="loja-shipping-hint">
            PAC ou SEDEX usam tabela fixa por UF, mais R$ 2 por unidade extra. Em Sudeste, Sul e Centro-Oeste, o backend aplica
            ate 30% de desconto no frete, com teto de R$ 20, quando o subtotal chega a R$ 165 ou o pedido tem 3 ou mais
            unidades.
          </p>
          <p className={`loja-stock ${managedStock && stock > 0 && stock <= 12 ? 'loja-stock--low' : ''}`}>
            {managedStock ? `Estoque: ${stock}` : 'Disponibilidade: sob demanda'}
          </p>

          {type === 'roupa' && sizes.length ? (
            <label className="loja-size-label">
              Tamanho
              <select value={resolvedSize} onChange={(e) => setSize(e.target.value)} className="loja-size-select">
                {sizes.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
          {!user?.uid ? (
            <p className="loja-shipping-hint">Entre na conta para cotar frete e liberar o checkout desta compra.</p>
          ) : null}
          {buyerMissingFields.length ? (
            <div className="loja-banner loja-banner--erro loja-banner--with-cta loja-produto__buyer-hint" role="status">
              <p className="loja-banner__text">Antes de comprar, complete no perfil: {buyerMissingFields.join(', ')}.</p>
              <Link className="loja-banner__cta" to={`/perfil#${PERFIL_LOJA_DADOS_HASH}`}>
                Completar cadastro
              </Link>
            </div>
          ) : null}
          {err ? <p className="loja-error loja-error--block">{err}</p> : null}

          <div className="loja-qty-row">
            <label className="loja-qty-label">
              Qtd
              <input
                type="number"
                min={1}
                max={maxQty}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(maxQty, Number(e.target.value || 1))))}
              />
            </label>
            <button type="button" className="loja-btn-buy" disabled={!canBuyNow} onClick={handleComprarAgora}>
              Comprar agora
            </button>
            <button
              type="button"
              className="loja-btn-ghost"
              disabled={!config.acceptingOrders || (managedStock && stock <= 0)}
              onClick={() => {
                const next = addToCart(product.id, qty, { size: type === 'roupa' && size ? size : '' });
                setCartItems(next);
                navigate('/loja/carrinho');
              }}
            >
              Ir para carrinho
            </button>
            <button type="button" className="loja-btn-ghost" onClick={() => navigate('/loja/carrinho')}>
              Carrinho ({cartCount(cartItems)})
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
