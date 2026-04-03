import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../services/firebase';
import {
  OBRA_PADRAO_ID,
  OBRA_SHITO_DEFAULT,
  ensureLegacyShitoObra,
  obterObraIdCapitulo,
  obraCreatorId,
  obraSegmentoUrlPublica,
} from '../../config/obras';
import { chapterCoverStyle } from '../../utils/chapterCoverStyle';
import { buildDiscoveryRanking } from '../../utils/discoveryRanking';
import { toRecordList } from '../../utils/firebaseRecordList';
import { obraVisivelNoCatalogoPublico } from '../../utils/obraCatalogo';
import { resolveCreatorNameFromObra } from '../../utils/publicCreatorName';
import ShitoManga from './ShitoManga';
import './HomeAdaptive.css';

function pathObraPublica(obra) {
  return `/work/${encodeURIComponent(obraSegmentoUrlPublica(obra))}`;
}

function pathCriadorPublico(obra) {
  return `/criador/${encodeURIComponent(obraCreatorId(obra))}`;
}

const registrarAttributionEvento = httpsCallable(functions, 'registrarAttributionEvento');

function randToken() {
  return Math.random().toString(36).slice(2, 8);
}

export default function HomeAdaptive({ user }) {
  const navigate = useNavigate();
  const [loadingObras, setLoadingObras] = useState(true);
  const [loadingCapitulos, setLoadingCapitulos] = useState(true);
  const [obrasPublicadas, setObrasPublicadas] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
  const [creatorsMap, setCreatorsMap] = useState({});
  const [heroIndex, setHeroIndex] = useState(0);
  const [categoriaAtiva, setCategoriaAtiva] = useState('all');
  const blocoImpressionRef = useRef(new Set());

  useEffect(() => {
    const obrasRef = ref(db, 'obras');
    const unsub = onValue(obrasRef, (snapshot) => {
      if (!snapshot.exists()) {
        // Legado: se ainda não criou "obras", mantém home single de Shito.
        setObrasPublicadas([{ ...OBRA_SHITO_DEFAULT, id: OBRA_PADRAO_ID }]);
        setLoadingObras(false);
        return;
      }
      const lista = ensureLegacyShitoObra(toRecordList(snapshot.val()))
        .filter((obra) => obraVisivelNoCatalogoPublico(obra))
        .sort((a, b) => (Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0)));
      setObrasPublicadas(lista);
      setLoadingObras(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const capsRef = ref(db, 'capitulos');
    const unsub = onValue(capsRef, (snapshot) => {
      const lista = snapshot.exists() ? toRecordList(snapshot.val()) : [];
      setCapitulos(lista);
      setLoadingCapitulos(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(db, 'usuarios_publicos'), (snapshot) => {
      setCreatorsMap(snapshot.exists() ? snapshot.val() || {} : {});
    });
    return () => unsub();
  }, []);

  const modoHome = useMemo(() => {
    if (loadingObras || loadingCapitulos) return 'loading';
    if (obrasPublicadas.length === 0) return 'empty';
    if (obrasPublicadas.length === 1) return 'single';
    return 'multi';
  }, [loadingObras, loadingCapitulos, obrasPublicadas.length]);

  const dadosMulti = useMemo(() => {
    const ranking = buildDiscoveryRanking({
      obras: obrasPublicadas,
      capitulos,
      creatorsMap,
    });
    return {
      updates: ranking.updates,
      obrasComStats: ranking.works,
      trending: ranking.trendingWorks,
      creators: ranking.popularCreators,
      categorias: ranking.categories,
      recomendados: ranking.recommendedWorks,
      hero: ranking.heroWorks,
    };
  }, [capitulos, creatorsMap, obrasPublicadas]);

  const obrasCategoria = useMemo(() => {
    if (categoriaAtiva === 'all') return dadosMulti.obrasComStats;
    return dadosMulti.obrasComStats.filter((obra) =>
      obra.genres.some((g) => g.toLowerCase() === categoriaAtiva)
    );
  }, [categoriaAtiva, dadosMulti.obrasComStats]);

  const nomeCriador = (obra) => resolveCreatorNameFromObra(obra, creatorsMap, capitulos);

  const registrarEventoHome = async (eventType, blockId, targetId = 'na') => {
    try {
      await registrarAttributionEvento({
        eventType,
        source: 'home_multi',
        campaignId: `home_${blockId}`,
        clickId: `h_${blockId}_${targetId}_${Date.now()}_${randToken()}`,
      });
    } catch {
      // Silencioso para nao impactar UX.
    }
  };

  useEffect(() => {
    if (modoHome !== 'multi') return;
    ['hero', 'updates', 'trending', 'creators', 'categorias', 'recomendados'].forEach((blockId) => {
      if (blocoImpressionRef.current.has(blockId)) return;
      blocoImpressionRef.current.add(blockId);
      registrarEventoHome('home_block_impression', blockId);
    });
  }, [modoHome]);

  useEffect(() => {
    if (modoHome !== 'multi' || dadosMulti.hero.length <= 1) return () => {};
    const id = window.setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % dadosMulti.hero.length);
    }, 6000);
    return () => window.clearInterval(id);
  }, [modoHome, dadosMulti.hero.length]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (heroIndex >= dadosMulti.hero.length) setHeroIndex(0);
  }, [heroIndex, dadosMulti.hero.length]);

  if (modoHome === 'loading') {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  if (modoHome === 'single') {
    const obra = obrasPublicadas[0];
    const obraId = String(obra?.id || '').toLowerCase();
    if (obraId === OBRA_PADRAO_ID) {
      return <ShitoManga user={user} />;
    }
    return (
      <section className="home-single-alt">
        <div
          className="home-single-alt-hero"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(7, 9, 16, 0.15), rgba(7, 9, 16, 0.88)), url('${obra?.bannerUrl || obra?.capaUrl || '/assets/fotos/shito.jpg'}')`,
          }}
        >
          <span className="home-single-alt-pill">Obra em destaque</span>
          <h1>{obra?.titulo || 'Nova obra'}</h1>
          <p className="home-single-alt-author">por {nomeCriador(obra)}</p>
          <p>{obra?.sinopse || 'Acompanhe os lançamentos desta obra.'}</p>
          <div className="home-hero-actions">
            <button type="button" className="btn-read-now" onClick={() => navigate(pathObraPublica(obra))}>
              Ler agora
            </button>
            <button type="button" className="btn-hero-sec" onClick={() => navigate(pathCriadorPublico(obra))}>
              Ver criador
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (modoHome === 'empty') {
    return (
      <section className="home-empty-state">
        <h1>Nenhuma obra publicada no momento</h1>
        <p>
          O catálogo está sendo preparado. Assim que publicar uma obra com
          <code> isPublished = true</code>, a Home muda automaticamente.
        </p>
      </section>
    );
  }

  return (
    <div className="home-multi">
      <section className="home-multi-top">
        <header
          className="home-multi-hero home-multi-hero--rotative"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(8, 12, 20, 0.35), rgba(8, 12, 20, 0.94)), url('${
              dadosMulti.hero[heroIndex]?.bannerUrl ||
              dadosMulti.hero[heroIndex]?.capaUrl ||
              '/assets/fotos/shito.jpg'
            }')`,
          }}
        >
          <div className="home-hero-content">
            <span className="home-hero-pill">Destaque</span>
            <h1>{dadosMulti.hero[heroIndex]?.titulo || 'Catálogo MangaTeofilo'}</h1>
            <p>{dadosMulti.hero[heroIndex]?.sinopse || `${obrasPublicadas.length} obras publicadas no catálogo.`}</p>
            <div className="home-hero-actions">
              <button
                type="button"
                className="btn-hero-main"
                onClick={() => {
                  const obraId = dadosMulti.hero[heroIndex]?.id;
                  if (!obraId) return;
                  registrarEventoHome('home_block_click', 'hero', String(obraId));
                  navigate(pathObraPublica(dadosMulti.hero[heroIndex]));
                }}
              >
                Ver obra
              </button>
              <button
                type="button"
                className="btn-hero-sec"
                onClick={() => {
                  registrarEventoHome('home_block_click', 'hero', 'lista');
                  navigate('/works');
                }}
              >
                Explorar catálogo
              </button>
            </div>
          </div>
          <div className="home-hero-dots">
            {dadosMulti.hero.map((item, idx) => (
              <button
                key={item.id || idx}
                type="button"
                className={idx === heroIndex ? 'active' : ''}
                onClick={() => setHeroIndex(idx)}
                aria-label={`Ver destaque ${idx + 1}`}
              />
            ))}
          </div>
        </header>
        <aside className="home-top-ranking">
          <div className="home-top-ranking-head">
            <h3>Obras em alta</h3>
            <button
              type="button"
              onClick={() => {
                registrarEventoHome('home_block_click', 'trending', 'ver_todos');
                navigate('/works');
              }}
            >
              Ver todos
            </button>
          </div>
          <div className="home-top-ranking-list">
            {dadosMulti.trending.slice(0, 5).map((obra, idx) => (
              <article
                key={`rank_top_${obra.id}`}
                className="home-rank-item"
                onClick={() => {
                  registrarEventoHome('home_block_click', 'trending', String(obra.id));
                  navigate(pathObraPublica(obra));
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && navigate(pathObraPublica(obra))}
              >
                <span className="home-rank-pos">{idx + 1}</span>
                <img src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'} alt={obra.titulo || obra.id} />
                <div className="home-rank-item__text">
                  <strong>{obra.titulo || obra.id}</strong>
                  <span className="home-rank-item__author">por {nomeCriador(obra)}</span>
                  <span className="home-rank-item__stats">
                    {Math.round(obra.totalViews || 0)} views · {obra.totalLikes || 0} likes
                  </span>
                  <button
                    type="button"
                    className="home-rank-creator-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      registrarEventoHome('home_block_click', 'trending', `creator_${String(obra.id)}`);
                      navigate(pathCriadorPublico(obra));
                    }}
                  >
                    Ver criador
                  </button>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="home-multi-section">
        <div className="home-multi-section-head">
          <h2>Updates recentes</h2>
          <button type="button" onClick={() => navigate('/works')}>Ver tudo</button>
        </div>
        {dadosMulti.updates.length > 0 ? (
          <div className="home-updates-grid">
            {dadosMulti.updates.map((cap) => (
              <article
                key={cap.id}
                className="home-update-card"
                onClick={() => {
                  registrarEventoHome('home_block_click', 'updates', String(cap.id));
                  navigate(`/ler/${cap.id}`);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/ler/${cap.id}`)}
              >
                <img
                  src={cap.capaUrl || '/assets/fotos/shito.jpg'}
                  alt={cap.titulo || `Capítulo ${cap.numero}`}
                  style={chapterCoverStyle(cap.capaAjuste)}
                />
                <div className="home-update-meta">
                  <strong>{cap.titulo || `Capítulo ${cap.numero}`}</strong>
                  <span>
                    {String(cap.obraTitulo || obterObraIdCapitulo(cap)).toUpperCase()} · #
                    {String(cap.numero || 0).padStart(2, '0')}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="home-empty-text">Sem updates recentes para obras publicadas.</p>
        )}
      </section>

      <section className="home-multi-section">
        <div className="home-multi-section-head">
          <h2>Descoberta em alta</h2>
        </div>
        <div className="home-obras-grid">
          {dadosMulti.trending.map((obra) => (
            <article
              key={`trend_${obra.id}`}
              className="home-obra-card"
              onClick={() => {
                registrarEventoHome('home_block_click', 'trending', String(obra.id));
                navigate(pathObraPublica(obra));
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(pathObraPublica(obra))}
            >
              <img src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'} alt={obra.titulo || obra.id} />
              <div className="home-obra-card-body">
                <strong>{obra.titulo || obra.id}</strong>
                <span>por {nomeCriador(obra)}</span>
                <span>{obra.totalViews} views · cap #{obra.lastChapterNumber ?? '--'}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-multi-section">
        <div className="home-multi-section-head">
          <h2>Criadores populares</h2>
        </div>
        <div className="home-creators-grid">
          {dadosMulti.creators.map((creator) => (
            <article
              key={`creator_${creator.creatorId}`}
              className="home-creator-card"
              onClick={() => {
                registrarEventoHome('home_block_click', 'creators', String(creator.creatorId));
                navigate(`/criador/${encodeURIComponent(creator.creatorId)}`);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/criador/${encodeURIComponent(creator.creatorId)}`)}
            >
              <img src={creator.avatarUrl || '/assets/fotos/shito.jpg'} alt={creator.displayName} />
              <div className="home-creator-card-body">
                <strong>{creator.displayName}</strong>
                <span>@{creator.username || creator.creatorId}</span>
                <span>{creator.followersCount} seguidores</span>
                <span>{creator.worksCount} obra(s) · {Math.round(creator.totalViews)} views</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-multi-section">
        <div className="home-multi-section-head">
          <h2>Categorias</h2>
        </div>
        <div className="home-category-chips">
          {dadosMulti.categorias.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`home-chip ${categoriaAtiva === cat.id ? 'active' : ''}`}
              onClick={() => {
                setCategoriaAtiva(cat.id);
                registrarEventoHome('home_block_click', 'categorias', cat.id);
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <div className="home-obras-grid">
          {obrasCategoria.slice(0, 12).map((obra) => (
            <article
              key={`cat_${obra.id}`}
              className="home-obra-card"
              onClick={() => {
                registrarEventoHome('home_block_click', 'categorias', String(obra.id));
                navigate(pathObraPublica(obra));
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(pathObraPublica(obra))}
            >
              <img src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'} alt={obra.titulo || obra.id} />
              <div className="home-obra-card-body">
                <strong>{obra.titulo || obra.id}</strong>
                <span>{obra.genres[0] || 'Sem gênero'}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-multi-section">
        <div className="home-multi-section-head">
          <h2>Recomendados</h2>
        </div>
        <div className="home-obras-grid">
          {dadosMulti.recomendados.map((obra) => (
            <article
              key={`rec_${obra.id}`}
              className="home-obra-card"
              onClick={() => {
                registrarEventoHome('home_block_click', 'recomendados', String(obra.id));
                navigate(pathObraPublica(obra));
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(pathObraPublica(obra))}
            >
              <img src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'} alt={obra.titulo || obra.id} />
              <div className="home-obra-card-body">
                <strong>{obra.titulo || obra.id}</strong>
                <span>{obra.chaptersCount} capítulos · atualização recente</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
