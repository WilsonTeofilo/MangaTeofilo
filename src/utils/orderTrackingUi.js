/**
 * Timeline unificada (compras loja + mangá físico) — inspirada em fluxos tipo marketplace.
 * Passos: criado → pagamento → produção → a caminho → entregue.
 */

export const UNIFIED_TIMELINE_STEPS = Object.freeze([
  { key: 'created', label: 'Pedido criado' },
  { key: 'payment', label: 'Pagamento confirmado' },
  { key: 'production', label: 'Em produção' },
  { key: 'transit', label: 'Enviado · em trânsito' },
  { key: 'delivered', label: 'Entregue' },
]);

/** @typedef {'all'|'payment_pending'|'production'|'transit'|'delivered'|'cancelled'|'problem'} OrderFilterBucket */

/** @param {string} [status] */
export function normalizeStoreStatus(status) {
  return String(status || '').trim().toLowerCase();
}

/**
 * @param {string} status
 * @returns {{ activeStep: number, cancelled: boolean, problem: boolean, problemHint?: string, paymentPending: boolean }}
 */
export function storeOrderTimelineMeta(status, paymentStatus) {
  const s = normalizeStoreStatus(status);
  const ps = String(paymentStatus || '').trim().toLowerCase();
  const problem =
    ps === 'rejected' ||
    ps === 'cancelled' ||
    ps === 'refunded' ||
    (s !== 'cancelled' && ps && ps !== 'approved' && ps !== '' && s === 'pending');
  if (s === 'cancelled') {
    return { activeStep: -1, cancelled: true, problem: false, paymentPending: false };
  }
  if (problem) {
    return {
      activeStep: 0,
      cancelled: false,
      problem: true,
      problemHint:
        ps === 'rejected'
          ? 'Pagamento recusado ou cancelado. Refaça o checkout se necessário.'
          : 'Há uma pendência no pagamento. Verifique o Mercado Pago ou entre em contato.',
      paymentPending: true,
    };
  }
  if (s === 'pending' || s === 'pending_payment') {
    return { activeStep: 0, cancelled: false, problem: false, paymentPending: true };
  }
  if (s === 'paid' || s === 'order_received') {
    return { activeStep: 1, cancelled: false, problem: false, paymentPending: false };
  }
  if (s === 'processing' || s === 'in_production') {
    return { activeStep: 2, cancelled: false, problem: false, paymentPending: false };
  }
  if (s === 'ready_to_ship' || s === 'shipped') {
    return { activeStep: 3, cancelled: false, problem: false, paymentPending: false };
  }
  if (s === 'delivered') {
    return { activeStep: 4, cancelled: false, problem: false, paymentPending: false };
  }
  return { activeStep: 1, cancelled: false, problem: false, paymentPending: false };
}

/**
 * @param {string} status
 * @returns {{ activeStep: number, cancelled: boolean, problem: boolean, productionHint?: string }}
 */
export function podOrderTimelineMeta(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return { activeStep: 0, cancelled: false, problem: false };
  if (s === 'cancelled') {
    return { activeStep: -1, cancelled: true, problem: false };
  }
  if (s === 'pending_payment') {
    return { activeStep: 0, cancelled: false, problem: false };
  }
  if (s === 'paid') {
    return { activeStep: 2, cancelled: false, problem: false, productionHint: 'Aguardando entrada na fila de produção.' };
  }
  if (s === 'in_production') {
    return { activeStep: 2, cancelled: false, problem: false, productionHint: 'Lote em produção na gráfica.' };
  }
  if (s === 'ready_to_ship') {
    return { activeStep: 3, cancelled: false, problem: false, productionHint: 'Pronto para postagem.' };
  }
  if (s === 'shipped') {
    return { activeStep: 3, cancelled: false, problem: false };
  }
  if (s === 'delivered') {
    return { activeStep: 4, cancelled: false, problem: false };
  }
  return { activeStep: 0, cancelled: false, problem: false };
}

/**
 * @param {number} activeStep - índice do passo atual (0..4), -1 cancelado
 * @param {boolean} cancelled
 * @param {boolean} problem
 */
export function buildTimelineStepsState(activeStep, cancelled, problem) {
  const steps = UNIFIED_TIMELINE_STEPS.map((st, i) => {
    if (cancelled) {
      return { ...st, state: 'upcoming' };
    }
    if (problem && i > 0) {
      return { ...st, state: 'upcoming' };
    }
    if (i < activeStep) return { ...st, state: 'done' };
    if (i === activeStep) return { ...st, state: 'current' };
    return { ...st, state: 'upcoming' };
  });
  return { steps, cancelled, problem };
}

/** @param {object} order */
export function storeOrderFilterBucket(order) {
  const s = normalizeStoreStatus(order?.status);
  const ps = String(order?.paymentStatus || '').trim().toLowerCase();
  if (s === 'cancelled') return 'cancelled';
  if (ps === 'rejected' || ps === 'cancelled' || (s === 'pending' && ps && ps !== 'approved')) return 'problem';
  if (s === 'pending' || s === 'pending_payment') return 'payment_pending';
  if (s === 'processing' || s === 'in_production' || s === 'paid' || s === 'order_received') return 'production';
  if (s === 'ready_to_ship' || s === 'shipped') return 'transit';
  if (s === 'delivered') return 'delivered';
  return 'production';
}

/** @param {object} order */
export function podOrderFilterBucket(order) {
  const s = String(order?.status || '').trim().toLowerCase();
  if (s === 'cancelled') return 'cancelled';
  if (s === 'pending_payment') return 'payment_pending';
  if (s === 'paid' || s === 'in_production') return 'production';
  if (s === 'ready_to_ship' || s === 'shipped') return 'transit';
  if (s === 'delivered') return 'delivered';
  return 'production';
}

/**
 * @param {object[]} items
 * @param {string} q
 */
export function storeOrderMatchesSearch(order, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  const id = String(order?.id || '').toLowerCase();
  if (id.includes(needle) || id.slice(-8).includes(needle)) return true;
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.some((it) => {
    const t = String(it?.title || it?.productId || '').toLowerCase();
    return t.includes(needle);
  });
}

export function podOrderMatchesSearch(order, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  const id = String(order?.id || '').toLowerCase();
  if (id.includes(needle) || id.slice(-8).includes(needle)) return true;
  const snap = order?.snapshot && typeof order.snapshot === 'object' ? order.snapshot : {};
  const blob = [snap.saleModel, snap.format, snap.quantity != null ? String(snap.quantity) : '']
    .join(' ')
    .toLowerCase();
  return blob.includes(needle);
}

export const ORDER_FILTER_OPTIONS = Object.freeze([
  { value: 'all', label: 'Todos os status' },
  { value: 'payment_pending', label: 'Aguardando pagamento' },
  { value: 'production', label: 'Em produção / preparação' },
  { value: 'transit', label: 'Enviado · em trânsito' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'problem', label: 'Problema no pedido' },
]);

export function shortOrderPublicId(id) {
  return String(id || '').slice(-8).toUpperCase();
}

/**
 * @param {object} order
 * @param {{ key: string, label: string, state: string }[]} steps
 * @param {(ts: number) => string} formatDate
 */
export function enrichStoreTimelineSteps(order, steps, formatDate) {
  const meta = storeOrderTimelineMeta(order?.status, order?.paymentStatus);
  const s = normalizeStoreStatus(order?.status);
  const fmt = (ts) => formatDate(Number(ts || 0));
  return steps.map((step) => {
    if (step.key === 'created') {
      return { ...step, detail: `Registrado em ${fmt(order?.createdAt)}` };
    }
    if (step.key === 'payment') {
      if (meta.problem) return { ...step, detail: meta.problemHint || 'Há uma pendência no pagamento.' };
      if (meta.paymentPending) return { ...step, detail: 'Aguardando confirmação do Mercado Pago.' };
      const paidTs = Number(order?.paidAt || 0);
      return { ...step, detail: paidTs ? `Confirmado em ${fmt(paidTs)}` : 'Pagamento confirmado.' };
    }
    if (step.key === 'production') {
      if (s === 'processing' || s === 'in_production' || s === 'paid' || s === 'order_received') {
        return { ...step, detail: `Última movimentação: ${fmt(order?.updatedAt || order?.createdAt)}` };
      }
      return { ...step, detail: 'Preparação e produção do pedido.' };
    }
    if (step.key === 'transit') {
      if (s === 'ready_to_ship' || s === 'shipped') {
        const tr = String(order?.trackingCode || order?.codigoRastreio || '').trim();
        return {
          ...step,
          detail: tr ? `Código: ${tr}` : `Postado · atualizado em ${fmt(order?.updatedAt)}`,
        };
      }
      return { ...step, detail: 'Envio pelos Correios após produção.' };
    }
    if (step.key === 'delivered') {
      if (s === 'delivered') return { ...step, detail: `Concluído em ${fmt(order?.updatedAt)}` };
      return { ...step, detail: 'Confirmação de entrega ao comprador.' };
    }
    return { ...step, detail: '' };
  });
}

/**
 * @param {object} order
 * @param {{ key: string, label: string, state: string }[]} steps
 * @param {(ts: number) => string} formatDate
 */
export function enrichPodTimelineSteps(order, steps, formatDate, nowMs = Date.now()) {
  const st = String(order?.status || '').trim().toLowerCase();
  const fmt = (ts) => formatDate(Number(ts || 0));
  const { productionHint: podHint } = podOrderTimelineMeta(order?.status);
  return steps.map((step) => {
    if (step.key === 'created') return { ...step, detail: `Registrado em ${fmt(order?.createdAt)}` };
    if (step.key === 'payment') {
      if (st === 'pending_payment') {
        const exp = Number(order?.expiresAt || 0);
        if (exp > 0) {
          const left = Math.max(0, Math.floor((exp - nowMs) / 1000));
          if (left <= 0) {
            return {
              ...step,
              detail: 'Prazo de reserva esgotado — o pedido será cancelado se o pagamento não for confirmado.',
            };
          }
          const h = Math.floor(left / 3600);
          const m = Math.floor((left % 3600) / 60);
          const s = left % 60;
          const pad = (n) => String(n).padStart(2, '0');
          return {
            ...step,
            detail: `Aguardando pagamento. Expira em ${pad(h)}:${pad(m)}:${pad(s)}.`,
          };
        }
        return { ...step, detail: 'Aguardando pagamento do lote.' };
      }
      return { ...step, detail: 'Pagamento do pedido físico confirmado.' };
    }
    if (step.key === 'production') {
      const line = podHint || 'Produção na gráfica.';
      return { ...step, detail: `${line} Atualizado em ${fmt(order?.updatedAt || order?.createdAt)}` };
    }
    if (step.key === 'transit') {
      if (st === 'shipped' || st === 'ready_to_ship') {
        const tr = String(order?.trackingCode || '').trim();
        return { ...step, detail: tr ? `Código: ${tr}` : `Logística · ${fmt(order?.updatedAt)}` };
      }
      return { ...step, detail: 'Envio após produção.' };
    }
    if (step.key === 'delivered') {
      if (st === 'delivered') return { ...step, detail: `Entregue · ${fmt(order?.updatedAt)}` };
      return { ...step, detail: 'Entrega ao endereço informado.' };
    }
    return { ...step, detail: '' };
  });
}
