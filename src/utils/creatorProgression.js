/**
 * Creator progression helpers for display. Sensitive gating stays in the backend.
 * Canonical metrics source: creators/{uid}/stats.
 */

import { STORE_PROMO_ELIGIBILITY_THRESHOLDS } from '../../functions/shared/promoThresholds.js';
import {
  normalizeCreatorEngagementMetrics,
  resolveCreatorEngagementMetrics,
} from '../../functions/shared/creatorEngagementMetrics.js';

export const CREATOR_LEVEL_THRESHOLDS = {
  1: STORE_PROMO_ELIGIBILITY_THRESHOLDS,
  2: { followers: 200, views: 10000, likes: 80 },
  3: { followers: 400, views: 80000, likes: 80 },
};

export const VITRINE_PROMO_THRESHOLDS = CREATOR_LEVEL_THRESHOLDS[1];
export const MONETIZATION_THRESHOLDS = CREATOR_LEVEL_THRESHOLDS[2];

export const CREATOR_LEVEL_META = {
  0: {
    id: 0,
    key: 'beginner',
    title: 'Iniciante',
    short: 'Iniciante',
    emoji: '🟤',
    color: '#a8a29e',
    perks: ['Publicar obras', 'Modo vitrine ao bater as metas do Nível 1'],
  },
  1: {
    id: 1,
    key: 'rising',
    title: 'Em ascensão',
    short: 'Em ascensão',
    emoji: '🟡',
    color: '#eab308',
    perks: ['Prioridade leve no ranking', 'Vitrine da loja liberada nas metas'],
  },
  2: {
    id: 2,
    key: 'monetized',
    title: 'Monetizado',
    short: 'Monetizado',
    emoji: '🟢',
    color: '#22c55e',
    perks: ['Ganhar com vendas da loja', 'Apoios e recebimentos após cadastro aprovado'],
  },
  3: {
    id: 3,
    key: 'spotlight',
    title: 'Destaque',
    short: 'Destaque',
    emoji: '🔵',
    color: '#38bdf8',
    perks: ['Mais exposição', 'Prioridade na vitrine (evoluindo)', 'Selo especial (em breve)'],
  },
};

export const MONETIZATION_REWARD_LINES = [
  'Receber pelos seus apoios e membros',
  'Ganhar com vendas da loja',
  'Liberar recursos financeiros do creator',
];

function norm(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

function buildProgressRows(metrics, thresholds) {
  return [
    { key: 'followers', label: 'Seguidores', current: metrics.followers, target: thresholds.followers },
    { key: 'views', label: 'Views totais', current: metrics.views, target: thresholds.views },
    { key: 'likes', label: 'Likes totais', current: metrics.likes, target: thresholds.likes },
  ];
}

function averagePercent(rows) {
  if (!rows.length) return 100;
  const total = rows.reduce((sum, row) => {
    const target = Math.max(1, Number(row.target) || 1);
    return sum + Math.min(1, Math.max(0, Number(row.current) || 0) / target);
  }, 0);
  return Math.min(100, Math.round((total / rows.length) * 100));
}

function buildGapRows(rows) {
  return rows
    .map((row) => ({
      key: row.key,
      label: String(row.label || '').toLowerCase(),
      left: Math.max(0, norm(row.target) - norm(row.current)),
    }))
    .filter((row) => row.left > 0);
}

function firstGapPhrase(gaps, suffix) {
  if (!gaps.length) return null;
  const sorted = [...gaps].sort((a, b) => a.left - b.left);
  const gap = sorted[0];
  const nf = new Intl.NumberFormat('pt-BR');
  return `Faltam ${nf.format(gap.left)} ${gap.label}${suffix}`;
}

export function metricsFromUsuarioRow(row, creatorStatsOverride = null) {
  return resolveCreatorEngagementMetrics({
    creatorStats: creatorStatsOverride || row?.creatorsStats || null,
    userRow: row,
  });
}

export function normalizeCreatorMetrics(metrics) {
  return normalizeCreatorEngagementMetrics(metrics);
}

function computeCreatorLevel(metrics) {
  const normalized = normalizeCreatorMetrics(metrics);
  if (
    normalized.followers >= CREATOR_LEVEL_THRESHOLDS[3].followers &&
    normalized.views >= CREATOR_LEVEL_THRESHOLDS[3].views &&
    normalized.likes >= CREATOR_LEVEL_THRESHOLDS[3].likes
  ) {
    return 3;
  }
  if (
    normalized.followers >= CREATOR_LEVEL_THRESHOLDS[2].followers &&
    normalized.views >= CREATOR_LEVEL_THRESHOLDS[2].views &&
    normalized.likes >= CREATOR_LEVEL_THRESHOLDS[2].likes
  ) {
    return 2;
  }
  if (
    normalized.followers >= CREATOR_LEVEL_THRESHOLDS[1].followers &&
    normalized.views >= CREATOR_LEVEL_THRESHOLDS[1].views &&
    normalized.likes >= CREATOR_LEVEL_THRESHOLDS[1].likes
  ) {
    return 1;
  }
  return 0;
}

export function buildCreatorProgressViewModel(metrics) {
  const normalized = normalizeCreatorMetrics(metrics);
  const level = computeCreatorLevel(normalized);
  const nextLevel = level >= 3 ? null : level + 1;
  const nextLevelRows = nextLevel == null ? [] : buildProgressRows(normalized, CREATOR_LEVEL_THRESHOLDS[nextLevel]);
  const nextLevelGapRows = buildGapRows(nextLevelRows);
  const monetizationProgressRows = buildProgressRows(normalized, MONETIZATION_THRESHOLDS);
  const monetizationGapRows = buildGapRows(monetizationProgressRows);

  return {
    metrics: normalized,
    level,
    meta: CREATOR_LEVEL_META[level] || CREATOR_LEVEL_META[0],
    nextLevel,
    nextLevelMeta: nextLevel == null ? null : CREATOR_LEVEL_META[nextLevel] || null,
    nextLevelRows,
    nextLevelGapRows,
    nextLevelProgressPercent: nextLevel == null ? 100 : averagePercent(nextLevelRows),
    primaryNextLevelGapPhrase:
      nextLevel == null
        ? 'Você atingiu o nível máximo de metas da plataforma.'
        : firstGapPhrase(nextLevelGapRows, ' para o próximo nível'),
    monetizationProgressRows,
    monetizationGapRows,
    monetizationProgressPercent: averagePercent(monetizationProgressRows),
    monetizationThresholdReached: level >= 2,
    primaryMonetizationGapPhrase: firstGapPhrase(monetizationGapRows, ' para monetizar'),
  };
}

export function creatorDiscoveryLevelBoost(metrics) {
  const level = buildCreatorProgressViewModel(metrics).level;
  if (level <= 0) return 0;
  if (level === 1) return 220;
  if (level === 2) return 480;
  return 820;
}

