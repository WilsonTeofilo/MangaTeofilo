import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { get, onValue, push, ref, set, update } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';

import { db, storage } from '../../services/firebase';
import {
  normalizeStoreConfig,
  STORE_CATEGORY_KEYS,
  STORE_CATEGORY_LABELS,
  STORE_DEFAULT_CONFIG,
  STORE_TYPE_KEYS,
} from '../../config/store';
import {
  buildProductPayload,
  EMPTY_PRODUCT,
  formatBRL,
  INVENTORY_MODE,
  parseImages,
  parseRegionShipping,
  productToFormState,
  SHIPPING_MODE,
} from './lojaAdminShared';
import './LojaAdmin.css';
import './StoreAdminLayout.css';

async function uploadLojaFile(file, ownerUid, kind) {
  const u = String(ownerUid || '').trim();
  if (!u) throw new Error('UID de destino inválido para upload.');
  const ext =
    kind === 'pdf'
      ? '.pdf'
      : String(file.name || '')
          .toLowerCase()
          .match(/\.(jpe?g|png|webp)$/)?.[0] || '.jpg';
  const path = `loja_produtos/${u}/${kind}_${Date.now()}${ext}`;
  const r = storageRef(storage, path);
  const contentType =
    kind === 'pdf'
      ? 'application/pdf'
      : String(file.type || 'image/jpeg').split(';')[0] || 'image/jpeg';
  await uploadBytes(r, file, { contentType });
  return getDownloadURL(r);
}

export default function LojaProductEditorAdmin({ user, adminAccess, workspace = 'admin' }) {
  const navigate = useNavigate();
  const params = useParams();
  const productId = String(params.productId || '').trim();
  const isCreate = !productId;

  const creatorUid = String(user?.uid || '').trim();
  const isMangaka = Boolean(adminAccess?.isMangaka && creatorUid);
  const isCreatorWorkspace = workspace === 'creator';
  const productsBase = isCreatorWorkspace ? '/creator/loja/produtos' : '/admin/products';

  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const configRef = useRef(config);
  configRef.current = config;
  const [form, setForm] = useState(() => ({ ...EMPTY_PRODUCT, creatorId: isMangaka ? creatorUid : '' }));
  const [editingId, setEditingId] = useState('');
  const [msg, setMsg] = useState('');
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [pdfFile, setPdfFile] = useState(null);

  useEffect(() => {
    const unsub = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!coverFile) {
      setCoverPreview('');
      return undefined;
    }
    const u = URL.createObjectURL(coverFile);
    setCoverPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [coverFile]);

  const storageTargetUid = useMemo(() => {
    if (isMangaka) return creatorUid;
    const c = String(form.creatorId || '').trim();
    return c || creatorUid;
  }, [creatorUid, form.creatorId, isMangaka]);

  const loadProduct = useCallback(async () => {
    const cfg = configRef.current;
    if (isCreate) {
      setEditingId('');
      setForm({
        ...EMPTY_PRODUCT,
        creatorId: isMangaka ? creatorUid : '',
        freeShippingThresholdBrl: cfg.freeShippingThresholdBrl ?? 150,
        shippingMode: cfg.defaultShippingMode || SHIPPING_MODE.API,
      });
      setCoverFile(null);
      setPdfFile(null);
      return;
    }
    const snap = await get(ref(db, `loja/produtos/${productId}`));
    if (!snap.exists()) {
      setMsg('Produto não encontrado.');
      navigate(productsBase);
      return;
    }
    const row = snap.val() || {};
    if (isMangaka && String(row.creatorId || '').trim() !== creatorUid) {
      setMsg('Você não pode editar este produto.');
      navigate(productsBase);
      return;
    }
    setEditingId(productId);
    setForm(productToFormState({ id: productId, ...row }, cfg, { isMangaka, creatorUid }));
    setCoverFile(null);
    setPdfFile(null);
  }, [creatorUid, isCreate, isMangaka, navigate, productId, productsBase]);

  useEffect(() => {
    loadProduct();
  }, [loadProduct]);

  const previewImages = useMemo(() => parseImages(form.imagesText), [form.imagesText]);
  const displayCover = coverPreview || previewImages[0] || '';

  const effectivePrice =
    form.isOnSale && Number(form.promoPrice || 0) > 0 ? Number(form.promoPrice || 0) : Number(form.price || 0);
  const profitBrl = Math.round((effectivePrice - Number(form.costPrice || 0)) * 100) / 100;
  const marginPct = effectivePrice > 0 ? Math.round((profitBrl / effectivePrice) * 1000) / 10 : 0;
  const regionalShipping = useMemo(() => parseRegionShipping(form.regionShippingText), [form.regionShippingText]);

  async function saveProduct() {
    setMsg('');
    try {
      let imagesText = form.imagesText;
      let mioloPdfUrl = form.mioloPdfUrl;
      let coverSourceUrl = form.coverSourceUrl;

      if (coverFile) {
        const url = await uploadLojaFile(coverFile, storageTargetUid, 'cover');
        const rest = parseImages(imagesText).filter((u) => u !== url);
        imagesText = [url, ...rest].join('\n');
        coverSourceUrl = url;
      }
      if (pdfFile) {
        mioloPdfUrl = await uploadLojaFile(pdfFile, storageTargetUid, 'miolo');
      }

      const formReady = { ...form, imagesText, mioloPdfUrl, coverSourceUrl };
      const payload = buildProductPayload(formReady, { isMangaka, creatorUid, config });

      if (!payload.title || payload.price <= 0) {
        setMsg('Preencha nome e preço de venda válidos.');
        return;
      }

      const now = Date.now();
      if (editingId) {
        await update(ref(db, `loja/produtos/${editingId}`), payload);
      } else {
        const newRef = push(ref(db, 'loja/produtos'));
        await set(newRef, { ...payload, createdAt: now });
      }
      setMsg('Produto salvo.');
      setCoverFile(null);
      setPdfFile(null);
      navigate(productsBase);
    } catch (e) {
      setMsg(e?.message || 'Erro ao salvar.');
    }
  }

  const shipOptions = [
    { id: SHIPPING_MODE.API, title: 'Automático (recomendado)', sub: 'Estimativa por peso e região do comprador' },
    { id: SHIPPING_MODE.REGION, title: 'Por região', sub: 'Tabela própria por macro-região' },
    { id: SHIPPING_MODE.FIXED, title: 'Fixo', sub: 'Usa frete base da configuração global' },
  ];

  return (
    <main className="loja-admin-page">
      <header className="loja-admin-head store-admin-head">
        <div>
          <nav className="store-admin-breadcrumb" aria-label="Navegação">
            <Link to={productsBase}>Produtos</Link>
            <span aria-hidden="true">/</span>
            <span>{isCreate ? 'Novo produto' : 'Editar produto'}</span>
          </nav>
          <h1>{isCreate ? 'Novo produto' : 'Editar produto'}</h1>
          <p className="store-admin-lead">Foco em preço, custo e margem. Capa e arquivos por upload.</p>
          {msg ? <p className="store-admin-toast">{msg}</p> : null}
        </div>
        <Link to={productsBase} className="loja-admin-link-pedidos">
          ← Lista
        </Link>
      </header>

      <nav className="store-admin-subnav" aria-label="Seções da loja">
        <NavLink to={productsBase} className={({ isActive }) => (isActive ? 'is-active' : '')} end>
          Produtos
        </NavLink>
        <NavLink
          to={isCreatorWorkspace ? `${productsBase}/criar` : `${productsBase}/create`}
          className={({ isActive }) => (isActive ? 'is-active' : '')}
        >
          Novo produto
        </NavLink>
        {!isMangaka ? (
          <NavLink to="/admin/store/settings" className={({ isActive }) => (isActive ? 'is-active' : '')}>
            Configuração global
          </NavLink>
        ) : null}
      </nav>

      <div className="sa-pe-layout">
        <div>
          <section className="sa-pe-block">
            <h2 className="sa-pe-block__title">Produto</h2>
            <div className="loja-admin-editor-grid">
              <label className="loja-admin-field loja-admin-field--full">
                Nome
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              </label>
              <label className="loja-admin-field loja-admin-field--full">
                Descrição
                <textarea rows={7} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
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
                <input value={form.collection} onChange={(e) => setForm((f) => ({ ...f, collection: e.target.value }))} />
              </label>
              <label className="loja-admin-field">
                Selo (badge)
                <input value={form.dropLabel} onChange={(e) => setForm((f) => ({ ...f, dropLabel: e.target.value }))} />
              </label>
              <label className="loja-admin-field">
                Obra relacionada (slug/id)
                <input value={form.obra} onChange={(e) => setForm((f) => ({ ...f, obra: e.target.value }))} />
              </label>
              {form.type === STORE_TYPE_KEYS.ROUPA ? (
                <label className="loja-admin-field loja-admin-field--full">
                  Tamanhos (separados por vírgula)
                  <input
                    value={form.sizesText}
                    onChange={(e) => setForm((f) => ({ ...f, sizesText: e.target.value }))}
                    placeholder="P, M, G, GG"
                  />
                </label>
              ) : null}
            </div>

            <div className="sa-pe-upload-zone">
              <p className="sa-pe-upload-zone__title">Capa da vitrine</p>
              <p className="loja-admin-hint">JPG, PNG ou WebP. Substitui a primeira imagem do produto.</p>
              <label className="sa-pe-file-trigger">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  hidden
                  onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
                />
                Escolher imagem
              </label>
              {displayCover ? (
                <div>
                  <img src={displayCover} alt="" />
                </div>
              ) : null}
            </div>
          </section>

          <section className="sa-pe-block">
            <h2 className="sa-pe-block__title">Financeiro</h2>
            <div className="sa-pe-finance-trio">
              <div className="sa-pe-money-box">
                <label htmlFor="sa-cost">Custo</label>
                <input
                  id="sa-cost"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.costPrice}
                  onChange={(e) => setForm((f) => ({ ...f, costPrice: Number(e.target.value || 0) }))}
                />
              </div>
              <div className="sa-pe-money-box">
                <label htmlFor="sa-price">Preço de venda</label>
                <input
                  id="sa-price"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value || 0) }))}
                />
              </div>
              <div className="sa-pe-money-box sa-pe-money-box--weight">
                <label htmlFor="sa-weight">Peso (g)</label>
                <input
                  id="sa-weight"
                  type="number"
                  min={0}
                  value={form.weightGrams}
                  onChange={(e) => setForm((f) => ({ ...f, weightGrams: Number(e.target.value || 0) }))}
                />
              </div>
            </div>
            <div className={`sa-pe-profit-panel ${profitBrl < 0 ? 'is-negative' : ''}`}>
              <div className="sa-pe-profit-label">Lucro bruto</div>
              <div className="sa-pe-profit-value">{formatBRL(profitBrl)}</div>
              <div className="sa-pe-margin">Margem: {Number.isFinite(marginPct) ? `${marginPct}%` : '0%'}</div>
            </div>
            <div className="loja-admin-toggle-row" style={{ marginTop: 12 }}>
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
                <input type="checkbox" checked={form.isNew} onChange={(e) => setForm((f) => ({ ...f, isNew: e.target.checked }))} />{' '}
                Novo
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />{' '}
                Ativo
              </label>
            </div>
            {form.isOnSale ? (
              <label className="loja-admin-field" style={{ marginTop: 10 }}>
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
          </section>

          <section className="sa-pe-block">
            <h2 className="sa-pe-block__title">Frete deste produto</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {shipOptions.map((opt) => (
                <label key={opt.id} className="sa-pe-ship-option">
                  <input
                    type="radio"
                    name="shipMode"
                    checked={form.shippingMode === opt.id}
                    onChange={() => setForm((f) => ({ ...f, shippingMode: opt.id }))}
                  />
                  <span>
                    <strong>{opt.title}</strong>
                    <small>{opt.sub}</small>
                  </span>
                </label>
              ))}
            </div>
            {form.shippingMode === SHIPPING_MODE.REGION ? (
              <label className="loja-admin-field loja-admin-field--full" style={{ marginTop: 14, maxWidth: '100%' }}>
                Tabela (região: valor em R$)
                <textarea
                  rows={6}
                  value={form.regionShippingText}
                  onChange={(e) => setForm((f) => ({ ...f, regionShippingText: e.target.value }))}
                />
              </label>
            ) : null}
            {form.shippingMode === SHIPPING_MODE.FIXED || form.shippingMode === SHIPPING_MODE.API ? (
              <label className="loja-admin-field" style={{ marginTop: 12 }}>
                Frete grátis acima de (R$) — este produto
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.freeShippingThresholdBrl}
                  onChange={(e) => setForm((f) => ({ ...f, freeShippingThresholdBrl: Number(e.target.value || 0) }))}
                />
              </label>
            ) : null}
          </section>

          <section className="sa-pe-block">
            <h2 className="sa-pe-block__title">Estoque e arquivos internos</h2>
            <div className="loja-admin-toggle-row">
              <label>
                <input
                  type="radio"
                  checked={form.inventoryMode === INVENTORY_MODE.ON_DEMAND}
                  onChange={() => setForm((f) => ({ ...f, inventoryMode: INVENTORY_MODE.ON_DEMAND }))}
                />{' '}
                Sob demanda
              </label>
              <label>
                <input
                  type="radio"
                  checked={form.inventoryMode === INVENTORY_MODE.FIXED}
                  onChange={() => setForm((f) => ({ ...f, inventoryMode: INVENTORY_MODE.FIXED }))}
                />{' '}
                Estoque fixo
              </label>
            </div>
            {form.inventoryMode === INVENTORY_MODE.FIXED ? (
              <label className="loja-admin-field">
                Quantidade
                <input
                  type="number"
                  min={0}
                  value={form.stock}
                  onChange={(e) => setForm((f) => ({ ...f, stock: Number(e.target.value || 0) }))}
                />
              </label>
            ) : (
              <p className="loja-admin-hint">Produção disparada após a compra.</p>
            )}
            <div className="sa-pe-upload-zone" style={{ marginTop: 14 }}>
              <p className="sa-pe-upload-zone__title">PDF do miolo (opcional)</p>
              <label className="sa-pe-file-trigger">
                <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => setPdfFile(e.target.files?.[0] || null)} />
                Enviar PDF
              </label>
              {pdfFile ? <p className="loja-admin-hint">{pdfFile.name}</p> : null}
              {!pdfFile && form.mioloPdfUrl ? (
                <p className="loja-admin-hint">
                  Arquivo atual ligado. Envie outro PDF para substituir.
                </p>
              ) : null}
            </div>
          </section>

          {!isMangaka ? (
            <details className="sa-pe-details">
              <summary>Avançado — atribuir a outro criador</summary>
              <label className="loja-admin-field loja-admin-field--full" style={{ marginTop: 10, maxWidth: '100%' }}>
                UID do criador (Firebase)
                <input
                  value={form.creatorId}
                  onChange={(e) => setForm((f) => ({ ...f, creatorId: e.target.value }))}
                  placeholder="Deixe vazio para não definir"
                  autoComplete="off"
                />
              </label>
            </details>
          ) : null}

          <div className="loja-admin-actions" style={{ marginTop: 20 }}>
            <button type="button" className="loja-admin-btn-primary" onClick={saveProduct}>
              {editingId ? 'Salvar alterações' : 'Criar produto'}
            </button>
            <button type="button" onClick={() => navigate(productsBase)}>
              Cancelar
            </button>
          </div>
        </div>

        <aside className="sa-pe-aside">
          <div className="sa-pe-aside-preview">
            <div className="sa-pe-aside-preview__img">
              {displayCover ? <img src={displayCover} alt="" /> : <span className="loja-admin-hint">Preview da capa</span>}
            </div>
            <div className="sa-pe-aside-preview__body">
              <p style={{ margin: 0, fontWeight: 700, color: '#eee' }}>{form.title || 'Nome do produto'}</p>
              <p className="loja-admin-hint" style={{ marginTop: 8 }}>
                {form.description || 'Descrição aparece aqui.'}
              </p>
              <p className="sa-pe-aside-price">{formatBRL(effectivePrice)}</p>
              <p className={`sa-pe-aside-profit ${profitBrl < 0 ? 'is-negative' : ''}`}>{formatBRL(profitBrl)} lucro</p>
              <p className="sa-pe-aside-cost">Custo {formatBRL(form.costPrice)} · {Number(form.weightGrams || 0)} g</p>
            </div>
          </div>
          <article className="loja-admin-finance-card">
            <h3>Resumo</h3>
            <dl>
              <div>
                <dt>Frete (modo)</dt>
                <dd>
                  {form.shippingMode === SHIPPING_MODE.API
                    ? 'Automático'
                    : form.shippingMode === SHIPPING_MODE.REGION
                      ? `${Object.keys(regionalShipping).length || 0} regiões`
                      : 'Fixo'}
                </dd>
              </div>
              <div>
                <dt>Estoque</dt>
                <dd>{form.inventoryMode === INVENTORY_MODE.ON_DEMAND ? 'Sob demanda' : `${Number(form.stock || 0)} un.`}</dd>
              </div>
              <div>
                <dt>Grátis acima</dt>
                <dd>{formatBRL(form.freeShippingThresholdBrl)}</dd>
              </div>
            </dl>
          </article>
        </aside>
      </div>
    </main>
  );
}
