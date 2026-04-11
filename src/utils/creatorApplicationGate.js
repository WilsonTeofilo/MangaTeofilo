/**
 * Gate de aprovação de criador (UI) — mesmas metas que `functions/creatorApplicationGate.js`.
 */
import { metricsFromUsuarioRow, VITRINE_PROMO_THRESHOLDS } from './creatorProgression.js';

export const CREATOR_APPLICATION_APPROVAL_THRESHOLDS = VITRINE_PROMO_THRESHOLDS;

function norm(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

export function evaluateCreatorApplicationApprovalGate(row, creatorStatsOverride = null) {
  const metrics = metricsFromUsuarioRow(row, creatorStatsOverride || row?.creatorsStats || null);
  const thresholds = VITRINE_PROMO_THRESHOLDS;
  const ok =
    metrics.followers >= thresholds.followers &&
    metrics.views >= thresholds.views &&
    metrics.likes >= thresholds.likes;
  return {
    ok,
    metrics,
    thresholds,
    shortfalls: {
      followers: Math.max(0, thresholds.followers - metrics.followers),
      views: Math.max(0, thresholds.views - metrics.views),
      likes: Math.max(0, thresholds.likes - metrics.likes),
    },
    surplus: {
      followers: Math.max(0, metrics.followers - thresholds.followers),
      views: Math.max(0, metrics.views - thresholds.views),
      likes: Math.max(0, metrics.likes - thresholds.likes),
    },
  };
}

/** Formata comparação para uma métrica (falta X ou sobra Y). */
export function formatMetricDeltaLine(key, gate) {
  const cur = norm(gate.metrics[key]);
  const need = norm(gate.thresholds[key]);
  if (cur >= need) {
    const extra = gate.surplus[key];
    return extra > 0 ? `Meta atingida (+${extra} acima)` : 'Meta exata';
  }
  const miss = gate.shortfalls[key];
  return `Faltam ${miss} para a meta`;
}
