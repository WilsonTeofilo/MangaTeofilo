import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate, useParams } from 'react-router-dom';

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
import { getStoreDemoProductById } from '../../data/storeDemoProducts';
import './Loja.css';

export default function LojaProduto({ user, perfil }) {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [product, setProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState('');
  const [cartItems, setCartItems] = useState(getCartItems());
  const [err, setErr] = useState('');
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);

  const vip = descontoVipLojaAtivo(perfil, user);
  const id = useMemo(() => decodeURIComponent(String(productId || '')), [productId]);

  useEffect(() => {
    const unsubCfg = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    return () => unsubCfg();
  }, []);

  useEffect(() => {
    const unsubProd = onValue(ref(db, `loja/produtos/${id}`), (snap) => {
      if (snap.exists()) {
        setProduct({ id, ...(snap.val() || {}) });
        return;
      }
      const demo = getStoreDemoProductById(id);
      setProduct(demo || null);
    });
    return () => unsubProd();
  }, [id]);

  useEffect(() => {
    if (!product) return;
    const sizes = Array.isArray(product.sizes) ? product.sizes.map((s) => String(s || '').trim()).filter(Boolean) : [];
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

  if (!product) {
    return (
      <main className="loja-page">
        <section className="loja-empty">
          <h1>Produto não encontrado</h1>
          <button type="button" onClick={() => navigate('/loja')}>
            Voltar para loja
          </button>
        </section>
      </main>
    );
  }

  const basePrice = Number(product.isOnSale && Number(product.promoPrice) > 0 ? product.promoPrice : product.price || 0);
  const finalPrice = applyVipDiscount(basePrice, product, config.vipDiscountPct, vip);
  const stock = Math.max(0, Number(product.stock || 0));
  const type = String(product.type || 'manga').toLowerCase();
  const sizes = Array.isArray(product.sizes) ? product.sizes.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const badges = getStoreProductBadges(product);
  const mainImg = images.length ? images[Math.min(imgIdx, images.length - 1)] : '/assets/fotos/shito.jpg';
  const collectionLine = getProductCollectionKey(product);
  const dropLine = getProductDropLabel(product);

  async function handleComprarAgora() {
    setErr('');
    if (product.isStoreDemo === true) {
      setErr('Produto de demonstração — só para visualizar o layout.');
      return;
    }
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    if (!config.acceptingOrders) {
      setErr('Pedidos estão fechados.');
      return;
    }
    if (type === 'roupa' && sizes.length && !sizes.includes(size)) {
      setErr('Escolha um tamanho.');
      return;
    }
    setLoadingCheckout(true);
    try {
      const item = { productId: product.id, quantity: Math.min(qty, stock) };
      if (type === 'roupa' && size) item.size = size;
      const url = await openStoreCheckout(functions, [item]);
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
          <p className="loja-product-desc">{product.description || 'Sem descrição'}</p>
          <ul className="loja-product-trust" aria-label="Informações do produto">
            <li>Edição artesanal · produção limitada</li>
            <li>Envio pelos Correios após confirmação do pagamento</li>
            {stock > 0 && stock <= 12 ? (
              <li className="loja-product-trust--scarcity">Restam poucas unidades — {stock} em estoque</li>
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
            {vip && product.isVIPDiscountEnabled && finalPrice < basePrice ? <span className="loja-price-vip">VIP</span> : null}
          </div>
          {config.fixedShippingBrl > 0 ? (
            <p className="loja-shipping-hint">+ frete fixo R$ {Number(config.fixedShippingBrl).toFixed(2)} no checkout</p>
          ) : null}
          <p className={`loja-stock ${stock > 0 && stock <= 12 ? 'loja-stock--low' : ''}`}>
            Estoque: {stock}
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

          {product.isStoreDemo === true ? (
            <p className="loja-demo-hint">Demonstração — não é possível comprar ou reservar este item.</p>
          ) : null}
          {err ? <p className="loja-error loja-error--block">{err}</p> : null}

          <div className="loja-qty-row">
            <label className="loja-qty-label">
              Qtd
              <input
                type="number"
                min={1}
                max={Math.max(1, stock)}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(stock, Number(e.target.value || 1))))}
              />
            </label>
            <button
              type="button"
              className="loja-btn-buy"
              disabled={
                product.isStoreDemo === true || stock <= 0 || !config.acceptingOrders || loadingCheckout
              }
              onClick={handleComprarAgora}
            >
              {product.isStoreDemo === true ? 'Só demo' : 'Comprar agora'}
            </button>
            <button
              type="button"
              className="loja-btn-ghost"
              disabled={
                product.isStoreDemo === true || stock <= 0 || !config.acceptingOrders
              }
              onClick={() => {
                if (product.isStoreDemo === true) return;
                const next = addToCart(product.id, qty, { size: type === 'roupa' && size ? size : '' });
                setCartItems(next);
              }}
            >
              Adicionar ao carrinho
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
