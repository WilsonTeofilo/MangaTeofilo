function norm(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

function readStatsLikes(stats) {
  if (!stats || typeof stats !== 'object') return 0;
  return norm(stats.totalLikes ?? stats.likesTotal);
}

function readStatsViews(stats) {
  if (!stats || typeof stats !== 'object') return 0;
  return norm(stats.totalViews ?? stats.viewsCount);
}

function readStatsFollowers(stats) {
  if (!stats || typeof stats !== 'object') return 0;
  return norm(stats.followersCount);
}

export const CREATOR_ENGAGEMENT_METRICS = {
  followers: {
    label: 'Seguidores',
    weight: 1,
    kind: 'followers',
  },
  views: {
    label: 'Views',
    weight: 0.15,
    kind: 'views',
  },
  likes: {
    label: 'Curtidas',
    weight: 2.5,
    kind: 'likes',
  },
  comments: {
    label: 'Comentarios',
    weight: 3.5,
    kind: 'comments',
  },
  favorites: {
    label: 'Favoritos',
    weight: 4,
    kind: 'favorites',
  },
};

export const CREATOR_ENGAGEMENT_KEYS = Object.keys(CREATOR_ENGAGEMENT_METRICS);

export function normalizeCreatorEngagementMetrics(m) {
  return {
    followers: norm(m?.followers),
    views: norm(m?.views),
    likes: norm(m?.likes),
  };
}

export function resolveCreatorEngagementMetrics({ creatorStats } = {}) {
  const creatorCanonical = creatorStats && typeof creatorStats === 'object' ? creatorStats : {};

  return normalizeCreatorEngagementMetrics({
    followers: readStatsFollowers(creatorCanonical),
    views: readStatsViews(creatorCanonical),
    likes: readStatsLikes(creatorCanonical),
  });
}

export function creatorEngagementScoreFromMetrics(metrics = {}) {
  let score = 0;
  for (const key of CREATOR_ENGAGEMENT_KEYS) {
    const cfg = CREATOR_ENGAGEMENT_METRICS[key];
    score += Number(metrics[key] || 0) * (cfg?.weight || 1);
  }
  return Math.round(score * 100) / 100;
}
