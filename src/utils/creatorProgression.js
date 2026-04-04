/**
 * Níveis de criador — métricas agregadas (seguidores, views totais, likes totais).
 * Fonte: `usuarios/{uid}/creatorProfile/stats` (espelhada em `stats` no perfil).
 */

/** Nível 1 = Em ascensão · Nível 2 = Monetizado (POD com repasse + vitrine metas) · Nível 3 = Destaque */
export const CREATOR_LEVEL_THRESHOLDS = {
  1: { followers: 300, views: 5000, likes: 100 },
  2: { followers: 1000, views: 20000, likes: 500 },
  3: { followers: 5000, views: 80000, likes: 2000 },
};

/** Metas modo vitrine POD = Nível 1 */
export const VITRINE_PROMO_THRESHOLDS = CREATOR_LEVEL_THRESHOLDS[1];

/** Alvo único “quase monetizando” (barras % e copy) = Nível 2 */
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
    perks: ['Prioridade leve no ranking', 'Vitrine POD liberada nas metas'],
  },
  2: {
    id: 2,
    key: 'monetized',
    title: 'Monetizado',
    short: 'Monetizado',
    emoji: '🟢',
    color: '#22c55e',
    perks: ['Ganhar com a loja (POD + repasse)', 'Membership e Pix conforme cadastro aprovado'],
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

/** Recompensas exibidas ao usuário rumo ao Nível 2 */
export const MONETIZATION_REWARD_LINES = [
  'Monetização e repasses (com aprovação no perfil)',
  'Venda na loja — mangá físico com repasse',
  'Membership e apoio direto',
];

function norm(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

/**
 * @param {object | null | undefined} row — nó `usuarios/{uid}`
 */
export function metricsFromUsuarioRow(row) {
  if (!row || typeof row !== 'object') {
    return { followers: 0, views: 0, likes: 0 };
  }
  return {
    followers: norm(row?.creatorProfile?.stats?.followersCount ?? row?.stats?.followersCount),
    views: norm(row?.creatorProfile?.stats?.totalViews ?? row?.stats?.totalViews),
    likes: norm(row?.creatorProfile?.stats?.totalLikes ?? row?.stats?.totalLikes),
  };
}

/**
 * @param {{ followers?: number, views?: number, likes?: number }} m
 */
export function normalizeCreatorMetrics(m) {
  return {
    followers: norm(m?.followers),
    views: norm(m?.views),
    likes: norm(m?.likes),
  };
}

/**
 * @param {{ followers?: number, views?: number, likes?: number }} metrics
 * @returns {0|1|2|3}
 */
export function computeCreatorLevel(metrics) {
  const m = normalizeCreatorMetrics(metrics);
  if (
    m.followers >= CREATOR_LEVEL_THRESHOLDS[3].followers &&
    m.views >= CREATOR_LEVEL_THRESHOLDS[3].views &&
    m.likes >= CREATOR_LEVEL_THRESHOLDS[3].likes
  ) {
    return 3;
  }
  if (
    m.followers >= CREATOR_LEVEL_THRESHOLDS[2].followers &&
    m.views >= CREATOR_LEVEL_THRESHOLDS[2].views &&
    m.likes >= CREATOR_LEVEL_THRESHOLDS[2].likes
  ) {
    return 2;
  }
  if (
    m.followers >= CREATOR_LEVEL_THRESHOLDS[1].followers &&
    m.views >= CREATOR_LEVEL_THRESHOLDS[1].views &&
    m.likes >= CREATOR_LEVEL_THRESHOLDS[1].likes
  ) {
    return 1;
  }
  return 0;
}

/** % médio rumo às metas de monetização (Nível 2), 0–100 */
export function getMonetizationProgressPercent(metrics) {
  const m = normalizeCreatorMetrics(metrics);
  const t = MONETIZATION_THRESHOLDS;
  const pf = Math.min(1, m.followers / Math.max(1, t.followers));
  const pv = Math.min(1, m.views / Math.max(1, t.views));
  const pl = Math.min(1, m.likes / Math.max(1, t.likes));
  return Math.min(100, Math.round(((pf + pv + pl) / 3) * 100));
}

/** Linhas para barras “progresso para monetização” (sempre alvo Nível 2) */
export function getMonetizationProgressRows(metrics) {
  const m = normalizeCreatorMetrics(metrics);
  const t = MONETIZATION_THRESHOLDS;
  return [
    { key: 'followers', label: 'Seguidores', current: m.followers, target: t.followers },
    { key: 'views', label: 'Views', current: m.views, target: t.views },
    { key: 'likes', label: 'Likes', current: m.likes, target: t.likes },
  ];
}

/** Gaps até monetização (nível 2), só itens que faltam */
export function getGapsUntilMonetization(metrics) {
  const m = normalizeCreatorMetrics(metrics);
  const t = MONETIZATION_THRESHOLDS;
  const rows = [
    { key: 'followers', label: 'seguidores', left: Math.max(0, t.followers - m.followers) },
    { key: 'views', label: 'views', left: Math.max(0, t.views - m.views) },
    { key: 'likes', label: 'likes', left: Math.max(0, t.likes - m.likes) },
  ];
  return rows.filter((r) => r.left > 0);
}

/** Uma frase curta: o que mais aproxima de monetizar */
export function getPrimaryMonetizationGapPhrase(metrics) {
  const gaps = getGapsUntilMonetization(metrics);
  if (!gaps.length) return null;
  gaps.sort((a, b) => a.left - b.left);
  const g = gaps[0];
  const nf = new Intl.NumberFormat('pt-BR');
  return `Faltam ${nf.format(g.left)} ${g.label} para monetizar`;
}

/**
 * Progresso rumo ao próximo nível (card secundário).
 */
export function getProgressTowardsNextLevel(metrics) {
  const m = normalizeCreatorMetrics(metrics);
  const level = computeCreatorLevel(m);
  if (level >= 3) {
    return { level, nextLevel: null, rows: [] };
  }
  const next = level + 1;
  const t = CREATOR_LEVEL_THRESHOLDS[next];
  const rows = [
    { key: 'followers', label: 'Seguidores', current: m.followers, target: t.followers },
    { key: 'views', label: 'Views totais', current: m.views, target: t.views },
    { key: 'likes', label: 'Likes totais', current: m.likes, target: t.likes },
  ];
  return { level, nextLevel: next, rows };
}

/** Nudge longo (perfil legal) */
export function getMonetizationNudgeMessage(metrics) {
  const line = getPrimaryMonetizationGapPhrase(metrics);
  if (!line) return null;
  return `${line} na plataforma — aí liberamos venda pelo POD com repasse (com monetização aprovada).`;
}

export function meetsMonetizationLevel(metrics) {
  return computeCreatorLevel(metrics) >= 2;
}

/** Boost discreto no ranking por nível */
export function creatorDiscoveryLevelBoost(metrics) {
  const lv = computeCreatorLevel(metrics);
  if (lv <= 0) return 0;
  if (lv === 1) return 220;
  if (lv === 2) return 480;
  return 820;
}
