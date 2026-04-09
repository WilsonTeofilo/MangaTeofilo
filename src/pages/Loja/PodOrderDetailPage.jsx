import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import OrderTimeline from '../../components/orders/OrderTimeline';
import '../../components/orders/OrderTracking.css';
import { correiosRastreamentoUrl } from '../../config/store';
import { functions } from '../../services/firebase';
import { formatarDataHoraBr } from '../../utils/datasBr';
import {
  buildTimelineStepsState,
  enrichPodTimelineSteps,
  podOrderTimelineMeta,
  shortOrderPublicId,
} from '../../utils/orderTrackingUi';
import {
  formatPodStatusLabel,
  isPodStatusPaidLike,
  isPodStatusPendingPayment,
  podStatusBadgeClass,
} from '../../utils/podStatus';
import {
  describePodLeadTimePt,
  formatPodBookFormatPt,
  formatPodOrderAmountDue,
  formatPodSaleModelPt,
} from '../../utils/printOnDemandOrderUi';
import './Loja.css';

const getMyPrintOnDemandOrder = httpsCallable(functions, 'getMyPrintOnDemandOrder');
const resumePrintOnDemandCheckout = httpsCallable(functions, 'resumePrintOnDemandCheckout');
const cancelMyPrintOnDemandOrder = httpsCallable(functions, 'cancelMyPrintOnDemandOrder');

/**
 * @param {{ user: import('firebase/auth').User | null }} props
 */
export default function PodOrderDetailPage({ user }) {
  const { orderId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const mpReturn = String(searchParams.get('mp') || '').trim().toLowerCase();
  const id = String(orderId || '').trim();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resumeLoading, setResumeLoading] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [resumeError, setResumeError] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (!order || !isPodStatusPendingPayment(order.status)) return undefined;
    if (!Number(order.expiresAt || 0)) return undefined;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [order?.id, order?.status, order?.expiresAt]);

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
        const { data } = await getMyPrintOnDemandOrder({ orderId: id });
        if (!on) return;
        if (data?.ok && data?.order) setOrder(data.order);
        else {
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

  const handleCancelPedido = useCallback(async () => {
    if (!id || cancelBusy) return;
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      setCancelError('Informe o motivo (mínimo 3 caracteres).');
      return;
    }
    setCancelBusy(true);
    setCancelError('');
    try {
      const { data } = await cancelMyPrintOnDemandOrder({ orderId: id, cancellationReason: reason });
      if (!data?.ok) {
        setCancelError('Não foi possível cancelar. Tente de novo ou fale com o suporte.');
        return;
      }
      setCancelModalOpen(false);
      setCancelReason('');
      const { data: fresh } = await getMyPrintOnDemandOrder({ orderId: id });
      if (fresh?.ok && fresh?.order) setOrder(fresh.order);
    } catch (e) {
      setCancelError(e?.message || 'Não foi possível cancelar o pedido.');
    } finally {
      setCancelBusy(false);
    }
  }, [id, cancelBusy, cancelReason]);

  const handleResumeCheckout = useCallback(async () => {
    if (!id || resumeLoading) return;
    setResumeLoading(true);
    setResumeError('');
    try {
      const { data } = await resumePrintOnDemandCheckout({ orderId: id });
      const url = String(data?.url || '').trim();
      if (!data?.ok || !url) {
        setResumeError('Não foi possível gerar o link de pagamento. Tente de novo ou fale com o suporte.');
        return;
      }
      window.location.assign(url);
    } catch (e) {
      setResumeError(e?.message || 'Não foi possível gerar o link de pagamento.');
    } finally {
      setResumeLoading(false);
    }
  }, [id, resumeLoading]);

  useEffect(() => {
    if (!mpReturn) return undefined;
    const t = window.setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('mp');
          return next;
        },
        { replace: true }
      );
    }, 14000);
    return () => window.clearTimeout(t);
  }, [mpReturn, setSearchParams]);

  const snap = order?.snapshot && typeof order.snapshot === 'object' ? order.snapshot : {};
  const timeline = useMemo(() => {
    if (!order) return { steps: [], cancelled: false, productionHint: '' };
    const meta = podOrderTimelineMeta(order.status);
    const built = buildTimelineStepsState(meta.activeStep, meta.cancelled, false);
    return {
      steps: enrichPodTimelineSteps(order, built.steps, (ts) => formatarDataHoraBr(ts), nowTick),
      cancelled: built.cancelled,
      productionHint: meta.productionHint || '',
    };
  }, [order, nowTick]);
  const { steps, cancelled, productionHint } = timeline;
  const paymentExpired = Boolean(
    order &&
      isPodStatusPendingPayment(order.status) &&
      Number(order.expiresAt || 0) > 0 &&
      nowTick > Number(order.expiresAt)
  );
  const orderEventsList = useMemo(() => {
    const raw = order?.orderEvents;
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw)
      .map(([k, v]) => ({ id: k, ...(typeof v === 'object' && v ? v : {}) }))
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
      .slice(0, 24);
  }, [order?.orderEvents]);
  const track = String(order?.trackingCode || '').trim();
  const trackUrl = correiosRastreamentoUrl(track);
  const amount = formatPodOrderAmountDue(snap);
  const addr = order?.shippingAddress && typeof order.shippingAddress === 'object' ? order.shippingAddress : null;

  const mpReturnBanner = useMemo(() => {
    if (!order || (mpReturn !== 'ok' && mpReturn !== 'pending')) return null;
    const st = String(order.status || '').trim().toLowerCase();
    const publicId = shortOrderPublicId(order.id);
    const eta = describePodLeadTimePt(snap.saleModel, snap.format, snap.quantity);
    if (isPodStatusPendingPayment(st)) {
      return {
        variant: 'ot-mp-return-banner--pending',
        title: 'Confirmando pagamento',
        idLine: `ID do pedido: #${publicId}`,
        body:
          mpReturn === 'pending'
            ? 'O Mercado Pago marcou este pagamento como pendente. Assim que for aprovado, o status abaixo atualiza sozinho.'
            : 'Se você usou Pix, a aprovação pode levar alguns minutos. O andamento aparece nesta página.',
        eta,
      };
    }
    if (isPodStatusPaidLike(order.status)) {
      return {
        variant: '',
        title: 'Pedido confirmado ✓',
        idLine: `ID do pedido: #${publicId}`,
        body: 'Pagamento registrado. Acompanhe produção e envio na linha do tempo.',
        eta,
      };
    }
    return null;
  }, [order, mpReturn, snap.saleModel, snap.format, snap.quantity]);

  const checklistEntries = useMemo(() => {
    const c = order?.productionChecklist && typeof order.productionChecklist === 'object' ? order.productionChecklist : {};
    const keys = ['printing', 'organizing', 'gluing', 'pressing', 'cutting', 'finishing'];
    const labels = {
      printing: 'Impressão',
      organizing: 'Organização',
      gluing: 'Colagem',
      pressing: 'Prensa',
      cutting: 'Corte',
      finishing: 'Acabamento',
    };
    return keys.map((k) => ({ key: k, label: labels[k], on: c[k] === true }));
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
        <Link className="ot-detail-back" to="/pedidos?tab=fisico">
          ← Voltar aos pedidos
        </Link>
      </main>
    );
  }

  return (
    <main className="loja-page ot-detail-page">
      <Link className="ot-detail-back" to="/pedidos?tab=fisico">
        ← Voltar aos pedidos
      </Link>

      {mpReturnBanner ? (
        <div
          className={['ot-mp-return-banner', mpReturnBanner.variant].filter(Boolean).join(' ')}
          role="status"
        >
          <h2>{mpReturnBanner.title}</h2>
          <p className="ot-mp-return-banner__id">{mpReturnBanner.idLine}</p>
          {mpReturnBanner.eta ? <p className="ot-mp-return-banner__body">{mpReturnBanner.eta}</p> : null}
          <p className="ot-mp-return-banner__body">{mpReturnBanner.body}</p>
          <a className="ot-mp-return-banner__cta" href="#pod-detail-tracking">
            Acompanhar pedido
          </a>
        </div>
      ) : null}

      {order &&
      isPodStatusPendingPayment(order.status) &&
      Number(order.expiresAt || 0) > 0 &&
      !cancelled ? (
        <div
          className={`ot-pod-expiry-banner ${paymentExpired ? 'ot-pod-expiry-banner--gone' : ''}`}
          role="status"
        >
          {paymentExpired ? (
            <p>
              <strong>Reserva encerrada.</strong> O prazo de 24 horas para pagamento passou. Este pedido será cancelado
              automaticamente em breve — monte um novo lote no carrinho se ainda quiser produzir.
            </p>
          ) : (
            <p>
              <strong>Aguardando pagamento</strong>
              {' — '}
              {(() => {
                const left = Math.max(0, Math.floor((Number(order.expiresAt) - nowTick) / 1000));
                const h = Math.floor(left / 3600);
                const m = Math.floor((left % 3600) / 60);
                const s = left % 60;
                const pad = (n) => String(n).padStart(2, '0');
                return `Expira em ${pad(h)}:${pad(m)}:${pad(s)}`;
              })()}
            </p>
          )}
        </div>
      ) : null}

      {resumeError ? (
        <p className="ot-card__pay-hint" role="alert" style={{ marginBottom: 12, color: '#fca5a5' }}>
          {resumeError}
        </p>
      ) : null}

      <header className="ot-detail-hero">
        <p className="ot-detail-hero__id">Mangá físico #{shortOrderPublicId(order.id)}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <h1 className="ot-detail-hero__status" style={{ margin: 0 }}>
            {formatPodStatusLabel(order.status)}
          </h1>
          <span className={podStatusBadgeClass(order.status)}>{formatPodStatusLabel(order.status)}</span>
        </div>
        <p className="ot-detail-hero__eta">
          {formatPodSaleModelPt(snap.saleModel)} · {formatPodBookFormatPt(snap.format)}
          {snap.quantity != null ? ` · ${snap.quantity} un.` : ''}
          {amount ? ` · ${amount}` : ''}
        </p>
        <p className="ot-detail-hero__updated">
          Última atualização: {formatarDataHoraBr(Number(order.updatedAt || order.createdAt || 0))}
        </p>
        {cancelled ? (
          <p className="ot-card__hint" style={{ marginTop: '12px' }}>
            Este lote foi cancelado. Dúvidas sobre reembolso: suporte.
            {String(order.buyerCancellationReason || '').trim() ? (
              <>
                <br />
                <strong style={{ display: 'block', marginTop: '8px' }}>Motivo do seu cancelamento</strong>
                {String(order.buyerCancellationReason).trim()}
              </>
            ) : null}
            {String(order.adminCancellationReason || '').trim() ? (
              <>
                <br />
                <strong style={{ display: 'block', marginTop: '8px' }}>Motivo informado pela equipe</strong>
                {String(order.adminCancellationReason).trim()}
              </>
            ) : null}
          </p>
        ) : null}
      </header>

      <section id="pod-detail-tracking" className="ot-detail-block" aria-label="Linha do tempo do pedido">
        <h2>Andamento</h2>
        <OrderTimeline steps={steps} layout="vertical" />
      </section>

      {String(order.status || '').toLowerCase() === 'pending_payment' && !String(order.checkoutUrl || '').trim() ? (
        <p className="ot-card__pay-hint ot-detail-pay-hint" role="status">
          Não há link de pagamento salvo neste pedido (por exemplo, se o fluxo foi interrompido). Gere um novo link para
          pagar com o Mercado Pago; após a aprovação, o status atualiza automaticamente.
        </p>
      ) : null}

      <div className="ot-detail-actions" style={{ marginBottom: '16px' }}>
        {isPodStatusPendingPayment(order.status) && String(order.checkoutUrl || '').trim() ? (
          paymentExpired ? (
            <span className="ot-btn ot-btn--primary ot-btn--disabled" style={{ opacity: 0.55, cursor: 'not-allowed' }}>
              Prazo de pagamento expirado
            </span>
          ) : (
            <a className="ot-btn ot-btn--primary" href={String(order.checkoutUrl)} rel="noopener noreferrer">
              Pagar agora (Mercado Pago)
            </a>
          )
        ) : null}
        {isPodStatusPendingPayment(order.status) && !String(order.checkoutUrl || '').trim() ? (
          <button
            type="button"
            className="ot-btn ot-btn--primary"
            onClick={handleResumeCheckout}
            disabled={resumeLoading || paymentExpired}
          >
            {resumeLoading ? 'Gerando link…' : 'Gerar link de pagamento'}
          </button>
        ) : null}
        {track && trackUrl ? (
          <a className="ot-btn ot-btn--primary" href={trackUrl} target="_blank" rel="noopener noreferrer">
            Rastrear envio
          </a>
        ) : null}
        <Link className="ot-btn ot-btn--ghost" to="/sobre-autor">
          Problema com pedido / suporte
        </Link>
        <Link className="ot-btn ot-btn--ghost" to="/print-on-demand?ctx=creator">
          Novo pedido físico
        </Link>
        {isPodStatusPendingPayment(order.status) && !cancelled && !paymentExpired ? (
          <button type="button" className="ot-btn ot-btn--ghost" onClick={() => setCancelModalOpen(true)}>
            Cancelar pedido
          </button>
        ) : null}
      </div>

      {orderEventsList.length > 0 ? (
        <section className="ot-detail-block" aria-label="Histórico do pedido">
          <h2>Registro de eventos</h2>
          <ul className="ot-pod-events">
            {orderEventsList.map((ev) => (
              <li key={ev.id}>
                <time dateTime={new Date(Number(ev.at || 0)).toISOString()}>
                  {formatarDataHoraBr(Number(ev.at || 0))}
                </time>
                <span className="ot-pod-events__type">{String(ev.type || 'evento')}</span>
                <span className="ot-pod-events__msg">{String(ev.message || '—')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {addr ? (
        <section className="ot-detail-block">
          <h2>Envio</h2>
          <p>
            {addr.name ? <>{addr.name} · </> : null}
            {addr.street || '—'}
            {addr.neighborhood ? (
              <>
                <br />
                Bairro: {addr.neighborhood}
              </>
            ) : null}
            <br />
            {addr.city || '—'}
            {addr.state ? ` / ${addr.state}` : ''}
            {addr.zip ? ` · CEP ${addr.zip}` : ''}
            {addr.complement ? (
              <>
                <br />
                {addr.complement}
              </>
            ) : null}
          </p>
          {track ? (
            <p style={{ marginTop: '8px' }}>
              <strong>Rastreio:</strong> {track}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="ot-detail-block">
          <h2>Envio</h2>
          <p>Este modelo de pedido não exige endereço na plataforma ou ainda não foi informado.</p>
        </section>
      )}

      <section className="ot-detail-block">
        <h2>Resumo do lote</h2>
        <p style={{ marginTop: 0 }}>Valor: {amount || '—'}</p>
        <p>Status na gráfica: {productionHint || '—'}</p>
      </section>

      {cancelModalOpen ? (
        <div
          className="ot-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!cancelBusy) setCancelModalOpen(false);
          }}
        >
          <div
            className="ot-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ot-cancel-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="ot-cancel-title" className="ot-modal__title">
              Cancelar este pedido?
            </h2>
            <p className="ot-modal__body">
              Só é possível cancelar por aqui enquanto o pagamento estiver pendente. Se você já pagou, fale com o suporte.
            </p>
            <label className="ot-modal__label">
              Motivo (obrigatório)
              <textarea
                className="ot-modal__textarea"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ex.: errei quantidade / não quero mais seguir com o pedido"
                maxLength={2000}
                disabled={cancelBusy}
              />
            </label>
            {cancelError ? <p className="ot-modal__error">{cancelError}</p> : null}
            <div className="ot-modal__actions">
              <button type="button" className="ot-btn ot-btn--ghost" onClick={() => setCancelModalOpen(false)} disabled={cancelBusy}>
                Voltar
              </button>
              <button type="button" className="ot-btn ot-btn--primary" onClick={handleCancelPedido} disabled={cancelBusy}>
                {cancelBusy ? 'Cancelando…' : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="ot-detail-block">
        <h2>Produção (checklist)</h2>
        <ul className="ot-detail-checklist">
          {checklistEntries.map((row) => (
            <li key={row.key} className={row.on ? 'is-on' : 'is-off'}>
              {row.on ? '✓' : '○'} {row.label}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
