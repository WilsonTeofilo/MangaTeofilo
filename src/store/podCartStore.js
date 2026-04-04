const KEY = 'mangateofilo_pod_cart_v1';

export const POD_CART_CHANGED_EVENT = 'mangateofilo:podcart';

function notifyPodCartChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(POD_CART_CHANGED_EVENT));
}

/**
 * Rascunho único de lote POD (um pagamento por vez). Contém URLs já enviadas ao Storage.
 * @typedef {{
 *   saleModel: string,
 *   format: string,
 *   quantity: number,
 *   unitSalePriceBRL?: number,
 *   linkedWorkId?: string|null,
 *   pdfUrl: string,
 *   coverUrl: string,
 *   amountDueBRL: number,
 *   labelLine: string,
 *   obraTitle?: string,
 *   addedAt: number,
 * }} PodCartDraft
 */

/** @returns {PodCartDraft | null} */
export function getPodCartDraft() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    if (!o.pdfUrl || !o.coverUrl || !o.saleModel || !o.format) return null;
    return o;
  } catch {
    return null;
  }
}

/** @param {PodCartDraft | null} draft */
export function setPodCartDraft(draft) {
  if (draft == null) {
    localStorage.removeItem(KEY);
  } else {
    localStorage.setItem(KEY, JSON.stringify(draft));
  }
  notifyPodCartChanged();
}

export function clearPodCartDraft() {
  localStorage.removeItem(KEY);
  notifyPodCartChanged();
}

export function hasPodCartDraft() {
  return getPodCartDraft() != null;
}
