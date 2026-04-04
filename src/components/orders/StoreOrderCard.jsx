import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { correiosRastreamentoUrl } from '../../config/store';
import { formatarDataHoraBr } from '../../utils/datasBr';
import {
  buildTimelineStepsState,
  shortOrderPublicId,
  storeOrderTimelineMeta,
} from '../../utils/orderTrackingUi';
import OrderTimeline from './OrderTimeline';
import { storeOrderBadgeProps } from './storeOrderBadge';
import './OrderTracking.css';

function firstItemThumb(items, productImages) {
  const it = Array.isArray(items) ? items[0] : null;
  const pid = String(it?.productId || '').trim();
  if (pid && productImages?.[pid]) return productImages[pid];
  return null;
}

/**
 * @param {object} props
 * @param {object} props.order
 * @param {Record<string, string>} [props.productImages] productId -> url
 * @param {'buyer'|'seller'} [props.perspective]
 */
export default function StoreOrderCard({ order, productImages = {}, perspective = 'buyer' }) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const first = items[0];
  const thumbUrl = firstItemThumb(items, productImages);
  const track = String(order?.trackingCode || order?.codigoRastreio || '').trim();
  const trackUrl = correiosRastreamentoUrl(track);
  const badge = storeOrderBadgeProps(order);
  const meta = storeOrderTimelineMeta(order?.status, order?.paymentStatus);
  const { steps } = buildTimelineStepsState(meta.activeStep, meta.cancelled, meta.problem);

  const subtitle = useMemo(() => {
    if (!first) return 'Itens do pedido';
    const more = items.length > 1 ? ` +${items.length - 1}` : '';
    return `${String(first.title || first.productId || 'Produto')}${more}`;
  }, [first, items.length]);

  const total = perspective === 'seller' ? Number(order?.creatorSubtotal ?? order?.total ?? 0) : Number(order?.total ?? 0);
  const qty = items.reduce((s, it) => s + Number(it?.quantity || 0), 0) || items.length;

  return (
    <article className="ot-card">
      <div className="ot-card__top">
        <div>
          <p className="ot-card__id">Pedido #{shortOrderPublicId(order?.id)}</p>
          <p className="ot-card__date">{formatarDataHoraBr(Number(order?.createdAt || 0))}</p>
        </div>
        <span className={badge.className}>{badge.label}</span>
      </div>

      <div className="ot-card__mid">
        <div className="ot-card__thumb" aria-hidden="true">
          {thumbUrl ? <img src={thumbUrl} alt="" loading="lazy" /> : <span>📦</span>}
        </div>
        <div>
          <p className="ot-card__product-title">{subtitle}</p>
          <p className="ot-card__product-meta">
            {perspective === 'seller' && order?.containsForeignItems ? (
              <span>Pedido misto — só seus itens aparecem aqui. </span>
            ) : null}
            Última atualização: {formatarDataHoraBr(Number(order?.updatedAt || order?.createdAt || 0))}
          </p>
        </div>
        <div className="ot-card__money">
          <strong>
            {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </strong>
          <span>{qty} un. no total</span>
        </div>
      </div>

      <OrderTimeline steps={steps} layout="horizontal" />

      {meta.problem && meta.problemHint ? <p className="ot-card__hint">{meta.problemHint}</p> : null}

      {perspective === 'seller' ? (
        <div className="ot-card__creator-metrics">
          <strong>Seu subtotal neste pedido:</strong>{' '}
          {Number(order?.creatorSubtotal ?? order?.total ?? 0).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          })}
          <br />
          <span style={{ opacity: 0.9 }}>
            Repasse:{' '}
            {String(order?.payoutStatus || '').toLowerCase() === 'released' ? 'Liberado após entrega' : 'Retido até entrega confirmada'}
          </span>
        </div>
      ) : null}

      <div className="ot-card__actions">
        <Link className="ot-btn ot-btn--primary" to={`/pedidos/loja/${encodeURIComponent(order?.id)}`}>
          Ver detalhes
        </Link>
        {track && trackUrl ? (
          <a className="ot-btn ot-btn--ghost" href={trackUrl} target="_blank" rel="noopener noreferrer">
            Rastrear envio
          </a>
        ) : null}
        <Link className="ot-btn ot-btn--ghost" to="/sobre-autor">
          Falar com suporte
        </Link>
      </div>
    </article>
  );
}
