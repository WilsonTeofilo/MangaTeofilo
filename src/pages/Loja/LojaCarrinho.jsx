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
import { buildLoginUrlWithRedirect } from '../../utils/loginRedirectPath';
import { getStoreBuyerProfileMissingFields } from '../../utils/storeBuyerProfile';
import './Loja.css';

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
  const [shippingLoading, setShippingLoading] = useState(false);
  const [shippingService, setShippingService] = useState('PAC');

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

  const subtotal = detailed.filter((l) => !l.invalidSize).reduce((sum, line) => sum + line.lineTotal, 0);
  const hasInvalid = detailed.some((l) => l.invalidSize);
  const selectedShippingOption = useMemo(
    () => shippingQuote?.options?.find((option) => option.serviceCode === shippingService) || null,
    [shippingQuote, shippingService]
  );
  const shipping = Number(selectedShippingOption?.priceBrl || 0);
  const total = Math.round((subtotal + shipping) * 100) / 100;

  useEffect(() => {
    let active = true;
    async function loadQuote() {
      if (!user?.uid || !detailed.length || hasInvalid || buyerMissingFields.length) {
        setShippingQuote(null);
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
      } catch {
        if (active) setShippingQuote(null);
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
          Vocù pode montar o carrinho sem conta. Para calcular frete e pagar, entre e complete os dados de entrega no perfil.
        </p>
      ) : null}

      {!detailed.length ? (
        <section className="loja-empty">
          <p>Seu carrinho esta vazio.</p>
        </section>
      ) : (
        <section className="loja-cart-list">
          {detailed.map((line) => (
            <article key={lineKey(line.productId, line.size)} className="loja-cart-item">
              <img
                src={(Array.isArray(line.product.images) && line.product.images[0]) || '/assets/fotos/shito.jpg'}
                alt=""
              />
              <div>
                <h3>{line.product.title}</h3>
                {line.size ? <p className="loja-cart-size">Tam.: {line.size}</p> : null}
                {line.invalidSize ? <p className="loja-error">Escolha tamanho valido (edite no produto).</p> : null}
                <p>R$ {line.unitPrice.toFixed(2)} / un</p>
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
              <strong>R$ {line.invalidSize ? '--' : line.lineTotal.toFixed(2)}</strong>
              <button type="button" onClick={() => setCartItems(removeFromCart(line.productId, line.size || ''))}>
                Remover
              </button>
            </article>
          ))}
          <footer className="loja-cart-footer">
            <div className="loja-cart-totals">
              <div>Subtotal: R$ {subtotal.toFixed(2)}</div>
              {selectedShippingOption ? (
                <div>
                  {selectedShippingOption.label}: R$ {Number(selectedShippingOption.priceBrl || 0).toFixed(2)}
                  {Number(selectedShippingOption.discountBrl || 0) > 0 ? ` ù Voce economizou R$ ${Number(selectedShippingOption.discountBrl || 0).toFixed(2)}` : ''}
                </div>
              ) : null}
              <div className="loja-cart-total-final">Total: R$ {total.toFixed(2)}</div>
            </div>
            <p className="loja-shipping-hint">
              Frete dinamico por peso, servico e regiao. A API oficial dos Correios pede contrato; por isso o checkout usa motor proprio pronto para PAC e SEDEX e depois pode ser plugado na API oficial.
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
                    <span>Prazo: {option.deliveryDays} dias</span>
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
              {loading ? 'Abrindo checkout...' : 'Finalizar compra'}
            </button>
          </footer>
        </section>
      )}
    </main>
  );
}
