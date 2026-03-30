import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { onValue, ref, set } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import { assinaturaPremiumAtiva } from '../../utils/capituloLancamento';
import { applyVipDiscount, normalizeStoreConfig, STORE_DEFAULT_CONFIG } from '../../config/store';
import { clearCart, getCartItems, removeFromCart, updateCartQuantity } from '../../store/cartStore';
import './Loja.css';

function mapProducts(data) {
  const src = data && typeof data === 'object' ? data : {};
  return Object.entries(src).reduce((acc, [id, item]) => {
    acc[id] = { id, ...(item || {}) };
    return acc;
  }, {});
}

export default function LojaCarrinho({ user, perfil }) {
  const navigate = useNavigate();
  const [cartItems, setCartItems] = useState(getCartItems());
  const [products, setProducts] = useState({});
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const vip = assinaturaPremiumAtiva(perfil);

  useEffect(() => {
    const unsubProducts = onValue(ref(db, 'loja/produtos'), (snap) => {
      setProducts(mapProducts(snap.exists() ? snap.val() : {}));
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
        return {
          ...item,
          product: p,
          unitPrice,
          lineTotal: Math.round(unitPrice * item.quantity * 100) / 100,
        };
      })
      .filter(Boolean);
  }, [cartItems, products, config.vipDiscountPct, vip]);

  const total = detailed.reduce((sum, line) => sum + line.lineTotal, 0);

  async function handleCheckout() {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    if (!detailed.length) return;
    if (!config.acceptingOrders) {
      setErro('Pedidos estão temporariamente fechados.');
      return;
    }
    setLoading(true);
    setErro('');
    try {
      const call = httpsCallable(functions, 'criarCheckoutLoja');
      const payload = {
        items: detailed.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      };
      const res = await call(payload);
      const data = res?.data || {};
      if (!data.ok || !data.url) throw new Error('Falha ao abrir checkout.');
      clearCart();
      setCartItems([]);
      window.location.href = data.url;
    } catch (e) {
      setErro(e?.message || 'Erro no checkout');
      setLoading(false);
    }
  }

  return (
    <main className="loja-page">
      <header className="loja-head">
        <h1>Carrinho</h1>
        <button type="button" onClick={() => navigate('/loja')}>Continuar comprando</button>
      </header>

      {!detailed.length ? (
        <section className="loja-empty">
          <p>Seu carrinho está vazio.</p>
        </section>
      ) : (
        <section className="loja-cart-list">
          {detailed.map((line) => (
            <article key={line.productId} className="loja-cart-item">
              <img src={(Array.isArray(line.product.images) && line.product.images[0]) || '/assets/fotos/shito.jpg'} alt={line.product.title || line.productId} />
              <div>
                <h3>{line.product.title}</h3>
                <p>R$ {line.unitPrice.toFixed(2)} / un</p>
              </div>
              <input
                type="number"
                min={1}
                max={Math.max(1, Number(line.product.stock || 1))}
                value={line.quantity}
                onChange={(e) => setCartItems(updateCartQuantity(line.productId, Number(e.target.value || 1)))}
              />
              <strong>R$ {line.lineTotal.toFixed(2)}</strong>
              <button type="button" onClick={() => setCartItems(removeFromCart(line.productId))}>Remover</button>
            </article>
          ))}
          <footer className="loja-cart-footer">
            <div>Total: R$ {total.toFixed(2)}</div>
            {erro ? <p className="loja-error">{erro}</p> : null}
            <button type="button" disabled={loading} onClick={handleCheckout}>
              {loading ? 'Abrindo checkout...' : 'Finalizar compra'}
            </button>
          </footer>
        </section>
      )}
    </main>
  );
}

