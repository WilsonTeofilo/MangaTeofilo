import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { formatarDataHoraBr } from '../utils/datasBr';
import {
  formatPodBookFormatPt,
  formatPodOrderAmountDue,
  formatPodOrderStatusPt,
  formatPodSaleModelPt,
  podOrderTrackingUrl,
  shortPodOrderId,
} from '../utils/printOnDemandOrderUi';

/**
 * Lista de pedidos print-on-demand do utilizador (dados de `listMyPrintOnDemandOrders`).
 * @param {{ orders: object[], newOrderPath?: string }} props
 */
export default function PodOrdersList({ orders, newOrderPath = '/print-on-demand' }) {
  const [openId, setOpenId] = useState('');
  const list = useMemo(() => (Array.isArray(orders) ? orders : []), [orders]);

  if (!list.length) {
    return (
      <section className="meus-pedidos-empty" aria-label="Sem pedidos de manga fisico">
        <p>Voce ainda nao tem pedidos de manga fisico registrados.</p>
        <p className="meus-pedidos-empty__hint">
          Encomendas para vender pela plataforma, producao para voce ou modo vitrine na loja entram por aqui.
        </p>
        <Link className="meus-pedidos-cta" to={newOrderPath}>
          Novo pedido de manga fisico
        </Link>
      </section>
    );
  }

  return (
    <section className="meus-pedidos-pod-list" aria-label="Pedidos de manga fisico">
      <div className="meus-pedidos-pod-list__toolbar">
        <Link className="meus-pedidos-cta meus-pedidos-cta--ghost" to={newOrderPath}>
          + Novo pedido
        </Link>
      </div>
      <ul className="meus-pedidos-pod-cards">
        {list.map((o) => {
          const id = String(o.id || '');
          const snap = o.snapshot && typeof o.snapshot === 'object' ? o.snapshot : {};
          const expanded = openId === id;
          const track = String(o.trackingCode || '').trim();
          const trackUrl = podOrderTrackingUrl(track);
          const amount = formatPodOrderAmountDue(snap);
          return (
            <li key={id}>
              <article className="meus-pedidos-pod-card">
                <div className="meus-pedidos-pod-card__main">
                  <div>
                    <h3>Pedido fisico #{shortPodOrderId(id)}</h3>
                    <p className="meus-pedidos-pod-card__status">
                      <strong>Status:</strong> {formatPodOrderStatusPt(o.status)}
                    </p>
                    <p className="meus-pedidos-pod-card__meta">
                      {formatPodSaleModelPt(snap.saleModel)} · {formatPodBookFormatPt(snap.format)} · Qtd.{' '}
                      {snap.quantity != null ? String(snap.quantity) : '-'}
                    </p>
                    <p className="meus-pedidos-pod-card__date">{formatarDataHoraBr(Number(o.createdAt || 0))}</p>
                    {amount ? (
                      <p className="meus-pedidos-pod-card__amount">
                        <strong>Valor do lote:</strong> {amount}
                      </p>
                    ) : null}
                    {track && trackUrl ? (
                      <p className="loja-order-tracking-inline">
                        <span className="loja-order-tracking-code">Rastreio: {track}</span>
                        <a className="loja-order-correios" href={trackUrl} target="_blank" rel="noopener noreferrer">
                          Rastrear nos Correios
                        </a>
                      </p>
                    ) : null}
                  </div>
                  <div className="meus-pedidos-pod-card__right">
                    <button
                      type="button"
                      className="loja-btn-ghost loja-btn-small"
                      onClick={() => setOpenId(expanded ? '' : id)}
                    >
                      {expanded ? 'Fechar' : 'Detalhes'}
                    </button>
                  </div>
                </div>
                {expanded ? (
                  <div className="meus-pedidos-pod-card__detail">
                    {o.shippingAddress && typeof o.shippingAddress === 'object' ? (
                      <p className="loja-order-lines-meta">
                        <strong>Entrega:</strong>{' '}
                        {String(o.shippingAddress.name || '').trim() || '-'} -{' '}
                        {String(o.shippingAddress.street || '').trim()}, {String(o.shippingAddress.city || '').trim()}/
                        {String(o.shippingAddress.state || '').trim()} - CEP {String(o.shippingAddress.zip || '').trim()}
                      </p>
                    ) : null}
                    {snap.shippingNote ? <p className="meus-pedidos-pod-card__note">{String(snap.shippingNote)}</p> : null}
                    {track && trackUrl ? (
                      <div className="loja-order-tracking-block">
                        <p>
                          <strong>Codigo de rastreio:</strong> <code>{track}</code>
                        </p>
                        <a className="loja-btn-ghost loja-btn-small" href={trackUrl} target="_blank" rel="noopener noreferrer">
                          Abrir rastreio nos Correios
                        </a>
                      </div>
                    ) : null}
                    <p className="meus-pedidos-pod-card__hint">
                      Atualizacoes tambem aparecem nas <Link to="/perfil">notificacoes da conta</Link>.
                    </p>
                  </div>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
