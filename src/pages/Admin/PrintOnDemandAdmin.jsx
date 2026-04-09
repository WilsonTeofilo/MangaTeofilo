import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../services/firebase';
import { addBusinessDaysLocal } from '../../utils/businessDays';
import { PRODUCTION_CHECKLIST_KEYS, formatBRL } from '../../utils/printOnDemandPricingV2';
import { formatPodStatusLabel, normalizePodStatus } from '../../utils/podStatus';
import { formatUserDisplayWithHandle } from '../../utils/publicCreatorName';
import './PrintOnDemandAdmin.css';

/** Transicoes normais (cancelamento e fluxo separado com motivo obrigatorio). */
const STATUS_TRANSITION_OPTIONS = [
  'pending_payment',
  'paid',
  'in_production',
  'ready_to_ship',
  'shipped',
  'delivered',
];

const STATUS_FILTER_OPTIONS = [...STATUS_TRANSITION_OPTIONS, 'cancelled'];

const STATUS_LABELS = {
  pending_payment: 'Pagamento pendente',
  paid: 'Pago',
  in_production: 'Em producao',
  ready_to_ship: 'Pronto p/ envio',
  shipped: 'Enviado',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

function shortId(id) {
  return String(id || '').slice(-8).toUpperCase();
}

/** Opcoes do select alinhadas as transicoes permitidas no backend (sem "pago" manual). */
function podAdminSelectableStatuses(current) {
  const c = normalizePodStatus(current);
  const m = {
    pending_payment: ['pending_payment'],
    paid: ['paid', 'in_production'],
    in_production: ['in_production', 'ready_to_ship', 'shipped'],
    ready_to_ship: ['ready_to_ship', 'shipped'],
    shipped: ['shipped', 'delivered'],
    delivered: ['delivered'],
    cancelled: ['cancelled'],
  };
  return m[c] || STATUS_TRANSITION_OPTIONS;
}

/** Mangaka monetizado vs nÃ£o (anÃ¡lise). */
function podTipoDisplay(snap) {
  const sm = String(snap?.saleModel || '');
  const k = String(snap?.creatorProductKind || '');
  if (sm === 'store_promo' || k === 'non_monetized_promo') return 'Mangaka nao monetizado';
  if (sm === 'personal' || k === 'personal_purchase') return 'â€”';
  if (k === 'monetized' || sm === 'platform') return 'Mangaka monetizado';
  return 'â€”';
}

/** Canal: uma das trÃªs formas de pedido fÃ­sico. */
function podOrigemDisplay(snap) {
  const sm = String(snap?.saleModel || '');
  if (sm === 'store_promo') return 'Modo vitrine (divulgacao)';
  if (sm === 'personal') return 'Produzir para mim';
  if (sm === 'platform') return 'Venda pela plataforma';
  return 'â€”';
}

function formatTs(ms) {
  if (!ms) return 'â€”';
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function startOfDayMs(isoDate) {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function endOfDayMs(isoDate) {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T23:59:59.999`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function productionMeta(o) {
  if (o.status === 'cancelled') {
    return { label: 'â€”', late: false, daysLeft: null, due: null, kind: '' };
  }
  const snap = o.snapshot || {};
  const kind = String(snap.estimateKind || '').trim().toLowerCase();
  const high = Number(snap.estimatedProductionDaysHigh || 0);
  const low = Number(snap.estimatedProductionDaysLow || 0);
  const created = Number(o.createdAt || 0);
  if (!high || !created) return { label: 'â€”', late: false, daysLeft: null, due: null, kind };
  const due = addBusinessDaysLocal(created, high);
  const msLeft = due - Date.now();
  const days = Math.ceil(msLeft / 86400000);
  const late =
    msLeft < 0 &&
    (kind === 'approval'
      ? o.status === 'pending_payment' || o.status === 'paid'
      : o.status === 'in_production');
  const label =
    kind === 'approval'
      ? `aprovaÃ§Ã£o ${low && high ? `${low}â€“${high} d Ãºteis` : `${high} d Ãºteis`}`
      : low && high ? `${low}â€“${high} d Ãºteis` : `${high} d Ãºteis`;
  return { label, late, daysLeft: Math.max(0, days), due, msLeft, kind };
}

export default function PrintOnDemandAdmin({ embedded = false }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatorNames, setCreatorNames] = useState({});

  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterFormat, setFilterFormat] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(true);

  const [selectedId, setSelectedId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [trackingDraft, setTrackingDraft] = useState('');
  const [cancelReasonDraft, setCancelReasonDraft] = useState('');
  const [localChecklist, setLocalChecklist] = useState(null);
  const checklistTimer = useRef(null);
  const [saving, setSaving] = useState(false);

  const [toast, setToast] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const listFn = useMemo(() => httpsCallable(functions, 'adminListPrintOnDemandOrders'), []);
  const updateFn = useMemo(() => httpsCallable(functions, 'adminUpdatePrintOnDemandOrder'), []);

  const showToast = useCallback((type, message) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await listFn();
      setOrders(Array.isArray(data?.orders) ? data.orders : []);
    } catch (e) {
      showToast('error', e?.message || 'Erro ao atualizar pedidos.');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [listFn, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const uids = [...new Set(orders.map((o) => o.creatorUid).filter(Boolean))];
    if (!uids.length) {
      setCreatorNames({});
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const next = {};
      await Promise.all(
        uids.map(async (uid) => {
          try {
            const snap = await get(ref(db, `usuarios/${uid}/publicProfile`));
            const v = snap.exists() ? snap.val() : null;
            const name = formatUserDisplayWithHandle(v);
            next[uid] = name || `${String(uid).slice(0, 8)}â€¦`;
          } catch {
            next[uid] = String(uid).slice(0, 8);
          }
        })
      );
      if (!cancelled) setCreatorNames((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [orders]);

  const selected = useMemo(() => orders.find((o) => o.id === selectedId) || null, [orders, selectedId]);

  useEffect(() => {
    if (selected) {
      setTrackingDraft(String(selected.trackingCode || ''));
      setCancelReasonDraft('');
      setLocalChecklist({ ...(selected.productionChecklist || {}) });
    } else {
      setCancelReasonDraft('');
      setLocalChecklist(null);
    }
  }, [selected?.id, selected]);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const stats = useMemo(() => {
    const pedidosHoje = orders.filter((o) => Number(o.createdAt || 0) >= todayStart).length;
    const emProducao = orders.filter((o) => o.status === 'in_production').length;
    let atrasados = 0;
    let receita = 0;
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const { late } = productionMeta(o);
      if (late) atrasados += 1;
      const snap = o.snapshot || {};
      if (snap.amountDueBRL != null) receita += Number(snap.amountDueBRL) || 0;
    }
    return { pedidosHoje, emProducao, atrasados, receita };
  }, [orders, todayStart]);

  useEffect(() => {
    if (selectedId && !orders.some((o) => o.id === selectedId)) {
      setSelectedId(null);
      setDrawerOpen(false);
    }
  }, [orders, selectedId]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const fromMs = startOfDayMs(dateFrom);
    const toMs = endOfDayMs(dateTo);

    return orders.filter((o) => {
      if (filterStatus && String(o.status) !== filterStatus) return false;
      const sm = String(o.snapshot?.saleModel || '');
      if (filterType && sm !== filterType) return false;
      const fmt = String(o.snapshot?.format || '');
      if (filterFormat && fmt !== filterFormat) return false;
      const created = Number(o.createdAt || 0);
      if (fromMs != null && created < fromMs) return false;
      if (toMs != null && created > toMs) return false;
      if (q) {
        const idMatch = String(o.id || '').toLowerCase().includes(q) || shortId(o.id).toLowerCase().includes(q);
        const uid = String(o.creatorUid || '');
        const name = String(creatorNames[uid] || '').toLowerCase();
        const nameMatch = uid.toLowerCase().includes(q) || name.includes(q);
        if (!idMatch && !nameMatch) return false;
      }
      return true;
    });
  }, [orders, filterStatus, filterType, filterFormat, dateFrom, dateTo, searchQuery, creatorNames]);

  const openDrawer = (id) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  useEffect(() => {
    if (!confirmModal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) setConfirmModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmModal, saving]);

  const persistChecklist = useCallback(
    async (orderId, checklistObj) => {
      setSaving(true);
      try {
        await updateFn({ orderId, productionChecklist: checklistObj });
        showToast('success', 'Checklist salvo.');
        await load();
      } catch (e) {
        showToast('error', e?.message || 'Erro ao salvar checklist.');
      } finally {
        setSaving(false);
      }
    },
    [updateFn, load, showToast]
  );

  const onChecklistChange = (key, checked) => {
    if (!selected || selected.status === 'cancelled') return;
    const base = { ...localChecklist };
    PRODUCTION_CHECKLIST_KEYS.forEach(({ key: k }) => {
      if (base[k] == null) base[k] = false;
    });
    const next = { ...base, [key]: checked };
    setLocalChecklist(next);
    if (checklistTimer.current) window.clearTimeout(checklistTimer.current);
    checklistTimer.current = window.setTimeout(() => {
      persistChecklist(selected.id, next);
    }, 550);
  };

  const requestStatusChange = (orderId, nextStatus) => {
    const row = orders.find((o) => o.id === orderId);
    if (!row || row.status === nextStatus) return;
    if (row.status === 'cancelled') {
      showToast('error', 'Pedido cancelado: use apenas a visualizaÃ§Ã£o deste painel.');
      return;
    }
    setConfirmModal({ type: 'status', orderId, from: row.status, to: nextStatus });
  };

  const executeStatusChange = async () => {
    if (!confirmModal || confirmModal.type !== 'status') return;
    setSaving(true);
    try {
      await updateFn({ orderId: confirmModal.orderId, status: confirmModal.to });
      showToast('success', 'Status atualizado com sucesso.');
      setConfirmModal(null);
      await load();
    } catch (e) {
      showToast('error', e?.message || 'Erro ao atualizar pedido.');
    } finally {
      setSaving(false);
    }
  };

  const openCancelConfirmModal = () => {
    if (!selected || selected.status === 'cancelled') return;
    const reason = cancelReasonDraft.trim();
    if (reason.length < 3) {
      showToast('error', 'Informe o motivo do cancelamento (mÃ­nimo 3 caracteres).');
      return;
    }
    setConfirmModal({ type: 'cancel' });
  };

  const executeCancelOrder = async () => {
    if (!selected || selected.status === 'cancelled' || confirmModal?.type !== 'cancel') return;
    const reason = cancelReasonDraft.trim();
    if (reason.length < 3) return;
    setSaving(true);
    try {
      await updateFn({ orderId: selected.id, status: 'cancelled', cancellationReason: reason });
      showToast('success', 'Pedido cancelado.');
      setCancelReasonDraft('');
      setConfirmModal(null);
      await load();
    } catch (e) {
      showToast('error', e?.message || 'Erro ao cancelar pedido.');
    } finally {
      setSaving(false);
    }
  };

  const saveTracking = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateFn({ orderId: selected.id, trackingCode: trackingDraft });
      showToast('success', 'Rastreio salvo.');
      await load();
    } catch (e) {
      showToast('error', e?.message || 'Erro ao salvar rastreio.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`po-orders${embedded ? ' po-orders--embedded' : ''}`}>
      {toast ? (
        <div className={`po-toast po-toast--${toast.type}`} role="status">
          {toast.message}
        </div>
      ) : null}

      {!embedded ? (
        <aside className="po-orders__sidebar" aria-label="NavegaÃ§Ã£o admin">
          <Link to="/admin" className="po-orders__side-link">
            â† Painel admin
          </Link>
          <Link to="/admin/pedidos" className="po-orders__side-link">
            Pedidos da loja
          </Link>
          <Link to="/admin/products" className="po-orders__side-link">
            Produtos
          </Link>
        </aside>
      ) : null}

      <div className="po-orders__main">
        <header className="po-orders__header">
          <div className="po-orders__header-text">
            <h1>Pedidos de produÃ§Ã£o</h1>
            <p>Gerencie produÃ§Ã£o, envio e status dos mangÃ¡s fÃ­sicos</p>
          </div>
          <div className="po-orders__header-actions">
            <button type="button" className="po-btn po-btn--primary" onClick={load} disabled={loading}>
              {loading ? 'Atualizandoâ€¦' : 'Atualizar'}
            </button>
            <button
              type="button"
              className="po-btn po-btn--ghost"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
            >
              Filtrar
            </button>
          </div>
        </header>

        <div className="po-orders__search">
          <label className="po-search">
            <span className="po-visually-hidden">Buscar pedido</span>
            <input
              type="search"
              placeholder="Buscar por ID ou nome do criadorâ€¦"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
            />
          </label>
        </div>

        <section className="po-orders__cards" aria-label="Resumo">
          <article className="po-card">
            <span className="po-card__label">Pedidos hoje</span>
            <strong className="po-card__value">{stats.pedidosHoje}</strong>
          </article>
          <article className="po-card">
            <span className="po-card__label">Em producao</span>
            <strong className="po-card__value">{stats.emProducao}</strong>
          </article>
          <article className="po-card">
            <span className="po-card__label">Atrasados</span>
            <strong className="po-card__value po-card__value--warn">{stats.atrasados}</strong>
          </article>
          <article className="po-card">
            <span className="po-card__label">Receita total (registrada)</span>
            <strong className="po-card__value">{formatBRL(stats.receita)}</strong>
          </article>
        </section>

        {filtersOpen ? (
          <div className="po-orders__filters">
            <label>
              Status
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">Todos</option>
                {STATUS_FILTER_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s] || s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Canal de venda
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">Todos</option>
                <option value="platform">Venda pela plataforma</option>
                <option value="personal">Produzir para mim</option>
                <option value="store_promo">Modo vitrine (divulgacao)</option>
              </select>
            </label>
            <label>
              Modelo
              <select value={filterFormat} onChange={(e) => setFilterFormat(e.target.value)}>
                <option value="">Todos</option>
                <option value="tankobon">TankÅbon</option>
                <option value="meio_tanko">Meio-TankÅ</option>
              </select>
            </label>
            <label>
              De
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              AtÃ©
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
          </div>
        ) : null}

        <div className="po-orders__table-wrap po-orders__table-wrap--desktop">
          <table className="po-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Criador</th>
                <th>Modelo</th>
                <th>MonetizaÃ§Ã£o (autor)</th>
                <th>Canal do pedido</th>
                <th>Qtd</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Prazo</th>
                <th className="po-table__col-actions">AÃ§Ãµes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const snap = o.snapshot || {};
                const total = snap.amountDueBRL != null ? formatBRL(snap.amountDueBRL) : 'â€”';
                const pm = productionMeta(o);
                const uid = o.creatorUid;
                const creatorLabel = creatorNames[uid] || `${String(uid || '').slice(0, 8)}â€¦`;
                return (
                  <tr
                    key={o.id}
                    className={selectedId === o.id ? 'is-active' : ''}
                    onClick={() => openDrawer(o.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openDrawer(o.id);
                      }
                    }}
                  >
                    <td className="po-table__mono">#{shortId(o.id)}</td>
                    <td title={uid}>{creatorLabel}</td>
                    <td>{snap.format === 'meio_tanko' ? 'Meio-TankÅ' : 'TankÅbon'}</td>
                    <td>{podTipoDisplay(snap)}</td>
                    <td>{podOrigemDisplay(snap)}</td>
                    <td>{snap.quantity}</td>
                    <td>{total}</td>
                    <td>
                      <span className={`po-badge po-badge--${normalizePodStatus(o.status)}`}>{formatPodStatusLabel(o.status)}</span>
                    </td>
                    <td>
                      <span className={pm.late ? 'po-prazo po-prazo--late' : 'po-prazo'}>{pm.label}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="po-link-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDrawer(o.id);
                        }}
                      >
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="po-orders__mobile-list" role="list">
          {filtered.map((o) => {
            const snap = o.snapshot || {};
            const pm = productionMeta(o);
            const uid = o.creatorUid;
            const creatorLabel = creatorNames[uid] || `${String(uid || '').slice(0, 8)}â€¦`;
            return (
              <button
                key={o.id}
                type="button"
                className="po-mobile-card"
                onClick={() => openDrawer(o.id)}
              >
                <div className="po-mobile-card__top">
                  <span className="po-table__mono">#{shortId(o.id)}</span>
                  <span className={`po-badge po-badge--${normalizePodStatus(o.status)}`}>{formatPodStatusLabel(o.status)}</span>
                </div>
                <div className="po-mobile-card__meta">
                  {podTipoDisplay(snap)} Â· {podOrigemDisplay(snap)}
                </div>
                <div className="po-mobile-card__meta po-mobile-card__meta--second">
                  {creatorLabel} Â· {snap.quantity} un Â· {snap.amountDueBRL != null ? formatBRL(snap.amountDueBRL) : 'â€”'}
                </div>
                <div className="po-mobile-card__foot">Prazo: {pm.label}</div>
              </button>
            );
          })}
        </div>

        {!loading && filtered.length === 0 ? (
          <p className="po-empty">Nenhum pedido com estes filtros.</p>
        ) : null}
      </div>

      {drawerOpen ? (
        <div
          className="po-drawer-backdrop"
          role="presentation"
          onClick={closeDrawer}
          onKeyDown={(e) => e.key === 'Escape' && closeDrawer()}
        />
      ) : null}

      <aside
        className={`po-drawer ${drawerOpen ? 'is-open' : ''}`}
        aria-hidden={!drawerOpen}
        id="po-drawer-panel"
      >
        {!selected ? (
          <p className="po-empty">Selecione um pedido.</p>
        ) : (
          <div className="po-drawer__inner">
            <div className="po-drawer__head">
              <h2>Pedido #{shortId(selected.id)}</h2>
              <button type="button" className="po-drawer__close" onClick={closeDrawer} aria-label="Fechar">
                Ã—
              </button>
            </div>

            <div className="po-drawer__scroll">
              <section className="po-drawer__section">
                <h3>InformaÃ§Ãµes gerais</h3>
                <dl className="po-dl">
                  <dt>ID completo</dt>
                  <dd className="po-table__mono">{selected.id}</dd>
                  <dt>Criador</dt>
                  <dd>{creatorNames[selected.creatorUid] || selected.creatorUid}</dd>
                  <dt>UID</dt>
                  <dd className="po-table__mono">{selected.creatorUid}</dd>
                  <dt>MonetizaÃ§Ã£o do autor</dt>
                  <dd>{podTipoDisplay(selected.snapshot)}</dd>
                  <dt>Canal do pedido</dt>
                  <dd>{podOrigemDisplay(selected.snapshot)}</dd>
                  <dt>saleModel (raw)</dt>
                  <dd className="po-table__mono">{String(selected.snapshot?.saleModel || 'â€”')}</dd>
                  <dt>creatorProductKind</dt>
                  <dd className="po-table__mono">{String(selected.snapshot?.creatorProductKind || 'â€”')}</dd>
                  <dt>Modelo</dt>
                  <dd>{selected.snapshot?.format === 'meio_tanko' ? 'Meio-TankÅ' : 'TankÅbon'}</dd>
                  <dt>Quantidade</dt>
                  <dd>{selected.snapshot?.quantity}</dd>
                  {selected.linkedWorkId || selected.snapshot?.linkedWorkId ? (
                    <>
                      <dt>Obra vinculada</dt>
                      <dd className="po-table__mono">
                        {String(selected.linkedWorkId || selected.snapshot?.linkedWorkId || '')}
                      </dd>
                    </>
                  ) : null}
                  {selected.snapshot?.storePromoMetrics ? (
                    <>
                      <dt>MÃ©tricas (divulgaÃ§Ã£o)</dt>
                      <dd>
                        Seguidores: {selected.snapshot.storePromoMetrics.followers} /{' '}
                        {selected.snapshot.storePromoMetrics.thresholds?.followers ?? 'â€”'} Â· Views:{' '}
                        {selected.snapshot.storePromoMetrics.views} /{' '}
                        {selected.snapshot.storePromoMetrics.thresholds?.views ?? 'â€”'} Â· Likes:{' '}
                        {selected.snapshot.storePromoMetrics.likes} /{' '}
                        {selected.snapshot.storePromoMetrics.thresholds?.likes ?? 'â€”'}
                      </dd>
                    </>
                  ) : null}
                  {selected.snapshot?.unitSalePriceBRL != null ? (
                    <>
                      <dt>PreÃ§o unitÃ¡rio (loja)</dt>
                      <dd>{formatBRL(selected.snapshot.unitSalePriceBRL)}</dd>
                    </>
                  ) : null}
                  <dt>Valor total / produÃ§Ã£o</dt>
                  <dd>{formatBRL(selected.snapshot?.amountDueBRL)}</dd>
                  {selected.snapshot?.creatorProfitPerSoldUnitBRL != null ? (
                    <>
                      <dt>Lucro por unidade vendida</dt>
                      <dd>{formatBRL(selected.snapshot.creatorProfitPerSoldUnitBRL)}</dd>
                      <dt>Lucro se vender tudo</dt>
                      <dd>{formatBRL(selected.snapshot.creatorProfitTotalIfAllSoldBRL)}</dd>
                    </>
                  ) : null}
                  <dt>Criado em</dt>
                  <dd>{formatTs(selected.createdAt)}</dd>
                </dl>
              </section>

              <section className="po-drawer__section">
                <h3>Arquivos</h3>
                <div className="po-drawer__file-actions">
                  <a className="po-btn po-btn--ghost po-btn--sm" href={selected.pdfUrl} target="_blank" rel="noopener noreferrer">
                    Ver PDF do miolo
                  </a>
                  <a className="po-btn po-btn--ghost po-btn--sm" href={selected.coverUrl} target="_blank" rel="noopener noreferrer">
                    Ver capa
                  </a>
                </div>
                <div className="po-drawer__preview">
                  <p className="po-drawer__preview-label">PrÃ©-visualizaÃ§Ã£o da capa</p>
                  <img src={selected.coverUrl} alt="" className="po-drawer__cover-img" />
                </div>
                <div className="po-drawer__preview po-drawer__preview--pdf">
                  <p className="po-drawer__preview-label">PrÃ©-visualizaÃ§Ã£o do miolo (se o navegador permitir)</p>
                  <iframe title="PDF miolo" src={selected.pdfUrl} className="po-drawer__iframe" />
                </div>
              </section>

              <section className="po-drawer__section">
                <h3>ProduÃ§Ã£o</h3>
                <p className="po-drawer__hint">AlteraÃ§Ãµes sÃ£o salvas automaticamente apÃ³s uma breve pausa.</p>
                <ul className="po-checklist">
                  {PRODUCTION_CHECKLIST_KEYS.map(({ key, label }) => (
                    <li key={key}>
                      <label className="po-check-item">
                        <input
                          type="checkbox"
                          checked={Boolean(localChecklist?.[key])}
                          onChange={(e) => onChecklistChange(key, e.target.checked)}
                          disabled={saving || selected.status === 'cancelled'}
                        />
                        {label}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="po-drawer__section">
                <h3>Prazo</h3>
                <p>
                  Prazo estimado:{' '}
                  <strong>
                    {selected.snapshot?.estimatedProductionDaysLow}â€“{selected.snapshot?.estimatedProductionDaysHigh} dias Ãºteis
                  </strong>
                </p>
                {selected.snapshot?.estimatedProductionHours ? (
                  <p>Tempo manual previsto: <strong>{selected.snapshot.estimatedProductionHours} h</strong></p>
                ) : null}
                {(() => {
                  const pm = productionMeta(selected);
                  if (pm.due == null) return null;
                  return (
                    <p className={pm.late ? 'po-prazo po-prazo--late' : ''}>
                      {pm.late
                        ? `Atrasado: teto (dias Ãºteis) era ${new Date(pm.due).toLocaleDateString('pt-BR')}.`
                        : `Tempo restante atÃ© o teto (~dias corridos): ~${pm.daysLeft} dia(s).`}
                    </p>
                  );
                })()}
              </section>

              <section className="po-drawer__section">
                <h3>Envio</h3>
                {selected.shippingAddress?.street ? (
                  <address className="po-drawer__addr">
                    {selected.shippingAddress.name}
                    <br />
                    {selected.shippingAddress.street}
                    <br />
                    {selected.shippingAddress.city} / {selected.shippingAddress.state} â€” CEP {selected.shippingAddress.zip}
                    {selected.shippingAddress.complement ? (
                      <>
                        <br />
                        {selected.shippingAddress.complement}
                      </>
                    ) : null}
                  </address>
                ) : (
                  <p className="po-drawer__hint">Sem endereÃ§o obrigatÃ³rio neste pedido.</p>
                )}
                <label className="po-field">
                  CÃ³digo de rastreio
                  <input
                    value={trackingDraft}
                    onChange={(e) => setTrackingDraft(e.target.value)}
                    placeholder="BR123456789BR"
                    disabled={selected.status === 'cancelled'}
                  />
                </label>
                <button
                  type="button"
                  className="po-btn po-btn--primary po-btn--sm"
                  onClick={saveTracking}
                  disabled={saving || selected.status === 'cancelled'}
                >
                  Salvar rastreio
                </button>
              </section>

              <section className="po-drawer__section">
                <h3>Status do pedido</h3>
                {selected.status === 'cancelled' ? (
                  <>
                    <p className="po-drawer__hint">
                      Status: <strong>{STATUS_LABELS.cancelled}</strong>
                    </p>
                    {selected.adminCancellationReason ? (
                      <div className="po-drawer__cancel-note">
                        <strong>Motivo registrado</strong>
                        <p>{String(selected.adminCancellationReason)}</p>
                        {selected.cancelledAt ? (
                          <p className="po-drawer__hint">Em {formatTs(selected.cancelledAt)}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <label className="po-field">
                      Alterar para
                      <select
                        value={selected.status}
                        onChange={(e) => requestStatusChange(selected.id, e.target.value)}
                        disabled={saving}
                      >
                        {podAdminSelectableStatuses(selected.status).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s] || s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="po-drawer__hint">Cada mudanÃ§a pede confirmaÃ§Ã£o antes de gravar.</p>
                  </>
                )}
              </section>

              {selected.status !== 'cancelled' ? (
                <section className="po-drawer__section po-drawer__section--danger">
                  <h3>Cancelar pedido</h3>
                  <p className="po-drawer__hint">
                    Use para pedidos antigos sem pagamento ou quando nÃ£o houver como concluir a produÃ§Ã£o. O motivo Ã©
                    enviado ao criador na notificaÃ§Ã£o.
                  </p>
                  <label className="po-field">
                    Motivo (obrigatÃ³rio)
                    <textarea
                      className="po-drawer__textarea"
                      rows={4}
                      value={cancelReasonDraft}
                      onChange={(e) => setCancelReasonDraft(e.target.value)}
                      placeholder="Ex.: Pedido criado antes do checkout; sem pagamento registrado â€” encerrado administrativamente."
                      disabled={saving}
                      maxLength={2000}
                    />
                  </label>
                  <button
                    type="button"
                    className="po-btn po-btn--danger po-btn--sm"
                    onClick={openCancelConfirmModal}
                    disabled={saving || cancelReasonDraft.trim().length < 3}
                  >
                    Cancelar pedido e notificar criador
                  </button>
                </section>
              ) : null}
            </div>
          </div>
        )}
      </aside>

      {confirmModal ? (
        <div
          className="po-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!saving) setConfirmModal(null);
          }}
        >
          <div
            className="po-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="po-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            {confirmModal.type === 'status' ? (
              <>
                <h2 id="po-modal-title" className="po-modal__title">
                  Confirmar mudanÃ§a de status
                </h2>
                <p className="po-modal__body">
                  Alterar de <strong>{STATUS_LABELS[confirmModal.from] || confirmModal.from}</strong> para{' '}
                  <strong>{STATUS_LABELS[confirmModal.to] || confirmModal.to}</strong>?
                </p>
                <div className="po-modal__actions">
                  <button type="button" className="po-btn po-btn--ghost" onClick={() => setConfirmModal(null)} disabled={saving}>
                    Voltar
                  </button>
                  <button type="button" className="po-btn po-btn--primary" onClick={executeStatusChange} disabled={saving}>
                    {saving ? 'Salvandoâ€¦' : 'Confirmar'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="po-modal-title" className="po-modal__title">
                  Cancelar pedido fÃ­sico
                </h2>
                <p className="po-modal__body">
                  O criador recebe uma notificaÃ§Ã£o com o motivo que vocÃª informou abaixo. Esta aÃ§Ã£o nÃ£o desfaz pagamentos
                  no Mercado Pago automaticamente.
                </p>
                <p className="po-modal__preview">{cancelReasonDraft.trim()}</p>
                <div className="po-modal__actions">
                  <button type="button" className="po-btn po-btn--ghost" onClick={() => setConfirmModal(null)} disabled={saving}>
                    Voltar
                  </button>
                  <button type="button" className="po-btn po-btn--danger" onClick={executeCancelOrder} disabled={saving}>
                    {saving ? 'Cancelandoâ€¦' : 'Sim, cancelar pedido'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}


