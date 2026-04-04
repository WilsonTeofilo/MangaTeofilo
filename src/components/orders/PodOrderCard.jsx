import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { formatPodBookFormatPt, formatPodOrderAmountDue, formatPodOrderStatusPt, formatPodSaleModelPt } from '../../utils/printOnDemandOrderUi';
import { functions } from '../../services/firebase';
import { formatarDataHoraBr } from '../../utils/datasBr';
import { buildTimelineStepsState, podOrderTimelineMeta, shortOrderPublicId } from '../../utils/orderTrackingUi';
import { correiosRastreamentoUrl } from '../../config/store';
import OrderTimeline from './OrderTimeline';
import './OrderTracking.css';

const resumeCheckoutFn = httpsCallable(functions, 'resumePrintOnDemandCheckout');
const cancelMyPrintOnDemandOrderFn = httpsCallable(functions, 'cancelMyPrintOnDemandOrder');

function podBadgeClass(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'cancelled') return 'ot-badge ot-badge--cancel';
  if (s === 'pending_payment') return 'ot-badge ot-badge--payment';
  if (s === 'in_production' || s === 'paid') return 'ot-badge ot-badge--production';
  if (s === 'ready_to_ship' || s === 'shipped') return 'ot-badge ot-badge--transit';
  if (s === 'delivered') return 'ot-badge ot-badge--done';
  return 'ot-badge ot-badge--neutral';
}

/**
 * @param {object} props
 * @param {object} props.order
 * @param {string} [props.newOrderPath]
 * @param {() => void} [props.onPaymentLinkReady] — após gerar link (resume), atualizar lista no pai
 * @param {() => void} [props.onOrderUpdated] — após cancelar ou outras ações que mudam o pedido
 */
export default function PodOrderCard({
  order,
  newOrderPath = '/print-on-demand?ctx=creator',
  onPaymentLinkReady,
  onOrderUpdated,
}) {
  const refreshList = onOrderUpdated || onPaymentLinkReady;

  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeErrorModal, setResumeErrorModal] = useState(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());

  const snap = order?.snapshot && typeof order.snapshot === 'object' ? order.snapshot : {};
  const meta = podOrderTimelineMeta(order?.status);
  const { steps } = buildTimelineStepsState(meta.activeStep, meta.cancelled, false);
  const track = String(order?.trackingCode || '').trim();
  const trackUrl = correiosRastreamentoUrl(track);
  const amount = formatPodOrderAmountDue(snap);

  const title = useMemo(
    () =>
      `${formatPodSaleModelPt(snap.saleModel)} · ${formatPodBookFormatPt(snap.format)} · ${snap.quantity != null ? `${snap.quantity} un.` : '—'}`,
    [snap.saleModel, snap.format, snap.quantity]
  );

  const st = String(order?.status || '').trim().toLowerCase();
  const checkoutUrl = String(order?.checkoutUrl || '').trim();
  const needsPayment = st === 'pending_payment';
  const canPayNow = needsPayment && Boolean(checkoutUrl);
  const canResumeCheckout = needsPayment && !checkoutUrl;
  const paymentExpired = Boolean(
    needsPayment && Number(order?.expiresAt || 0) > 0 && nowTick > Number(order.expiresAt)
  );
  const canCancelFromList = needsPayment && !meta.cancelled && !paymentExpired;

  useEffect(() => {
    if (!needsPayment || !Number(order?.expiresAt || 0)) return undefined;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [needsPayment, order?.expiresAt]);

  const onResumePay = useCallback(async () => {
    const oid = String(order?.id || '').trim();
    if (!oid || !canResumeCheckout || resumeLoading) return;
    setResumeLoading(true);
    setResumeErrorModal(null);
    try {
      const { data } = await resumeCheckoutFn({ orderId: oid });
      const url = String(data?.url || '').trim();
      if (!data?.ok || !url) {
        setResumeErrorModal(
          'Não foi possível gerar o link de pagamento. Tente de novo ou fale com o suporte.'
        );
        return;
      }
      refreshList?.();
      window.location.assign(url);
    } catch (e) {
      setResumeErrorModal(e?.message || 'Não foi possível gerar o link de pagamento.');
    } finally {
      setResumeLoading(false);
    }
  }, [order?.id, canResumeCheckout, resumeLoading, refreshList]);

  const handleCancelPedido = useCallback(async () => {
    const oid = String(order?.id || '').trim();
    if (!oid || cancelBusy) return;
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      setCancelError('Informe o motivo (mínimo 3 caracteres).');
      return;
    }
    setCancelBusy(true);
    setCancelError('');
    try {
      const { data } = await cancelMyPrintOnDemandOrderFn({ orderId: oid, cancellationReason: reason });
      if (!data?.ok) {
        setCancelError('Não foi possível cancelar. Tente de novo ou fale com o suporte.');
        return;
      }
      setCancelModalOpen(false);
      setCancelReason('');
      refreshList?.();
    } catch (e) {
      setCancelError(e?.message || 'Não foi possível cancelar o pedido.');
    } finally {
      setCancelBusy(false);
    }
  }, [order?.id, cancelBusy, cancelReason, refreshList]);

  return (
    <article className="ot-card">
      {resumeErrorModal ? (
        <div
          className="ot-modal-backdrop"
          role="presentation"
          onClick={() => setResumeErrorModal(null)}
        >
          <div
            className="ot-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ot-card-resume-err-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="ot-card-resume-err-title" className="ot-modal__title">
              Link de pagamento
            </h2>
            <p className="ot-modal__body">{resumeErrorModal}</p>
            <div className="ot-modal__actions">
              <button type="button" className="ot-btn ot-btn--primary" onClick={() => setResumeErrorModal(null)}>
                Ok
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
            aria-labelledby="ot-card-cancel-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="ot-card-cancel-title" className="ot-modal__title">
              Cancelar este pedido?
            </h2>
            <p className="ot-modal__body">
              Só é possível cancelar por aqui enquanto o pagamento estiver pendente. Se você já pagou, fale com o
              suporte.
            </p>
            <label className="ot-modal__label" htmlFor="ot-card-cancel-reason">
              Motivo (mín. 3 caracteres)
            </label>
            <textarea
              id="ot-card-cancel-reason"
              className="ot-modal__textarea"
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              disabled={cancelBusy}
            />
            {cancelError ? <p className="ot-modal__error">{cancelError}</p> : null}
            <div className="ot-modal__actions">
              <button
                type="button"
                className="ot-btn ot-btn--ghost"
                onClick={() => setCancelModalOpen(false)}
                disabled={cancelBusy}
              >
                Voltar
              </button>
              <button type="button" className="ot-btn ot-btn--primary" onClick={handleCancelPedido} disabled={cancelBusy}>
                {cancelBusy ? 'Cancelando…' : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="ot-card__top">
        <div>
          <p className="ot-card__id">Mangá físico #{shortOrderPublicId(order?.id)}</p>
          <p className="ot-card__date">{formatarDataHoraBr(Number(order?.createdAt || 0))}</p>
        </div>
        <span className={podBadgeClass(order?.status)}>{formatPodOrderStatusPt(order?.status)}</span>
      </div>

      <div className="ot-card__mid">
        <div className="ot-card__thumb" aria-hidden="true">
          <span>📚</span>
        </div>
        <div>
          <p className="ot-card__product-title">{title}</p>
          <p className="ot-card__product-meta">
            Última atualização: {formatarDataHoraBr(Number(order?.updatedAt || order?.createdAt || 0))}
            {meta.productionHint ? ` · ${meta.productionHint}` : ''}
          </p>
        </div>
        <div className="ot-card__money">
          {amount ? <strong>{amount}</strong> : <strong>—</strong>}
          <span>Valor do lote</span>
        </div>
      </div>

      <OrderTimeline steps={steps} layout="horizontal" />

      {needsPayment && Number(order?.expiresAt || 0) > 0 ? (
        <p className={`ot-card__pay-hint ${paymentExpired ? 'ot-card__pay-hint--warn' : ''}`} role="status">
          {paymentExpired ? (
            <>
              <strong>Reserva encerrada.</strong> Prazo de pagamento passou — o pedido será cancelado automaticamente em
              breve.
            </>
          ) : (
            <>
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
            </>
          )}
        </p>
      ) : null}

      {needsPayment ? (
        <p className="ot-card__pay-hint" role="status">
          {canPayNow
            ? 'Conclua o pagamento do lote para liberar a produção.'
            : 'Sem link de checkout neste pedido — gere um novo link para pagar com segurança.'}
        </p>
      ) : null}

      <div className="ot-card__actions">
        {canPayNow ? (
          paymentExpired ? (
            <span className="ot-btn ot-btn--primary ot-btn--disabled" style={{ opacity: 0.55, cursor: 'not-allowed' }}>
              Prazo de pagamento expirado
            </span>
          ) : (
            <a className="ot-btn ot-btn--primary" href={checkoutUrl} rel="noopener noreferrer">
              Pagar agora (Mercado Pago)
            </a>
          )
        ) : null}
        {canResumeCheckout ? (
          <button
            type="button"
            className="ot-btn ot-btn--primary"
            onClick={onResumePay}
            disabled={resumeLoading || paymentExpired}
          >
            {resumeLoading ? 'Gerando link…' : 'Gerar link de pagamento'}
          </button>
        ) : null}
        {canCancelFromList ? (
          <button type="button" className="ot-btn ot-btn--ghost" onClick={() => setCancelModalOpen(true)}>
            Cancelar pedido
          </button>
        ) : null}
        <Link
          className={canPayNow || canResumeCheckout ? 'ot-btn ot-btn--ghost' : 'ot-btn ot-btn--primary'}
          to={`/pedidos/fisico/${encodeURIComponent(order?.id)}`}
        >
          Ver detalhes
        </Link>
        {track && trackUrl ? (
          <a className="ot-btn ot-btn--ghost" href={trackUrl} target="_blank" rel="noopener noreferrer">
            Rastrear envio
          </a>
        ) : null}
        <Link className="ot-btn ot-btn--ghost" to={newOrderPath}>
          Novo pedido físico
        </Link>
        <Link className="ot-btn ot-btn--ghost" to="/sobre-autor">
          Falar com suporte
        </Link>
      </div>
    </article>
  );
}
