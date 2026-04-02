import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db } from '../../services/firebase';
import {
  OBRA_PADRAO_ID,
  OBRA_SHITO_DEFAULT,
  ensureLegacyShitoObra,
  obterObraIdCapitulo,
  obraCreatorId,
  obraSegmentoUrlPublica,
} from '../../config/obras';
import { buildDiscoveryRanking } from '../../utils/discoveryRanking';
import { mergeWorkFavoriteMaps, removeWorkFavoriteBoth, saveWorkFavoriteBoth } from '../../utils/workFavorites';
import { obraVisivelNoCatalogoPublico } from '../../utils/obraCatalogo';
import './ListaMangas.css';

function pathObraPublica(obra) {
  return `/work/${encodeURIComponent(obraSegmentoUrlPublica(obra))}`;
}

function toList(snapshotVal) {
  if (!snapshotVal || typeof snapshotVal !== 'object') return [];
  return Object.entries(snapshotVal).map(([id, data]) => ({ id, ...(data || {}) }));
}

function msUltimaAtualizacao(cap) {
  const release = Number(cap?.publicReleaseAt);
  if (Number.isFinite(release) && release > 0) return release;
  const uploadMs = Date.parse(cap?.dataUpload || '');
  if (Number.isFinite(uploadMs) && uploadMs > 0) return uploadMs;
  return 0;
}

function formatarAtualizacaoRelativa(ts) {
  if (!Number.isFinite(Number(ts)) || Number(ts) <= 0) return 'Sem atualização';
  const dias = Math.max(0, Math.floor((Date.now() - Number(ts)) / (1000 * 60 * 60 * 24)));
  if (dias <= 0) return 'Atualizado hoje';
  if (dias === 1) return 'Atualizado há 1 dia';
  return `Atualizado há ${dias} dias`;
}

export default function ListaMangas({ user }) {
  const navigate = useNavigate();
  const [catalogSnapshotNow] = useState(() => Date.now());
  const [loadingObras, setLoadingObras] = useState(true);
  const [loadingCaps, setLoadingCaps] = useState(true);
  const [obras, setObras] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
  const [creatorsMap, setCreatorsMap] = useState({});
  const [favoritosLegacy, setFavoritosLegacy] = useState({});
  const [favoritosCanon, setFavoritosCanon] = useState({});

  useEffect(() => {
    const obrasRef = ref(db, 'obras');
    const unsub = onValue(obrasRef, (snapshot) => {
      if (!snapshot.exists()) {
        setObras([{ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID }]);
        setLoadingObras(false);
        return;
      }
      const lista = ensureLegacyShitoObra(toList(snapshot.val()))
        .filter((obra) => obraVisivelNoCatalogoPublico(obra))
        .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
      setObras(lista);
      setLoadingObras(false);
    }, () => {
      setObras([{ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID }]);
      setLoadingObras(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const capsRef = ref(db, 'capitulos');
    const unsub = onValue(capsRef, (snapshot) => {
      const lista = snapshot.exists() ? toList(snapshot.val()) : [];
      setCapitulos(lista);
      setLoadingCaps(false);
    }, () => {
      setCapitulos([]);
      setLoadingCaps(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(db, 'usuarios_publicos'), (snapshot) => {
      setCreatorsMap(snapshot.exists() ? snapshot.val() || {} : {});
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFavoritosLegacy({});
      setFavoritosCanon({});
      return () => {};
    }
    const u1 = onValue(ref(db, `usuarios/${user.uid}/favoritosObras`), (snapshot) => {
      setFavoritosLegacy(snapshot.exists() ? snapshot.val() || {} : {});
    });
    const u2 = onValue(ref(db, `usuarios/${user.uid}/favorites`), (snapshot) => {
      setFavoritosCanon(snapshot.exists() ? snapshot.val() || {} : {});
    });
    return () => {
      u1();
      u2();
    };
  }, [user?.uid]);

  const favoritosMap = useMemo(
    () => mergeWorkFavoriteMaps(favoritosLegacy, favoritosCanon),
    [favoritosLegacy, favoritosCanon]
  );

  const obrasCards = useMemo(() => {
    const agrupado = new Map();
    capitulos.forEach((cap) => {
      const obraId = obterObraIdCapitulo(cap);
      const atual = agrupado.get(obraId) || { total: 0, lastUpdateTs: 0 };
      const ts = msUltimaAtualizacao(cap);
      agrupado.set(obraId, {
        total: atual.total + 1,
        lastUpdateTs: Math.max(atual.lastUpdateTs, ts),
      });
    });

    return obras.map((obra) => {
      const obraId = String(obra?.id || '').toLowerCase();
      const stats = agrupado.get(obraId) || { total: 0, lastUpdateTs: Number(obra?.updatedAt || 0) };
      const dias = Math.floor((catalogSnapshotNow - Number(stats.lastUpdateTs || 0)) / (1000 * 60 * 60 * 24));
      const badgeNovo = Number.isFinite(dias) && dias >= 0 && dias <= 7;
      const status = String(obra?.status || 'ongoing').toLowerCase();
      return {
        ...obra,
        obraId,
        totalCapitulos: stats.total,
        lastUpdateTs: stats.lastUpdateTs,
        updatedLabel: formatarAtualizacaoRelativa(stats.lastUpdateTs),
        isFavorito: Boolean(favoritosMap?.[obraId]),
        badgeNovo,
        status,
      };
    });
  }, [obras, capitulos, favoritosMap, catalogSnapshotNow]);

  const discovery = useMemo(
    () => buildDiscoveryRanking({ obras, capitulos, creatorsMap }),
    [obras, capitulos, creatorsMap]
  );
  const heroWork = discovery.trendingWorks[0] || obrasCards[0] || null;

  const creatorName = (obra) => {
    const profile = creatorsMap?.[obraCreatorId(obra)] || null;
    return (
      profile?.creatorProfile?.displayName ||
      profile?.creatorDisplayName ||
      profile?.userName ||
      'Criador'
    );
  };

  const toggleFavorito = async (obra) => {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    const wid = obra.obraId;
    if (obra.isFavorito) {
      await removeWorkFavoriteBoth(db, user.uid, wid);
      return;
    }
    await saveWorkFavoriteBoth(db, user.uid, wid, {
      obraId: wid,
      workId: wid,
      creatorId: obraCreatorId(obra),
      titulo: obra.titulo || wid,
      savedAt: Date.now(),
    });
  };

  if (loadingObras || loadingCaps) {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  return (
    <main className="lista-mangas-page">
      <div className="lista-mangas-inner">
        <header className="lista-mangas-header">
          <h1>Lista de mangás</h1>
          <p>
            Catálogo MangaTeofilo — grelha de capas responsiva (celular, tablet, TV). Toque na capa para abrir a
            obra.
          </p>
        </header>

        {heroWork ? (
          <section
            className="hero-banner"
            role="button"
            tabIndex={0}
            onClick={() => navigate(pathObraPublica(heroWork))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(pathObraPublica(heroWork));
              }
            }}
          >
            <img
              src={heroWork.bannerUrl || heroWork.capaUrl || '/assets/fotos/shito.jpg'}
              alt={heroWork.titulo || heroWork.id || 'Obra em destaque'}
              className="hero-banner-image"
            />
            <div className="hero-content">
              <span className="hero-kicker">Em destaque</span>
              <h2>{heroWork.titulo || heroWork.id}</h2>
              <p className="hero-creator">por {creatorName(heroWork)}</p>
              <div className="hero-stats">
                <span>{Math.round(heroWork.totalViews || 0)} views</span>
                <span>{heroWork.totalLikes || 0} likes</span>
                <span>{heroWork.followersCount || 0} seguidores</span>
              </div>
            </div>
          </section>
        ) : null}

        {discovery.trendingWorks.length > 0 ? (
          <section className="lista-discovery-section">
            <div className="lista-discovery-head">
              <h2>Obras em alta</h2>
              <p>Ranking por seguidores, likes, views, comentarios e recencia.</p>
            </div>
            <div className="lista-discovery-row">
              {discovery.trendingWorks.slice(0, 6).map((obra, index) => (
                <article
                  key={`discover-work-${obra.id}`}
                  className="lista-discovery-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(pathObraPublica(obra))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(pathObraPublica(obra));
                    }
                  }}
                >
                  <span className="lista-discovery-rank">#{index + 1}</span>
                  <img
                    src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'}
                    alt={obra.titulo || obra.id}
                    className="lista-discovery-cover"
                  />
                  <div className="lista-discovery-body">
                    <strong>{obra.titulo || obra.id}</strong>
                    <span>por {creatorName(obra)}</span>
                    <span>{Math.round(obra.totalViews || 0)} views · {obra.totalLikes || 0} likes</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {discovery.popularCreators.length > 0 ? (
          <section className="lista-discovery-section">
            <div className="lista-discovery-head">
              <h2>Criadores populares</h2>
              <p>Perfis com audiencia forte e obras puxando descoberta no catalogo.</p>
            </div>
            <div className="lista-discovery-row">
              {discovery.popularCreators.slice(0, 6).map((creator, index) => (
                <article
                  key={`discover-creator-${creator.creatorId}`}
                  className="lista-discovery-card is-creator"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/criador/${encodeURIComponent(creator.creatorId)}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/criador/${encodeURIComponent(creator.creatorId)}`);
                    }
                  }}
                >
                  <span className="lista-discovery-rank">#{index + 1}</span>
                  <img
                    src={creator.avatarUrl || '/assets/fotos/shito.jpg'}
                    alt={creator.displayName}
                    className="lista-discovery-cover"
                  />
                  <div className="lista-discovery-body">
                    <strong>{creator.displayName}</strong>
                    <span>@{creator.username || creator.creatorId}</span>
                    <span>{creator.followersCount} seguidores · {creator.worksCount} obra(s)</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {obrasCards.length === 0 ? (
          <section className="lista-mangas-empty">
            <h2>Nenhuma obra publicada</h2>
            <p>Quando uma obra estiver com <code>isPublished=true</code>, ela aparecerá aqui.</p>
          </section>
        ) : (
          <section className="lista-mangas-grid">
            {obrasCards.map((obra) => (
              <article
                key={obra.obraId}
                className="manga-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(pathObraPublica(obra))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(pathObraPublica(obra));
                  }
                }}
              >
                <div className="manga-card-cover-wrap">
                  <img
                    src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'}
                    alt={obra.titulo || obra.obraId}
                    className="manga-card-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="manga-card-badges">
                    {obra.badgeNovo && <span className="badge novo">Novo</span>}
                    {obra.status === 'completed' && <span className="badge completo">Completo</span>}
                    {obra.status === 'hiatus' && <span className="badge hiato">Hiato</span>}
                    {obra.status === 'ongoing' && <span className="badge ongoing">Em lançamento</span>}
                  </div>
                </div>
                <div className="manga-card-body">
                  <h3>{obra.titulo || obra.obraId}</h3>
                  <p className="manga-update">{obra.updatedLabel}</p>
                  <p className="manga-meta">{obra.totalCapitulos} capítulos</p>
                  <div className="manga-card-actions">
                    <button
                      type="button"
                      className="btn-obra-abrir"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(pathObraPublica(obra));
                      }}
                    >
                      Ver obra
                    </button>
                    <button
                      type="button"
                      className={`btn-obra-fav ${obra.isFavorito ? 'is-fav' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorito(obra);
                      }}
                    >
                      {obra.isFavorito ? '★ Favoritado' : '☆ Favoritar'}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
