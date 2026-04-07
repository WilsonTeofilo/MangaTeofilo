/**
 * Client-only helpers for rendering the engagement cycle snapshot that comes
 * from the backend. Mission completion, streaks, boosts, and level transitions
 * are server-authoritative in `functions/creatorEngagementCycleServer.js`.
 */

export const ENGAGEMENT_CYCLE_LEVEL_MIN = 1;
export const ENGAGEMENT_CYCLE_LEVEL_MAX = 5;

export const BOOST_MUL_BY_LEVEL = {
  1: 1.2,
  2: 1.4,
  3: 1.6,
  4: 1.8,
  5: 2.2,
};

export const BOOST_MS_BY_LEVEL = {
  1: 6 * 60 * 60 * 1000,
  2: 24 * 60 * 60 * 1000,
  3: 48 * 60 * 60 * 1000,
  4: 48 * 60 * 60 * 1000,
  5: 72 * 60 * 60 * 1000,
};

const VALID_BOOST_MUL_VALUES = Object.values(BOOST_MUL_BY_LEVEL);

function norm(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

function normalizeCreatorMetrics(metrics) {
  return {
    followers: norm(metrics?.followers),
    views: norm(metrics?.views),
    likes: norm(metrics?.likes),
  };
}

function defaultCycleState(metrics, now = Date.now()) {
  const normalized = normalizeCreatorMetrics(metrics);
  return {
    v: 1,
    cycleLevel: ENGAGEMENT_CYCLE_LEVEL_MIN,
    cycleStartedAt: now,
    baselines: {
      followers: normalized.followers,
      views: normalized.views,
      likes: normalized.likes,
    },
    completedIds: {},
    repliesInCycle: 0,
    streakCount: 0,
    lastStreakKey: '',
    activeBoostMul: null,
    activeBoostUntil: null,
    spotlightUntil: null,
    badgeTier: 0,
  };
}

function isValidBoostMul(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return false;
  return VALID_BOOST_MUL_VALUES.some((candidate) => Math.abs(candidate - numeric) < 0.001);
}

function sanitizeBoostFields(mul, until, now) {
  const boostUntil = until != null ? Number(until) : null;
  const boostMul = mul != null ? Number(mul) : null;
  if (
    boostMul == null ||
    boostUntil == null ||
    !Number.isFinite(boostUntil) ||
    boostUntil <= now ||
    !Number.isFinite(boostMul) ||
    boostMul <= 1 ||
    !isValidBoostMul(boostMul)
  ) {
    return { mul: null, until: null };
  }
  return { mul: boostMul, until: boostUntil };
}

export function requiredMissionsForCycleLevel(level) {
  const normalized = norm(level) || 1;
  if (normalized <= 1) return 2;
  if (normalized <= 3) return 3;
  return 5;
}

export function getMissionPoolForLevel(level) {
  const normalized = Math.min(
    ENGAGEMENT_CYCLE_LEVEL_MAX,
    Math.max(ENGAGEMENT_CYCLE_LEVEL_MIN, norm(level) || 1)
  );

  switch (normalized) {
    case 1:
      return [
        { id: 'ch_bonus', label: 'Publicar 1 capitulo novo', xp: 50, kind: 'chapter' },
        { id: 'likes_20', label: 'Subir +20 likes desde o inicio do ciclo', xp: 25, kind: 'likes_delta', need: 20 },
        { id: 'views_100', label: 'Subir +100 views desde o inicio do ciclo', xp: 20, kind: 'views_delta', need: 100 },
      ];
    case 2:
      return [
        { id: 'ch_bonus', label: 'Publicar 1 capitulo novo', xp: 50, kind: 'chapter' },
        { id: 'likes_40', label: 'Subir +40 likes desde o inicio do ciclo', xp: 30, kind: 'likes_delta', need: 40 },
        { id: 'views_300', label: 'Subir +300 views desde o inicio do ciclo', xp: 25, kind: 'views_delta', need: 300 },
        { id: 'fol_5', label: 'Subir +5 seguidores desde o inicio do ciclo', xp: 40, kind: 'followers_delta', need: 5 },
      ];
    case 3:
      return [
        { id: 'ch_bonus', label: 'Publicar 1 capitulo novo', xp: 50, kind: 'chapter' },
        { id: 'likes_80', label: 'Subir +80 likes desde o inicio do ciclo', xp: 35, kind: 'likes_delta', need: 80 },
        { id: 'views_800', label: 'Subir +800 views desde o inicio do ciclo', xp: 30, kind: 'views_delta', need: 800 },
        { id: 'fol_10', label: 'Subir +10 seguidores desde o inicio do ciclo', xp: 45, kind: 'followers_delta', need: 10 },
      ];
    case 4:
      return [
        { id: 'ch_bonus', label: 'Publicar 1 capitulo novo', xp: 50, kind: 'chapter' },
        { id: 'likes_150', label: 'Subir +150 likes desde o inicio do ciclo', xp: 40, kind: 'likes_delta', need: 150 },
        { id: 'views_2000', label: 'Subir +2.000 views desde o inicio do ciclo', xp: 35, kind: 'views_delta', need: 2000 },
        { id: 'fol_20', label: 'Subir +20 seguidores desde o inicio do ciclo', xp: 50, kind: 'followers_delta', need: 20 },
        { id: 'rep_5', label: 'Responder 5 comentarios nos seus capitulos', xp: 30, kind: 'replies', need: 5 },
        { id: 'views_2500', label: 'Ou subir +2.500 views desde o inicio do ciclo', xp: 35, kind: 'views_delta', need: 2500 },
      ];
    case 5:
    default:
      return [
        { id: 'ch_bonus', label: 'Publicar 1 capitulo novo', xp: 50, kind: 'chapter' },
        { id: 'likes_300', label: 'Subir +300 likes desde o inicio do ciclo', xp: 45, kind: 'likes_delta', need: 300 },
        { id: 'views_5000', label: 'Subir +5.000 views desde o inicio do ciclo', xp: 40, kind: 'views_delta', need: 5000 },
        { id: 'fol_40', label: 'Subir +40 seguidores desde o inicio do ciclo', xp: 55, kind: 'followers_delta', need: 40 },
        { id: 'streak_7', label: 'Entrar no painel do criador 7 dias seguidos', xp: 35, kind: 'streak', need: 7 },
        { id: 'likes_350', label: 'Ou subir +350 likes desde o inicio do ciclo', xp: 45, kind: 'likes_delta', need: 350 },
      ];
  }
}

function formatBoostDurationPt(level) {
  const ms = BOOST_MS_BY_LEVEL[level] || 0;
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)} dia(s)`;
}

export function rewardLinesForCompletingCycleLevel(level) {
  const normalized = Math.min(
    ENGAGEMENT_CYCLE_LEVEL_MAX,
    Math.max(ENGAGEMENT_CYCLE_LEVEL_MIN, norm(level) || 1)
  );

  if (normalized >= ENGAGEMENT_CYCLE_LEVEL_MAX) {
    return [
      `Boost forte no feed (${BOOST_MUL_BY_LEVEL[5]}x) por ${formatBoostDurationPt(5)}`,
      'Selo especial e mais chance de aparecer para novos leitores',
      'Depois o ciclo volta para a fase 1 (o boost atual continua ate expirar)',
    ];
  }

  const lines = [`Boost no feed ${BOOST_MUL_BY_LEVEL[normalized]}x por ${formatBoostDurationPt(normalized)}`];
  if (normalized >= 3) lines.push('Selo e destaque no perfil');
  if (normalized >= 4) lines.push('Empurrao leve no ranking e na vitrine');
  return lines;
}

export function buildEngagementCycleViewModel(state, metrics, now = Date.now()) {
  const safeState =
    state && typeof state === 'object' && state.cycleStartedAt != null
      ? state
      : defaultCycleState(metrics, now);

  const normalizedMetrics = normalizeCreatorMetrics(metrics);
  const baselines = {
    followers: norm(safeState.baselines?.followers),
    views: norm(safeState.baselines?.views),
    likes: norm(safeState.baselines?.likes),
  };
  const deltas = {
    followers: Math.max(0, normalizedMetrics.followers - baselines.followers),
    views: Math.max(0, normalizedMetrics.views - baselines.views),
    likes: Math.max(0, normalizedMetrics.likes - baselines.likes),
  };

  const cycleLevel = Math.min(
    ENGAGEMENT_CYCLE_LEVEL_MAX,
    Math.max(ENGAGEMENT_CYCLE_LEVEL_MIN, norm(safeState.cycleLevel) || 1)
  );
  const completedIds =
    safeState.completedIds && typeof safeState.completedIds === 'object'
      ? safeState.completedIds
      : {};
  const missions = getMissionPoolForLevel(cycleLevel).map((mission) => ({
    ...mission,
    done: completedIds[mission.id] === true,
  }));
  const need = requiredMissionsForCycleLevel(cycleLevel);
  const doneCount = missions.filter((mission) => mission.done).length;
  const poolSize = missions.length;
  const pct = need > 0 ? Math.min(100, Math.round((doneCount / need) * 100)) : 0;
  const remaining = Math.max(0, need - doneCount);
  const nudge =
    remaining === 0
      ? 'Meta desta fase concluida. O servidor avanca a proxima fase no proximo tick.'
      : remaining === 1
        ? 'Falta 1 missao para fechar esta fase.'
        : `Faltam ${remaining} missoes para fechar esta fase.`;

  const sanitizedBoost = sanitizeBoostFields(
    safeState.activeBoostMul,
    safeState.activeBoostUntil,
    now
  );
  const boostActive = sanitizedBoost.until != null && sanitizedBoost.mul != null;
  const boostRemainingMs = boostActive ? sanitizedBoost.until - now : 0;
  const xpVisualTotal = missions
    .filter((mission) => mission.done)
    .reduce((total, mission) => total + norm(mission.xp), 0);

  return {
    cycleLevel,
    missions,
    need,
    poolSize,
    doneCount,
    pct,
    nudge,
    nextRewardLines: rewardLinesForCompletingCycleLevel(cycleLevel),
    boostActive,
    boostMul: boostActive ? sanitizedBoost.mul : 1,
    boostRemainingMs,
    badgeTier: norm(safeState.badgeTier),
    spotlightActive: Number(safeState.spotlightUntil || 0) > now,
    xpVisualTotal,
    deltas,
    repliesInCycle: norm(safeState.repliesInCycle),
    streakCount: norm(safeState.streakCount),
    cycleStartedAt: Number(safeState.cycleStartedAt) || now,
    serverDriven: true,
  };
}

export function formatRemainingShort(ms) {
  if (ms <= 0) return '';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 48) return `${Math.floor(hours / 24)}d`;
  if (hours >= 1) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}
