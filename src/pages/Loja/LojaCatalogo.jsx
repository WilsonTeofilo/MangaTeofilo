import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { Link, useNavigate } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import { isAdminUser } from '../../constants';
import { descontoVipLojaAtivo } from '../../utils/capituloLancamento';
import { CART_CHANGED_EVENT, cartCount, getCartItems } from '../../store/cartStore';
import {
  applyVipDiscount,
  getStoreProductBadges,
  groupStoreProductsByCollection,
  normalizeProductCategory,
  normalizeStoreConfig,
  productIsVisible,
  STORE_CATEGORY_KEYS,
  STORE_CATEGORY_TAB_LABELS,
  STORE_DEFAULT_CONFIG,
} from '../../config/store';
import { openStoreCheckout } from '../../utils/storeCheckout';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { getStoreBuyerProfileMissingFields } from '../../utils/storeBuyerProfile';
import { PERFIL_LOJA_DADOS_HASH } from '../../utils/brazilianStates';
import './Loja.css';

function toList(data) {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data).map(([id, v]) => ({ id, ...(v || {}) }));
}

const CATEGORY_TABS = [
  { key: 'all', label: STORE_CATEGORY_TAB_LABELS.all },
  { key: STORE_CATEGORY_KEYS.MANGA, label: STORE_CATEGORY_TAB_LABELS[STORE_CATEGORY_KEYS.MANGA] },
  { key: STORE_CATEGORY_KEYS.VESTUARIO, label: STORE_CATEGORY_TAB_LABELS[STORE_CATEGORY_KEYS.VESTUARIO] },
  { key: STORE_CATEGORY_KEYS.EXTRAS, label: STORE_CATEGORY_TAB_LABELS[STORE_CATEGORY_KEYS.EXTRAS] },
];

function CartIcon() {
  return (
    <svg className="loja-store__cart-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 4h2l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 8H6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LojaCatalogo({ user, perfil }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cartItems, setCartItems] = useState(getCartItems());
  const [catFilter, setCatFilter] = useState('all');
  const [checkoutErr, setCheckoutErr] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const isAdmin = isAdminUser(user);
  const vip = descontoVipLojaAtivo(perfil, user);
  const buyerMissingFields = useMemo(
    () => getStoreBuyerProfileMissingFields(perfil?.buyerProfile),
    [perfil?.buyerProfile]
  );

  useEffect(() => {
    const unsubCfg = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    }, () => {
      setConfig(STORE_DEFAULT_CONFIG);
    });
    const unsubProd = onValue(ref(db, 'loja/produtos'), (snap) => {
      const list = snap.exists() ? toList(snap.val()) : [];
      setProducts(list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));
      setLoading(false);
    }, () => {
      setProducts([]);
      setLoading(false);
    });
    return () => {
      unsubCfg();
      unsubProd();
    };
  }, []);

  useEffect(() => {
    const sync = () => setCartItems(getCartItems());
    const onVis = () => {
      if (document.visibilityState === 'visible') sync();
    };
    window.addEventListener('storage', sync);
    window.addEventListener(CART_CHANGED_EVENT, sync);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CART_CHANGED_EVENT, sync);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const visibleProducts = useMemo(() => {
    if (isAdmin) return products;
    return products.filter(productIsVisible);
  }, [products, isAdmin]);

  const filtered = useMemo(() => {
    if (catFilter === 'all') return visibleProducts;
    return visibleProducts.filter((p) => normalizeProductCategory(p) === catFilter);
  }, [visibleProducts, catFilter]);

  const groupedProducts = useMemo(() => groupStoreProductsByCollection(filtered), [filtered]);

  const canAccess = isAdmin || (config.storeEnabled && config.storeVisibleToUsers);

  const handleComprar = useCallback(
    async (p) => {
      setCheckoutErr('');
      const type = String(p.type || 'manga').toLowerCase();
      const sizes = Array.isArray(p.sizes) ? p.sizes.filter(Boolean) : [];
      if (type === 'roupa' && sizes.length) {
        navigate(`/loja/produto/${encodeURIComponent(p.id)}`);
        return;
      }
      if (!user?.uid) {
        navigate('/login');
        return;
      }
      if (buyerMissingFields.length) {
        setCheckoutErr(`Complete seu perfil de compra antes de pagar: ${buyerMissingFields.join(', ')}.`);
        return;
      }
      if (!config.acceptingOrders) {
        setCheckoutErr('Pedidos estao fechados no momento.');
        return;
      }
      setCheckoutLoading(true);
      try {
        const url = await openStoreCheckout(functions, [{ productId: p.id, quantity: 1 }]);
        window.location.href = url;
      } catch (e) {
        setCheckoutErr(mensagemErroCallable(e));
        setCheckoutLoading(false);
      }
    },
    [buyerMissingFields, config.acceptingOrders, navigate, user?.uid]
  );

  if (loading) return <div className="shito-app-splash" aria-hidden="true" />;

  if (!canAccess) {
    return (
      <main className="loja-page">
        <section className="loja-empty">
          <h1>Loja em preparacao</h1>
          <p>Em breve você poderá comprar produtos físicos por aqui, com checkout integrado.</p>
        </section>
      </main>
    );
  }

  const nCart = cartCount(cartItems);

  return (
    <main className="loja-page loja-page--premium loja-store">
      <header className="loja-store__dock">
        <button type="button" className="loja-store__ghost-link" onClick={() => navigate('/')}>
          ? Site
        </button>
        <div className="loja-store__dock-actions">
          {user ? (
            <button type="button" className="loja-btn-outline loja-btn-outline--sm" onClick={() => navigate('/pedidos')}>
              Pedidos
            </button>
          ) : null}
          <button
            type="button"
            className="loja-store__cart"
            onClick={() => navigate('/loja/carrinho')}
            aria-label={nCart ? `Carrinho, ${nCart} itens` : 'Carrinho'}
          >
            <CartIcon />
            {nCart > 0 ? <span className="loja-store__cart-count">{nCart > 99 ? '99+' : nCart}</span> : null}
          </button>
        </div>
      </header>

      <section className="loja-hero loja-hero--store" aria-label="Colecao">
        <div className="loja-hero__bg" aria-hidden="true" />
        <div className="loja-hero__inner">
          <span className="loja-hero__eyebrow">{config.heroEyebrow}</span>
          <h1 className="loja-hero__title">{config.heroTitle}</h1>
          <p className="loja-hero__subtitle">{config.heroSubtitle}</p>
          <button
            type="button"
            className="loja-hero__cta loja-hero__cta--solid"
            onClick={() => document.getElementById('loja-explorar')?.scrollIntoView({ behavior: 'smooth' })}
          >
            Explorar
          </button>
        </div>
      </section>

      <div className="loja-container loja-store__content" id="loja-explorar">
        <section className="loja-author-strip" aria-label="Mangá físico e programa de autores">
          <div className="loja-author-strip__text">
            <span className="loja-author-strip__eyebrow">Autores</span>
            <p className="loja-author-strip__p">
              Leve sua obra para o papel: <strong>tankōbon</strong> ou <strong>meio-tankō</strong> com produção pela
              MangaTeofilo — venda na loja com repasse, encomende para você ou, como criador sem monetização, peça vaga na
              vitrine (preço fixo e metas).
            </p>
          </div>
          <div className="loja-author-strip__actions">
            <Link className="loja-author-strip__cta" to="/print-on-demand">
              Ver mangá físico
            </Link>
            <Link className="loja-author-strip__cta loja-author-strip__cta--ghost" to="/creators">
              Quero ser autor
            </Link>
          </div>
        </section>

        <nav className="loja-cat-tabs loja-cat-tabs--store" aria-label="Categorias">
          {CATEGORY_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`loja-cat-tab ${catFilter === t.key ? 'loja-cat-tab--active' : ''}`}
              onClick={() => setCatFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {checkoutErr ? <p className="loja-banner loja-banner--erro loja-banner--store">{checkoutErr}</p> : null}
        {buyerMissingFields.length && user ? (
          <div
            className="loja-banner loja-banner--erro loja-banner--store loja-banner--with-cta"
            role="status"
          >
            <p className="loja-banner__text">
              Para comprar, complete seu perfil com: {buyerMissingFields.join(', ')}.
            </p>
            <Link className="loja-banner__cta" to={`/perfil#${PERFIL_LOJA_DADOS_HASH}`}>
              Completar cadastro
            </Link>
          </div>
        ) : null}
        {vip ? (
          <div className="loja-vip-strip" role="status">
            <span className="loja-vip-strip__icon" aria-hidden="true">
              ?
            </span>
            <p className="loja-vip-strip__text">Membros VIP recebem desconto exclusivo nos produtos marcados.</p>
          </div>
        ) : null}

        {!filtered.length ? (
          <section className="loja-empty loja-empty--inline">
            <p>Nenhum produto nesta categoria.</p>
          </section>
        ) : (
          groupedProducts.map(([collectionKey, items]) => (
            <section key={collectionKey} className="loja-collection loja-collection--store">
              <header className="loja-collection__head">
                <h2 className="loja-collection__title">
                  {collectionKey === '__essenciais' ? 'Essenciais' : collectionKey}
                </h2>
              </header>
              <div className="loja-grid--store">
                {items.map((p) => {
                  const basePrice = Number(p.isOnSale && Number(p.promoPrice) > 0 ? p.promoPrice : p.price || 0);
                  const finalPrice = applyVipDiscount(basePrice, p, config.vipDiscountPct, vip);
                  const badges = getStoreProductBadges(p);
                  const img = (Array.isArray(p.images) && p.images[0]) || '/assets/fotos/shito.jpg';
                  const outOfStock = Number(p.stock || 0) <= 0;
                  const buyDisabled = !config.acceptingOrders || outOfStock || checkoutLoading;
                  const buyLabel = outOfStock ? 'Esgotado' : 'Comprar';
                  const openProd = () => navigate(`/loja/produto/${encodeURIComponent(p.id)}`);

                  return (
                    <article
                      key={p.id}
                      className={`loja-pcard ${p.isActive === false ? 'loja-pcard--inactive' : ''}`}
                    >
                      <div className="loja-pcard__visual">
                        <button type="button" className="loja-pcard__imgBtn" onClick={openProd} aria-label={`Ver ${p.title || p.id}`}>
                          <img className="loja-pcard__img" src={img} alt="" loading="lazy" />
                        </button>
                        {badges.length ? (
                          <div className="loja-pcard__badges">
                            {badges.map((b) => (
                              <span key={b.key} className={`loja-badge loja-badge--sm loja-badge--${b.key}`}>
                                {b.label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="loja-pcard__overlay">
                          <div className="loja-pcard__actrow loja-pcard__actrow--stack">
                            <button
                              type="button"
                              className="loja-pcard__btn loja-pcard__btn--primary"
                              disabled={buyDisabled}
                              onClick={() => handleComprar(p)}
                            >
                              {buyLabel}
                            </button>
                            <button type="button" className="loja-pcard__btn loja-pcard__btn--outline" onClick={openProd}>
                              Detalhes
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="loja-pcard__meta">
                        <button type="button" className="loja-pcard__nameBtn" onClick={openProd}>
                          <span className="loja-pcard__name">{p.title || p.id}</span>
                        </button>
                        <div className="loja-pcard__priceRow">
                          {p.isOnSale === true && Number(p.promoPrice) > 0 && Number(p.price) > Number(p.promoPrice) ? (
                            <span className="loja-pcard__priceOld">R$ {Number(p.price).toFixed(2)}</span>
                          ) : null}
                          <span className="loja-pcard__price">R$ {finalPrice.toFixed(2)}</span>
                          {vip && p.isVIPDiscountEnabled === true && finalPrice < basePrice ? (
                            <span className="loja-pcard__vipTag">VIP</span>
                          ) : null}
                        </div>
                        <div className="loja-pcard__touch-actions">
                          <div className="loja-pcard__actrow loja-pcard__actrow--row">
                            <button
                              type="button"
                              className="loja-pcard__btn loja-pcard__btn--primary"
                              disabled={buyDisabled}
                              onClick={() => handleComprar(p)}
                            >
                              {buyLabel}
                            </button>
                            <button type="button" className="loja-pcard__btn loja-pcard__btn--outline" onClick={openProd}>
                              Detalhes
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
