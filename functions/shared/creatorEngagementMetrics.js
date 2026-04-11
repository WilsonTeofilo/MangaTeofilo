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

export function creatorEngagementScoreFromMetrics(metrics = {}) {
  let score = 0;
  for (const key of CREATOR_ENGAGEMENT_KEYS) {
    const cfg = CREATOR_ENGAGEMENT_METRICS[key];
    score += Number(metrics[key] || 0) * (cfg?.weight || 1);
  }
  return Math.round(score * 100) / 100;
}
