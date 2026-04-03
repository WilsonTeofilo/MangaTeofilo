import React, { useEffect, useMemo, useState } from 'react';
import { onValue, push, ref, remove, set, update } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';

import { db, functions } from '../../services/firebase';
import {
  normalizeProductCategory,
  normalizeStoreConfig,
  STORE_CATEGORY_KEYS,
  STORE_CATEGORY_LABELS,
  STORE_DEFAULT_CONFIG,
  STORE_TYPE_KEYS,
} from '../../config/store';
import './LojaAdmin.css';

const EMPTY_PRODUCT = {
  customId: '',
  title: '',
  description: '',
  price: 0,
  costPrice: 0,
  weightGrams: 450,
  stock: 0,
  imagesText: '',
  isActive: true,
  isOnSale: false,
  promoPrice: 0,
  isVIPDiscountEnabled: true,
  type: STORE_TYPE_KEYS.MANGA,
  category: STORE_CATEGORY_KEYS.MANGA,
  obra: '',
  collection: '',
  dropLabel: '',
  creatorId: '',
  sizesText: '',
  isNew: false,
  shippingMode: 'fixed',
  freeShippingThresholdBrl: 150,
  regionShippingText: 'sudeste: 25\nsul: 30\ncentro-oeste: 35\nnordeste: 45\nnorte: 60',
  inventoryMode: 'on_demand',
  mioloPdfUrl: '',
  coverSourceUrl: '',
};

const SHIPPING_MODE = {
  FIXED: 'fixed',
  REGION: 'region',
  API: 'api',
};

const INVENTORY_MODE = {
  ON_DEMAND: 'on_demand',
  FIXED: 'fixed',
};

function parseImages(text) {
  return String(text || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSizes(text) {
  return String(text || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseRegionShipping(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((acc, line) => {
      const [regionRaw, valueRaw = ''] = line.split(':');
      const region = String(regionRaw || '').trim().toLowerCase();
      const value = Number(String(valueRaw || '').replace(',', '.').trim());
      if (!region || !Number.isFinite(value) || value < 0) return acc;
      acc[region] = Math.round(value * 100) / 100;
      return acc;
    }, {});
}

function regionShippingToText(regionalShipping) {
  return Object.entries(regionalShipping || {})
    .map(([region, value]) => `${region}: ${Number(value || 0).toFixed(2)}`)
    .join('\n');
}

function formatBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function orderBelongsToCreator(order, creatorUid) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.some((item) => String(item?.creatorId || '').trim() === creatorUid);
}

function creatorOrderTotal(order, creatorUid) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.reduce((sum, item) => {
    if (String(item?.creatorId || '').trim() !== creatorUid) return sum;
    return sum + Number(item?.lineTotal || 0);
  }, 0);
}

export default function LojaAdmin({ user, adminAccess, workspace = 'admin' }) {
  const navigate = useNavigate();
  const creatorUid = String(user?.uid || '').trim();
  const isMangaka = Boolean(adminAccess?.isMangaka && creatorUid);
  const ordersPath = workspace === 'creator' ? '/creator/loja' : '/admin/pedidos';
  const isCreatorWorkspace = workspace === 'creator';
  const listVisibleOrders = useMemo(() => httpsCallable(functions, 'adminListVisibleStoreOrders'), []);
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [editingId, setEditingId] = useState('');
  const [ok, setOk] = useState('');
  const [shipIn, setShipIn] = useState(null);
  const [thanksIn, setThanksIn] = useState(null);

  useEffect(() => {
    const unsubCfg = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    const unsubProducts = onValue(ref(db, 'loja/produtos'), (snap) => {
      const list = Object.entries(snap.exists() ? snap.val() : {}).map(([id, v]) => ({ id, ...(v || {}) }));
      setProducts(list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));
    });
    let unsubOrders = () => {};
    if (isMangaka) {
      listVisibleOrders()
        .then(({ data }) => {
          const list = Array.isArray(data?.orders) ? data.orders : [];
          setOrders(list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)));
        })
        .catch(() => {
          setOrders([]);
          setOk('Nao foi possivel carregar pedidos visiveis do criador.');
          setTimeout(() => setOk(''), 3200);
        });
    } else {
      unsubOrders = onValue(ref(db, 'loja/pedidos'), (snap) => {
        const list = Object.entries(snap.exists() ? snap.val() : {}).map(([id, v]) => ({ id, ...(v || {}) }));
        setOrders(list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)));
      });
    }
    return () => {
      unsubCfg();
      unsubProducts();
      unsubOrders();
    };
  }, [isMangaka, listVisibleOrders]);

  const visibleProducts = useMemo(() => {
    if (!isMangaka) return products;
    return products.filter((product) => String(product?.creatorId || '').trim() === creatorUid);
  }, [creatorUid, isMangaka, products]);

  const visibleOrders = useMemo(() => {
    if (!isMangaka) return orders;
    return orders.filter((order) => orderBelongsToCreator(order, creatorUid));
  }, [creatorUid, isMangaka, orders]);

  const totals = useMemo(() => {
    return visibleOrders.reduce(
      (acc, order) => {
        const totalBase = isMangaka ? creatorOrderTotal(order, creatorUid) : Number(order.total || 0);
        acc.total += totalBase;
        if (
          order.status === 'paid' ||
          order.status === 'order_received' ||
          order.status === 'processing' ||
          order.status === 'in_production' ||
          order.status === 'shipped' ||
          order.status === 'delivered'
        ) {
          acc.paid += totalBase;
        }
        if (order.status === 'pending' || order.status === 'pending_payment') acc.pending += 1;
        return acc;
      },
      { total: 0, paid: 0, pending: 0 }
    );
  }, [creatorUid, isMangaka, visibleOrders]);

  async function saveConfig(patch) {
    if (isMangaka) {
      setOk('Configuracoes globais da loja ficam com o admin-chefe.');
      setTimeout(() => setOk(''), 3200);
      return;
    }
    await update(ref(db, 'loja/config'), { ...patch, updatedAt: Date.now() });
    setOk('Configuração salva.');
    setTimeout(() => setOk(''), 2200);
  }

  const [heroEyebrowIn, setHeroEyebrowIn] = useState(null);
  const [heroTitleIn, setHeroTitleIn] = useState(null);
  const [heroSubtitleIn, setHeroSubtitleIn] = useState(null);

  const previewImages = useMemo(() => parseImages(form.imagesText), [form.imagesText]);
  const effectivePrice = form.isOnSale && Number(form.promoPrice || 0) > 0 ? Number(form.promoPrice || 0) : Number(form.price || 0);
  const profitBrl = Math.round((effectivePrice - Number(form.costPrice || 0)) * 100) / 100;
  const marginPct = effectivePrice > 0 ? Math.round((profitBrl / effectivePrice) * 1000) / 10 : 0;
  const regionalShipping = useMemo(() => parseRegionShipping(form.regionShippingText), [form.regionShippingText]);

  async function saveShippingBlock() {
    await saveConfig({
      fixedShippingBrl: Math.max(0, Number(shipIn ?? config.fixedShippingBrl ?? 0)),
      freeShippingThresholdBrl: Math.max(0, Number(config.freeShippingThresholdBrl ?? 150)),
      postPurchaseThanks: String(thanksIn ?? config.postPurchaseThanks ?? '').trim(),
    });
  }

  async function saveHeroBlock() {
    await saveConfig({
      heroEyebrow: String(heroEyebrowIn ?? config.heroEyebrow ?? '').trim(),
      heroTitle: String(heroTitleIn ?? config.heroTitle ?? '').trim(),
      heroSubtitle: String(heroSubtitleIn ?? config.heroSubtitle ?? '').trim(),
    });
  }

  async function saveProduct() {
    const now = Date.now();
    const images = parseImages(form.imagesText);
    const sizes = parseSizes(form.sizesText);
    const type = String(form.type || STORE_TYPE_KEYS.MANGA).toLowerCase();
    const category = normalizeProductCategory({ category: form.category });

    const payload = {
      title: String(form.title || '').trim(),
      description: String(form.description || '').trim(),
      price: Number(form.price || 0),
      costPrice: Math.max(0, Number(form.costPrice || 0)),
      weightGrams: Math.max(0, Number(form.weightGrams || 0)),
      stock:
        form.inventoryMode === INVENTORY_MODE.ON_DEMAND
          ? 9999
          : Math.max(0, Number(form.stock || 0)),
      images,
      isActive: form.isActive === true,
      isOnSale: form.isOnSale === true,
      promoPrice: Number(form.promoPrice || 0),
      isVIPDiscountEnabled: form.isVIPDiscountEnabled === true,
      type: type === STORE_TYPE_KEYS.ROUPA ? STORE_TYPE_KEYS.ROUPA : STORE_TYPE_KEYS.MANGA,
      category,
      obra: String(form.obra || '').trim(),
      collection: String(form.collection || '').trim(),
      dropLabel: String(form.dropLabel || '').trim(),
      creatorId: isMangaka ? creatorUid : String(form.creatorId || '').trim() || null,
      sizes: type === STORE_TYPE_KEYS.ROUPA ? sizes : [],
      isNew: form.isNew === true,
      shippingMode: Object.values(SHIPPING_MODE).includes(form.shippingMode) ? form.shippingMode : SHIPPING_MODE.FIXED,
      freeShippingThresholdBrl: Math.max(0, Number(form.freeShippingThresholdBrl || 0)),
      regionalShipping,
      inventoryMode:
        form.inventoryMode === INVENTORY_MODE.FIXED ? INVENTORY_MODE.FIXED : INVENTORY_MODE.ON_DEMAND,
      internalFiles: {
        mioloPdfUrl: String(form.mioloPdfUrl || '').trim(),
        coverSourceUrl: String(form.coverSourceUrl || '').trim(),
      },
      updatedAt: now,
    };

    if (!payload.title || payload.price <= 0) {
      setOk('Preencha nome e preço válidos.');
      setTimeout(() => setOk(''), 2500);
      return;
    }

    const slug = String(form.customId || '').trim().toLowerCase();
    const slugOk = /^[a-z0-9_-]{2,40}$/.test(slug);

    try {
      if (editingId) {
        await update(ref(db, `loja/produtos/${editingId}`), payload);
      } else if (slugOk) {
        await set(ref(db, `loja/produtos/${slug}`), { ...payload, createdAt: now });
      } else {
        const newRef = push(ref(db, 'loja/produtos'));
        await set(newRef, { ...payload, createdAt: now });
      }
      setForm({ ...EMPTY_PRODUCT, creatorId: isMangaka ? creatorUid : '' });
      setEditingId('');
      setOk('Produto salvo.');
      setTimeout(() => setOk(''), 2200);
    } catch (e) {
      setOk(e?.message || 'Erro ao salvar.');
      setTimeout(() => setOk(''), 4000);
    }
  }

  function loadProductIntoForm(p) {
    if (isMangaka && String(p?.creatorId || '').trim() !== creatorUid) {
      setOk('Voce so pode editar produtos do seu creatorId.');
      setTimeout(() => setOk(''), 3200);
      return;
    }
    setEditingId(p.id);
    setForm({
      customId: p.id,
      title: p.title || '',
      description: p.description || '',
      price: Number(p.price || 0),
      costPrice: Number(p.costPrice || 0),
      weightGrams: Number(p.weightGrams || 450),
      stock: Number(p.stock || 0),
      imagesText: Array.isArray(p.images) ? p.images.join('\n') : '',
      isActive: p.isActive !== false,
      isOnSale: p.isOnSale === true,
      promoPrice: Number(p.promoPrice || 0),
      isVIPDiscountEnabled: p.isVIPDiscountEnabled !== false,
      type: String(p.type || STORE_TYPE_KEYS.MANGA).toLowerCase() === STORE_TYPE_KEYS.ROUPA ? STORE_TYPE_KEYS.ROUPA : STORE_TYPE_KEYS.MANGA,
      category: normalizeProductCategory(p),
      obra: String(p.obra || ''),
      collection: String(p.collection || ''),
      dropLabel: String(p.dropLabel || ''),
      creatorId: isMangaka ? creatorUid : String(p.creatorId || ''),
      sizesText: Array.isArray(p.sizes) ? p.sizes.join(', ') : '',
      isNew: p.isNew === true,
      shippingMode: Object.values(SHIPPING_MODE).includes(p.shippingMode) ? p.shippingMode : SHIPPING_MODE.FIXED,
      freeShippingThresholdBrl: Number(p.freeShippingThresholdBrl || config.freeShippingThresholdBrl || 150),
      regionShippingText: regionShippingToText(p.regionalShipping),
      inventoryMode:
        String(p.inventoryMode || '').toLowerCase() === INVENTORY_MODE.FIXED
          ? INVENTORY_MODE.FIXED
          : INVENTORY_MODE.ON_DEMAND,
      mioloPdfUrl: String(p.internalFiles?.mioloPdfUrl || ''),
      coverSourceUrl: String(p.internalFiles?.coverSourceUrl || ''),
    });
  }

  return (
    <main className="loja-admin-page">
      <header className="loja-admin-head">
        <div>
          <h1>{isMangaka ? 'Loja do criador' : workspace === 'creator' ? 'Operacao da loja' : 'Loja — Admin'}</h1>
          {ok ? <p>{ok}</p> : null}
          {!ok && isMangaka ? <p>Gerencie produtos e acompanhe apenas os pedidos ligados ao seu creatorId.</p> : null}
          {!ok && !isMangaka && isCreatorWorkspace ? <p>Contexto de loja dentro do workspace creator.</p> : null}
        </div>
        <button type="button" className="loja-admin-link-pedidos" onClick={() => navigate(ordersPath)}>
          {isMangaka ? 'Pedidos e operacao →' : 'Pedidos da loja →'}
        </button>
      </header>

      <section className="loja-admin-kpis">
        <article>
          <span>Pedidos aguardando pagamento</span>
          <strong>{totals.pending}</strong>
        </article>
        <article>
          <span>Volume (todos)</span>
          <strong>R$ {totals.total.toFixed(2)}</strong>
        </article>
        <article>
          <span>Volume pago / em curso</span>
          <strong>R$ {totals.paid.toFixed(2)}</strong>
        </article>
      </section>

      <section className="loja-admin-card loja-admin-card--wide">
        <h2>{isMangaka ? 'Resumo da sua operacao' : 'Configuração'}</h2>
        {isMangaka ? (
          <p>
            A vitrine global continua com a plataforma. Aqui voce foca no que e seu: produtos, estoque e pedidos
            relacionados ao seu catalogo.
          </p>
        ) : null}
        {!isMangaka ? (
        <>
        <div className="loja-admin-config-grid">
          <label>
            <input
              type="checkbox"
              checked={config.storeEnabled}
              onChange={(e) => saveConfig({ storeEnabled: e.target.checked })}
            />{' '}
            Loja ativa
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.storeVisibleToUsers}
              onChange={(e) => saveConfig({ storeVisibleToUsers: e.target.checked })}
            />{' '}
            Visível ao público
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.acceptingOrders}
              onChange={(e) => saveConfig({ acceptingOrders: e.target.checked })}
            />{' '}
            Aceitando pedidos
          </label>
          <label className="loja-admin-field">
            Desconto VIP (%)
            <input
              type="number"
              min={0}
              max={60}
              value={config.vipDiscountPct}
              onChange={(e) => saveConfig({ vipDiscountPct: Number(e.target.value || 0) })}
            />
          </label>
        </div>
        <div className="loja-admin-shipping-block">
          <h3>Hero da loja (vitrine)</h3>
          <label className="loja-admin-field">
            Eyebrow (linha pequena acima do título)
            <input value={heroEyebrowIn ?? config.heroEyebrow ?? ''} onChange={(e) => setHeroEyebrowIn(e.target.value)} placeholder="Kokuin Project" />
          </label>
          <label className="loja-admin-field">
            Título principal
            <input value={heroTitleIn ?? config.heroTitle ?? ''} onChange={(e) => setHeroTitleIn(e.target.value)} placeholder="KOKUIN COLLECTION" />
          </label>
          <label className="loja-admin-field">
            Subtítulo
            <textarea
              rows={2}
              value={heroSubtitleIn ?? config.heroSubtitle ?? ''}
              onChange={(e) => setHeroSubtitleIn(e.target.value)}
              placeholder="Peças do universo..."
            />
          </label>
          <button type="button" className="loja-admin-btn-primary" onClick={saveHeroBlock}>
            Salvar hero
          </button>
        </div>

        <div className="loja-admin-shipping-block">
          <h3>Frete fixo e pós-compra</h3>
          <label className="loja-admin-field">
            Frete fixo (R$)
            <input type="number" min={0} step={0.01} value={shipIn ?? config.fixedShippingBrl ?? 0} onChange={(e) => setShipIn(Number(e.target.value || 0))} />
          </label>
          <label className="loja-admin-field">
            Frete grátis acima de (R$)
            <input
              type="number"
              min={0}
              step={0.01}
              value={config.freeShippingThresholdBrl ?? 150}
              onChange={(e) => saveConfig({ freeShippingThresholdBrl: Number(e.target.value || 0) })}
            />
          </label>
          <label className="loja-admin-field">
            Mensagem após pagamento (site)
            <textarea
              rows={3}
              value={thanksIn ?? config.postPurchaseThanks ?? ''}
              onChange={(e) => setThanksIn(e.target.value)}
              placeholder="Ex.: Obrigado! Você apoia o Shito — benefício X liberado em breve."
            />
          </label>
          <button type="button" className="loja-admin-btn-primary" onClick={saveShippingBlock}>
            Salvar frete e mensagem
          </button>
        </div>
        </>
        ) : null}
      </section>

      <section className="loja-admin-card loja-admin-card--wide loja-admin-product-editor">
        <div className="loja-admin-product-head">
          <div>
            <h2>{editingId ? `Editar: ${editingId}` : isMangaka ? 'Novo produto do criador' : 'Novo produto'}</h2>
            <p className="loja-admin-hint">
              Produto bom de administrar mostra custo, preço, peso e regra de frete sem esconder nada.
            </p>
          </div>
          <div className="loja-admin-actions">
            <button type="button" className="loja-admin-btn-primary" onClick={saveProduct}>
              {editingId ? 'Salvar mudanças' : 'Criar produto'}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm({ ...EMPTY_PRODUCT, creatorId: isMangaka ? creatorUid : '' });
                setEditingId('');
              }}
            >
              Limpar formulário
            </button>
          </div>
        </div>

        <div className="loja-admin-product-shell">
          <div className="loja-admin-product-form">
            <section className="loja-admin-editor-section">
              <h3>Informações do produto</h3>
              <div className="loja-admin-editor-grid">
                {!editingId ? (
                  <label className="loja-admin-field">
                    ID do produto (opcional)
                    <input
                      value={form.customId}
                      onChange={(e) => setForm((f) => ({ ...f, customId: e.target.value }))}
                      placeholder="ex.: kokuin-vol1"
                    />
                  </label>
                ) : (
                  <label className="loja-admin-field">
                    ID fixo
                    <input value={editingId} disabled />
                  </label>
                )}
                <label className="loja-admin-field">
                  Nome do produto
                  <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                </label>
                <label className="loja-admin-field loja-admin-field--full">
                  Descrição
                  <textarea rows={5} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </label>
                <label className="loja-admin-field">
                  Tipo
                  <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                    <option value={STORE_TYPE_KEYS.MANGA}>Mangá / produto físico</option>
                    <option value={STORE_TYPE_KEYS.ROUPA}>Vestuário (tamanhos)</option>
                  </select>
                </label>
                <label className="loja-admin-field">
                  Categoria
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                    <option value={STORE_CATEGORY_KEYS.MANGA}>{STORE_CATEGORY_LABELS[STORE_CATEGORY_KEYS.MANGA]}</option>
                    <option value={STORE_CATEGORY_KEYS.VESTUARIO}>{STORE_CATEGORY_LABELS[STORE_CATEGORY_KEYS.VESTUARIO]}</option>
                    <option value={STORE_CATEGORY_KEYS.EXTRAS}>{STORE_CATEGORY_LABELS[STORE_CATEGORY_KEYS.EXTRAS]}</option>
                  </select>
                </label>
                <label className="loja-admin-field">
                  Coleção / drop
                  <input
                    value={form.collection}
                    onChange={(e) => setForm((f) => ({ ...f, collection: e.target.value }))}
                    placeholder="Ex.: DROP 01 TEMPESTUA"
                  />
                </label>
                <label className="loja-admin-field">
                  Badge extra
                  <input
                    value={form.dropLabel}
                    onChange={(e) => setForm((f) => ({ ...f, dropLabel: e.target.value }))}
                    placeholder="Limited edition"
                  />
                </label>
                <label className="loja-admin-field">
                  Obra relacionada
                  <input value={form.obra} onChange={(e) => setForm((f) => ({ ...f, obra: e.target.value }))} placeholder="kokuin" />
                </label>
                {!isMangaka ? (
                  <label className="loja-admin-field">
                    UID do criador
                    <input
                      value={form.creatorId}
                      onChange={(e) => setForm((f) => ({ ...f, creatorId: e.target.value }))}
                      placeholder="UID Firebase"
                      autoComplete="off"
                    />
                  </label>
                ) : null}
                {form.type === STORE_TYPE_KEYS.ROUPA ? (
                  <label className="loja-admin-field">
                    Tamanhos
                    <input
                      value={form.sizesText}
                      onChange={(e) => setForm((f) => ({ ...f, sizesText: e.target.value }))}
                      placeholder="P, M, G, GG"
                    />
                  </label>
                ) : null}
                <label className="loja-admin-field loja-admin-field--full">
                  URLs das imagens (uma por linha)
                  <textarea
                    rows={5}
                    value={form.imagesText}
                    onChange={(e) => setForm((f) => ({ ...f, imagesText: e.target.value }))}
                    placeholder="https://..."
                  />
                </label>
              </div>
            </section>

            <section className="loja-admin-editor-section">
              <h3>Custo, venda e margem</h3>
              <div className="loja-admin-editor-grid loja-admin-editor-grid--compact">
                <label className="loja-admin-field">
                  Custo de produção (R$)
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.costPrice}
                    onChange={(e) => setForm((f) => ({ ...f, costPrice: Number(e.target.value || 0) }))}
                  />
                </label>
                <label className="loja-admin-field">
                  Preço de venda (R$)
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value || 0) }))}
                  />
                </label>
                <label className="loja-admin-field">
                  Peso (g)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={form.weightGrams}
                    onChange={(e) => setForm((f) => ({ ...f, weightGrams: Number(e.target.value || 0) }))}
                  />
                </label>
                <label className="loja-admin-field">
                  Frete grátis acima de (R$)
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.freeShippingThresholdBrl}
                    onChange={(e) => setForm((f) => ({ ...f, freeShippingThresholdBrl: Number(e.target.value || 0) }))}
                  />
                </label>
              </div>
              <div className="loja-admin-toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={form.isOnSale}
                    onChange={(e) => setForm((f) => ({ ...f, isOnSale: e.target.checked }))}
                  />{' '}
                  Em promoção
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.isVIPDiscountEnabled}
                    onChange={(e) => setForm((f) => ({ ...f, isVIPDiscountEnabled: e.target.checked }))}
                  />{' '}
                  Desconto VIP
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.isNew}
                    onChange={(e) => setForm((f) => ({ ...f, isNew: e.target.checked }))}
                  />{' '}
                  Badge novo
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />{' '}
                  Ativo na loja
                </label>
              </div>
              {form.isOnSale ? (
                <label className="loja-admin-field">
                  Preço promocional (R$)
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.promoPrice}
                    onChange={(e) => setForm((f) => ({ ...f, promoPrice: Number(e.target.value || 0) }))}
                  />
                </label>
              ) : null}
              <div className="loja-admin-money-strip">
                <article className="loja-admin-money-card">
                  <span>Preço ativo</span>
                  <strong>{formatBRL(effectivePrice)}</strong>
                </article>
                <article className={`loja-admin-money-card ${profitBrl >= 0 ? 'is-positive' : 'is-negative'}`}>
                  <span>Lucro bruto</span>
                  <strong>{formatBRL(profitBrl)}</strong>
                </article>
                <article className="loja-admin-money-card">
                  <span>Margem</span>
                  <strong>{Number.isFinite(marginPct) ? `${marginPct}%` : '0%'}</strong>
                </article>
              </div>
            </section>

            <section className="loja-admin-editor-section">
              <h3>Frete e logística</h3>
              <div className="loja-admin-toggle-row">
                <label>
                  <input
                    type="radio"
                    name="shippingMode"
                    checked={form.shippingMode === SHIPPING_MODE.API}
                    onChange={() => setForm((f) => ({ ...f, shippingMode: SHIPPING_MODE.API }))}
                  />{' '}
                  API automática
                </label>
                <label>
                  <input
                    type="radio"
                    name="shippingMode"
                    checked={form.shippingMode === SHIPPING_MODE.REGION}
                    onChange={() => setForm((f) => ({ ...f, shippingMode: SHIPPING_MODE.REGION }))}
                  />{' '}
                  Frete por região
                </label>
                <label>
                  <input
                    type="radio"
                    name="shippingMode"
                    checked={form.shippingMode === SHIPPING_MODE.FIXED}
                    onChange={() => setForm((f) => ({ ...f, shippingMode: SHIPPING_MODE.FIXED }))}
                  />{' '}
                  Frete fixo
                </label>
              </div>
              {form.shippingMode === SHIPPING_MODE.REGION ? (
                <label className="loja-admin-field loja-admin-field--full">
                  Tabela por região
                  <textarea
                    rows={6}
                    value={form.regionShippingText}
                    onChange={(e) => setForm((f) => ({ ...f, regionShippingText: e.target.value }))}
                    placeholder={'sudeste: 25\nsul: 30\ncentro-oeste: 35\nnordeste: 45\nnorte: 60'}
                  />
                </label>
              ) : null}
              <p className="loja-admin-hint">
                {form.shippingMode === SHIPPING_MODE.API
                  ? 'O checkout pode consultar PAC e SEDEX depois usando peso e CEP.'
                  : form.shippingMode === SHIPPING_MODE.REGION
                    ? 'A tabela regional fica salva no produto para você comparar custo real por área.'
                    : 'Frete fixo usa a configuração global atual da loja como base.'}
              </p>
            </section>

            <section className="loja-admin-editor-section">
              <h3>Operação e arquivos internos</h3>
              <div className="loja-admin-toggle-row">
                <label>
                  <input
                    type="radio"
                    name="inventoryMode"
                    checked={form.inventoryMode === INVENTORY_MODE.ON_DEMAND}
                    onChange={() => setForm((f) => ({ ...f, inventoryMode: INVENTORY_MODE.ON_DEMAND }))}
                  />{' '}
                  Produção sob demanda
                </label>
                <label>
                  <input
                    type="radio"
                    name="inventoryMode"
                    checked={form.inventoryMode === INVENTORY_MODE.FIXED}
                    onChange={() => setForm((f) => ({ ...f, inventoryMode: INVENTORY_MODE.FIXED }))}
                  />{' '}
                  Estoque fixo
                </label>
              </div>
              {form.inventoryMode === INVENTORY_MODE.FIXED ? (
                <label className="loja-admin-field">
                  Quantidade em estoque
                  <input
                    type="number"
                    min={0}
                    value={form.stock}
                    onChange={(e) => setForm((f) => ({ ...f, stock: Number(e.target.value || 0) }))}
                  />
                </label>
              ) : (
                <p className="loja-admin-hint">Sob demanda deixa o produto sempre disponível e a produção entra quando a compra cair.</p>
              )}
              <div className="loja-admin-editor-grid">
                <label className="loja-admin-field">
                  PDF do miolo
                  <input
                    value={form.mioloPdfUrl}
                    onChange={(e) => setForm((f) => ({ ...f, mioloPdfUrl: e.target.value }))}
                    placeholder="https://..."
                  />
                </label>
                <label className="loja-admin-field">
                  Arquivo da capa
                  <input
                    value={form.coverSourceUrl}
                    onChange={(e) => setForm((f) => ({ ...f, coverSourceUrl: e.target.value }))}
                    placeholder="https://..."
                  />
                </label>
              </div>
            </section>
          </div>

          <aside className="loja-admin-product-preview">
            <article className="loja-admin-preview-card">
              <div className="loja-admin-preview-image">
                {previewImages[0] ? <img src={previewImages[0]} alt={form.title || 'Preview do produto'} /> : <span>Preview da capa</span>}
              </div>
              <div>
                <strong>{form.title || 'Nome do produto'}</strong>
                <p>{form.description || 'A descrição aparece aqui para você enxergar como a loja vai respirar.'}</p>
                <span>{formatBRL(effectivePrice)}</span>
              </div>
            </article>

            <article className="loja-admin-finance-card">
              <h3>Resumo financeiro</h3>
              <dl>
                <div><dt>Custo</dt><dd>{formatBRL(form.costPrice)}</dd></div>
                <div><dt>Venda</dt><dd>{formatBRL(effectivePrice)}</dd></div>
                <div><dt>Lucro</dt><dd>{formatBRL(profitBrl)}</dd></div>
                <div><dt>Margem</dt><dd>{Number.isFinite(marginPct) ? `${marginPct}%` : '0%'}</dd></div>
                <div><dt>Peso</dt><dd>{Number(form.weightGrams || 0)} g</dd></div>
                <div><dt>Estoque</dt><dd>{form.inventoryMode === INVENTORY_MODE.ON_DEMAND ? 'Sob demanda' : `${Number(form.stock || 0)} un`}</dd></div>
                <div><dt>Frete</dt><dd>{form.shippingMode === SHIPPING_MODE.API ? 'PAC / SEDEX via API' : form.shippingMode === SHIPPING_MODE.REGION ? `${Object.keys(regionalShipping).length || 0} regiões` : formatBRL(config.fixedShippingBrl)}</dd></div>
                <div><dt>Grátis acima</dt><dd>{formatBRL(form.freeShippingThresholdBrl)}</dd></div>
              </dl>
            </article>
          </aside>
        </div>
      </section>

      <section className="loja-admin-card loja-admin-card--wide">
        <h2>{isMangaka ? 'Seus produtos' : 'Produtos cadastrados'}</h2>
        <div className="loja-admin-list loja-admin-list--products">
          {visibleProducts.map((p) => {
            const img = (Array.isArray(p.images) && p.images[0]) || '/assets/fotos/shito.jpg';
            const cat = normalizeProductCategory(p);
            const basePrice = p.isOnSale === true && Number(p.promoPrice || 0) > 0 ? Number(p.promoPrice || 0) : Number(p.price || 0);
            const profit = basePrice - Number(p.costPrice || 0);
            return (
              <article key={p.id}>
                <img src={img} alt="" className="loja-admin-thumb" />
                <div>
                  <strong>{p.title}</strong>
                  <span>
                    {formatBRL(basePrice)} · custo {formatBRL(p.costPrice || 0)} · lucro {formatBRL(profit)} · peso {Number(p.weightGrams || 0)} g
                  </span>
                  <span>
                    {String(p.inventoryMode || '') === INVENTORY_MODE.ON_DEMAND ? 'sob demanda' : `estoque ${Number(p.stock || 0)}`} ·{' '}
                    {STORE_CATEGORY_LABELS[cat] || cat} · {p.isActive === false ? 'inativo' : 'ativo'}
                  </span>
                </div>
                <div>
                  <button type="button" onClick={() => loadProductIntoForm(p)}>
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => update(ref(db, `loja/produtos/${p.id}`), { isActive: false, updatedAt: Date.now() })}
                  >
                    Desativar
                  </button>
                  <button type="button" onClick={() => remove(ref(db, `loja/produtos/${p.id}`))}>
                    Excluir
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

