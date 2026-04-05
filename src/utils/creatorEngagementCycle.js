/**
 * Ciclo de engajamento (temporada) — níveis 1→5, reset infinito.
 * Progressão por missões completadas (não por XP). XP só visual.
 * Boost espelhado em usuarios_publicos para o feed (Cloud Function mirrorEngagementCycleToPublicProfile).
 */

export const ENGAGEMENT_CYCLE_LEVEL_MIN = 1;
export const ENGAGEMENT_CYCLE_LEVEL_MAX = 5;

/** Multiplicador aplicado ao score de descoberta enquanto boost ativo */
export const BOOST_MUL_BY_LEVEL = {
  1: 1.2,
  2: 1.4,
  3: 1.6,
  4: 1.8,
  5: 2.2,
};

/** Duração do boost ao concluir o nível (ms) */
export const BOOST_MS_BY_LEVEL = {
  1: 6 * 60 * 60 * 1000,
  2: 24 * 60 * 60 * 1000,
  3: 48 * 60 * 60 * 1000,
  4: 48 * 60 * 60 * 1000,
  5: 72 * 60 * 60 * 1000,
};

const VALID_BOOST_MUL_VALUES = Object.values(BOOST_MUL_BY_LEVEL);

function isValidBoostMul(m) {
  const x = Number(m);
  if (!Number.isFinite(x)) return false;
  return VALID_BOOST_MUL_VALUES.some((t) => Math.abs(t - x) < 0.001);
}

function sanitizeBoostFields(mul, until, now) {
  const u = until != null ? Number(until) : null;
  const m = mul != null ? Number(mul) : null;
  if (m == null || u == null || !Number.isFinite(u) || u <= now || !Number.isFinite(m) || m <= 1 || !isValidBoostMul(m)) {
    return { mul: null, until: null };
  }
  return { mul: m, until: u };
}

function norm(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

function capTs(cap) {
  const r = Number(cap?.publicReleaseAt);
  if (Number.isFinite(r) && r > 0) return r;
  const u = Date.parse(cap?.dataUpload || '');
  if (Number.isFinite(u) && u > 0) return u;
  return 0;
}

/**
 * Quantas missões cumprir neste nível para subir.
 * Missões necessárias para subir de fase: 2 (fase 1), 3 (fases 2–3), 5 (fases 4–5).
 */
export function requiredMissionsForCycleLevel(level) {
  const lv = norm(level) || 1;
  if (lv <= 1) return 2;
  if (lv <= 3) return 3;
  return 5;
}

/**
 * @param {number} level
 * @returns {{ id: string, label: string, xp: number, kind: string, need?: number }[]}
 */
export function getMissionPoolForLevel(level) {
  const lv = Math.min(ENGAGEMENT_CYCLE_LEVEL_MAX, Math.max(ENGAGEMENT_CYCLE_LEVEL_MIN, norm(level) || 1));
  switch (lv) {
    case 1:
      return [
        { id: 'ch_bonus', label: 'Publicar 1 capítulo novo (vale como missão completa)', xp: 50, kind: 'chapter' },
        { id: 'likes_20', label: 'Subir +20 likes desde o inicio do ciclo', xp: 25, kind: 'likes_delta', need: 20 },
        { id: 'views_100', label: 'Subir +100 views desde o inicio do ciclo', xp: 20, kind: 'views_delta', need: 100 },
      ];
    case 2:
      return [
        { id: 'ch_bonus', label: 'Publicar 1 capítulo novo (+50 XP)', xp: 50, kind: 'chapter' },
        { id: 'likes_40', label: 'Subir +40 likes desde o inicio do ciclo', xp: 30, kind: 'likes_delta', need: 40 },
        { id: 'views_300', label: 'Subir +300 views desde o inicio do ciclo', xp: 25, kind: 'views_delta', need: 300 },
        { id: 'fol_5', label: 'Subir +5 seguidores desde o inicio do ciclo', xp: 40, kind: 'followers_delta', need: 5 },
      ];
    case 3:
      return [
        { id: 'ch_bonus', label: 'Publicar 1 capítulo novo (+50 XP)', xp: 50, kind: 'chapter' },
        { id: 'likes_80', label: 'Subir +80 likes desde o inicio do ciclo', xp: 35, kind: 'likes_delta', need: 80 },
        { id: 'views_800', label: 'Subir +800 views desde o inicio do ciclo', xp: 30, kind: 'views_delta', need: 800 },
        { id: 'fol_10', label: 'Subir +10 seguidores desde o inicio do ciclo', xp: 45, kind: 'followers_delta', need: 10 },
      ];
    case 4:
      return [
        { id: 'ch_bonus', label: 'Publicar 1 capítulo novo (+50 XP)', xp: 50, kind: 'chapter' },
        { id: 'likes_150', label: 'Subir +150 likes desde o inicio do ciclo', xp: 40, kind: 'likes_delta', need: 150 },
        { id: 'views_2000', label: 'Subir +2.000 views desde o inicio do ciclo', xp: 35, kind: 'views_delta', need: 2000 },
        { id: 'fol_20', label: 'Subir +20 seguidores desde o inicio do ciclo', xp: 50, kind: 'followers_delta', need: 20 },
        { id: 'rep_5', label: 'Responder 5 comentarios nos seus capitulos', xp: 30, kind: 'replies', need: 5 },
        { id: 'views_2500', label: 'Ou: subir +2.500 views desde o inicio do ciclo', xp: 35, kind: 'views_delta', need: 2500 },
      ];
    case 5:
    default:
      return [
        { id: 'ch_bonus', label: 'Publicar 1 capítulo novo (+50 XP)', xp: 50, kind: 'chapter' },
        { id: 'likes_300', label: 'Subir +300 likes desde o inicio do ciclo', xp: 45, kind: 'likes_delta', need: 300 },
        { id: 'views_5000', label: 'Subir +5.000 views desde o inicio do ciclo', xp: 40, kind: 'views_delta', need: 5000 },
        { id: 'fol_40', label: 'Subir +40 seguidores desde o inicio do ciclo', xp: 55, kind: 'followers_delta', need: 40 },
        { id: 'streak_7', label: 'Entrar no painel do criador 7 dias seguidos', xp: 35, kind: 'streak', need: 7 },
        { id: 'likes_350', label: 'Ou: subir +350 likes desde o inicio do ciclo', xp: 45, kind: 'likes_delta', need: 350 },
      ];
  }
}

/** Recompensas ao concluir o nível atual (antes de subir). */
export function rewardLinesForCompletingCycleLevel(level) {
  const lv = Math.min(ENGAGEMENT_CYCLE_LEVEL_MAX, Math.max(ENGAGEMENT_CYCLE_LEVEL_MIN, norm(level) || 1));
  if (lv >= ENGAGEMENT_CYCLE_LEVEL_MAX) {
    return [
      `Boost forte no feed (${BOOST_MUL_BY_LEVEL[5]}Ã—) por ${formatBoostDurationPt(5)}`,
      'Selo especial e mais chance de aparecer para novos leitores',
      'Depois a semana recomeça na fase 1 (seu boost atual segue até acabar)',
    ];
  }
  const lines = [
    `Boost no feed ${BOOST_MUL_BY_LEVEL[lv]}Ã— por ${formatBoostDurationPt(lv)}`,
  ];
  if (lv >= 3) lines.push('Selo / destaque no seu perfil');
  if (lv >= 4) lines.push('Um empurrão leve no ranking e na vitrine â€œem altaâ€');
  return lines;
}

function formatBoostDurationPt(level) {
  const ms = BOOST_MS_BY_LEVEL[level] || 0;
  const h = Math.round(ms / (60 * 60 * 1000));
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d} dia(s)`;
}

function defaultCycleState(metrics, now = Date.now()) {
  const m = normalizeCreatorMetrics(metrics);
  return {
    v: 1,
    cycleLevel: ENGAGEMENT_CYCLE_LEVEL_MIN,
    cycleStartedAt: now,
    baselines: { followers: m.followers, views: m.views, likes: m.likes },
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

function normalizeCreatorMetrics(m) {
  return {
    followers: norm(m?.followers),
    views: norm(m?.views),
    likes: norm(m?.likes),
  };
}

function chapterPublishedSince(caps, cycleStartedAt, uid) {
  const start = Number(cycleStartedAt) || 0;
  const u = String(uid || '').trim();
  if (!caps || !Array.isArray(caps) || !start) return false;
  return caps.some((cap) => {
    if (String(cap?.creatorId || '').trim() !== u) return false;
    const ts = capTs(cap);
    return ts >= start;
  });
}

function missionSatisfied(mission, ctx) {
  const { deltas, chapterOk, replies, streak } = ctx;
  switch (mission.kind) {
    case 'chapter':
      return chapterOk;
    case 'likes_delta':
      return deltas.likes >= norm(mission.need);
    case 'views_delta':
      return deltas.views >= norm(mission.need);
    case 'followers_delta':
      return deltas.followers >= norm(mission.need);
    case 'replies':
      return replies >= norm(mission.need);
    case 'streak':
      return streak >= norm(mission.need);
    default:
      return false;
  }
}

/**
 * Atualiza streak (1x por dia local) quando o criador abre o workspace.
 */
export function bumpStreakForVisit(prev, now = Date.now()) {
  const state = prev && typeof prev === 'object' ? { ...prev } : {};
  const d = new Date(now);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const last = String(state.lastStreakKey || '');
  if (last === key) return state;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const ykey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  let count = norm(state.streakCount);
  if (last === ykey) count += 1;
  else count = 1;
  return { ...state, streakCount: count, lastStreakKey: key };
}

/**
 * Processa tick: merge streak, detecta missões, sobe nível, aplica boost.
 * @returns {{ state: object, usuarioPatch: object, publicoPatch: object, changed: boolean }}
 */
export function processEngagementCycleTick({
  engagementCycle,
  metrics,
  caps,
  uid,
  now = Date.now(),
}) {
  let state =
    engagementCycle && typeof engagementCycle === 'object' && engagementCycle.cycleStartedAt != null
      ? { ...engagementCycle }
      : defaultCycleState(metrics, now);

  state = bumpStreakForVisit(state, now);

  const m = normalizeCreatorMetrics(metrics);
  const base = {
    followers: norm(state.baselines?.followers),
    views: norm(state.baselines?.views),
    likes: norm(state.baselines?.likes),
  };
  const deltas = {
    followers: Math.max(0, m.followers - base.followers),
    views: Math.max(0, m.views - base.views),
    likes: Math.max(0, m.likes - base.likes),
  };

  const cycleStartedAt = Number(state.cycleStartedAt) || now;
  const chapterOk = chapterPublishedSince(caps, cycleStartedAt, uid);
  const replies = norm(state.repliesInCycle);
  const streak = norm(state.streakCount);

  const level = Math.min(
    ENGAGEMENT_CYCLE_LEVEL_MAX,
    Math.max(ENGAGEMENT_CYCLE_LEVEL_MIN, norm(state.cycleLevel) || 1)
  );
  const pool = getMissionPoolForLevel(level);
  const need = requiredMissionsForCycleLevel(level);

  const completedIds = {};
  for (const mission of pool) {
    if (missionSatisfied(mission, { deltas, chapterOk, replies, streak })) {
      completedIds[mission.id] = true;
    }
  }

  const doneList = pool.filter((x) => completedIds[x.id]);
  const doneCount = doneList.length;

  let cycleLevel = level;
  let baselines = { ...base };
  let nextCompleted = { ...completedIds };
  let activeBoostMul = state.activeBoostMul != null ? Number(state.activeBoostMul) : null;
  let activeBoostUntil = state.activeBoostUntil != null ? Number(state.activeBoostUntil) : null;
  let spotlightUntil = state.spotlightUntil != null ? Number(state.spotlightUntil) : null;
  let badgeTier = Math.min(3, Math.max(0, norm(state.badgeTier)));

  let leveled = false;

  if (doneCount >= need) {
    leveled = true;
    const mul = BOOST_MUL_BY_LEVEL[cycleLevel] || 1.2;
    const dur = BOOST_MS_BY_LEVEL[cycleLevel] || BOOST_MS_BY_LEVEL[1];
    const until = now + dur;
    if (!activeBoostUntil || until > activeBoostUntil || mul > (activeBoostMul || 1)) {
      activeBoostMul = mul;
      activeBoostUntil = until;
    }
    if (cycleLevel >= 3) {
      badgeTier = Math.min(3, Math.max(badgeTier, cycleLevel >= 5 ? 3 : cycleLevel - 2));
      spotlightUntil = Math.max(Number(spotlightUntil) || 0, now + (cycleLevel >= 4 ? 72 * 3600000 : 24 * 3600000));
    }

    if (cycleLevel >= ENGAGEMENT_CYCLE_LEVEL_MAX) {
      cycleLevel = ENGAGEMENT_CYCLE_LEVEL_MIN;
    } else {
      cycleLevel += 1;
    }
    baselines = { followers: m.followers, views: m.views, likes: m.likes };
    nextCompleted = {};
    state = {
      ...state,
      cycleLevel,
      cycleStartedAt: now,
      baselines,
      completedIds: nextCompleted,
      repliesInCycle: 0,
      activeBoostMul,
      activeBoostUntil,
      spotlightUntil,
      badgeTier,
    };
  } else {
    const sb = sanitizeBoostFields(activeBoostMul, activeBoostUntil, now);
    activeBoostMul = sb.mul;
    activeBoostUntil = sb.until;
    if (spotlightUntil != null && Number(spotlightUntil) <= now) spotlightUntil = null;
    state = {
      ...state,
      cycleLevel,
      baselines,
      completedIds: nextCompleted,
      repliesInCycle: replies,
      streakCount: streak,
      lastStreakKey: state.lastStreakKey,
      activeBoostMul,
      activeBoostUntil,
      spotlightUntil,
      badgeTier,
    };
  }

  const prevSnap = stableEngagementSnapshot(engagementCycle);
  const nextSnap = stableEngagementSnapshot(state);
  const changed = prevSnap !== nextSnap;

  const usuarioPatch = { engagementCycle: state };
  const boostActive = activeBoostUntil && activeBoostUntil > now && activeBoostMul && activeBoostMul > 1;
  const publicoPatch = {
    engagementBoostMul: boostActive ? activeBoostMul : null,
    engagementBoostUntil: boostActive ? activeBoostUntil : null,
    engagementBadgeTier: badgeTier > 0 ? badgeTier : null,
  };

  return { state, usuarioPatch, publicoPatch, changed, leveled };
}

function stableEngagementSnapshot(s) {
  if (!s || typeof s !== 'object') return '';
  const doneKeys =
    s.completedIds && typeof s.completedIds === 'object'
      ? Object.keys(s.completedIds)
          .filter((k) => s.completedIds[k])
          .sort()
          .join(',')
      : '';
  return JSON.stringify({
    l: s.cycleLevel,
    b: s.baselines,
    c: doneKeys,
    r: s.repliesInCycle,
    st: s.streakCount,
    sk: s.lastStreakKey,
    bm: s.activeBoostMul,
    bu: s.activeBoostUntil,
    sp: s.spotlightUntil,
    bt: s.badgeTier,
    t: s.cycleStartedAt,
  });
}

/**
 * UI view-model para o painel
 */
export function buildEngagementCycleViewModel(state, metrics, caps, uid, now = Date.now()) {
  if (!state || typeof state !== 'object') {
    state = defaultCycleState(metrics, now);
  }
  const m = normalizeCreatorMetrics(metrics);
  const base = {
    followers: norm(state.baselines?.followers),
    views: norm(state.baselines?.views),
    likes: norm(state.baselines?.likes),
  };
  const deltas = {
    followers: Math.max(0, m.followers - base.followers),
    views: Math.max(0, m.views - base.views),
    likes: Math.max(0, m.likes - base.likes),
  };
  const cycleStartedAt = Number(state.cycleStartedAt) || now;
  const chapterOk = chapterPublishedSince(caps, cycleStartedAt, uid);
  const replies = norm(state.repliesInCycle);
  const streak = norm(state.streakCount);

  const level = Math.min(
    ENGAGEMENT_CYCLE_LEVEL_MAX,
    Math.max(ENGAGEMENT_CYCLE_LEVEL_MIN, norm(state.cycleLevel) || 1)
  );
  const pool = getMissionPoolForLevel(level);
  const need = requiredMissionsForCycleLevel(level);

  const missions = pool.map((mission) => {
    const done = missionSatisfied(mission, { deltas, chapterOk, replies, streak });
    return { ...mission, done };
  });
  const doneCount = missions.filter((x) => x.done).length;
  const poolSize = missions.length;
  const pct = need > 0 ? Math.min(100, Math.round((doneCount / need) * 100)) : 0;

  const remaining = Math.max(0, need - doneCount);
  const nudge =
    remaining === 0
      ? 'Meta desta fase cumprida. Em instantes o sistema atualiza sozinho (ao usar o painel).'
      : remaining === 1
        ? 'Falta só 1 missão para fechar esta fase — pode ser qualquer uma que ainda esteja em aberto.'
        : `Faltam ${remaining} missões para fechar esta fase. Você escolhe quais fazer na lista abaixo.`;

  const boostUntil = Number(state.activeBoostUntil) || 0;
  const boostMul = Number(state.activeBoostMul) || 1;
  const boostActive = boostUntil > now && boostMul > 1;
  const boostRemainingMs = boostActive ? boostUntil - now : 0;

  const xpTotal = missions.filter((x) => x.done).reduce((s, x) => s + norm(x.xp), 0);

  return {
    cycleLevel: level,
    missions,
    need,
    poolSize,
    doneCount,
    pct,
    nudge,
    nextRewardLines: rewardLinesForCompletingCycleLevel(level),
    boostActive,
    boostMul,
    boostRemainingMs,
    badgeTier: norm(state.badgeTier),
    spotlightActive: (Number(state.spotlightUntil) || 0) > now,
    xpVisualTotal: xpTotal,
    deltas,
    chapterBonusDone: chapterOk,
  };
}

export function formatRemainingShort(ms) {
  if (ms <= 0) return '';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return `${Math.floor(h / 24)}d`;
  if (h >= 1) return `${h}h ${m}min`;
  return `${m}min`;
}

