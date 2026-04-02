import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { useNavigate, useParams } from 'react-router-dom';

import { CREATOR_BIO_MIN_LENGTH } from '../../constants';
import { db, functions } from '../../services/firebase';
import { apoiePathParaCriador } from '../../utils/creatorSupportPaths';
import { toRecordList } from '../../utils/firebaseRecordList';
import { creatorPublicHeroImageUrl } from '../../utils/creatorPublicHero';
import { ensureLegacyShitoObra, obraCreatorId, obraSegmentoUrlPublica } from '../../config/obras';
import { obraVisivelNoCatalogoPublico } from '../../utils/obraCatalogo';
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

function formatarPrecoBrl(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
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
  const [perfilPublico, setPerfilPublico] = useState(null);
  const [obras, setObras] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followMessage, setFollowMessage] = useState('');
  const creatorUid = String(creatorId || '').trim();
  const toggleCreatorFollow = useMemo(() => httpsCallable(functions, 'toggleCreatorFollow'), []);

  useEffect(() => {
    if (!creatorUid) return () => {};
    const unsub = onValue(ref(db, `usuarios_publicos/${creatorUid}`), (snapshot) => {
      setPerfilPublico(snapshot.exists() ? snapshot.val() : null);
    });
    return () => unsub();
  }, [creatorUid]);

  useEffect(() => {
    const unsub = onValue(ref(db, 'obras'), (snapshot) => {
      const lista = snapshot.exists() ? ensureLegacyShitoObra(toRecordList(snapshot.val())) : [];
      setObras(
        lista
          .filter((obra) => obraVisivelNoCatalogoPublico(obra) && obraCreatorId(obra) === creatorUid)
          .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      );
    });
    return () => unsub();
  }, [creatorUid]);

  useEffect(() => {
    const unsub = onValue(ref(db, 'capitulos'), (snapshot) => {
      setCapitulos(snapshot.exists() ? toRecordList(snapshot.val()) : []);
    });
    return () => unsub();
  }, []);

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

  const redes = useMemo(() => {
    const socialLinks = perfilPublico?.creatorProfile?.socialLinks || {};
    const instagramUrl = normalizarRede(
      socialLinks?.instagramUrl || perfilPublico?.instagramUrl || perfilPublico?.instagram
    );
    const youtubeUrl = normalizarRede(
      socialLinks?.youtubeUrl || perfilPublico?.youtubeUrl || perfilPublico?.youtube
    );
    return [
      instagramUrl ? { id: 'instagram', label: 'Instagram', href: instagramUrl } : null,
      youtubeUrl ? { id: 'youtube', label: 'YouTube', href: youtubeUrl } : null,
    ].filter(Boolean);
  }, [perfilPublico]);

  const obrasComStats = useMemo(() => {
    return obras.map((obra) => {
      const obraId = String(obra?.id || '').trim().toLowerCase();
      const capsDaObra = capitulos.filter((cap) => {
        const capObraId = String(cap?.obraId || cap?.mangaId || '').trim().toLowerCase();
        return capObraId === obraId;
      });
      return {
        ...obra,
        stats: statsFromWork(obra, capsDaObra),
      };
    });
  }, [capitulos, obras]);

  const creatorStats = useMemo(() => {
    const fromProfile = perfilPublico?.creatorProfile?.stats || perfilPublico?.stats || {};
    return {
      followersCount: valueCount(fromProfile?.followersCount, [
        perfilPublico?.followersCount,
        countMapEntries(perfilPublico?.followers),
      ]),
      totalLikes: obrasComStats.reduce((sum, obra) => sum + Number(obra?.stats?.likes || 0), 0),
      totalViews: obrasComStats.reduce((sum, obra) => sum + Number(obra?.stats?.views || 0), 0),
      totalComments: obrasComStats.reduce((sum, obra) => sum + Number(obra?.stats?.comments || 0), 0),
    };
  }, [obrasComStats, perfilPublico]);

  const nomeCriador =
    String(
      perfilPublico?.creatorProfile?.displayName || perfilPublico?.creatorDisplayName || perfilPublico?.userName || ''
    ).trim() ||
    (obras[0]?.creatorName ? String(obras[0].creatorName) : '') ||
    'Criador';

  const username = String(
    perfilPublico?.creatorProfile?.username || perfilPublico?.creatorUsername || perfilPublico?.username || creatorUid
  ).trim();
  const bioShort = String(
    perfilPublico?.creatorProfile?.bioShort || perfilPublico?.creatorBio || perfilPublico?.bio || ''
  ).trim();
  const bioFull = String(perfilPublico?.creatorProfile?.bioFull || '').trim();
  const bio = bioFull || bioShort;
  const avatar =
    String(perfilPublico?.creatorProfile?.avatarUrl || perfilPublico?.userAvatar || '').trim() ||
    '/assets/fotos/shito.jpg';
  const heroBackdropUrl = creatorPublicHeroImageUrl(perfilPublico);
  const creatorStatus = String(perfilPublico?.creatorStatus || '').trim().toLowerCase();
  const creatorMonetizationStatus = String(perfilPublico?.creatorMonetizationStatus || '').trim().toLowerCase();
  const membershipEnabled = creatorMonetizationStatus === 'active' && perfilPublico?.creatorMembershipEnabled === true;
  const membershipPrice = Number(perfilPublico?.creatorMembershipPriceBRL || 12);
  const donationSuggested = Number(perfilPublico?.creatorDonationSuggestedBRL || 7);
  const hasPublicBase = avatar.length > 3 && bio.length >= CREATOR_BIO_MIN_LENGTH && redes.length > 0;
  const canFollow = Boolean(user?.uid) && user.uid !== creatorUid;

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
      if (data?.isFollowing === true && typeof window !== 'undefined' && typeof Notification !== 'undefined') {
        const wantsBrowserNotifications = window.confirm(
          'Voce começou a seguir este criador. Deseja receber avisos no navegador quando sair capitulo novo?'
        );
        if (wantsBrowserNotifications && Notification.permission === 'default') {
          await Notification.requestPermission();
        }
      }
      setPerfilPublico((current) => {
        if (!current || typeof current !== 'object') return current;
        const currentCount = valueCount(current?.creatorProfile?.stats?.followersCount, [
          current?.stats?.followersCount,
          current?.followersCount,
          countMapEntries(current?.followers),
        ]);
        const nextCount = Math.max(0, currentCount + (data?.isFollowing ? 1 : -1));
        return {
          ...current,
          followersCount: nextCount,
          stats: {
            ...(current?.stats && typeof current.stats === 'object' ? current.stats : {}),
            followersCount: nextCount,
          },
          creatorProfile: {
            ...(current?.creatorProfile && typeof current.creatorProfile === 'object'
              ? current.creatorProfile
              : {}),
            stats: {
              ...(current?.creatorProfile?.stats && typeof current.creatorProfile.stats === 'object'
                ? current.creatorProfile.stats
                : {}),
              followersCount: nextCount,
            },
          },
        };
      });
    } catch (err) {
      setFollowMessage(err?.message || 'Nao foi possivel atualizar o follow agora.');
    } finally {
      setFollowBusy(false);
    }
  }

  if (!creatorUid) {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Criador nao encontrado</h1>
          <p>O link publico informado esta incompleto.</p>
        </section>
      </main>
    );
  }

  if ((creatorStatus && creatorStatus !== 'active') || !hasPublicBase) {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>{nomeCriador}</h1>
          <p>Este perfil de criador ainda esta em preparacao e nao foi publicado por completo.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="criador-page">
      <section className="criador-hero criador-hero--blur-backdrop">
        <div className="criador-hero__backdrop" aria-hidden="true">
          <div
            className="criador-hero__backdrop-img"
            style={{ backgroundImage: `url(${heroBackdropUrl})` }}
          />
          <div className="criador-hero__backdrop-scrim" />
        </div>
        <div className="criador-hero__foreground">
        <div className="criador-hero__avatar">
          <img src={avatar} alt={nomeCriador} />
        </div>
        <div className="criador-hero__content">
          <span className="criador-hero__pill">Criador</span>
          <h1>{nomeCriador}</h1>
          <p className="criador-hero__username">@{username}</p>
          <p>{bio || 'Criador autoral da plataforma MangaTeofilo.'}</p>
          <div className="criador-hero__actions">
            {canFollow ? (
              <button type="button" className={isFollowing ? 'is-secondary' : ''} disabled={followBusy} onClick={handleToggleFollow}>
                {followBusy ? 'Atualizando...' : isFollowing ? 'Seguindo' : 'Seguir'}
              </button>
            ) : null}
            {membershipEnabled ? (
              <button type="button" onClick={() => navigate(apoiePathParaCriador(creatorUid))}>
                Apoiar o autor
              </button>
            ) : null}
            <button type="button" className="is-secondary" onClick={() => navigate('/works')}>
              Ver catalogo
            </button>
          </div>
          {followMessage ? <p className="criador-hero__support-copy">{followMessage}</p> : null}
          <div className="criador-stats-grid">
            <article>
              <strong>{creatorStats.followersCount}</strong>
              <span>seguidores</span>
            </article>
            <article>
              <strong>{creatorStats.totalLikes}</strong>
              <span>likes</span>
            </article>
            <article>
              <strong>{creatorStats.totalViews}</strong>
              <span>views</span>
            </article>
            <article>
              <strong>{creatorStats.totalComments}</strong>
              <span>comentarios</span>
            </article>
          </div>
          <p className="criador-hero__support-copy">
            Este e o link principal de apoio direto ao criador dentro da plataforma.
          </p>
          {membershipEnabled ? (
            <p className="criador-hero__support-copy">
              Membership do criador: <strong>{formatarPrecoBrl(membershipPrice)}</strong> por 30 dias. Ela libera acesso antecipado somente nas obras deste autor. Doacao sugerida: <strong>{formatarPrecoBrl(donationSuggested)}</strong>.
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

      <section className="criador-section">
        <div className="criador-section__head">
          <h2>Obras do criador</h2>
          <span>{obrasComStats.length} obra(s)</span>
        </div>
        {!obrasComStats.length ? (
          <p className="criador-section__empty">Nenhuma obra publica cadastrada para este criador ainda.</p>
        ) : (
          <div className="criador-obras-grid">
            {obrasComStats.map((obra) => (
              <article
                key={obra.id}
                className="criador-obra-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(pathObra(obra))}
                onKeyDown={(e) => e.key === 'Enter' && navigate(pathObra(obra))}
              >
                <img src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'} alt={obra.titulo || obra.id} />
                <div>
                  <strong>{obra.titulo || obra.id}</strong>
                  <span>{obra.status || 'ongoing'}</span>
                  <div className="criador-obra-stats">
                    <small>{obra.stats.likes} likes</small>
                    <small>{obra.stats.views} views</small>
                    <small>{obra.stats.comments} comentarios</small>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
