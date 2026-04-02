import { obterObraIdCapitulo, obraCreatorId } from '../config/obras';

function parseGenres(obra) {
  if (Array.isArray(obra?.generos)) {
    return obra.generos.map((g) => String(g || '').trim()).filter(Boolean);
  }
  if (typeof obra?.generos === 'string') {
    return obra.generos
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
  }
  if (typeof obra?.genero === 'string') return [obra.genero.trim()].filter(Boolean);
  return [];
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

function recentBoost(timestamp) {
  const ageMs = Math.max(0, Date.now() - Number(timestamp || 0));
  const days = ageMs / (1000 * 60 * 60 * 24);
  if (days <= 1) return 160;
  if (days <= 3) return 120;
  if (days <= 7) return 80;
  if (days <= 14) return 40;
  return 0;
}

function computeWorkScore({ likes, views, comments, followers, chaptersCount, lastUpdateTs }) {
  return (
    likes * 14 +
    views * 0.18 +
    comments * 18 +
    followers * 5 +
    chaptersCount * 4 +
    recentBoost(lastUpdateTs)
  );
}

function computeCreatorScore({ followers, likes, views, comments, worksCount, recentWorks }) {
  return (
    followers * 22 +
    likes * 10 +
    views * 0.12 +
    comments * 16 +
    worksCount * 18 +
    recentWorks * 25
  );
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
    const creatorId = obraCreatorId(obra);
    const caps = chaptersByWork.get(obraId) || [];
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
      numeric(creatorsMap?.[creatorId]?.creatorProfile?.stats?.followersCount) ||
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
      }),
    };
  });

  const creators = Object.entries(creatorsMap || {})
    .map(([creatorId, profile]) => {
      const creatorWorks = works.filter((obra) => obra.creatorId === creatorId);
      const followers =
        numeric(profile?.creatorProfile?.stats?.followersCount) ||
        numeric(profile?.stats?.followersCount) ||
        numeric(profile?.followersCount);
      const likes = creatorWorks.reduce((sum, obra) => sum + numeric(obra?.totalLikes), 0);
      const views = creatorWorks.reduce((sum, obra) => sum + numeric(obra?.totalViews), 0);
      const comments = creatorWorks.reduce((sum, obra) => sum + numeric(obra?.totalComments), 0);
      const recentWorks = creatorWorks.filter((obra) => recentBoost(obra?.lastUpdateTs) > 0).length;
      const displayName =
        String(profile?.creatorProfile?.displayName || profile?.creatorDisplayName || profile?.userName || '').trim() ||
        'Criador';
      const username = String(
        profile?.creatorProfile?.username || profile?.creatorUsername || profile?.username || creatorId
      ).trim();
      return {
        creatorId,
        displayName,
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
        }),
      };
    })
    .filter((creator) => creator.worksCount > 0);

  const genreCounter = new Map();
  for (const obra of works) {
    for (const genre of obra.genres) {
      const key = genre.toLowerCase();
      genreCounter.set(key, (genreCounter.get(key) || 0) + 1);
    }
  }

  return {
    works,
    creators,
    updates: capitulosPublicos.slice(0, 16),
    trendingWorks: [...works]
      .sort((a, b) => (
        b.discoveryScore - a.discoveryScore ||
        b.followersCount - a.followersCount ||
        b.totalLikes - a.totalLikes ||
        b.lastUpdateTs - a.lastUpdateTs
      ))
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
        .map(([id]) => ({ id, label: id })),
    ],
  };
}
