import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate, useParams } from 'react-router-dom';

import { db } from '../../services/firebase';
import { addToCart, cartCount, getCartItems } from '../../store/cartStore';
import { assinaturaPremiumAtiva } from '../../utils/capituloLancamento';
import { applyVipDiscount, normalizeStoreConfig, STORE_DEFAULT_CONFIG } from '../../config/store';
import './Loja.css';

export default function LojaProduto({ perfil }) {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [product, setProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [cartItems, setCartItems] = useState(getCartItems());

  const vip = assinaturaPremiumAtiva(perfil);
  const id = useMemo(() => decodeURIComponent(String(productId || '')), [productId]);

  useEffect(() => {
    const unsubCfg = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    const unsubProd = onValue(ref(db, `loja/produtos/${id}`), (snap) => {
      setProduct(snap.exists() ? { id, ...(snap.val() || {}) } : null);
    });
    return () => {
      unsubCfg();
      unsubProd();
    };
  }, [id]);

  if (!product) {
    return (
      <main className="loja-page">
        <section className="loja-empty">
          <h1>Produto não encontrado</h1>
          <button type="button" onClick={() => navigate('/loja')}>Voltar para loja</button>
        </section>
      </main>
    );
  }

  const basePrice = Number(product.isOnSale && Number(product.promoPrice) > 0 ? product.promoPrice : product.price || 0);
  const finalPrice = applyVipDiscount(basePrice, product, config.vipDiscountPct, vip);
  const stock = Math.max(0, Number(product.stock || 0));

  return (
    <main className="loja-page loja-product-page">
      <button type="button" className="loja-back-btn" onClick={() => navigate('/loja')}>Voltar</button>
      <section className="loja-product">
        <img src={(Array.isArray(product.images) && product.images[0]) || '/assets/fotos/shito.jpg'} alt={product.title || product.id} />
        <div className="loja-product-body">
          <h1>{product.title}</h1>
          <p>{product.description || 'Sem descrição'}</p>
          <div className="loja-price">
            <strong>R$ {finalPrice.toFixed(2)}</strong>
            {vip && product.isVIPDiscountEnabled && <span>Desconto VIP ativo</span>}
          </div>
          <p>Estoque: {stock}</p>
          <div className="loja-qty-row">
            <input
              type="number"
              min={1}
              max={Math.max(1, stock)}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value || 1)))}
            />
            <button
              type="button"
              disabled={stock <= 0 || !config.acceptingOrders}
              onClick={() => {
                const next = addToCart(product.id, qty);
                setCartItems(next);
              }}
            >
              Adicionar ao carrinho
            </button>
            <button type="button" onClick={() => navigate('/loja/carrinho')}>
              Ir para carrinho ({cartCount(cartItems)})
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

