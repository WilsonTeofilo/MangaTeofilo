import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Link, useParams } from 'react-router-dom';

import OrderTimeline from '../../components/orders/OrderTimeline';
import { storeOrderBadgeProps } from '../../components/orders/storeOrderBadge';
import '../../components/orders/OrderTracking.css';
import {
  correiosRastreamentoUrl,
  formatLojaOrderStatusPt,
  formatLojaPayoutStatusPt,
} from '../../config/store';
import { functions } from '../../services/firebase';
import { formatarDataHoraBr } from '../../utils/datasBr';
import {
  buildTimelineStepsState,
  enrichStoreTimelineSteps,
  shortOrderPublicId,
  storeOrderTimelineMeta,
} from '../../utils/orderTrackingUi';
import { STORE_INTERNAL_PREP_DAYS_MAX, STORE_INTERNAL_PREP_DAYS_MIN } from '../../utils/storeShipping';
import './Loja.css';

const getStoreOrderForViewer = httpsCallable(functions, 'getStoreOrderForViewer');

const CHECKLIST_LABELS = {
  printing: 'Impressão',
  organizing: 'Organização',
  gluing: 'Colagem',
  pressing: 'Prensa',
  cutting: 'Corte',
  finishing: 'Acabamento',
};

/**
 * @param {{ user: import('firebase/auth').User | null }} props
 */
export default function StoreOrderDetailPage({ user }) {
  const { orderId } = useParams();
  const id = String(orderId || '').trim();
  const [order, setOrder] = useState(null);
  const [viewerRole, setViewerRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const storeDeliveryEta = useMemo(() => {
    if (!order) return '';
    const low = Number(order.shippingDeliveryDaysLow);
    const high = Number(order.shippingDeliveryDaysHigh);
    const transit = Number(order.shippingTransitDays ?? order.shippingDeliveryDays ?? 0);
    const method = String(order.shippingMethod || 'PAC').trim();
    if (Number.isFinite(low) && Number.isFinite(high) && high >= low) {
      return `${low}–${high} dias úteis após confirmação do pagamento (${method}: ~${transit} úteis nos Correios + preparação e postagem). Sem data garantida — use o rastreio quando o status for «Enviado».`;
    }
    if (Number.isFinite(transit) && transit > 0) {
      return `Estimativa: ${transit + STORE_INTERNAL_PREP_DAYS_MIN}–${transit + STORE_INTERNAL_PREP_DAYS_MAX} dias úteis (pedido sem intervalo salvo; trânsito ~${transit} d úteis, ${method}).`;
    }
    return 'Prazo em dias úteis após produção e postagem — acompanhe pelo rastreio quando o status for «Enviado».';
  }, [order]);

  useEffect(() => {
    let on = true;
    async function run() {
      if (!user?.uid || !id) {
        setOrder(null);
        setLoading(false);
        setError(!user?.uid ? '' : 'Pedido inválido.');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const { data } = await getStoreOrderForViewer({ orderId: id });
        if (!on) return;
        if (data?.ok && data?.order) {
          setOrder(data.order);
          setViewerRole(String(data.viewerRole || ''));
        } else {
          setOrder(null);
          setError('Não foi possível carregar o pedido.');
        }
      } catch (e) {
        if (!on) return;
        setOrder(null);
        setError(e?.message || 'Não foi possível carregar o pedido.');
      } finally {
        if (on) setLoading(false);
      }
    }
    run();
    return () => {
      on = false;
    };
  }, [user?.uid, id]);

  const timeline = useMemo(() => {
    if (!order) {
      return { steps: [], cancelled: false, problem: false, problemHint: '' };
    }
    const meta = storeOrderTimelineMeta(order.status, order.paymentStatus);
    const built = buildTimelineStepsState(meta.activeStep, meta.cancelled, meta.problem);
    return {
      steps: enrichStoreTimelineSteps(order, built.steps, (ts) => formatarDataHoraBr(ts)),
      cancelled: built.cancelled,
      problem: built.problem,
      problemHint: meta.problemHint || '',
    };
  }, [order]);
  const { steps, cancelled, problem, problemHint } = timeline;
  const badge = order ? storeOrderBadgeProps(order) : { className: 'ot-badge ot-badge--neutral', label: '—' };
  const statusTitle = order ? formatLojaOrderStatusPt(order.status) : '—';
  const track = String(order?.trackingCode || order?.codigoRastreio || '').trim();
  const trackUrl = correiosRastreamentoUrl(track);
  const items = Array.isArray(order?.items) ? order.items : [];
  const creatorId = String(items[0]?.creatorId || '').trim();
  const isBuyer = viewerRole === 'buyer';

  const checklistEntries = useMemo(() => {
    const c = order?.productionChecklist && typeof order.productionChecklist === 'object' ? order.productionChecklist : {};
    return Object.entries(CHECKLIST_LABELS).map(([key, label]) => ({
      key,
      label,
      on: c[key] === true,
    }));
  }, [order?.productionChecklist]);

  if (!user?.uid) {
    return (
      <main className="loja-page ot-detail-page">
        <p>Faça login para ver este pedido.</p>
        <Link to="/login">Entrar</Link>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="loja-page ot-detail-page">
        <p className="meus-pedidos-loading" role="status">
          Carregando pedido…
        </p>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="loja-page ot-detail-page">
        <p>{error || 'Pedido não encontrado.'}</p>
        <Link className="ot-detail-back" to="/pedidos">
          ← Voltar aos pedidos
        </Link>
      </main>
    );
  }

  return (
    <main className="loja-page ot-detail-page">
      <Link className="ot-detail-back" to={isBuyer ? '/pedidos?tab=compras' : '/pedidos?tab=vendas'}>
        ← Voltar aos pedidos
      </Link>

      <header className="ot-detail-hero">
        <p className="ot-detail-hero__id">Pedido #{shortOrderPublicId(order.id)}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <h1 className="ot-detail-hero__status" style={{ margin: 0 }}>
            {statusTitle}
          </h1>
          <span className={badge.className}>{badge.label}</span>
        </div>
        <p className="ot-detail-hero__eta">Entrega estimada: {storeDeliveryEta}</p>
        <p className="ot-detail-hero__updated">
          Última atualização: {formatarDataHoraBr(Number(order.updatedAt || order.createdAt || 0))}
        </p>
        {cancelled ? (
          <p className="ot-card__hint" style={{ marginTop: '12px' }}>
            Este pedido foi cancelado. Em caso de cobrança indevida, fale com o suporte.
          </p>
        ) : null}
        {problem && problemHint ? <p className="ot-card__hint" style={{ marginTop: '12px' }}>{problemHint}</p> : null}
      </header>

      <section className="ot-detail-block" aria-label="Linha do tempo do pedido">
        <h2>Andamento</h2>
        <OrderTimeline steps={steps} layout="vertical" />
      </section>

      <div className="ot-detail-actions" style={{ marginBottom: '16px' }}>
        {track && trackUrl ? (
          <a className="ot-btn ot-btn--primary" href={trackUrl} target="_blank" rel="noopener noreferrer">
            Rastrear envio
          </a>
        ) : null}
        <Link className="ot-btn ot-btn--ghost" to="/sobre-autor">
          Falar com suporte
        </Link>
        {items[0]?.productId ? (
          <Link className="ot-btn ot-btn--ghost" to={`/loja/produto/${encodeURIComponent(items[0].productId)}`}>
            Ver produto
          </Link>
        ) : null}
      </div>

      {order.shippingAddress && typeof order.shippingAddress === 'object' ? (
        <section className="ot-detail-block">
          <h2>Envio</h2>
          <p>
            {order.shippingAddress.addressLine1 || '—'}
            {order.shippingAddress.addressLine2 ? (
              <>
                <br />
                {order.shippingAddress.addressLine2}
              </>
            ) : null}
            <br />
            {order.shippingAddress.neighborhood ? <>{order.shippingAddress.neighborhood} · </> : null}
            {order.shippingAddress.city || '—'}
            {order.shippingAddress.state ? ` / ${order.shippingAddress.state}` : ''}
            {order.shippingAddress.postalCode ? ` · CEP ${order.shippingAddress.postalCode}` : ''}
          </p>
          {track ? (
            <p style={{ marginTop: '8px' }}>
              <strong>Rastreio:</strong> {track}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="ot-detail-block">
        <h2>Pagamento</h2>
        {isBuyer ? (
          <>
            <div className="ot-detail-block__row">
              <span>Subtotal</span>
              <span>{Number(order.subtotal ?? order.total ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            </div>
            {Number(order.shippingBrl) > 0 ? (
              <div className="ot-detail-block__row">
                <span>Frete</span>
                <span>{Number(order.shippingBrl).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
            ) : null}
            {Number(order.shippingDiscountBrl) > 0 ? (
              <div className="ot-detail-block__row">
                <span>Desconto no frete</span>
                <span>-{Number(order.shippingDiscountBrl).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
            ) : null}
            <div className="ot-detail-block__row">
              <span>
                <strong>Total</strong>
              </span>
              <span>
                <strong>{Number(order.total ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
              </span>
            </div>
          </>
        ) : (
          <div className="ot-detail-block__row">
            <span>Seu subtotal (itens do seu catálogo)</span>
            <span>
              <strong>
                {Number(order.creatorSubtotal ?? order.total ?? 0).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })}
              </strong>
            </span>
          </div>
        )}
        <p style={{ marginTop: '10px', marginBottom: 0 }}>
          Mercado Pago: {order.paymentStatus ? String(order.paymentStatus) : '—'}
          {order.paymentId ? ` · ID ${String(order.paymentId).slice(-10)}` : ''}
        </p>
        {!isBuyer ? (
          <p style={{ marginTop: '8px', marginBottom: 0 }}>
            Repasse: {formatLojaPayoutStatusPt(order.payoutStatus)}
          </p>
        ) : null}
      </section>

      <section className="ot-detail-block">
        <h2>Itens</h2>
        <ul>
          {items.map((it, idx) => (
            <li key={`${it.productId}-${idx}`}>
              {it.title || it.productId} × {it.quantity}
              {it.size ? ` (${it.size})` : ''} —{' '}
              {Number(it.lineTotal || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </li>
          ))}
        </ul>
      </section>

      {creatorId ? (
        <section className="ot-detail-block">
          <h2>Criador</h2>
          <p>
            Parte deste pedido é de um criador da plataforma.
            <br />
            <Link to={`/criador/${encodeURIComponent(creatorId)}`}>Ver perfil do criador</Link>
          </p>
        </section>
      ) : null}

      {!isBuyer && checklistEntries.length ? (
        <section className="ot-detail-block">
          <h2>Produção (checklist)</h2>
          <ul className="ot-detail-checklist">
            {checklistEntries.map((row) => (
              <li key={row.key} className={row.on ? 'is-on' : 'is-off'}>
                {row.on ? '✓' : '○'} {row.label}
              </li>
            ))}
          </ul>
          {order.containsForeignItems ? (
            <p style={{ marginTop: '10px', fontSize: '0.82rem', color: 'rgba(248, 250, 252, 0.75)' }}>
              Pedido misto: atualizações operacionais completas ficam com a equipe — use o painel do creator para o que couber no seu escopo.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
