import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db } from '../../services/firebase';
import { isAdminUser } from '../../constants';
import { assinaturaPremiumAtiva } from '../../utils/capituloLancamento';
import { addToCart, cartCount, getCartItems } from '../../store/cartStore';
import { applyVipDiscount, normalizeStoreConfig, productIsVisible, STORE_DEFAULT_CONFIG } from '../../config/store';
import './Loja.css';

function toList(data) {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(([id, v]) => ({ id, ...(v || {}) }));
}

export default function LojaCatalogo({ user, perfil }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cartItems, setCartItems] = useState(getCartItems());

  const isAdmin = isAdminUser(user);
  const vip = assinaturaPremiumAtiva(perfil) || isAdmin;

  useEffect(() => {
    const unsubCfg = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    const unsubProd = onValue(ref(db, 'loja/produtos'), (snap) => {
      const list = snap.exists() ? toList(snap.val()) : [];
      setProducts(list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));
      setLoading(false);
    });
    return () => {
      unsubCfg();
      unsubProd();
    };
  }, []);

  const visibleProducts = useMemo(() => {
    if (isAdmin) return products;
    return products.filter(productIsVisible);
  }, [products, isAdmin]);

  const canAccess = isAdmin || (config.storeEnabled && config.storeVisibleToUsers);

  if (loading) return <div className="shito-app-splash" aria-hidden="true" />;

  if (!canAccess) {
    return (
      <main className="loja-page">
        <section className="loja-empty">
          <h1>Loja em preparação</h1>
          <p>Em breve você poderá comprar produtos físicos direto por aqui.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="loja-page">
      <header className="loja-head">
        <h1>Loja Física</h1>
        <div className="loja-head-actions">
          <button type="button" onClick={() => navigate('/loja/carrinho')}>
            Carrinho ({cartCount(cartItems)})
          </button>
          {user && <button type="button" onClick={() => navigate('/loja/pedidos')}>Meus pedidos</button>}
        </div>
      </header>

      <section className="loja-grid">
        {visibleProducts.map((p) => {
          const basePrice = Number(p.isOnSale && Number(p.promoPrice) > 0 ? p.promoPrice : p.price || 0);
          const finalPrice = applyVipDiscount(basePrice, p, config.vipDiscountPct, vip);
          return (
            <article key={p.id} className="loja-card">
              <img src={(Array.isArray(p.images) && p.images[0]) || '/assets/fotos/shito.jpg'} alt={p.title || p.id} />
              <div className="loja-card-body">
                <h3>{p.title || p.id}</h3>
                <p>{p.description || 'Sem descrição.'}</p>
                <div className="loja-price">
                  <strong>R$ {finalPrice.toFixed(2)}</strong>
                  {vip && p.isVIPDiscountEnabled === true && <span>VIP aplicado</span>}
                </div>
                <div className="loja-card-actions">
                  <button type="button" onClick={() => navigate(`/loja/produto/${encodeURIComponent(p.id)}`)}>
                    Ver produto
                  </button>
                  <button
                    type="button"
                    disabled={!config.acceptingOrders || Number(p.stock || 0) <= 0}
                    onClick={() => {
                      const next = addToCart(p.id, 1);
                      setCartItems(next);
                    }}
                  >
                    {config.acceptingOrders ? 'Adicionar' : 'Pedidos fechados'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

