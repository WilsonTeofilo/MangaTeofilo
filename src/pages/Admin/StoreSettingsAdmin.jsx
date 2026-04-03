import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { onValue, ref, update } from 'firebase/database';

import { db } from '../../services/firebase';
import { normalizeStoreConfig, STORE_DEFAULT_CONFIG } from '../../config/store';
import './LojaAdmin.css';
import './StoreAdminLayout.css';

export default function StoreSettingsAdmin() {
  const [config, setConfig] = useState(STORE_DEFAULT_CONFIG);
  const [msg, setMsg] = useState('');
  const [heroOpen, setHeroOpen] = useState(false);
  const [shipIn, setShipIn] = useState(null);
  const [thanksIn, setThanksIn] = useState(null);
  const [heroEyebrowIn, setHeroEyebrowIn] = useState(null);
  const [heroTitleIn, setHeroTitleIn] = useState(null);
  const [heroSubtitleIn, setHeroSubtitleIn] = useState(null);

  useEffect(() => {
    const unsub = onValue(ref(db, 'loja/config'), (snap) => {
      setConfig(normalizeStoreConfig(snap.exists() ? snap.val() : STORE_DEFAULT_CONFIG));
    });
    return () => unsub();
  }, []);

  async function save(patch) {
    await update(ref(db, 'loja/config'), { ...patch, updatedAt: Date.now() });
    setMsg('Salvo.');
    setTimeout(() => setMsg(''), 2200);
  }

  async function saveShippingBlock() {
    await save({
      fixedShippingBrl: Math.max(0, Number(shipIn ?? config.fixedShippingBrl ?? 0)),
      freeShippingThresholdBrl: Math.max(0, Number(config.freeShippingThresholdBrl ?? 150)),
      postPurchaseThanks: String(thanksIn ?? config.postPurchaseThanks ?? '').trim(),
    });
  }

  async function saveHeroBlock() {
    await save({
      heroEyebrow: String(heroEyebrowIn ?? config.heroEyebrow ?? '').trim(),
      heroTitle: String(heroTitleIn ?? config.heroTitle ?? '').trim(),
      heroSubtitle: String(heroSubtitleIn ?? config.heroSubtitle ?? '').trim(),
    });
  }

  return (
    <main className="loja-admin-page store-admin-settings">
      <header className="loja-admin-head store-admin-head">
        <div>
          <nav className="store-admin-breadcrumb" aria-label="Navegação">
            <Link to="/admin/products">Produtos</Link>
            <span aria-hidden="true">/</span>
            <span>Configuração global</span>
          </nav>
          <h1>Configuração da loja</h1>
          <p className="store-admin-lead">
            Ajustes da vitrine e frete padrão. Cadastro de produtos fica em outra tela.
          </p>
          {msg ? <p className="store-admin-toast">{msg}</p> : null}
        </div>
        <Link to="/admin/products" className="loja-admin-link-pedidos">
          ← Voltar aos produtos
        </Link>
      </header>

      <section className="store-settings-section">
        <h2 className="store-settings-section__title">Loja</h2>
        <div className="store-settings-checkgrid">
          <label className="store-settings-check">
            <input
              type="checkbox"
              checked={config.storeEnabled}
              onChange={(e) => save({ storeEnabled: e.target.checked })}
            />
            <span>Loja ativa</span>
          </label>
          <label className="store-settings-check">
            <input
              type="checkbox"
              checked={config.storeVisibleToUsers}
              onChange={(e) => save({ storeVisibleToUsers: e.target.checked })}
            />
            <span>Visível ao público</span>
          </label>
          <label className="store-settings-check">
            <input
              type="checkbox"
              checked={config.acceptingOrders}
              onChange={(e) => save({ acceptingOrders: e.target.checked })}
            />
            <span>Aceitando pedidos</span>
          </label>
        </div>
      </section>

      <section className="store-settings-section">
        <h2 className="store-settings-section__title">Frete (padrão da plataforma)</h2>
        <p className="loja-admin-hint" style={{ marginBottom: 12 }}>
          Define o modo usado quando o produto não sobrescreve o frete. Produtos podem escolher outro modo na ficha.
        </p>
        <div className="store-settings-radio-stack">
          {[
            { id: 'api', label: 'Automático (recomendado)', sub: 'PAC/SEDEX estimados por peso e região' },
            { id: 'region', label: 'Por região', sub: 'Tabela por macro-região (configurável por produto)' },
            { id: 'fixed', label: 'Fixo', sub: 'Valor único + complemento por kg' },
          ].map((opt) => (
            <label key={opt.id} className="store-settings-radio-card">
              <input
                type="radio"
                name="defaultShippingMode"
                checked={config.defaultShippingMode === opt.id}
                onChange={() => save({ defaultShippingMode: opt.id })}
              />
              <span>
                <strong>{opt.label}</strong>
                <small>{opt.sub}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="store-settings-fieldgrid" style={{ marginTop: 16 }}>
          <label className="loja-admin-field">
            Frete grátis acima de (R$)
            <input
              type="number"
              min={0}
              step={0.01}
              value={config.freeShippingThresholdBrl ?? 150}
              onChange={(e) => save({ freeShippingThresholdBrl: Number(e.target.value || 0) })}
            />
          </label>
          {config.defaultShippingMode === 'fixed' ? (
            <label className="loja-admin-field">
              Frete fixo base (R$)
              <input
                type="number"
                min={0}
                step={0.01}
                value={shipIn ?? config.fixedShippingBrl ?? 0}
                onChange={(e) => setShipIn(Number(e.target.value || 0))}
              />
            </label>
          ) : null}
        </div>
        <label className="loja-admin-field loja-admin-field--full" style={{ marginTop: 14, maxWidth: '100%' }}>
          Mensagem após pagamento (site)
          <textarea
            rows={3}
            value={thanksIn ?? config.postPurchaseThanks ?? ''}
            onChange={(e) => setThanksIn(e.target.value)}
            placeholder="Ex.: Obrigado pela compra..."
          />
        </label>
        <button type="button" className="loja-admin-btn-primary" style={{ marginTop: 12 }} onClick={saveShippingBlock}>
          Salvar valores de frete e mensagem
        </button>
      </section>

      <section className="store-settings-section">
        <h2 className="store-settings-section__title">Desconto</h2>
        <label className="loja-admin-field">
          Desconto VIP (%)
          <input
            type="number"
            min={0}
            max={60}
            value={config.vipDiscountPct}
            onChange={(e) => save({ vipDiscountPct: Number(e.target.value || 0) })}
          />
        </label>
      </section>

      <section className="store-settings-section store-settings-section--accordion">
        <button
          type="button"
          className="store-settings-accordion-trigger"
          aria-expanded={heroOpen}
          onClick={() => setHeroOpen((v) => !v)}
        >
          <span>Hero da vitrine (visual)</span>
          <span className="store-settings-accordion-chevron">{heroOpen ? '▾' : '▸'}</span>
        </button>
        {heroOpen ? (
          <div className="store-settings-accordion-panel">
            <p className="loja-admin-hint">Textos do bloco principal da página pública da loja.</p>
            <label className="loja-admin-field loja-admin-field--full" style={{ maxWidth: '100%' }}>
              Linha acima do título (eyebrow)
              <input
                value={heroEyebrowIn ?? config.heroEyebrow ?? ''}
                onChange={(e) => setHeroEyebrowIn(e.target.value)}
                placeholder="Marca · coleção"
              />
            </label>
            <label className="loja-admin-field loja-admin-field--full" style={{ maxWidth: '100%' }}>
              Título principal
              <input
                value={heroTitleIn ?? config.heroTitle ?? ''}
                onChange={(e) => setHeroTitleIn(e.target.value)}
              />
            </label>
            <label className="loja-admin-field loja-admin-field--full" style={{ maxWidth: '100%' }}>
              Subtítulo
              <textarea
                rows={2}
                value={heroSubtitleIn ?? config.heroSubtitle ?? ''}
                onChange={(e) => setHeroSubtitleIn(e.target.value)}
              />
            </label>
            <button type="button" className="loja-admin-btn-primary" onClick={saveHeroBlock}>
              Salvar hero
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
