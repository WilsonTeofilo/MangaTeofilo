import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import { addToCart, cartCount, getCartItems } from '../../store/cartStore';
import { descontoVipLojaAtivo } from '../../utils/capituloLancamento';
import {
  applyVipDiscount,
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

  const vip = descontoVipLojaAtivo(perfil, user);
  const buyerMissingFields = useMemo(
    () => getStoreBuyerProfileMissingFields(perfil?.buyerProfile),
    [perfil?.buyerProfile]
  );
  const id = useMemo(() => decodeURIComponent(String(productId || '')), [productId]);
  const type = String(product?.type || 'manga').toLowerCase();
  const inventoryMode = String(product?.inventoryMode || 'stock').trim().toLowerCase();
  const sizes = Array.isArray(product?.sizes)
    ? product.sizes.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
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

  useEffect(() => {
    if (!product) return;
    if (sizes.length && !sizes.includes(size)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSize(sizes[0]);
    }
  }, [product, size]);

  const images = useMemo(() => {
    if (!product || !Array.isArray(product.images)) return [];
    return product.images.map((u) => String(u || '').trim()).filter(Boolean);
  }, [product]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImgIdx(0);
  }, [id, images.length]);

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
        if (type === 'roupa' && size) items[0].size = size;
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
  }, [buyerMissingFields.length, product, qty, quoteStoreShipping, size, type, user?.uid]);

  if (!product) {
    return (
      <main className="loja-page">
        <section className="loja-empty">
          <h1>Produto n�o encontrado</h1>
          <button type="button" onClick={() => navigate('/loja')}>
            Voltar para loja
          </button>
        </section>
      </main>
    );
  }

  const basePrice = Number(product.isOnSale && Number(product.promoPrice) > 0 ? product.promoPrice : product.price || 0);
  const finalPriceClient = applyVipDiscount(basePrice, product, config.vipDiscountPct, vip);
  const finalPrice = serverPricing?.pricedLine?.unitPrice ?? finalPriceClient;
  const finalSubtotal = serverPricing?.subtotal ?? Math.round(finalPrice * qty * 100) / 100;
  const badges = getStoreProductBadges(product);
  const mainImg = images.length ? images[Math.min(imgIdx, images.length - 1)] : '/assets/fotos/shito.jpg';
  const collectionLine = getProductCollectionKey(product);
  const dropLine = getProductDropLabel(product);
  const selectedShippingOption = shippingQuote?.options?.find((option) => option.serviceCode === shippingService) || null;
  const canBuyNow =
    config.acceptingOrders &&
    !loadingCheckout &&
    Boolean(selectedShippingOption) &&
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
    if (!config.acceptingOrders) {
      setErr('Pedidos estao fechados.');
      return;
    }
    if (type === 'roupa' && sizes.length && !sizes.includes(size)) {
      setErr('Escolha um tamanho.');
      return;
    }
    setLoadingCheckout(true);
    try {
      const item = { productId: product.id, quantity: managedStock ? Math.min(qty, stock) : qty };
      if (type === 'roupa' && size) item.size = size;
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
            <img src={mainImg} alt="" />
          </div>
          {images.length > 1 ? (
            <div className="loja-product-thumbs" role="tablist" aria-label="Imagens do produto">
              {images.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  role="tab"
                  aria-selected={i === imgIdx}
                  className={`loja-product-thumb ${i === imgIdx ? 'loja-product-thumb--active' : ''}`}
                  onClick={() => setImgIdx(i)}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          ) : null}
          <div className="loja-card-badges loja-card-badges--product">
            {badges.map((b) => (
              <span key={b.key} className={`loja-badge loja-badge--${b.key}`}>
                {b.label}
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
            <li>Edicao artesanal ? producao limitada</li>
            <li>Envio pelos Correios apos confirmacao do pagamento</li>
            {managedStock && stock > 0 && stock <= 12 ? (
              <li className="loja-product-trust--scarcity">Restam poucas unidades - {stock} em estoque</li>
            ) : null}
            {!managedStock ? <li className="loja-product-trust--scarcity">Produto sob demanda - sem limite por estoque local</li> : null}
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
            {vip && product.isVIPDiscountEnabled && finalPrice < basePrice ? <span className="loja-price-vip">VIP</span> : null}
          </div>
          <p className="loja-shipping-hint">Subtotal atual: R$ {finalSubtotal.toFixed(2)}</p>
          <p className="loja-shipping-hint">
            PAC ou SEDEX: tabela fixa por UF + R$ 2 por unidade extra. Em Sudeste, Sul e Centro-Oeste, com subtotal a partir de
            R$ 165 ou 3+ unidades no pedido, at� 30% de desconto s� no frete (teto R$ 20).
          </p>
          <p className={`loja-stock ${managedStock && stock > 0 && stock <= 12 ? 'loja-stock--low' : ''}`}>
            {managedStock ? `Estoque: ${stock}` : 'Disponibilidade: sob demanda'}
          </p>

          {type === 'roupa' && sizes.length ? (
            <label className="loja-size-label">
              Tamanho
              <select value={size} onChange={(e) => setSize(e.target.value)} className="loja-size-select">
                {sizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
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
          {buyerMissingFields.length ? (
            <div className="loja-banner loja-banner--erro loja-banner--with-cta loja-produto__buyer-hint" role="status">
              <p className="loja-banner__text">
                Antes de comprar, complete no perfil: {buyerMissingFields.join(', ')}.
              </p>
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
            <button
              type="button"
              className="loja-btn-buy"
              disabled={!canBuyNow}
              onClick={handleComprarAgora}
            >
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
