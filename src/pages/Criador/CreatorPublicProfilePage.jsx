import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { useNavigate, useParams } from 'react-router-dom';
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
  const [publicoReady, setPublicoReady] = useState(false);
  const [obrasReady, setObrasReady] = useState(false);
  const [sortObras, setSortObras] = useState('recent');
  const obrasSectionRef = useRef(null);
  const creatorUid = String(creatorId || '').trim();
  const toggleCreatorFollow = useMemo(() => httpsCallable(functions, 'toggleCreatorFollow'), []);

  useEffect(() => {
    if (!creatorUid) return () => {};
    setPublicoReady(false);
    const unsub = onValue(
      ref(db, `usuarios_publicos/${creatorUid}`),
      (snapshot) => {
        setPerfilPublico(snapshot.exists() ? snapshot.val() : null);
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
    setObrasReady(false);
    const unsub = onValue(
      ref(db, 'obras'),
      (snapshot) => {
        const lista = snapshot.exists() ? ensureLegacyShitoObra(toRecordList(snapshot.val())) : [];
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
  const creatorMonetizationStatus = String(perfilPublico?.creatorMonetizationStatus || '').trim().toLowerCase();
  const membershipEnabled = creatorMonetizationStatus === 'active' && perfilPublico?.creatorMembershipEnabled === true;
  const membershipPrice = Number(perfilPublico?.creatorMembershipPriceBRL || 12);
  const donationSuggested = Number(perfilPublico?.creatorDonationSuggestedBRL || 7);
  const moderation = String(perfilPublico?.creatorModerationAction || '').trim().toLowerCase();
  const canFollow = Boolean(user?.uid) && user.uid !== creatorUid;

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

  if (!publicoReady || !obrasReady) {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  const perfilBloqueado = moderation === 'banned';
  const temSinalPublico = perfilPublico != null || obras.length > 0;

  if (perfilBloqueado) {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Perfil indisponivel</h1>
          <p>Este perfil de criador nao esta acessivel no momento.</p>
        </section>
      </main>
    );
  }

  if (!temSinalPublico) {
    return (
      <main className="criador-page">
        <section className="criador-empty">
          <h1>Criador nao encontrado</h1>
          <p>Nao ha dados publicos para este link.</p>
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
          <p className="criador-hero__bio">{bio || 'Historias autorais na MangaTeofilo.'}</p>
          <div className="criador-hero__actions">
            {canFollow ? (
              <button type="button" className={isFollowing ? 'is-secondary' : ''} disabled={followBusy} onClick={handleToggleFollow}>
                {followBusy ? 'Atualizando...' : isFollowing ? 'Seguindo' : 'Seguir'}
              </button>
            ) : null}
            {membershipEnabled ? (
              <button type="button" onClick={() => navigate(apoiePathParaCriador(creatorUid))}>
                Apoiar
              </button>
            ) : null}
            <button
              type="button"
              className="is-secondary"
              onClick={() => obrasSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Ver obras
            </button>
            <button type="button" className="is-secondary" onClick={() => navigate('/works')}>
              Catalogo geral
            </button>
          </div>
          {followMessage ? <p className="criador-hero__support-copy">{followMessage}</p> : null}
          <div className="criador-stats-grid">
            <article>
              <strong>{creatorStats.followersCount}</strong>
              <span>seguidores</span>
            </article>
            <article>
              <strong>{obrasComStats.length}</strong>
              <span>obras publicas</span>
            </article>
            <article>
              <strong>{creatorStats.totalViews}</strong>
              <span>views (obras)</span>
            </article>
            <article>
              <strong>{membershipEnabled ? formatarPrecoBrl(membershipPrice) : '—'}</strong>
              <span>{membershipEnabled ? 'membership /30d' : 'apoiar no site'}</span>
            </article>
          </div>
          <p className="criador-hero__support-copy">
            Seguir este criador ajuda a plataforma a destacar lancamentos e novidades quando estiverem ativas.
          </p>
          {membershipEnabled ? (
            <p className="criador-hero__support-copy">
              <strong>Membership:</strong> {formatarPrecoBrl(membershipPrice)} a cada 30 dias — acesso antecipado nas obras
              deste autor. Doacao sugerida: {formatarPrecoBrl(donationSuggested)}.
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

      {membershipEnabled ? (
        <section className="criador-section criador-section--support" aria-labelledby="criador-apoio-title">
          <div className="criador-section__head">
            <h2 id="criador-apoio-title">Apoie este criador</h2>
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
              Quero apoiar
            </button>
          </div>
        </section>
      ) : null}

      <section ref={obrasSectionRef} className="criador-section" id="obras-do-criador">
        <div className="criador-section__head criador-section__head--row">
          <h2>Obras do criador</h2>
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
          <p className="criador-section__empty">Nenhuma obra publica cadastrada para este criador ainda.</p>
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
    </main>
  );
}
