/**
 * Metas mínimas para aprovação manual de candidatura (monetização em fila).
 * Espelha `VITRINE_PROMO_THRESHOLDS` / CREATOR_LEVEL_THRESHOLDS[1] em `src/utils/creatorProgression.js`.
 */
import { readCreatorStatsFromDb } from './creatorRecord.js';

export const CREATOR_APPLICATION_APPROVAL_THRESHOLDS = {
  followers: 300,
  views: 5000,
  likes: 100,
};

function norm(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

export function metricsFromUsuarioRowForCreatorApproval(row) {
  if (!row || typeof row !== 'object') {
    return { followers: 0, views: 0, likes: 0 };
  }
  const stats = readCreatorStatsFromDb(row, row?.creatorStats || null);
  return {
    followers: norm(stats.followersCount),
    views: norm(stats.totalViews),
    likes: norm(stats.likesTotal),
  };
}

/**
 * @returns {{ ok: boolean, metrics: object, thresholds: object, shortfalls: object, surplus: object }}
 */
export function evaluateCreatorApplicationApprovalGate(row) {
  const metrics = metricsFromUsuarioRowForCreatorApproval(row);
  const thresholds = CREATOR_APPLICATION_APPROVAL_THRESHOLDS;
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
