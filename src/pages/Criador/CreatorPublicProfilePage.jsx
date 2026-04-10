import React, { useEffect, useMemo, useRef, useState } from 'react';
import { equalTo, get, onValue, orderByChild, query, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db, functions } from '../../services/firebase';
import { apoiePathParaCriador } from '../../utils/creatorSupportPaths';
import { toRecordList } from '../../utils/firebaseRecordList';
import { creatorPublicHeroImageUrl } from '../../utils/creatorPublicHero';
import { resolveEffectiveCreatorMonetizationStatusFromDb } from '../../utils/creatorMonetizationUi';
import { obraCreatorId, obraSegmentoUrlPublica } from '../../config/obras';
import { obraVisivelNoCatalogoPublico } from '../../utils/obraCatalogo';
import { formatUserDisplayWithHandle } from '../../utils/publicCreatorName';
import { resolvePublicProfilePath } from '../../utils/publicProfilePaths';
import { isReaderPublicProfileEffective } from '../../utils/readerPublicProfile';
import {
  buildPublicProfileFromUsuarioRow,
  isCreatorPublicProfile,
  resolvePublicProfileAvatarUrl,
  resolvePublicProfileBio,
  resolvePublicProfileSocialLinks,
} from '../../utils/publicUserProfile';
import { normalizeUsernameInput } from '../../utils/usernameValidation';
import BrowserPushPreferenceModal from '../../components/BrowserPushPreferenceModal.jsx';
import './CriadorPublico.css';

function normalizarRede(url) {
  const valor = String(url || '').trim();
  if (!valor) return '';
  if (/^https?:\/\//i.test(valor)) return valor;
  return `https://${valor}`;
}

function pathObra(obra) {
  return `/work/${encodeURIComponent(obraSegmentoUrlPublica(obra))}`;
}

function pathObraFromFavoriteRow(row) {
  const workId = String(row?.workId || '').trim();
  if (!workId) return '/works';
  const slug = String(row?.slug || workId).trim();
  return `/work/${encodeURIComponent(obraSegmentoUrlPublica({ id: workId, slug }))}`;
}

function formatarPrecoBrl(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
}

function formatarDataLeitor(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 'recente';
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: 'numeric',
  }).format(new Date(n));
}

function countMapEntries(value) {
  if (!value || typeof value !== 'object') return 0;
  return Object.keys(value).length;
}

function valueCount(value, fallbacks = []) {
  const primary = Number(value);
  if (Number.isFinite(primary) && primary >= 0) return primary;
  for (const item of fallbacks) {
    const n = Number(item);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function commentsCountFromValue(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function statsFromWork(obra, capitulosDaObra) {
  const likes = valueCount(
    obra?.likesCount,
    [
      obra?.curtidas,
      obra?.favoritosCount,
      obra?.favoritesCount,
      countMapEntries(obra?.likes),
      countMapEntries(obra?.favoritos),
    ]
  );
  const views =
    valueCount(obra?.viewsCount, [obra?.visualizacoes]) +
    capitulosDaObra.reduce((sum, cap) => sum + valueCount(cap?.viewsCount, [cap?.visualizacoes]), 0);
  const comments =
    commentsCountFromValue(obra?.comments) +
    valueCount(obra?.commentsCount) +
    capitulosDaObra.reduce(
      (sum, cap) => sum + commentsCountFromValue(cap?.comments) + valueCount(cap?.commentsCount),
      0
    );
  return { likes, views, comments };
}

export default function CreatorPublicProfilePage({ user }) {
  const { creatorId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [perfilPublico, setPerfilPublico] = useState(null);
  const [obras, setObras] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followMessage, setFollowMessage] = useState('');
  const [followersModalOpen, setFollowersModalOpen] = useState(false);
  const [followersBusy, setFollowersBusy] = useState(false);
  const [followersError, setFollowersError] = useState('');
  const [followersList, setFollowersList] = useState([]);
  const [privateFollowerModal, setPrivateFollowerModal] = useState(null);
  const [followBrowserPushModalOpen, setFollowBrowserPushModalOpen] = useState(false);
  const [followBrowserPushPermission, setFollowBrowserPushPermission] = useState('default');
  const [publicoReady, setPublicoReady] = useState(false);
  const [obrasReady, setObrasReady] = useState(false);
  const [capitulosReady, setCapitulosReady] = useState(false);
  const [creatorStatsRow, setCreatorStatsRow] = useState({});
  const [favoritesMap, setFavoritesMap] = useState({});
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [sortObras, setSortObras] = useState('recent');
  const [resolvedCreatorUid, setResolvedCreatorUid] = useState('');
  const [creatorIdentityReady, setCreatorIdentityReady] = useState(false);
  const obrasSectionRef = useRef(null);
  const creatorLookup = String(creatorId || '').trim();
  const creatorUid = String(resolvedCreatorUid || '').trim();
  const toggleCreatorFollow = useMemo(() => httpsCallable(functions, 'toggleCreatorFollow'), []);
  const getCreatorFollowers = useMemo(() => httpsCallable(functions, 'getCreatorFollowers'), []);

  useEffect(() => {
    let alive = true;
    const raw = String(creatorLookup || '').trim();
    if (!raw) {
      setResolvedCreatorUid('');
      setCreatorIdentityReady(true);
      return () => {};
    }

    setCreatorIdentityReady(false);
    const normalizedHandle = normalizeUsernameInput(raw.replace(/^@/, ''));

    (async () => {
      try {
        const directSnapshot = await get(ref(db, `usuarios/${raw}/publicProfile`));
        if (!alive) return;
        if (directSnapshot.exists()) {
          setResolvedCreatorUid(raw);
          setCreatorIdentityReady(true);
          return;
        }

        if (!normalizedHandle) {
          setResolvedCreatorUid('');
          setCreatorIdentityReady(true);
          return;
        }

        const handleSnapshot = await get(ref(db, `usernames/${normalizedHandle}`));
        if (!alive) return;
        setResolvedCreatorUid(handleSnapshot.exists() ? String(handleSnapshot.val() || '').trim() : '');
        setCreatorIdentityReady(true);
      } catch {
        if (!alive) return;
        setResolvedCreatorUid('');
        setCreatorIdentityReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [creatorLookup]);

  useEffect(() => {
    if (!creatorUid) return () => {};
    setPublicoReady(false);
    const unsub = onValue(
      ref(db, `usuarios/${creatorUid}/publicProfile`),
      (snapshot) => {
        setPerfilPublico(
          snapshot.exists() ? buildPublicProfileFromUsuarioRow(snapshot.val() || {}, creatorUid) : null
        );
        setPublicoReady(true);
      },
      () => {
        setPerfilPublico(null);
        setPublicoReady(true);
      }
    );
    return () => unsub();
  }, [creatorUid]);

  useEffect(() => {
    if (!creatorUid) return () => {};
    const unsub = onValue(
      ref(db, `creators/${creatorUid}/stats`),
      (snapshot) => {
        setCreatorStatsRow(snapshot.exists() ? snapshot.val() || {} : {});
      },
      () => {
        setCreatorStatsRow({});
      }
    );
    return () => unsub();
  }, [creatorUid]);

  useEffect(() => {
    if (!creatorUid) return () => {};
    setObrasReady(false);
    const unsub = onValue(
      query(ref(db, 'obras'), orderByChild('creatorId'), equalTo(creatorUid)),
      (snapshot) => {
        const lista = snapshot.exists() ? toRecordList(snapshot.val()) : [];
        setObras(
          lista
            .filter((obra) => obraVisivelNoCatalogoPublico(obra) && obraCreatorId(obra) === creatorUid)
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        );
        setObrasReady(true);
      },
      () => {
        setObras([]);
        setObrasReady(true);
      }
    );
    return () => unsub();
  }, [creatorUid]);

  useEffect(() => {
    if (!creatorUid) return () => {};
    setCapitulosReady(false);
    const unsub = onValue(query(ref(db, 'capitulos'), orderByChild('creatorId'), equalTo(creatorUid)), (snapshot) => {
      setCapitulos(snapshot.exists() ? toRecordList(snapshot.val()) : []);
      setCapitulosReady(true);
    });
    return () => unsub();
  }, [creatorUid]);

  useEffect(() => {
    if (!creatorUid) return () => {};
    setFavoritesReady(false);
    const unsub = onValue(
      ref(db, `usuarios/${creatorUid}/favorites`),
      (snapshot) => {
        setFavoritesMap(snapshot.exists() ? snapshot.val() || {} : {});
        setFavoritesReady(true);
      },
      () => {
        setFavoritesMap({});
        setFavoritesReady(true);
      }
    );
    return () => unsub();
  }, [creatorUid]);

  useEffect(() => {
    if (!user?.uid || !creatorUid) {
      setIsFollowing(false);
      return () => {};
    }
    const unsub = onValue(ref(db, `usuarios/${user.uid}/followingCreators/${creatorUid}`), (snapshot) => {
      setIsFollowing(snapshot.exists());
    });
    return () => unsub();
  }, [creatorUid, user?.uid]);

  useEffect(() => {
    if (!privateFollowerModal) return undefined;
    function handleEscape(event) {
      if (event.key === 'Escape') setPrivateFollowerModal(null);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [privateFollowerModal]);

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
      const capObraId = String(cap?.obraId || cap?.mangaId || '').trim().toLowerCase();
      if (!capObraId) return;
      const bucket = grouped.get(capObraId) || [];
      bucket.push(cap);
      grouped.set(capObraId, bucket);
    });
    return grouped;
  }, [capitulos]);

  const obrasComStats = useMemo(() => {
    return obras.map((obra) => {
      const obraId = String(obra?.id || '').trim().toLowerCase();
      return {
        ...obra,
        stats: statsFromWork(obra, chapterStatsByWorkId.get(obraId) || []),
      };
    });
  }, [chapterStatsByWorkId, obras]);

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
    fallback: '/assets/fotos/shito.jpg',
  });
  const heroBackdropUrl = profileMode === 'reader' ? avatar : creatorPublicHeroImageUrl(perfilPublico);
  const creatorMonetizationStatus = resolveEffectiveCreatorMonetizationStatusFromDb(perfilPublico);
  const supportEnabled = profileMode === 'writer' && creatorMonetizationStatus === 'active';
  const supportOffer =
    perfilPublico?.creatorProfile?.supportOffer && typeof perfilPublico.creatorProfile.supportOffer === 'object'
      ? perfilPublico.creatorProfile.supportOffer
      : {};
  const membershipEnabled = supportEnabled && supportOffer.membershipEnabled === true;
  const membershipPrice = Number(supportOffer.membershipPriceBRL || 12);
  const donationSuggested = Number(supportOffer.donationSuggestedBRL || 7);
  const moderation = String(perfilPublico?.creatorModerationAction || '').trim().toLowerCase();
  const canFollow = profileMode === 'writer' && Boolean(user?.uid) && user.uid !== creatorUid;

  const favoritesList = useMemo(() => {
    const worksById = new Map(
      obras.map((obra) => [String(obra?.id || '').trim().toLowerCase(), obra])
    );
    return Object.entries(favoritesMap || {})
      .map(([workIdRaw, row]) => {
        const workId = String(workIdRaw || '').trim();
        const linkedWork = worksById.get(workId.toLowerCase());
        return {
          workId,
          slug: String(linkedWork?.slug || row?.slug || workId).trim(),
          title: String(
            linkedWork?.titulo || linkedWork?.title || row?.titulo || row?.title || workId
          ).trim(),
          coverUrl: String(
            linkedWork?.capaUrl || linkedWork?.coverUrl || row?.coverUrl || row?.capaUrl || ''
          ).trim(),
          savedAt: Number(row?.savedAt || row?.createdAt || 0) || 0,
        };
      })
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

  async function handleToggleFollow() {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    setFollowBusy(true);
    setFollowMessage('');
    try {
      const { data } = await toggleCreatorFollow({ creatorId: creatorUid });
      setIsFollowing(data?.isFollowing === true);
      if (data?.isFollowing === true) {
        const perm =
          typeof window === 'undefined' || typeof Notification === 'undefined'
            ? 'unsupported'
            : Notification.permission;
        setFollowBrowserPushPermission(perm);
        setFollowBrowserPushModalOpen(true);
      }
      setPerfilPublico((current) => {
        if (!current || typeof current !== 'object') return current;
        const currentCount = valueCount(current?.stats?.followersCount, [current?.followersCount, countMapEntries(current?.followers)]);
        const nextCount = Math.max(0, currentCount + (data?.isFollowing ? 1 : -1));
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
      if (followersModalOpen) {
        void handleOpenFollowersModal({ force: true });
      }
    } catch (err) {
      setFollowMessage(err?.message || 'Nao foi possivel atualizar o follow agora.');
    } finally {
      setFollowBusy(false);
    }
  }

  async function handleOpenFollowersModal({ force = false } = {}) {
    if (!creatorUid || profileMode !== 'writer') return;
    setFollowersModalOpen(true);
    if (!force && followersList.length) return;
    setFollowersBusy(true);
    setFollowersError('');
    try {
      const { data } = await getCreatorFollowers({ creatorId: creatorUid });
      setFollowersList(Array.isArray(data?.followers) ? data.followers : []);
    } catch (err) {
      setFollowersError(err?.message || 'Nao foi possivel carregar os seguidores agora.');
    } finally {
      setFollowersBusy(false);
    }
  }

  function handleFollowerProfileOpen(follower) {
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
    setFollowersModalOpen(false);
  }

  if (!creatorLookup) {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Criador não encontrado</h1>
          <p>O link publico informado esta incompleto.</p>
        </section>
      </main>
    );
  }

  if (!creatorUid) {
    if (!creatorIdentityReady) {
      return <div className="shito-app-splash" aria-hidden="true" />;
    }
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Criador não encontrado</h1>
          <p>Não encontramos este perfil público pelo link informado.</p>
          <button type="button" onClick={() => navigate('/works')}>
            Voltar ao catálogo
          </button>
        </section>
      </main>
    );
  }

  if (!publicoReady || !obrasReady || !capitulosReady || !favoritesReady) {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  const favoritesPublicVisible = profileMode === 'writer' ? true : readerPublic;

  const perfilBloqueado = moderation === 'banned';

  if (perfilBloqueado) {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Perfil indisponível</h1>
          <p>Este perfil público não está acessível no momento.</p>
        </section>
      </main>
    );
  }

  if (profileMode === 'none') {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Perfil privado</h1>
          <p>Este usuário não deixou o perfil público disponível.</p>
        </section>
      </main>
    );
  }

  return (
    <main className={`criador-page${profileMode === 'reader' ? ' criador-page--reader' : ''}`}>
      <BrowserPushPreferenceModal
        open={followBrowserPushModalOpen}
        permission={followBrowserPushPermission}
        title="Avisos no navegador"
        description="Você passou a seguir este criador. Quer receber notificação aqui no navegador quando sair capítulo novo?"
        onClose={() => setFollowBrowserPushModalOpen(false)}
      />
      {followersModalOpen ? (
        <div
          className="criador-followers-modal__overlay"
          role="presentation"
          onClick={() => setFollowersModalOpen(false)}
        >
          <div
            className="criador-followers-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="criador-followers-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="criador-followers-modal__head">
              <div>
                <h2 id="criador-followers-title">Seguidores</h2>
                <p>{creatorStats.followersCount} perfil(is) acompanhando este escritor.</p>
              </div>
              <button type="button" className="criador-followers-modal__close" onClick={() => setFollowersModalOpen(false)}>
                Fechar
              </button>
            </div>
            {followersBusy ? <p className="criador-followers-modal__empty">Carregando seguidores...</p> : null}
            {!followersBusy && followersError ? <p className="criador-followers-modal__error">{followersError}</p> : null}
            {!followersBusy && !followersError && !followersList.length ? (
              <p className="criador-followers-modal__empty">Ninguem esta seguindo este escritor ainda.</p>
            ) : null}
            {!followersBusy && !followersError && followersList.length ? (
              <div className="criador-followers-modal__list">
                {followersList.map((follower) => (
                  <button
                    key={String(follower.uid || '')}
                    type="button"
                    className="criador-follower-row"
                    onClick={() => handleFollowerProfileOpen(follower)}
                  >
                    <img
                      src={String(follower.avatarUrl || '').trim() || '/assets/avatares/ava1.webp'}
                      alt={String(follower.displayName || follower.userHandle || 'Usuario')}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                    />
                    <span className="criador-follower-row__body">
                      <strong>{follower.displayName || 'Leitor'}</strong>
                      <span>
                        {follower.userHandle ? `@${follower.userHandle}` : 'sem @'}{' '}
                        {follower.isCreatorProfile ? '• escritor' : follower.isProfilePublic ? '• leitor publico' : '• perfil privado'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {privateFollowerModal ? (
        <div
          className="criador-followers-modal__overlay"
          role="presentation"
          onClick={() => setPrivateFollowerModal(null)}
        >
          <div
            className="criador-followers-modal criador-followers-modal--private"
            role="dialog"
            aria-modal="true"
            aria-labelledby="criador-private-profile-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="criador-private-profile-title">Perfil privado</h2>
            <p>{privateFollowerModal.label} nao deixou o card publico disponivel no momento.</p>
            <div className="criador-followers-modal__actions">
              <button type="button" onClick={() => setPrivateFollowerModal(null)}>
                Entendi
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <section className={`criador-hero criador-hero--blur-backdrop${profileMode === 'reader' ? ' criador-hero--reader' : ''}`}>
        <div className="criador-hero__backdrop" aria-hidden="true">
          <div
            className="criador-hero__backdrop-img"
            style={{ backgroundImage: `url(${heroBackdropUrl})` }}
          />
          <div className="criador-hero__backdrop-scrim" />
        </div>
        <div className="criador-hero__foreground">
        <div className="criador-hero__avatar">
          <img src={avatar} alt={publicLine} referrerPolicy="no-referrer" crossOrigin="anonymous" />
        </div>
        <div className="criador-hero__content">
          <span className={`criador-hero__pill${profileMode === 'reader' ? ' criador-hero__pill--reader' : ''}`}>
            {profileMode === 'writer' ? 'Escritor' : 'Leitor'}
          </span>
          <h1 className="criador-hero__title-line">{publicLine}</h1>
          {bio ? <p className="criador-hero__bio">{bio}</p> : null}
          <div className="criador-hero__actions">
            {canFollow ? (
              <button type="button" className={isFollowing ? 'is-secondary' : ''} disabled={followBusy} onClick={handleToggleFollow}>
                {followBusy ? 'Atualizando...' : isFollowing ? 'Seguindo' : 'Seguir'}
              </button>
            ) : null}
            {supportEnabled ? (
              <button type="button" onClick={() => navigate(apoiePathParaCriador(creatorUid))}>
                Apoie-me
              </button>
            ) : null}
            {profileMode === 'writer' ? (
              <button
                type="button"
                className="is-secondary"
                onClick={() => {
                  setSearchParams({ tab: 'works' });
                  window.setTimeout(() => {
                    obrasSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 80);
                }}
              >
                Ver obras
              </button>
            ) : (
              <button
                type="button"
                className="is-secondary is-reader-accent"
                onClick={() => setSearchParams({ tab: 'likes' })}
              >
                Ver curtidas
              </button>
            )}
            <button type="button" className="is-secondary" onClick={() => navigate('/works')}>
              Catálogo geral
            </button>
          </div>
          {followMessage ? <p className="criador-hero__support-copy">{followMessage}</p> : null}
          {profileMode === 'writer' ? (
            <>
              <div className="criador-stats-grid">
                <article>
                  <button type="button" className="criador-stat-button" onClick={() => handleOpenFollowersModal()}>
                    <strong>{creatorStats.followersCount}</strong>
                    <span>seguidores</span>
                  </button>
                </article>
                <article>
                  <strong>{obrasComStats.length}</strong>
                  <span>obras públicas</span>
                </article>
                <article>
                  <strong>{creatorStats.totalViews}</strong>
                  <span>views (obras)</span>
                </article>
                <article>
                  <strong>{membershipEnabled ? formatarPrecoBrl(membershipPrice) : '—'}</strong>
                  <span>{membershipEnabled ? 'membership /30d' : 'apoio indisponível'}</span>
                </article>
              </div>
              <p className="criador-hero__support-copy">
                Seguir este escritor ajuda a plataforma a destacar lançamentos e novidades quando estiverem ativas.
              </p>
              {!supportEnabled ? (
                <p className="criador-hero__support-copy">
                  Este escritor está em modo "só publicar". Apoio e membership ainda não estão disponíveis.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className="criador-stats-grid criador-stats-grid--reader">
                <article>
                  <strong>{readerSinceLabel}</strong>
                  <span>membro desde</span>
                </article>
                <article>
                  <strong>{favoritesList.length}</strong>
                  <span>obras curtidas</span>
                </article>
                <article>
                  <strong>{readerPublic ? 'ativo' : 'fechado'}</strong>
                  <span>perfil público</span>
                </article>
              </div>
              <p className="criador-hero__support-copy">
                Este perfil público de leitor mostra apenas os dados básicos disponibilizados pelo usuário.
              </p>
            </>
          )}
          {membershipEnabled ? (
            <p className="criador-hero__support-copy">
              <strong>Membership:</strong> {formatarPrecoBrl(membershipPrice)} a cada 30 dias — acesso antecipado nas obras
              deste escritor. Doação sugerida: {formatarPrecoBrl(donationSuggested)}.
            </p>
          ) : null}
          {redes.length ? (
            <div className="criador-hero__links">
              {redes.map((rede) => (
                <a key={rede.id} href={rede.href} target="_blank" rel="noreferrer">
                  {rede.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        </div>
      </section>

      <nav
        className={`criador-profile-tabs${profileMode === 'reader' ? ' criador-profile-tabs--reader' : ''}`}
        aria-label="Seções do perfil"
      >
        {profileMode === 'writer' ? (
          <button
            type="button"
            className={profileTab === 'works' ? 'is-active' : ''}
            onClick={() => setSearchParams({ tab: 'works' })}
          >
            Obras
          </button>
        ) : null}
        <button
          type="button"
          className={profileTab === 'likes' ? 'is-active' : ''}
          onClick={() => setSearchParams({ tab: 'likes' })}
        >
          {profileMode === 'writer' ? 'Curtidas' : 'Biblioteca'}
        </button>
      </nav>

      {profileMode === 'writer' && membershipEnabled ? (
        <section className="criador-section criador-section--support" aria-labelledby="criador-apoio-title">
          <div className="criador-section__head">
            <h2 id="criador-apoio-title">Apoie este escritor</h2>
          </div>
          <div className="criador-support-card">
            <p>
              <strong>{formatarPrecoBrl(membershipPrice)}</strong> / 30 dias — membros ganham acesso antecipado aos
              capitulos deste autor nas obras vinculadas.
            </p>
            <ul className="criador-support-benefits">
              <li>Lancamentos antecipados (quando o autor publicar com early access)</li>
              <li>Apoio direto ao trabalho autoral</li>
            </ul>
            <button type="button" className="criador-support-cta" onClick={() => navigate(apoiePathParaCriador(creatorUid))}>
              Apoie-me
            </button>
          </div>
        </section>
      ) : null}

      {profileMode === 'writer' && profileTab === 'works' ? (
        <section ref={obrasSectionRef} className="criador-section" id="obras-do-criador">
          <div className="criador-section__head criador-section__head--row">
            <h2>Obras publicadas</h2>
            <div className="criador-section__meta">
              <span>{obrasComStats.length} obra(s)</span>
              <label className="criador-sort-label">
                Ordenar
                <select value={sortObras} onChange={(e) => setSortObras(e.target.value)} aria-label="Ordenar obras">
                  <option value="recent">Mais recentes</option>
                  <option value="popular">Mais populares</option>
                </select>
              </label>
            </div>
          </div>
          {!obrasSorted.length ? (
            <p className="criador-section__empty">Nenhuma obra pública cadastrada ainda.</p>
          ) : (
            <div className="criador-obras-grid">
              {obrasSorted.map((obra) => {
                const sinopse = String(obra.sinopse || obra.descricao || '').trim();
                return (
                  <article
                    key={obra.id}
                    className="criador-obra-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(pathObra(obra))}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(pathObra(obra))}
                  >
                    <div className="criador-obra-card__thumb">
                      <img
                        src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'}
                        alt={obra.titulo || obra.id}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                      />
                    </div>
                    <div className="criador-obra-card__body">
                      <strong className="criador-obra-card__title">{obra.titulo || obra.id}</strong>
                      <span className="criador-obra-card__meta">{obra.status || 'ongoing'}</span>
                      {sinopse ? (
                        <p className="criador-obra-card__synopsis">{sinopse}</p>
                      ) : null}
                      <div className="criador-obra-stats" aria-label="Estatisticas da obra">
                        <small>{obra.stats.likes} curtidas</small>
                        <small>{obra.stats.views} views</small>
                        <small>{obra.stats.comments} comentarios</small>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {profileTab === 'likes' ? (
        <section className="criador-section criador-section--favorites" aria-labelledby="criador-curtidas-title">
          <div className="criador-section__head">
            <h2 id="criador-curtidas-title">{profileMode === 'writer' ? 'Obras curtidas' : 'Biblioteca pública'}</h2>
          </div>
          {!favoritesPublicVisible ? (
            <p className="criador-section__empty">Este usuário não exibe curtidas publicamente.</p>
          ) : !favoritesList.length ? (
            <p className="criador-section__empty">
              {profileMode === 'writer'
                ? 'Este escritor ainda não salvou nenhuma obra por aqui.'
                : 'Este leitor ainda não salvou nenhuma obra publicamente.'}
            </p>
          ) : (
            <div className="criador-favorites-grid">
              {favoritesList.map((fav) => (
                <button
                  key={String(fav.workId)}
                  type="button"
                  className="criador-favorite-card"
                  onClick={() => navigate(pathObraFromFavoriteRow(fav))}
                >
                  <div className="criador-favorite-card__thumb">
                    <img
                      src={String(fav.coverUrl || '').trim() || '/assets/fotos/shito.jpg'}
                      alt={String(fav.title || fav.workId || '')}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                    />
                  </div>
                  <span className="criador-favorite-card__title">{fav.title || fav.workId}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

    </main>
  );
}
