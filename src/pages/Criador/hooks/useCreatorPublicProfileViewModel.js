import { useCallback, useEffect, useMemo, useState } from 'react';

import { AVATAR_FALLBACK } from '../../../constants';
import { apoiePathParaCriador } from '../../../utils/creatorSupportPaths';
import { creatorPublicHeroImageUrl } from '../../../utils/creatorPublicHero';
import { resolveEffectiveCreatorMonetizationStatusFromDb } from '../../../utils/creatorMonetizationUi';
import { formatUserDisplayWithHandle } from '../../../utils/publicCreatorName';
import { resolvePublicProfilePath } from '../../../utils/publicProfilePaths';
import { isReaderPublicProfileEffective } from '../../../utils/readerPublicProfile';
import {
  isCreatorPublicProfile,
  resolvePublicProfileAvatarUrl,
  resolvePublicProfileBio,
  resolvePublicProfileSocialLinks,
} from '../../../utils/publicUserProfile';
import { useCreatorFollow } from './useCreatorFollow';
import {
  countMapEntries,
  formatarDataLeitor,
  isDefaultCreatorWorkCoverUrl,
  normalizarRede,
  pathObra,
  pathObraFromFavoriteRow,
  resolveWorkKey,
  resolveWorkKeyFromCap,
  statsFromWork,
  valueCount,
} from '../creatorPublicProfileUtils';

export function useCreatorPublicProfileViewModel({
  db,
  functions,
  navigate,
  searchParams,
  setSearchParams,
  user,
  perfilPublico,
  obras,
  capitulos,
  creatorStatsRow,
  setCreatorStatsRow,
  setPerfilPublico,
  favoritesMap,
  chapterCoverOverrides,
  creatorUid,
  obrasSectionRef,
}) {
  const [sortObras, setSortObras] = useState('recent');

  const redes = useMemo(() => {
    const socialLinks = resolvePublicProfileSocialLinks(perfilPublico);
    const instagramUrl = normalizarRede(socialLinks?.instagramUrl);
    const youtubeUrl = normalizarRede(socialLinks?.youtubeUrl);
    return [
      instagramUrl ? { id: 'instagram', label: 'Instagram', href: instagramUrl } : null,
      youtubeUrl ? { id: 'youtube', label: 'YouTube', href: youtubeUrl } : null,
    ].filter(Boolean);
  }, [perfilPublico]);

  const chapterStatsByWorkId = useMemo(() => {
    const grouped = new Map();
    capitulos.forEach((cap) => {
      const capObraId = resolveWorkKeyFromCap(cap);
      if (!capObraId) return;
      const bucket = grouped.get(capObraId) || [];
      bucket.push(cap);
      grouped.set(capObraId, bucket);
    });
    return grouped;
  }, [capitulos]);

  const chapterCoverByWorkId = useMemo(() => {
    const map = new Map();
    capitulos.forEach((cap) => {
      const capObraId = resolveWorkKeyFromCap(cap);
      if (!capObraId) return;
      const coverRaw = String(cap?.capaUrl || cap?.coverUrl || '').trim();
      let cover = coverRaw && !isDefaultCreatorWorkCoverUrl(coverRaw) ? coverRaw : '';
      if (!cover) {
        const pageCover = String(cap?.paginas?.[0] || '').trim();
        cover = pageCover && !isDefaultCreatorWorkCoverUrl(pageCover) ? pageCover : '';
      }
      if (!cover) return;
      const current = map.get(capObraId);
      if (!current || Number(cap?.updatedAt || 0) > Number(current.updatedAt || 0)) {
        map.set(capObraId, { url: cover, updatedAt: Number(cap?.updatedAt || 0) });
      }
    });
    return map;
  }, [capitulos]);

  const chapterCoverResolved = useMemo(() => {
    const resolved = { ...chapterCoverOverrides };
    chapterCoverByWorkId.forEach((row, key) => {
      if (!resolved[key]) resolved[key] = row.url;
    });
    return resolved;
  }, [chapterCoverByWorkId, chapterCoverOverrides]);

  const obrasComStats = useMemo(
    () =>
      obras.map((obra) => {
        const obraId = resolveWorkKey(obra);
        return {
          ...obra,
          stats: statsFromWork(obra, chapterStatsByWorkId.get(obraId) || []),
        };
      }),
    [chapterStatsByWorkId, obras]
  );

  const creatorStats = useMemo(() => {
    const stats = creatorStatsRow && typeof creatorStatsRow === 'object' ? creatorStatsRow : {};
    return {
      followersCount: valueCount(stats?.followersCount, [
        perfilPublico?.followersCount,
        countMapEntries(perfilPublico?.followers),
      ]),
      totalLikes: valueCount(stats?.likesTotal, [obrasComStats.reduce((sum, obra) => sum + Number(obra?.stats?.likes || 0), 0)]),
      totalViews: valueCount(stats?.totalViews, [obrasComStats.reduce((sum, obra) => sum + Number(obra?.stats?.views || 0), 0)]),
      totalComments: valueCount(
        stats?.commentsTotal,
        [obrasComStats.reduce((sum, obra) => sum + Number(obra?.stats?.comments || 0), 0)]
      ),
    };
  }, [creatorStatsRow, obrasComStats, perfilPublico]);

  const readerPublic = isReaderPublicProfileEffective(perfilPublico);
  const hasWriterProfile = isCreatorPublicProfile(perfilPublico);
  const profileMode = hasWriterProfile ? 'writer' : readerPublic ? 'reader' : 'none';
  const formattedPublic = formatUserDisplayWithHandle(perfilPublico);
  const publicLine =
    formattedPublic !== 'Leitor'
      ? formattedPublic
      : profileMode === 'writer'
        ? 'Escritor'
        : 'Leitor';
  const writerBio = resolvePublicProfileBio(perfilPublico, 'writer');
  const readerBio = resolvePublicProfileBio(perfilPublico, 'reader');
  const bio = profileMode === 'writer' ? writerBio : readerBio;
  const avatar = resolvePublicProfileAvatarUrl(perfilPublico, {
    mode: profileMode === 'reader' ? 'reader' : 'creator',
    fallback: AVATAR_FALLBACK,
  });
  const heroBackdropUrl = profileMode === 'reader' ? avatar : creatorPublicHeroImageUrl(perfilPublico);
  const creatorMonetizationStatus = resolveEffectiveCreatorMonetizationStatusFromDb(perfilPublico);
  const supportEnabled = profileMode === 'writer' && creatorMonetizationStatus === 'active';
  const supportOffer =
    perfilPublico?.creatorProfile?.monetization?.supportOffer &&
    typeof perfilPublico.creatorProfile.monetization.supportOffer === 'object'
      ? perfilPublico.creatorProfile.monetization.supportOffer
      : {};
  const membershipEnabled = supportEnabled && supportOffer.membershipEnabled === true;
  const membershipPrice = Number(supportOffer.membershipPriceBRL || 12);
  const donationSuggested = Number(supportOffer.donationSuggestedBRL || 7);
  const moderation = String(perfilPublico?.creatorModerationAction || '').trim().toLowerCase();
  const canFollow = profileMode === 'writer' && Boolean(user?.uid) && user.uid !== creatorUid;

  const handleFollowCountUpdate = useCallback(
    (nextFollowing) => {
      setPerfilPublico((current) => {
        if (!current || typeof current !== 'object') return current;
        const currentCount = valueCount(current?.stats?.followersCount, [
          current?.followersCount,
          countMapEntries(current?.followers),
        ]);
        const nextCount = Math.max(0, currentCount + (nextFollowing ? 1 : -1));
        setCreatorStatsRow((currentStats) => ({
          ...(currentStats && typeof currentStats === 'object' ? currentStats : {}),
          followersCount: nextCount,
        }));
        return {
          ...current,
          followersCount: nextCount,
          stats: {
            ...(current?.stats && typeof current.stats === 'object' ? current.stats : {}),
            followersCount: nextCount,
          },
        };
      });
    },
    [setCreatorStatsRow, setPerfilPublico]
  );

  const {
    isFollowing,
    followBusy,
    followMessage,
    followersModalOpen,
    followersBusy,
    followersError,
    followersList,
    privateFollowerModal,
    setPrivateFollowerModal,
    followBrowserPushModalOpen,
    followBrowserPushPermission,
    setFollowBrowserPushModalOpen,
    closeFollowersModal,
    handleToggleFollow: handleToggleFollowBase,
    handleOpenFollowersModal,
  } = useCreatorFollow({
    db,
    functions,
    creatorUid,
    profileMode,
    user,
    onLogin: () => navigate('/login'),
    onFollowChange: handleFollowCountUpdate,
  });

  useEffect(() => {
    if (!privateFollowerModal) return undefined;
    function handleEscape(event) {
      if (event.key === 'Escape') setPrivateFollowerModal(null);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [privateFollowerModal, setPrivateFollowerModal]);

  const handleToggleFollow = useCallback(async () => {
    await handleToggleFollowBase();
    if (followersModalOpen) {
      void handleOpenFollowersModal({ force: true });
    }
  }, [followersModalOpen, handleOpenFollowersModal, handleToggleFollowBase]);

  const favoritesList = useMemo(() => {
    const worksById = new Map(obras.map((obra) => [String(obra?.id || '').trim().toLowerCase(), obra]));
    return Object.entries(favoritesMap || {})
      .map(([workIdRaw, row]) => {
        const workId = String(workIdRaw || '').trim();
        const linkedWork = worksById.get(workId.toLowerCase());
        return {
          workId,
          slug: String(linkedWork?.slug || row?.slug || workId).trim(),
          title: String(linkedWork?.titulo || linkedWork?.title || row?.titulo || row?.title || workId).trim(),
          coverUrl: String(linkedWork?.capaUrl || linkedWork?.coverUrl || row?.coverUrl || row?.capaUrl || '').trim(),
          savedAt: Number(row?.savedAt || row?.createdAt || 0) || 0,
        };
      })
      .filter((row) => String(row?.workId || '').trim() && String(row?.title || '').trim())
      .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
  }, [favoritesMap, obras]);

  const rawTab = String(searchParams.get('tab') || '').toLowerCase();
  const availableTabs = profileMode === 'writer' ? ['works', 'likes'] : ['likes'];
  const profileTab = availableTabs.includes(rawTab) ? rawTab : availableTabs[0];
  const readerSinceLabel = formatarDataLeitor(perfilPublico?.readerSince || perfilPublico?.createdAt);

  const obrasSorted = useMemo(() => {
    const list = [...obrasComStats];
    if (sortObras === 'popular') {
      list.sort((a, b) => {
        const score = (o) =>
          Number(o?.stats?.views || 0) + Number(o?.stats?.likes || 0) * 2 + Number(o?.stats?.comments || 0) * 3;
        return score(b) - score(a);
      });
    } else {
      list.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    }
    return list;
  }, [obrasComStats, sortObras]);

  const favoritesPublicVisible = profileMode === 'writer' ? true : readerPublic;
  const perfilBloqueado = moderation === 'banned';

  const handleFollowerProfileOpen = useCallback(
    (follower) => {
      if (!follower?.uid) return;
      if (follower.isProfilePublic !== true) {
        setPrivateFollowerModal({
          label: follower.displayName || follower.userHandle || 'Este usuario',
        });
        return;
      }
      navigate(
        resolvePublicProfilePath(
          {
            uid: follower.uid,
            userHandle: follower.userHandle,
            userName: follower.displayName,
            isCreatorProfile: follower.isCreatorProfile === true,
            readerProfilePublic: follower.isCreatorProfile !== true,
          },
          follower.uid,
          { tab: follower.profileTab || (follower.isCreatorProfile ? 'works' : 'likes') }
        )
      );
      closeFollowersModal();
    },
    [closeFollowersModal, navigate, setPrivateFollowerModal]
  );

  const handleSupport = useCallback(() => navigate(apoiePathParaCriador(creatorUid)), [creatorUid, navigate]);

  const handleViewWorks = useCallback(() => {
    setSearchParams({ tab: 'works' });
    window.setTimeout(() => {
      obrasSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, [obrasSectionRef, setSearchParams]);

  const handleViewLikes = useCallback(() => setSearchParams({ tab: 'likes' }), [setSearchParams]);
  const handleCatalog = useCallback(() => navigate('/works'), [navigate]);
  const handleOpenWork = useCallback((obra) => navigate(pathObra(obra)), [navigate]);
  const handleOpenFavorite = useCallback((fav) => navigate(pathObraFromFavoriteRow(fav)), [navigate]);

  return {
    sortObras,
    setSortObras,
    redes,
    chapterCoverResolved,
    obrasComStats,
    creatorStats,
    readerPublic,
    profileMode,
    publicLine,
    bio,
    avatar,
    heroBackdropUrl,
    supportEnabled,
    membershipEnabled,
    membershipPrice,
    donationSuggested,
    canFollow,
    isFollowing,
    followBusy,
    followMessage,
    followersModalOpen,
    followersBusy,
    followersError,
    followersList,
    privateFollowerModal,
    setPrivateFollowerModal,
    followBrowserPushModalOpen,
    followBrowserPushPermission,
    setFollowBrowserPushModalOpen,
    handleToggleFollow,
    handleOpenFollowersModal,
    handleFollowerProfileOpen,
    closeFollowersModal,
    favoritesList,
    profileTab,
    readerSinceLabel,
    obrasSorted,
    favoritesPublicVisible,
    perfilBloqueado,
    handleSupport,
    handleViewWorks,
    handleViewLikes,
    handleCatalog,
    handleOpenWork,
    handleOpenFavorite,
  };
}
