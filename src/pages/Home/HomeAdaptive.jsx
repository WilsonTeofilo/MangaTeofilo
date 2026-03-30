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
} from '../../config/obras';
import ShitoManga from './ShitoManga';
import './HomeAdaptive.css';

const registrarAttributionEvento = httpsCallable(functions, 'registrarAttributionEvento');

function toList(snapshotVal) {
  if (!snapshotVal || typeof snapshotVal !== 'object') return [];
  return Object.entries(snapshotVal).map(([id, data]) => ({ id, ...(data || {}) }));
}

function capTimestamp(cap) {
  const release = Number(cap?.publicReleaseAt);
  if (Number.isFinite(release) && release > 0) return release;
  const upload = Date.parse(cap?.dataUpload || '');
  if (Number.isFinite(upload) && upload > 0) return upload;
  return 0;
}

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

function randToken() {
  return Math.random().toString(36).slice(2, 8);
}

export default function HomeAdaptive({ user }) {
  const navigate = useNavigate();
  const [loadingObras, setLoadingObras] = useState(true);
  const [loadingCapitulos, setLoadingCapitulos] = useState(true);
  const [obrasPublicadas, setObrasPublicadas] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
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
      const lista = ensureLegacyShitoObra(toList(snapshot.val()))
        .filter((obra) => obra?.isPublished !== false)
        .sort((a, b) => (Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0)));
      setObrasPublicadas(lista);
      setLoadingObras(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const capsRef = ref(db, 'capitulos');
    const unsub = onValue(capsRef, (snapshot) => {
      const lista = snapshot.exists() ? toList(snapshot.val()) : [];
      setCapitulos(lista);
      setLoadingCapitulos(false);
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
    const obraIds = new Set(obrasPublicadas.map((obra) => String(obra.id || '').toLowerCase()));
    const capitulosValidos = capitulos
      .filter((cap) => obraIds.has(obterObraIdCapitulo(cap)))
      .map((cap) => ({ ...cap, _ts: capTimestamp(cap) }))
      .sort((a, b) => b._ts - a._ts);

    const updates = capitulosValidos.slice(0, 16);
    const obrasComStats = obrasPublicadas
      .map((obra) => {
        const obraId = String(obra.id || '').toLowerCase();
        const caps = capitulosValidos.filter((cap) => obterObraIdCapitulo(cap) === obraId);
        const ultimoCap = caps[0];
        const totalViews = caps.reduce((sum, cap) => sum + Number(cap?.visualizacoes || 0), 0);
        return {
          ...obra,
          obraId,
          genres: parseGenres(obra),
          totalViews,
          chaptersCount: caps.length,
          lastChapterNumber: ultimoCap?.numero ?? null,
          lastUpdateTs: ultimoCap?._ts || Number(obra?.updatedAt || 0),
          latestChapterId: ultimoCap?.id || null,
        };
      })
      .sort((a, b) => Number(b.lastUpdateTs || 0) - Number(a.lastUpdateTs || 0));

    const trending = [...obrasComStats]
      .sort((a, b) => {
        if (b.totalViews !== a.totalViews) return b.totalViews - a.totalViews;
        return Number(b.lastUpdateTs || 0) - Number(a.lastUpdateTs || 0);
      })
      .slice(0, 12);

    const genreCounter = new Map();
    obrasComStats.forEach((obra) => {
      obra.genres.forEach((g) => {
        const key = g.toLowerCase();
        genreCounter.set(key, (genreCounter.get(key) || 0) + 1);
      });
    });
    const categorias = [
      { id: 'all', label: 'Todos' },
      ...[...genreCounter.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id]) => ({ id, label: id })),
    ];

    const recomendados = [...obrasComStats]
      .sort((a, b) => (Number(b.chaptersCount || 0) - Number(a.chaptersCount || 0)))
      .slice(0, 12);

    const hero = [...obrasComStats]
      .sort((a, b) => {
        if (Number(b.lastUpdateTs || 0) !== Number(a.lastUpdateTs || 0)) {
          return Number(b.lastUpdateTs || 0) - Number(a.lastUpdateTs || 0);
        }
        return Number(b.totalViews || 0) - Number(a.totalViews || 0);
      })
      .slice(0, 5);

    return { updates, obrasComStats, trending, categorias, recomendados, hero };
  }, [capitulos, obrasPublicadas]);

  const obrasCategoria = useMemo(() => {
    if (categoriaAtiva === 'all') return dadosMulti.obrasComStats;
    return dadosMulti.obrasComStats.filter((obra) =>
      obra.genres.some((g) => g.toLowerCase() === categoriaAtiva)
    );
  }, [categoriaAtiva, dadosMulti.obrasComStats]);

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
    ['hero', 'updates', 'trending', 'categorias', 'recomendados'].forEach((blockId) => {
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
    if (heroIndex >= dadosMulti.hero.length) setHeroIndex(0);
  }, [heroIndex, dadosMulti.hero.length]);

  if (modoHome === 'loading') {
    return <div className="shito-app-splash" aria-hidden="true" />;
  }

  if (modoHome === 'single') {
    const obra = obrasPublicadas[0];
    const obraId = String(obra?.id || '').toLowerCase();
    if (obraId === OBRA_PADRAO_ID) {
      return <ShitoManga />;
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
          <p>{obra?.sinopse || 'Acompanhe os lançamentos desta obra.'}</p>
          <button type="button" className="btn-read-now" onClick={() => navigate('/capitulos')}>
            Ler agora
          </button>
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
                  navigate(`/obra/${encodeURIComponent(String(obraId))}`);
                }}
              >
                Ver obra
              </button>
              <button
                type="button"
                className="btn-hero-sec"
                onClick={() => {
                  registrarEventoHome('home_block_click', 'hero', 'lista');
                  navigate('/mangas');
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
            <h3>Mais visualizados</h3>
            <button
              type="button"
              onClick={() => {
                registrarEventoHome('home_block_click', 'trending', 'ver_todos');
                navigate('/mangas');
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
                  navigate(`/obra/${encodeURIComponent(String(obra.id))}`);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/obra/${encodeURIComponent(String(obra.id))}`)}
              >
                <span className="home-rank-pos">{idx + 1}</span>
                <img src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'} alt={obra.titulo || obra.id} />
                <div>
                  <strong>{obra.titulo || obra.id}</strong>
                  <span>{obra.totalViews} views</span>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="home-multi-section">
        <div className="home-multi-section-head">
          <h2>Updates recentes</h2>
          <button type="button" onClick={() => navigate('/mangas')}>Ver tudo</button>
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
                <img src={cap.capaUrl || '/assets/fotos/shito.jpg'} alt={cap.titulo || `Capítulo ${cap.numero}`} />
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
          <h2>Trending</h2>
        </div>
        <div className="home-obras-grid">
          {dadosMulti.trending.map((obra) => (
            <article
              key={`trend_${obra.id}`}
              className="home-obra-card"
              onClick={() => {
                registrarEventoHome('home_block_click', 'trending', String(obra.id));
                navigate(`/obra/${encodeURIComponent(String(obra.id))}`);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/obra/${encodeURIComponent(String(obra.id))}`)}
            >
              <img src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'} alt={obra.titulo || obra.id} />
              <div className="home-obra-card-body">
                <strong>{obra.titulo || obra.id}</strong>
                <span>{obra.totalViews} views · cap #{obra.lastChapterNumber ?? '--'}</span>
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
                navigate(`/obra/${encodeURIComponent(String(obra.id))}`);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/obra/${encodeURIComponent(String(obra.id))}`)}
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
                navigate(`/obra/${encodeURIComponent(String(obra.id))}`);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/obra/${encodeURIComponent(String(obra.id))}`)}
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

