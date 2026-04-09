import { obterObraIdCapitulo } from '../config/obras';
import { OBRAS_WORK_GENRE_LABELS } from '../config/obraWorkForm';
import { creatorDiscoveryLevelBoost } from './creatorProgression';
import {
  formatUserDisplayWithHandle,
  normalizePublicHandle,
  resolvePublicCreatorName,
} from './publicCreatorName';
import { resolveCanonicalWorkCreator } from './workCreatorResolution';

function parseGenres(obra) {
  const fromGenresField = () => {
    const g = obra?.genres;
    if (Array.isArray(g)) return g.map((x) => String(x || '').trim()).filter(Boolean);
    if (g && typeof g === 'object') return Object.values(g).map((x) => String(x || '').trim()).filter(Boolean);
    return [];
  };
  let out = fromGenresField();
  if (out.length === 0) {
    if (Array.isArray(obra?.generos)) {
      out = obra.generos.map((x) => String(x || '').trim()).filter(Boolean);
    } else if (typeof obra?.generos === 'string') {
      out = obra.generos
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    } else if (typeof obra?.genero === 'string') {
      out = [obra.genero.trim()].filter(Boolean);
    }
  }
  const main = String(obra?.mainGenre || '').trim();
  if (out.length === 0 && main) return [main];
  return out;
}

function capTimestamp(cap) {
  const release = Number(cap?.publicReleaseAt);
  if (Number.isFinite(release) && release > 0) return release;
  const upload = Date.parse(cap?.dataUpload || '');
  if (Number.isFinite(upload) && upload > 0) return upload;
  return 0;
}

function chapterIsPublicNow(cap, nowTs = Date.now()) {
  const release = Number(cap?.publicReleaseAt);
  if (!Number.isFinite(release) || release <= 0) return true;
  return release <= nowTs;
}

function countEntries(value) {
  if (!value || typeof value !== 'object') return 0;
  return Object.keys(value).length;
}

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function commentsCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return numeric(value, 0);
}

function chapterLikesCount(cap) {
  return numeric(cap?.likesCount) || countEntries(cap?.usuariosQueCurtiram) || countEntries(cap?.likes);
}

function chapterCommentsCount(cap) {
  return numeric(cap?.commentsCount) || commentsCount(cap?.comentarios) || commentsCount(cap?.comments);
}

function chapterViewsCount(cap) {
  return numeric(cap?.viewsCount) || numeric(cap?.visualizacoes);
}

const MIN_VIEWS_FOR_QUALITY = 50;

/** Decaimento temporal: conteúdo mais antigo perde força no feed. */
function feedTimeDecay(lastUpdateTs, nowTs) {
  const ageH = Math.max(0, (nowTs - Number(lastUpdateTs || 0)) / 3600000);
  return 1 / (1 + ageH / 24);
}

/** likes/views com piso de views — evita rankear forte ruído / spam. */
function engagementQualityMul(likes, views) {
  const v = Math.max(0, views);
  const l = Math.max(0, likes);
  if (v < MIN_VIEWS_FOR_QUALITY) return 1;
  const r = l / v;
  if (r > 0.08) return 1.2;
  if (r > 0.05) return 1.1;
  return 0.85;
}

function activeEngagementBoostMul(profile, nowTs) {
  const until = Number(profile?.engagementBoostUntil);
  const m = Number(profile?.engagementBoostMul);
  if (!Number.isFinite(until) || until <= nowTs) return 1;
  if (!Number.isFinite(m) || m < 1) return 1;
  return Math.min(3, m);
}

/** Badge leve no ranking; selo (tier alto) um pouco mais forte. */
function badgeRankingMul(tier) {
  const t = Number(tier) || 0;
  if (t >= 3) return 1.1;
  if (t >= 1) return 1.05;
  return 1;
}

function weeklyActivityMul(lastUpdateTs, nowTs) {
  const ageMs = Math.max(0, nowTs - Number(lastUpdateTs || 0));
  return ageMs <= 7 * 24 * 3600000 ? 1.1 : 0.9;
}

function organicWorkBase({ likes, views, comments, followers, chaptersCount }) {
  return (
    views * 1 +
    likes * 3 +
    comments * 5 +
    Math.min(followers, 2000) * 0.5 +
    chaptersCount * 2
  );
}

function recentBoost(timestamp) {
  const ageMs = Math.max(0, Date.now() - Number(timestamp || 0));
  const days = ageMs / (1000 * 60 * 60 * 24);
  if (days <= 1) return 160;
  if (days <= 3) return 120;
  if (days <= 7) return 80;
  if (days <= 14) return 40;
  return 0;
}

function computeWorkScore({
  likes,
  views,
  comments,
  followers,
  chaptersCount,
  lastUpdateTs,
  creatorProfile,
  nowTs,
}) {
  const base = organicWorkBase({ likes, views, comments, followers, chaptersCount }) + recentBoost(lastUpdateTs) * 0.35;
  const decay = feedTimeDecay(lastUpdateTs, nowTs);
  const quality = engagementQualityMul(likes, views);
  const boost = activeEngagementBoostMul(creatorProfile, nowTs);
  const badge = badgeRankingMul(creatorProfile?.engagementBadgeTier);
  const consistency = weeklyActivityMul(lastUpdateTs, nowTs);
  const raw = base * decay * quality * boost * badge * consistency;
  return Math.max(0, raw);
}

/**
 * Só para "Obras em alta": ordem que bate com o que o leitor vê (views/likes/comentários).
 * O score geral (`discoveryScore`) ainda usa recência forte para outras listas; aqui recência
 * só desempata para não esmagar obras com mais tráfego real.
 */
function trendingEngagementScore({ views, likes, comments, followers }) {
  return views + likes * 2 + comments * 3 + followers * 1;
}

function computeCreatorScore({ followers, likes, views, comments, worksCount, recentWorks, profile, nowTs }) {
  const progression = creatorDiscoveryLevelBoost({ followers, views, likes });
  const base =
    progression +
    organicWorkBase({
      likes,
      views,
      comments,
      followers,
      chaptersCount: worksCount,
    }) +
    worksCount * 10 +
    recentWorks * 22;
  const boost = activeEngagementBoostMul(profile, nowTs);
  const badge = badgeRankingMul(profile?.engagementBadgeTier);
  const consistency = recentWorks >= 1 ? 1.1 : 0.95;
  return Math.max(0, base * boost * badge * consistency);
}

export function buildDiscoveryRanking({ obras = [], capitulos = [], creatorsMap = {} }) {
  const nowTs = Date.now();
  const obraIds = new Set(obras.map((obra) => String(obra?.id || '').toLowerCase()));
  const capitulosValidos = capitulos
    .filter((cap) => obraIds.has(obterObraIdCapitulo(cap)))
    .map((cap) => ({ ...cap, _ts: capTimestamp(cap) }))
    .sort((a, b) => b._ts - a._ts);
  const capitulosPublicos = capitulosValidos.filter((cap) => chapterIsPublicNow(cap, nowTs));

  const chaptersByWork = new Map();
  for (const cap of capitulosValidos) {
    const obraId = obterObraIdCapitulo(cap);
    const current = chaptersByWork.get(obraId) || [];
    current.push(cap);
    chaptersByWork.set(obraId, current);
  }

  const publicChaptersByWork = new Map();
  for (const cap of capitulosPublicos) {
    const obraId = obterObraIdCapitulo(cap);
    const current = publicChaptersByWork.get(obraId) || [];
    current.push(cap);
    publicChaptersByWork.set(obraId, current);
  }

  const works = obras.map((obra) => {
    const obraId = String(obra?.id || '').toLowerCase();
    const caps = chaptersByWork.get(obraId) || [];
    const { creatorId, profile: creatorProfile } = resolveCanonicalWorkCreator(obra, caps, creatorsMap);
    const publicCaps = publicChaptersByWork.get(obraId) || [];
    const ultimoCap = publicCaps[0] || null;
    const chapterViews = caps.reduce((sum, cap) => sum + chapterViewsCount(cap), 0);
    const chapterComments = caps.reduce((sum, cap) => sum + chapterCommentsCount(cap), 0);
    const chapterLikes = caps.reduce((sum, cap) => sum + chapterLikesCount(cap), 0);
    const rawWorkLikes = numeric(obra?.likesCount) || numeric(obra?.curtidas) || countEntries(obra?.likes);
    const rawWorkViews = numeric(obra?.viewsCount) || numeric(obra?.visualizacoes) || 0;
    const rawWorkComments =
      numeric(obra?.commentsCount) + commentsCount(obra?.comentarios) + commentsCount(obra?.comments);
    const workFollowers =
      numeric(obra?.favoritesCount) ||
      numeric(obra?.favoritosCount) ||
      countEntries(obra?.favoritos) ||
      countEntries(obra?.favorites);
    const creatorFollowers =
      numeric(creatorsMap?.[creatorId]?.stats?.followersCount) ||
      numeric(creatorsMap?.[creatorId]?.followersCount);
    const likes = Math.max(chapterLikes, rawWorkLikes);
    const views = Math.max(chapterViews, rawWorkViews);
    const comments = Math.max(chapterComments, rawWorkComments);
    const lastUpdateTs = ultimoCap?._ts || numeric(obra?.updatedAt);
    const chaptersCount = caps.length;
    return {
      ...obra,
      obraId,
      creatorId,
      genres: parseGenres(obra),
      totalViews: views,
      totalLikes: likes,
      totalComments: comments,
      followersCount: workFollowers,
      creatorFollowers,
      chaptersCount,
      lastChapterNumber: ultimoCap?.numero ?? null,
      lastUpdateTs,
      latestChapterId: ultimoCap?.id || null,
      discoveryScore: computeWorkScore({
        likes,
        views,
        comments,
        followers: workFollowers,
        chaptersCount,
        lastUpdateTs,
        creatorProfile,
        nowTs,
      }),
    };
  });

  const creators = Object.entries(creatorsMap || {})
    .map(([creatorId, profile]) => {
      const creatorWorks = works.filter((obra) => obra.creatorId === creatorId);
      const followers =
        numeric(profile?.stats?.followersCount) ||
        numeric(profile?.followersCount);
      const likes = creatorWorks.reduce((sum, obra) => sum + numeric(obra?.totalLikes), 0);
      const views = creatorWorks.reduce((sum, obra) => sum + numeric(obra?.totalViews), 0);
      const comments = creatorWorks.reduce((sum, obra) => sum + numeric(obra?.totalComments), 0);
      const recentWorks = creatorWorks.filter((obra) => recentBoost(obra?.lastUpdateTs) > 0).length;
      const displayName = resolvePublicCreatorName({
        creatorPublicProfile: profile,
        obra: null,
        fallback: 'Autor',
      });
      const publicLabel = formatUserDisplayWithHandle(profile);
      const username = normalizePublicHandle(profile) || String(creatorId);
      return {
        creatorId,
        displayName,
        publicLabel:
          publicLabel &&
          publicLabel !== 'Usuário' &&
          publicLabel !== 'Leitor'
            ? publicLabel
            : displayName,
        username,
        avatarUrl:
          String(profile?.creatorProfile?.avatarUrl || profile?.userAvatar || '').trim() ||
          '/assets/fotos/shito.jpg',
        bannerUrl:
          String(profile?.creatorProfile?.bannerUrl || profile?.creatorBannerUrl || '').trim() ||
          String(profile?.creatorProfile?.avatarUrl || profile?.userAvatar || '').trim() ||
          '/assets/fotos/shito.jpg',
        followersCount: followers,
        totalLikes: likes,
        totalViews: views,
        totalComments: comments,
        worksCount: creatorWorks.length,
        works: creatorWorks,
        discoveryScore: computeCreatorScore({
          followers,
          likes,
          views,
          comments,
          worksCount: creatorWorks.length,
          recentWorks,
          profile,
          nowTs,
        }),
      };
    })
    .filter((creator) => creator.worksCount > 0);

  const genreCounter = new Map();
  for (const obra of works) {
    for (const genre of obra.genres) {
      const key = String(genre || '').trim().toLowerCase();
      if (!key) continue;
      genreCounter.set(key, (genreCounter.get(key) || 0) + 1);
    }
  }

  return {
    works,
    creators,
    updates: capitulosPublicos.slice(0, 16),
    trendingWorks: [...works]
      .sort((a, b) => {
        const ta = trendingEngagementScore({
          views: a.totalViews,
          likes: a.totalLikes,
          comments: a.totalComments,
          followers: a.followersCount,
        });
        const tb = trendingEngagementScore({
          views: b.totalViews,
          likes: b.totalLikes,
          comments: b.totalComments,
          followers: b.followersCount,
        });
        if (tb !== ta) return tb - ta;
        if (b.totalViews !== a.totalViews) return b.totalViews - a.totalViews;
        if (b.totalLikes !== a.totalLikes) return b.totalLikes - a.totalLikes;
        return b.lastUpdateTs - a.lastUpdateTs;
      })
      .slice(0, 12),
    popularCreators: [...creators]
      .sort((a, b) => (
        b.discoveryScore - a.discoveryScore ||
        b.followersCount - a.followersCount ||
        b.totalLikes - a.totalLikes ||
        b.totalViews - a.totalViews
      ))
      .slice(0, 8),
    recommendedWorks: [...works]
      .sort((a, b) => {
        if (b.discoveryScore !== a.discoveryScore) return b.discoveryScore - a.discoveryScore;
        if (b.followersCount !== a.followersCount) return b.followersCount - a.followersCount;
        if (b.chaptersCount !== a.chaptersCount) return b.chaptersCount - a.chaptersCount;
        return b.lastUpdateTs - a.lastUpdateTs;
      })
      .slice(0, 12),
    heroWorks: [...works]
      .sort((a, b) => {
        if (b.discoveryScore !== a.discoveryScore) return b.discoveryScore - a.discoveryScore;
        if (b.followersCount !== a.followersCount) return b.followersCount - a.followersCount;
        return b.lastUpdateTs - a.lastUpdateTs;
      })
      .slice(0, 5),
    categories: [
      { id: 'all', label: 'Todos' },
      ...[...genreCounter.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id]) => ({ id, label: OBRAS_WORK_GENRE_LABELS[id] || id })),
    ],
  };
}
