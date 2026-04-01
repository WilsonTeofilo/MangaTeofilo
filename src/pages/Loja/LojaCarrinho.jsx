import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref, set } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import { descontoVipLojaAtivo } from '../../utils/capituloLancamento';
import { applyVipDiscount, normalizeStoreConfig, STORE_DEFAULT_CONFIG } from '../../config/store';
import { getStoreDemoProductsRecord } from '../../data/storeDemoProducts';
import { clearCart, getCartItems, removeFromCart, updateCartQuantity } from '../../store/cartStore';
import { openStoreCheckout } from '../../utils/storeCheckout';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
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

export default function LojaCarrinho({ user, perfil }) {
  const navigate = useNavigate();
  const [cartItems, setCartItems] = useState(getCartItems());
  const [firebaseProducts, setFirebaseProducts] = useState({});
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const vip = descontoVipLojaAtivo(perfil, user);

  const products = useMemo(() => {
    const demos = getStoreDemoProductsRecord();
    return { ...demos, ...firebaseProducts };
  }, [firebaseProducts]);

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
  const shipping = config.fixedShippingBrl > 0 ? Number(config.fixedShippingBrl) : 0;
  const total = Math.round((subtotal + shipping) * 100) / 100;
  const hasInvalid = detailed.some((l) => l.invalidSize);
  const hasDemoInCart = detailed.some((l) => l.product?.isStoreDemo === true);

  async function handleCheckout() {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    if (!detailed.length || hasInvalid || hasDemoInCart) return;
    if (!config.acceptingOrders) {
      setErro('Pedidos estão temporariamente fechados.');
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
      const url = await openStoreCheckout(functions, items);
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

      {!detailed.length ? (
        <section className="loja-empty">
          <p>Seu carrinho está vazio.</p>
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
                {line.invalidSize ? <p className="loja-error">Escolha tamanho válido (edite no produto).</p> : null}
                <p>R$ {line.unitPrice.toFixed(2)} / un</p>
              </div>
              <input
                type="number"
                min={1}
                max={Math.max(1, Number(line.product.stock || 1))}
                value={line.quantity}
                onChange={(e) =>
                  setCartItems(updateCartQuantity(line.productId, Number(e.target.value || 1), line.size || ''))
                }
              />
              <strong>R$ {line.invalidSize ? '—' : line.lineTotal.toFixed(2)}</strong>
              <button type="button" onClick={() => setCartItems(removeFromCart(line.productId, line.size || ''))}>
                Remover
              </button>
            </article>
          ))}
          <footer className="loja-cart-footer">
            <div className="loja-cart-totals">
              <div>Subtotal: R$ {subtotal.toFixed(2)}</div>
              {shipping > 0 ? <div>Frete fixo: R$ {shipping.toFixed(2)}</div> : null}
              <div className="loja-cart-total-final">Total: R$ {total.toFixed(2)}</div>
            </div>
            {erro ? <p className="loja-error">{erro}</p> : null}
            {hasDemoInCart ? (
              <p className="loja-error">Itens de demonstração não entram no checkout. Remova-os ou esvazie o carrinho.</p>
            ) : null}
            <button
              type="button"
              className="loja-btn-buy"
              disabled={loading || hasInvalid || hasDemoInCart}
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
