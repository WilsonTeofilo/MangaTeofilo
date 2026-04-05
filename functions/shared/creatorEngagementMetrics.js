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

export function normalizeCreatorEngagementMetrics(m) {
  return {
    followers: norm(m?.followers),
    views: norm(m?.views),
    likes: norm(m?.likes),
  };
}

export function resolveCreatorEngagementMetrics({ creatorStats, userRow } = {}) {
  const creatorCanonical = creatorStats && typeof creatorStats === 'object' ? creatorStats : {};

  return normalizeCreatorEngagementMetrics({
    followers: readStatsFollowers(creatorCanonical),
    views: readStatsViews(creatorCanonical),
    likes: readStatsLikes(creatorCanonical),
  });
}
