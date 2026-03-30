import React, { useEffect, useMemo, useState } from 'react';
import { onValue, push, ref, remove, set, update } from 'firebase/database';

import { db } from '../../services/firebase';
import { normalizeStoreConfig, STORE_DEFAULT_CONFIG } from '../../config/store';
import './LojaAdmin.css';

const EMPTY_PRODUCT = {
  title: '',
  description: '',
  price: 0,
  stock: 0,
  image: '',
  isActive: true,
  isOnSale: false,
  promoPrice: 0,
  isVIPDiscountEnabled: true,
};

export default function LojaAdmin() {
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [editingId, setEditingId] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    const unsubCfg = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    const unsubProducts = onValue(ref(db, 'loja/produtos'), (snap) => {
      const list = Object.entries(snap.exists() ? snap.val() : {}).map(([id, v]) => ({ id, ...(v || {}) }));
      setProducts(list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));
    });
    const unsubOrders = onValue(ref(db, 'loja/pedidos'), (snap) => {
      const list = Object.entries(snap.exists() ? snap.val() : {}).map(([id, v]) => ({ id, ...(v || {}) }));
      setOrders(list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)));
    });
    return () => {
      unsubCfg();
      unsubProducts();
      unsubOrders();
    };
  }, []);

  const totals = useMemo(() => {
    return orders.reduce(
      (acc, order) => {
        acc.total += Number(order.total || 0);
        if (order.status === 'paid') acc.paid += Number(order.total || 0);
        if (order.status === 'pending') acc.pending += 1;
        return acc;
      },
      { total: 0, paid: 0, pending: 0 }
    );
  }, [orders]);

  async function saveConfig(patch) {
    await update(ref(db, 'loja/config'), { ...patch, updatedAt: Date.now() });
    setOk('Configuração da loja salva.');
    setTimeout(() => setOk(''), 2200);
  }

  async function saveProduct() {
    const now = Date.now();
    const payload = {
      title: String(form.title || '').trim(),
      description: String(form.description || '').trim(),
      price: Number(form.price || 0),
      stock: Math.max(0, Number(form.stock || 0)),
      images: form.image ? [String(form.image).trim()] : [],
      isActive: form.isActive === true,
      isOnSale: form.isOnSale === true,
      promoPrice: Number(form.promoPrice || 0),
      isVIPDiscountEnabled: form.isVIPDiscountEnabled === true,
      updatedAt: now,
    };
    if (!payload.title || payload.price <= 0) return;
    if (editingId) {
      await update(ref(db, `loja/produtos/${editingId}`), payload);
    } else {
      const newRef = push(ref(db, 'loja/produtos'));
      await set(newRef, { ...payload, createdAt: now });
    }
    setForm(EMPTY_PRODUCT);
    setEditingId('');
    setOk('Produto salvo.');
    setTimeout(() => setOk(''), 2200);
  }

  return (
    <main className="loja-admin-page">
      <header className="loja-admin-head">
        <h1>Loja - Admin</h1>
        {ok ? <p>{ok}</p> : null}
      </header>

      <section className="loja-admin-kpis">
        <article><span>Pedidos pendentes</span><strong>{totals.pending}</strong></article>
        <article><span>Receita total</span><strong>R$ {totals.total.toFixed(2)}</strong></article>
        <article><span>Receita paga</span><strong>R$ {totals.paid.toFixed(2)}</strong></article>
      </section>

      <section className="loja-admin-grid">
        <article className="loja-admin-card">
          <h2>Configuração da loja</h2>
          <label><input type="checkbox" checked={config.storeEnabled} onChange={(e) => saveConfig({ storeEnabled: e.target.checked })} /> Loja ativa</label>
          <label><input type="checkbox" checked={config.storeVisibleToUsers} onChange={(e) => saveConfig({ storeVisibleToUsers: e.target.checked })} /> Visível ao público</label>
          <label><input type="checkbox" checked={config.acceptingOrders} onChange={(e) => saveConfig({ acceptingOrders: e.target.checked })} /> Aceitando pedidos</label>
          <label>
            Desconto VIP (%)
            <input
              type="number"
              min={0}
              max={60}
              value={config.vipDiscountPct}
              onChange={(e) => saveConfig({ vipDiscountPct: Number(e.target.value || 0) })}
            />
          </label>
        </article>

        <article className="loja-admin-card">
          <h2>{editingId ? 'Editar produto' : 'Novo produto'}</h2>
          <input placeholder="Nome" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <textarea placeholder="Descrição" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <input type="number" placeholder="Preço" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value || 0) }))} />
          <input type="number" placeholder="Estoque" value={form.stock} onChange={(e) => setForm((f) => ({ ...f, stock: Number(e.target.value || 0) }))} />
          <input placeholder="URL da imagem" value={form.image} onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))} />
          <label><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Ativo</label>
          <label><input type="checkbox" checked={form.isOnSale} onChange={(e) => setForm((f) => ({ ...f, isOnSale: e.target.checked }))} /> Em promoção</label>
          <input type="number" placeholder="Preço promocional" value={form.promoPrice} onChange={(e) => setForm((f) => ({ ...f, promoPrice: Number(e.target.value || 0) }))} />
          <label><input type="checkbox" checked={form.isVIPDiscountEnabled} onChange={(e) => setForm((f) => ({ ...f, isVIPDiscountEnabled: e.target.checked }))} /> Aceita desconto VIP</label>
          <div className="loja-admin-actions">
            <button type="button" onClick={saveProduct}>Salvar produto</button>
            <button type="button" onClick={() => { setForm(EMPTY_PRODUCT); setEditingId(''); }}>Limpar</button>
          </div>
        </article>
      </section>

      <section className="loja-admin-card">
        <h2>Produtos cadastrados</h2>
        <div className="loja-admin-list">
          {products.map((p) => (
            <article key={p.id}>
              <div>
                <strong>{p.title}</strong>
                <span>R$ {Number(p.price || 0).toFixed(2)} | estoque {Number(p.stock || 0)}</span>
              </div>
              <div>
                <button type="button" onClick={() => {
                  setEditingId(p.id);
                  setForm({
                    title: p.title || '',
                    description: p.description || '',
                    price: Number(p.price || 0),
                    stock: Number(p.stock || 0),
                    image: Array.isArray(p.images) ? p.images[0] || '' : '',
                    isActive: p.isActive !== false,
                    isOnSale: p.isOnSale === true,
                    promoPrice: Number(p.promoPrice || 0),
                    isVIPDiscountEnabled: p.isVIPDiscountEnabled !== false,
                  });
                }}>Editar</button>
                <button type="button" onClick={() => remove(ref(db, `loja/produtos/${p.id}`))}>Excluir</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="loja-admin-card">
        <h2>Pedidos</h2>
        <div className="loja-admin-list">
          {orders.map((o) => (
            <article key={o.id}>
              <div>
                <strong>#{o.id.slice(-8).toUpperCase()}</strong>
                <span>{o.uid} | R$ {Number(o.total || 0).toFixed(2)} | {o.status || 'pending'}</span>
              </div>
              <div>
                <button type="button" onClick={() => update(ref(db, `loja/pedidos/${o.id}`), { status: 'processing', updatedAt: Date.now() })}>Separando</button>
                <button type="button" onClick={() => update(ref(db, `loja/pedidos/${o.id}`), { status: 'shipped', updatedAt: Date.now() })}>Enviado</button>
                <button type="button" onClick={() => update(ref(db, `loja/pedidos/${o.id}`), { status: 'delivered', updatedAt: Date.now() })}>Entregue</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

