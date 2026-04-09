import React, { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db } from '../../services/firebase';
import {
  obterObraIdCapitulo,
  obraCreatorId,
  obraSegmentoUrlPublica,
} from '../../config/obras';
import { buildDiscoveryRanking } from '../../utils/discoveryRanking';
import { toRecordList } from '../../utils/firebaseRecordList';
import { removeWorkFavoriteBoth, saveWorkFavoriteBoth } from '../../utils/workFavorites';
import { obraVisivelNoCatalogoPublico } from '../../utils/obraCatalogo';
import { resolveCreatorFeedLabel, resolveCreatorNameFromObra } from '../../utils/publicCreatorName';
import { collectCreatorIdsFromWorksAndChapters, subscribePublicProfilesMap } from '../../utils/publicProfilesRealtime';
import {
  filterAndRankMangaCatalogCards,
  searchQueryIsActive,
  suggestMangaCatalogCards,
} from '../../utils/mangaCatalogSearch';
import { OBRAS_WORK_GENRE_IDS, OBRAS_WORK_GENRE_LABELS } from '../../config/obraWorkForm';
import MangaCatalogSearchBar from '../../components/MangaCatalogSearchBar';
import './ListaMangas.css';

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function pathObraPublica(obra) {
  return `/work/${encodeURIComponent(obraSegmentoUrlPublica(obra))}`;
}

function msUltimaAtualizacao(cap) {
  const release = Number(cap?.publicReleaseAt);
  if (Number.isFinite(release) && release > 0) return release;
  const uploadMs = Date.parse(cap?.dataUpload || '');
  if (Number.isFinite(uploadMs) && uploadMs > 0) return uploadMs;
  return 0;
}

function msCriacaoObra(obra) {
  const candidates = [
    Number(obra?.createdAt),
    Number(obra?.createdAtMs),
    Number(obra?.publishedAt),
    Date.parse(obra?.dataCriacao || ''),
    Date.parse(obra?.createdAtIso || ''),
    Number(obra?.updatedAt),
  ];
  for (const value of candidates) {
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function formatarAtualizacaoRelativa(ts) {
  if (!Number.isFinite(Number(ts)) || Number(ts) <= 0) return 'Sem atualização';
  const dias = Math.max(0, Math.floor((Date.now() - Number(ts)) / (1000 * 60 * 60 * 24)));
  if (dias <= 0) return 'Atualizado hoje';
  if (dias === 1) return 'Atualizado há 1 dia';
  return `Atualizado há ${dias} dias`;
}

/** Evita tela preta se algo falhar no pipeline de busca (dados inesperados, regressão futura). */
function safeFilterCatalogCards(cards, query, creatorsMap, capitulos) {
  try {
    return filterAndRankMangaCatalogCards(cards, query, (obra) =>
      resolveCreatorNameFromObra(obra, creatorsMap, capitulos)
    );
  } catch (err) {
    console.error('[ListaMangas] Erro ao filtrar catálogo:', err);
    return Array.isArray(cards) ? cards : [];
  }
}

function safeSuggestCatalogCards(cards, query, creatorsMap, capitulos, limit) {
  try {
    return suggestMangaCatalogCards(cards, query, (obra) =>
      resolveCreatorNameFromObra(obra, creatorsMap, capitulos),
      limit
    );
  } catch (err) {
    console.error('[ListaMangas] Erro nas sugestões de busca:', err);
    return [];
  }
}

export default function ListaMangas({ user }) {
  const navigate = useNavigate();
  const [catalogSnapshotNow] = useState(() => Date.now());
  const [loadingObras, setLoadingObras] = useState(true);
  const [loadingCaps, setLoadingCaps] = useState(true);
  const [obras, setObras] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
  const [creatorsMap, setCreatorsMap] = useState({});
  const [favoritosCanon, setFavoritosCanon] = useState({});
  const [catalogSearch, setCatalogSearch] = useState('');
  const [genreFilterOpen, setGenreFilterOpen] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState([]);
  const debouncedCatalogSearch = useDebouncedValue(catalogSearch, 280);

  useEffect(() => {
    const obrasRef = ref(db, 'obras');
    const unsub = onValue(obrasRef, (snapshot) => {
      if (!snapshot.exists()) {
        setObras([]);
        setLoadingObras(false);
        return;
      }
      const lista = toRecordList(snapshot.val())
        .filter((obra) => obraVisivelNoCatalogoPublico(obra))
        .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
      setObras(lista);
      setLoadingObras(false);
    }, () => {
      setObras([]);
      setLoadingObras(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const capsRef = ref(db, 'capitulos');
    const unsub = onValue(capsRef, (snapshot) => {
      const lista = snapshot.exists() ? toRecordList(snapshot.val()) : [];
      setCapitulos(lista);
      setLoadingCaps(false);
    }, () => {
      setCapitulos([]);
      setLoadingCaps(false);
    });
    return () => unsub();
  }, []);

  const creatorIdsForLookup = useMemo(
    () => collectCreatorIdsFromWorksAndChapters(obras, capitulos),
    [obras, capitulos]
  );

  useEffect(() => subscribePublicProfilesMap(db, creatorIdsForLookup, setCreatorsMap), [creatorIdsForLookup]);

  useEffect(() => {
    if (!user?.uid) {
      return undefined;
    }
    const u2 = onValue(ref(db, `usuarios/${user.uid}/favorites`), (snapshot) => {
      setFavoritosCanon(snapshot.exists() ? snapshot.val() || {} : {});
    });
    return () => {
      u2();
    };
  }, [user?.uid]);

  const obrasCards = useMemo(() => {
    const favoritosMap = user?.uid ? favoritosCanon : {};
    const NEW_BADGE_MS = 8 * 24 * 60 * 60 * 1000;
    const LATEST_24H_MS = 24 * 60 * 60 * 1000;
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
      const createdAtTs = msCriacaoObra(obra);
      const badgeNovo =
        Number.isFinite(createdAtTs) &&
        createdAtTs > 0 &&
        catalogSnapshotNow - createdAtTs <= NEW_BADGE_MS;
      const badgeLatest24h =
        Number.isFinite(stats.lastUpdateTs) &&
        stats.lastUpdateTs > 0 &&
        catalogSnapshotNow - stats.lastUpdateTs <= LATEST_24H_MS;
      const status = String(obra?.status || 'ongoing').toLowerCase();
      return {
        ...obra,
        obraId,
        totalCapitulos: stats.total,
        lastUpdateTs: stats.lastUpdateTs,
        createdAtTs,
        updatedLabel: formatarAtualizacaoRelativa(stats.lastUpdateTs),
        isFavorito: Boolean(favoritosMap?.[obraId]),
        badgeNovo,
        badgeLatest24h,
        badgeEmLancamento: status === 'ongoing',
        status,
      };
    });
  }, [obras, capitulos, favoritosCanon, catalogSnapshotNow, user?.uid]);

  const gridObrasCards = useMemo(() => {
    const filtered = safeFilterCatalogCards(obrasCards, debouncedCatalogSearch, creatorsMap, capitulos);
    if (!selectedGenres.length) return filtered;
    return filtered.filter((obra) => {
      const genres = Array.isArray(obra?.genres)
        ? obra.genres.map((g) => String(g || '').trim().toLowerCase()).filter(Boolean)
        : [];
      return selectedGenres.every((genreId) => genres.includes(genreId));
    });
  }, [obrasCards, debouncedCatalogSearch, creatorsMap, capitulos, selectedGenres]);

  const catalogSearchSuggestions = useMemo(() => {
    if (!searchQueryIsActive(catalogSearch)) return [];
    return safeSuggestCatalogCards(obrasCards, catalogSearch, creatorsMap, capitulos, 10);
  }, [obrasCards, catalogSearch, creatorsMap, capitulos]);

  const discovery = useMemo(
    () => buildDiscoveryRanking({ obras, capitulos, creatorsMap }),
    [obras, capitulos, creatorsMap]
  );
  const heroWork = discovery.trendingWorks[0] || obrasCards[0] || null;

  const creatorName = (obra) => resolveCreatorFeedLabel(obra, creatorsMap, capitulos);
  const activeGenreLabels = selectedGenres.map((genreId) => OBRAS_WORK_GENRE_LABELS[genreId] || genreId);

  const toggleGenreFilter = (genreId) => {
    const gid = String(genreId || '').trim().toLowerCase();
    if (!gid) return;
    setSelectedGenres((current) =>
      current.includes(gid) ? current.filter((item) => item !== gid) : [...current, gid]
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
      slug: String(obra.slug || wid || '').trim(),
      coverUrl: String(obra.capaUrl || obra.coverUrl || '').trim(),
      savedAt: Date.now(),
    });
  };

  if (loadingObras || loadingCaps) {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  return (
    <main className="lista-mangas-page">
      <div className="lista-mangas-inner">
        <header className="lista-mangas-header lista-mangas-header--toolbar">
          <div className="lista-mangas-header__intro">
            <h1>Lista de mangás</h1>
            <p>
               Toque na capa para abrir a obra.
            </p>
          </div>
          {obrasCards.length > 0 ? (
            <div className="lista-mangas-toolbar-controls">
              <MangaCatalogSearchBar
                value={catalogSearch}
                onChange={setCatalogSearch}
                suggestions={catalogSearchSuggestions}
                onSelectWork={(obra) => {
                  navigate(pathObraPublica(obra));
                  setCatalogSearch('');
                }}
                resultCount={gridObrasCards.length}
                totalCount={obrasCards.length}
              />
              <button
                type="button"
                className={`lista-mangas-filter-btn${selectedGenres.length ? ' is-active' : ''}`}
                onClick={() => setGenreFilterOpen(true)}
              >
                Filter
                {selectedGenres.length ? <span>{selectedGenres.length}</span> : null}
              </button>
            </div>
          ) : null}
        </header>

        {activeGenreLabels.length ? (
          <div className="lista-mangas-active-filters" aria-label="Filtros de gênero ativos">
            {activeGenreLabels.map((label) => (
              <span key={label} className="lista-mangas-active-chip">{label}</span>
            ))}
            <button type="button" className="lista-mangas-active-clear" onClick={() => setSelectedGenres([])}>
              Limpar filtros
            </button>
          </div>
        ) : null}

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
              <p>Ranking por seguidores, likes, views, comentários e recência.</p>
            </div>
            <div className="lista-discovery-row">
              {discovery.trendingWorks.slice(0, 5).map((obra, index) => (
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
                    <span className="lista-discovery-author">por {creatorName(obra)}</span>
                    <span className="lista-discovery-stats">
                      {Math.round(obra.totalViews || 0)} views · {obra.totalLikes || 0} likes
                    </span>
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
              <p>Perfis com audiência forte e obras puxando descoberta no catálogo.</p>
            </div>
            <div className="lista-discovery-row">
              {discovery.popularCreators.slice(0, 6).map((creator, index) => {
                const creatorPath =
                  creator.username && creator.username !== creator.creatorId
                    ? `/@${encodeURIComponent(creator.username)}`
                    : `/criador/${encodeURIComponent(creator.creatorId)}`;
                return (
                  <article
                    key={`discover-creator-${creator.creatorId}`}
                    className="lista-discovery-card is-creator"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(creatorPath)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(creatorPath);
                      }
                    }}
                  >
                    <span className="lista-discovery-rank">#{index + 1}</span>
                    <img
                      src={creator.avatarUrl || '/assets/fotos/shito.jpg'}
                      alt={creator.publicLabel}
                      className="lista-discovery-cover"
                    />
                    <div className="lista-discovery-body">
                      <strong>{creator.publicLabel}</strong>
                      <span>{creator.followersCount} seguidores · {creator.worksCount} obra(s)</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {obrasCards.length === 0 ? (
          <section className="lista-mangas-empty">
            <h2>Nenhuma obra publicada</h2>
            <p>O catálogo está vazio agora. Enquanto novas obras não entram no ar, você ainda pode explorar Kokuin ou conhecer a proposta da plataforma.</p>
            <div className="biblioteca-actions">
              <button type="button" className="btn-biblioteca-cta" onClick={() => navigate('/kokuin')}>
                Abrir Kokuin
              </button>
              <button type="button" className="btn-biblioteca-sec" onClick={() => navigate('/sobre-autor')}>
                Sobre a plataforma
              </button>
            </div>
          </section>
        ) : searchQueryIsActive(debouncedCatalogSearch) && gridObrasCards.length === 0 ? (
          <section className="lista-mangas-empty lista-mangas-empty--search" aria-live="polite">
            <h2>Nenhum resultado nesta busca</h2>
            <p>
              Tente outras palavras. A pesquisa ignora maiúsculas e acentos e procura no <strong>título</strong>,{' '}
              <strong>autor</strong>, <strong>gêneros</strong> e sinopse.
            </p>
            <button type="button" className="lista-mangas-search-reset" onClick={() => setCatalogSearch('')}>
              Limpar pesquisa
            </button>
          </section>
        ) : (
          <section className="lista-mangas-grid" aria-label="Catálogo de obras">
            {gridObrasCards.map((obra) => (
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
                    <div className="manga-card-badges__top">
                      {obra.badgeNovo ? <span className="badge novo">Novo</span> : null}
                      {!obra.badgeNovo && obra.badgeLatest24h ? <span className="badge latest">Latest 24 hours</span> : null}
                      {!obra.badgeNovo && !obra.badgeLatest24h && obra.status === 'completed' ? <span className="badge completo">Completo</span> : null}
                      {!obra.badgeNovo && !obra.badgeLatest24h && obra.status === 'hiatus' ? <span className="badge hiato">Hiato</span> : null}
                    </div>
                    <div className="manga-card-badges__bottom">
                      {obra.badgeEmLancamento ? <span className="badge ongoing">Em lançamento</span> : null}
                      {obra.badgeNovo && obra.badgeLatest24h ? <span className="badge latest">Latest 24 hours</span> : null}
                    </div>
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
      {genreFilterOpen ? (
        <div
          className="lista-mangas-filter-modal-backdrop"
          role="presentation"
          onClick={() => setGenreFilterOpen(false)}
        >
          <section
            className="lista-mangas-filter-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lista-mangas-filter-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lista-mangas-filter-modal__head">
              <div>
                <span className="lista-mangas-filter-modal__eyebrow">Filter</span>
                <h2 id="lista-mangas-filter-title">Filtrar por gênero</h2>
              </div>
              <button
                type="button"
                className="lista-mangas-filter-close"
                onClick={() => setGenreFilterOpen(false)}
                aria-label="Fechar filtro"
              >
                ×
              </button>
            </div>
            <div className="lista-mangas-filter-grid">
              {OBRAS_WORK_GENRE_IDS.map((genreId) => {
                const isActive = selectedGenres.includes(genreId);
                return (
                  <button
                    key={genreId}
                    type="button"
                    className={`lista-mangas-filter-chip${isActive ? ' is-active' : ''}`}
                    onClick={() => toggleGenreFilter(genreId)}
                  >
                    {OBRAS_WORK_GENRE_LABELS[genreId] || genreId}
                  </button>
                );
              })}
            </div>
            <div className="lista-mangas-filter-actions">
              <button
                type="button"
                className="lista-mangas-filter-secondary"
                onClick={() => setSelectedGenres([])}
              >
                Limpar
              </button>
              <button
                type="button"
                className="lista-mangas-filter-primary"
                onClick={() => setGenreFilterOpen(false)}
              >
                Aplicar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

