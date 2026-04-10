import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../services/firebase';
import {
  normalizarObraId,
  obterObraIdCapitulo,
  obraCreatorId,
  obraSegmentoUrlPublica,
} from '../../config/obras';
import KokuinLegacyLandingSection from '../../components/KokuinLegacyLandingSection';
import {
  getLastRead,
  getReadHistory,
  pruneReadingHistory,
  subscribeReadingProgress,
} from '../../utils/readingProgressLocal';
import { chapterCoverStyle } from '../../utils/chapterCoverStyle';
import { buildDiscoveryRanking } from '../../utils/discoveryRanking';
import { toRecordList } from '../../utils/firebaseRecordList';
import { obraVisivelNoCatalogoPublico } from '../../utils/obraCatalogo';
import { resolveCreatorNameFromObra } from '../../utils/publicCreatorName';
import { collectCreatorIdsFromWorksAndChapters, subscribePublicProfilesMap } from '../../utils/publicProfilesRealtime';
import './MangaMain.css';

function pathObraPublica(obra) {
  return `/work/${encodeURIComponent(obraSegmentoUrlPublica(obra))}`;
}

function pathCriadorPublico(obra) {
  return `/criador/${encodeURIComponent(obraCreatorId(obra))}`;
}

/** Histórico local: uma entrada por obra (a mais recente). */
function dedupeHistoryByWork(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (!e?.workId || !e?.chapterId) continue;
    const w = normalizarObraId(e.workId);
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(e);
    if (out.length >= 10) break;
  }
  return out;
}

const registrarAttributionEvento = httpsCallable(functions, 'registrarAttributionEvento');

function randToken() {
  return Math.random().toString(36).slice(2, 8);
}

export default function MangaMain({ user }) {
  const navigate = useNavigate();
  const [loadingObras, setLoadingObras] = useState(true);
  const [loadingCapitulos, setLoadingCapitulos] = useState(true);
  const [obrasPublicadas, setObrasPublicadas] = useState([]);
  const [capitulos, setCapitulos] = useState([]);
  const [creatorsMap, setCreatorsMap] = useState({});
  const [heroIndex, setHeroIndex] = useState(0);
  const [readingTick, setReadingTick] = useState(0);
  const blocoImpressionRef = useRef(new Set());

  useEffect(() => subscribeReadingProgress(() => setReadingTick((n) => n + 1)), []);

  useEffect(() => {
    const obrasRef = ref(db, 'obras');
    const unsub = onValue(obrasRef, (snapshot) => {
      if (!snapshot.exists()) {
        // Legado: se ainda não criou "obras", mantém home single de Shito.
        setObrasPublicadas([]);
        setLoadingObras(false);
        return;
      }
      const lista = toRecordList(snapshot.val())
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

  const validWorkIds = useMemo(
    () => new Set(obrasPublicadas.map((obra) => normalizarObraId(obra?.id || ''))),
    [obrasPublicadas]
  );

  const validChapterIds = useMemo(
    () =>
      new Set(
        capitulos
          .map((cap) => String(cap?.id || '').trim())
          .filter(Boolean)
      ),
    [capitulos]
  );

  useEffect(() => {
    if (loadingObras || loadingCapitulos) return;
    if (!validWorkIds.size) return;
    pruneReadingHistory({
      validWorkIds,
      validChapterIds: validChapterIds.size ? validChapterIds : undefined,
    });
  }, [loadingObras, loadingCapitulos, validWorkIds, validChapterIds]);

  const creatorIdsForLookup = useMemo(
    () => collectCreatorIdsFromWorksAndChapters(obrasPublicadas, capitulos),
    [obrasPublicadas, capitulos]
  );

  useEffect(() => subscribePublicProfilesMap(db, creatorIdsForLookup, setCreatorsMap), [creatorIdsForLookup]);

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

  const continueReading = useMemo(() => {
    const lr = getLastRead();
    if (!lr) return null;
    const obra = obrasPublicadas.find((o) => normalizarObraId(o.id) === normalizarObraId(lr.workId));
    if (!obra) return null;
    return { lr, obra };
  }, [obrasPublicadas, readingTick]);

  const recentReads = useMemo(() => {
    const raw = dedupeHistoryByWork(getReadHistory());
    return raw.map((e) => ({
      entry: e,
      obra: obrasPublicadas.find((o) => normalizarObraId(o.id) === normalizarObraId(e.workId)) || null,
    }))
    .filter((item) => Boolean(item.obra));
  }, [obrasPublicadas, readingTick]);

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
    ['hero', 'updates', 'trending', 'creators', 'recomendados'].forEach((blockId) => {
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
    return <KokuinLegacyLandingSection />;
  }

  return (
    <div className="home-multi">
      <section className="home-multi-top">
        <aside className="home-top-ranking">
          <div className="home-top-ranking-head">
            <h3>🔥 Em alta agora</h3>
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
                <img
                  className="home-thumb-pop"
                  src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'}
                  alt={obra.titulo || obra.id}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                />
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
            <span className="home-hero-pill">Destaque agora</span>
            <h1>{dadosMulti.hero[heroIndex]?.titulo || 'Catálogo da MangaTeofilo'}</h1>
            <p className="home-hero-tagline">
              {dadosMulti.hero[heroIndex]?.sinopse
                ? String(dadosMulti.hero[heroIndex].sinopse).slice(0, 140) +
                  (String(dadosMulti.hero[heroIndex].sinopse).length > 140 ? '…' : '')
                : 'Abra e leia na hora — sem enrolação.'}
            </p>
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
                Começar leitura
              </button>
              <button
                type="button"
                className="btn-hero-sec"
                onClick={() => {
                  registrarEventoHome('home_block_click', 'hero', 'lista');
                  navigate('/works');
                }}
              >
                Ver catálogo
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
      </section>

      {continueReading ? (
        <section className="home-multi-section home-reading-continue" aria-label="Continuar lendo">
          <div className="home-multi-section-head">
            <h2>Continuar lendo</h2>
          </div>
          <article className="home-continue-card">
            <img
              className="home-continue-cover"
              src={
                continueReading.obra?.capaUrl ||
                continueReading.obra?.bannerUrl ||
                continueReading.lr.capaUrl ||
                '/assets/fotos/shito.jpg'
              }
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              decoding="async"
            />
            <div className="home-continue-body">
              <strong className="home-continue-title">
                {continueReading.obra?.titulo || continueReading.lr.obraTitulo || 'Continuar leitura'}
              </strong>
              <p className="home-continue-meta">
                Capítulo {continueReading.lr.chapterNumber || '—'}
                <span className="home-continue-sep"> · </span>
                Você parou na página {continueReading.lr.page}
              </p>
              <div className="home-continue-actions">
                <button
                  type="button"
                  className="home-continue-btn"
                  onClick={() => {
                    registrarEventoHome('home_block_click', 'continue_reading', continueReading.lr.chapterId);
                    navigate(`/ler/${continueReading.lr.chapterId}`);
                  }}
                >
                  Continuar
                </button>
                {continueReading.obra ? (
                  <button
                    type="button"
                    className="home-continue-btn home-continue-btn--ghost"
                    onClick={() => {
                      registrarEventoHome('home_block_click', 'continue_reading', `work_${continueReading.obra.id}`);
                      navigate(pathObraPublica(continueReading.obra));
                    }}
                  >
                    Ficha da obra
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {recentReads.length > 0 ? (
        <section className="home-multi-section home-reading-recent" aria-label="Últimos lidos">
          <div className="home-multi-section-head home-multi-section-head--wrap">
            <h2>Últimos lidos</h2>
            <span className="home-reading-hint">Salvo neste aparelho — não precisa favoritar</span>
          </div>
          <div className="home-recent-read-grid">
            {recentReads.map(({ entry, obra }) => (
              <article
                key={`${entry.workId}_${entry.chapterId}`}
                className="home-recent-read-card"
                role="button"
                tabIndex={0}
                onClick={() => {
                  registrarEventoHome('home_block_click', 'recent_reads', entry.chapterId);
                  navigate(`/ler/${entry.chapterId}`);
                }}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/ler/${entry.chapterId}`)}
              >
                <img
                  src={obra?.capaUrl || obra?.bannerUrl || entry.capaUrl || '/assets/fotos/shito.jpg'}
                  alt=""
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                />
                <div className="home-recent-read-card__body">
                  <strong>{obra?.titulo || entry.obraTitulo || 'Obra'}</strong>
                  <span>
                    Cap. {entry.chapterNumber || '?'} · pág. {entry.page}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="home-multi-section">
        <div className="home-multi-section-head">
          <h2>🆕 Novos capítulos</h2>
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
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
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
          <h2>🔥 Em alta (descoberta)</h2>
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
              <img
                className="home-thumb-pop"
                src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'}
                alt={obra.titulo || obra.id}
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
              />
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
              <img
                src={creator.avatarUrl || '/assets/fotos/shito.jpg'}
                alt={creator.publicLabel}
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
              />
              <div className="home-creator-card-body">
                <strong>{creator.publicLabel}</strong>
                <span>{creator.followersCount} seguidores</span>
                <span>{creator.worksCount} obra(s) · {Math.round(creator.totalViews)} views</span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="home-multi-section">
        <div className="home-multi-section-head">
          <h2>🚀 Crescendo agora</h2>
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
              <img
                className="home-thumb-pop"
                src={obra.capaUrl || obra.bannerUrl || '/assets/fotos/shito.jpg'}
                alt={obra.titulo || obra.id}
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
              />
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

