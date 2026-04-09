import React, { useEffect, useMemo, useState } from 'react';
import { equalTo, onValue, orderByChild, query, ref } from 'firebase/database';
import { useNavigate } from 'react-router-dom';

import { db } from '../../services/firebase';
import { toRecordList } from '../../utils/firebaseRecordList';
import { resolveEffectiveCreatorMonetizationStatusFromDb } from '../../utils/creatorMonetizationUi';
import './CreatorFrame.css';

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(safeNumber(value));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(safeNumber(value));
}

function formatPercent(value) {
  return `${(safeNumber(value) * 100).toFixed(1)}%`;
}

function parseDateKey(key) {
  const iso = String(key || '').trim();
  const time = Date.parse(`${iso}T00:00:00`);
  return Number.isFinite(time) ? time : 0;
}

function filterDateKeys(keys, range) {
  if (range === 'all') return keys;
  const days = range === '7d' ? 7 : 30;
  const cutoff = Date.now() - (days - 1) * 24 * 60 * 60 * 1000;
  return keys.filter((key) => parseDateKey(key) >= cutoff);
}

function buildLinePath(points, width, height, maxValue) {
  if (!points.length) return '';
  const usableHeight = height - 24;
  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * (width - 8) + 4;
      const y = usableHeight - (safeNumber(point.value) / Math.max(maxValue, 1)) * usableHeight + 8;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function AudienceLineChart({ rows }) {
  const width = 860;
  const height = 240;
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => [safeNumber(row.followers), safeNumber(row.views), safeNumber(row.revenue)])
  );
  const followersPath = buildLinePath(rows.map((row) => ({ value: row.followers })), width, height, maxValue);
  const viewsPath = buildLinePath(rows.map((row) => ({ value: row.views })), width, height, maxValue);
  const revenuePath = buildLinePath(rows.map((row) => ({ value: row.revenue })), width, height, maxValue);

  return (
    <div className="creator-audience-chart-shell">
      {!rows.length ? (
        <p className="creator-empty-copy">Ainda não há histórico suficiente para mostrar o crescimento.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="creator-audience-chart" role="img" aria-label="Gráfico de crescimento">
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={ratio}
                x1="0"
                x2={width}
                y1={(height - 24) * ratio + 8}
                y2={(height - 24) * ratio + 8}
                className="creator-audience-chart-grid"
              />
            ))}
            <path d={followersPath} className="creator-audience-line followers" />
            <path d={viewsPath} className="creator-audience-line views" />
            <path d={revenuePath} className="creator-audience-line revenue" />
          </svg>
          <div className="creator-audience-legend">
            <span><i className="followers" /> Seguidores</span>
            <span><i className="views" /> Views</span>
            <span><i className="revenue" /> Receita</span>
          </div>
          <div className="creator-audience-chart-labels">
            <small>{rows[0]?.label || ''}</small>
            <small>{rows[rows.length - 1]?.label || ''}</small>
          </div>
        </>
      )}
    </div>
  );
}

export default function CreatorAudiencePage({ user, perfil }) {
  const navigate = useNavigate();
  const uid = String(user?.uid || '').trim();
  const creatorMonetizationIsActive =
    resolveEffectiveCreatorMonetizationStatusFromDb(perfil) === 'active';
  const [range, setRange] = useState('30d');
  const [creatorStats, setCreatorStats] = useState(null);
  const [dailyStats, setDailyStats] = useState({});
  const [membersIndex, setMembersIndex] = useState({});
  const [worksMap, setWorksMap] = useState({});
  const [chaptersMap, setChaptersMap] = useState({});
  const [retentionMap, setRetentionMap] = useState({});

  useEffect(() => {
    if (!uid) return () => {};
    const unsubs = [
      onValue(ref(db, `creators/${uid}/stats`), (snap) => setCreatorStats(snap.exists() ? snap.val() || {} : {})),
      onValue(ref(db, `creatorStatsDaily/${uid}`), (snap) => setDailyStats(snap.exists() ? snap.val() || {} : {})),
      onValue(ref(db, `creators/${uid}/membersIndex`), (snap) => setMembersIndex(snap.exists() ? snap.val() || {} : {})),
      onValue(query(ref(db, 'obras'), orderByChild('creatorId'), equalTo(uid)), (snap) =>
        setWorksMap(snap.exists() ? snap.val() || {} : {})
      ),
      onValue(query(ref(db, 'capitulos'), orderByChild('creatorId'), equalTo(uid)), (snap) =>
        setChaptersMap(snap.exists() ? snap.val() || {} : {})
      ),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [uid]);

  const creatorWorks = useMemo(() => {
    return toRecordList(worksMap);
  }, [worksMap]);

  const creatorWorkIds = useMemo(
    () => new Set(creatorWorks.map((work) => String(work.id || '').trim().toLowerCase())),
    [creatorWorks]
  );

  useEffect(() => {
    if (!uid) return () => {};
    const workIds = creatorWorks.map((w) => String(w.id || '').trim()).filter(Boolean);
    setRetentionMap({});
    if (!workIds.length) {
      setRetentionMap({});
      return () => {};
    }
    const unsubs = workIds.map((workId) =>
      onValue(ref(db, `workRetencao/${workId}`), (snap) => {
        setRetentionMap((prev) => ({
          ...prev,
          [workId]: snap.exists() ? snap.val() || {} : {},
        }));
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [uid, creatorWorks]);

  const creatorChapters = useMemo(() => {
    return toRecordList(chaptersMap)
      .sort((a, b) => safeNumber(a?.numero) - safeNumber(b?.numero));
  }, [chaptersMap]);

  const filteredDailyRows = useMemo(() => {
    const keys = filterDateKeys(
      Object.keys(dailyStats || {}).sort((a, b) => parseDateKey(a) - parseDateKey(b)),
      range
    );
    return keys.map((key) => ({
      key,
      label: key.slice(5),
      ...((dailyStats && dailyStats[key]) || {}),
    }));
  }, [dailyStats, range]);

  const totals = useMemo(() => {
    const stats = creatorStats || {};
    const activeMembros = Object.values(membersIndex || {}).filter((row) => safeNumber(row?.memberUntil) > Date.now()).length;
    return {
      followersCount: safeNumber(stats?.followersCount),
      totalViews: safeNumber(stats?.totalViews),
      uniqueReaders: safeNumber(stats?.uniqueReaders),
      likesTotal: safeNumber(stats?.likesTotal),
      commentsTotal: safeNumber(stats?.commentsTotal),
      membersCount: activeMembros || safeNumber(stats?.membersCount),
      revenueTotal: safeNumber(stats?.revenueTotal),
    };
  }, [creatorStats, membersIndex]);

  const periodSummary = useMemo(() => {
    return filteredDailyRows.reduce(
      (acc, row) => {
        acc.followersAdded += safeNumber(row.followersAdded);
        acc.views += safeNumber(row.totalViews);
        acc.uniqueReaders += safeNumber(row.uniqueReaders);
        acc.likes += safeNumber(row.likesTotal);
        acc.comments += safeNumber(row.commentsTotal);
        acc.revenue += safeNumber(row.revenueTotal);
        acc.membersAdded += safeNumber(row.membersAdded);
        return acc;
      },
      {
        followersAdded: 0,
        views: 0,
        uniqueReaders: 0,
        likes: 0,
        comments: 0,
        revenue: 0,
        membersAdded: 0,
      }
    );
  }, [filteredDailyRows]);

  const graphRows = useMemo(() => {
    if (!filteredDailyRows.length) return [];
    const totalFutureSeguidoresAdds = filteredDailyRows.reduce((sum, row) => sum + safeNumber(row.followersAdded), 0);
    const totalFutureViews = filteredDailyRows.reduce((sum, row) => sum + safeNumber(row.totalViews), 0);
    const totalFutureGanhos = filteredDailyRows.reduce((sum, row) => sum + safeNumber(row.revenueTotal), 0);
    let followersRunning = Math.max(0, totals.followersCount - totalFutureSeguidoresAdds);
    let viewsRunning = Math.max(0, totals.totalViews - totalFutureViews);
    let revenueRunning = Math.max(0, totals.revenueTotal - totalFutureGanhos);
    return filteredDailyRows.map((row) => {
      followersRunning += safeNumber(row.followersAdded);
      viewsRunning += safeNumber(row.totalViews);
      revenueRunning += safeNumber(row.revenueTotal);
      return {
        label: row.label,
        followers: followersRunning,
        views: viewsRunning,
        revenue: revenueRunning,
      };
    });
  }, [filteredDailyRows, totals.followersCount, totals.revenueTotal, totals.totalViews]);

  const topChapters = useMemo(() => {
    const worksById = new Map(creatorWorks.map((work) => [String(work.id || '').trim().toLowerCase(), work]));
    return [...creatorChapters]
      .map((chapter) => {
        const workId = String(chapter?.obraId || chapter?.mangaId || '').trim().toLowerCase();
        const work = worksById.get(workId);
        const likes = safeNumber(chapter?.likesCount || chapter?.curtidas);
        const comments = safeNumber(chapter?.commentsCount);
        const views = safeNumber(chapter?.viewsCount || chapter?.visualizacoes);
        return {
          id: chapter.id,
          title: String(chapter?.titulo || `Capítulo ${chapter?.numero || ''}`).trim(),
          workTitle: String(work?.titulo || work?.title || 'Obra').trim(),
          likes,
          comments,
          views,
          score: likes * 2 + comments * 3 + views * 0.05,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [creatorChapters, creatorWorks]);

  const retentionRows = useMemo(() => {
    const worksById = new Map(creatorWorks.map((work) => [String(work.id || '').trim().toLowerCase(), work]));
    return Object.entries(retentionMap || {})
      .filter(([workId]) => creatorWorkIds.has(String(workId || '').trim().toLowerCase()))
      .flatMap(([workId, payload]) => {
        const transitions = payload?.transitions && typeof payload.transitions === 'object' ? payload.transitions : {};
        const chapters = payload?.chapters && typeof payload.chapters === 'object' ? payload.chapters : {};
        return Object.entries(transitions).map(([transitionId, row]) => {
          const fromChapterId = String(row?.fromChapterId || '').trim();
          const fromReaders = safeNumber(chapters?.[fromChapterId]?.readersCount);
          const retainedReaders = safeNumber(row?.retainedReaders);
          return {
            id: transitionId,
            workTitle: String(worksById.get(String(workId || '').trim().toLowerCase())?.titulo || 'Obra').trim(),
            fromChapterNumber: safeNumber(row?.fromChapterNumber),
            toChapterNumber: safeNumber(row?.toChapterNumber),
            retainedReaders,
            fromReaders,
            rate: fromReaders > 0 ? retainedReaders / fromReaders : 0,
          };
        });
      })
      .filter((row) => row.fromChapterNumber > 0 && row.toChapterNumber > 0)
      .sort((a, b) => {
        if (a.workTitle !== b.workTitle) return a.workTitle.localeCompare(b.workTitle);
        return a.fromChapterNumber - b.fromChapterNumber;
      });
  }, [creatorWorkIds, creatorWorks, retentionMap]);

  const conversionRate = totals.followersCount > 0 ? totals.membersCount / totals.followersCount : 0;
  const averageLikesPerChapter = creatorChapters.length > 0 ? totals.likesTotal / creatorChapters.length : 0;
  const previousSummary = useMemo(() => {
    if (range === 'all' || !filteredDailyRows.length) {
      return null;
    }
    const windowSize = filteredDailyRows.length;
    const allRows = Object.keys(dailyStats || {})
      .sort((a, b) => parseDateKey(a) - parseDateKey(b))
      .map((key) => ({
        key,
        ...((dailyStats && dailyStats[key]) || {}),
      }));
    const firstKey = filteredDailyRows[0]?.key;
    const startIndex = allRows.findIndex((row) => row.key === firstKey);
    if (startIndex <= 0) return null;
    const prevRows = allRows.slice(Math.max(0, startIndex - windowSize), startIndex);
    return prevRows.reduce(
      (acc, row) => {
        acc.followersAdded += safeNumber(row.followersAdded);
        acc.views += safeNumber(row.totalViews);
        acc.revenue += safeNumber(row.revenueTotal);
        return acc;
      },
      { followersAdded: 0, views: 0, revenue: 0 }
    );
  }, [dailyStats, filteredDailyRows, range]);

  const periodChange = useMemo(() => {
    if (!previousSummary) return null;
    const diffPct = (current, previous) => {
      if (!safeNumber(previous)) return current > 0 ? 1 : 0;
      return (safeNumber(current) - safeNumber(previous)) / safeNumber(previous);
    };
    return {
      followers: diffPct(periodSummary.followersAdded, previousSummary.followersAdded),
      views: diffPct(periodSummary.views, previousSummary.views),
      revenue: diffPct(periodSummary.revenue, previousSummary.revenue),
    };
  }, [periodSummary, previousSummary]);

  const topWorks = useMemo(() => {
    const chaptersByWork = creatorChapters.reduce((acc, chapter) => {
      const workId = String(chapter?.obraId || chapter?.mangaId || '').trim().toLowerCase();
      acc[workId] = acc[workId] || [];
      acc[workId].push(chapter);
      return acc;
    }, {});
    return creatorWorks
      .map((work) => {
        const workId = String(work.id || '').trim().toLowerCase();
        const chapters = chaptersByWork[workId] || [];
        const views = safeNumber(work?.viewsCount || work?.visualizacoes) +
          chapters.reduce((sum, chapter) => sum + safeNumber(chapter?.viewsCount || chapter?.visualizacoes), 0);
        const likes = safeNumber(work?.likesCount || work?.favoritesCount || work?.curtidas);
        const comments = safeNumber(work?.commentsCount) +
          chapters.reduce((sum, chapter) => sum + safeNumber(chapter?.commentsCount), 0);
        const membersPotential = totals.followersCount > 0 ? totals.membersCount * (views / Math.max(totals.totalViews, 1)) : 0;
        return {
          id: work.id,
          title: String(work?.titulo || work?.title || 'Obra').trim(),
          views,
          likes,
          comments,
          estimatedConversion: totals.followersCount > 0 ? membersPotential / totals.followersCount : 0,
          score: views * 0.03 + likes * 2 + comments * 3,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [creatorChapters, creatorWorks, totals.followersCount, totals.membersCount, totals.totalViews]);

  const audienceInsights = useMemo(() => {
    const lines = [];
    if (periodChange) {
      lines.push(
        `Seguidores ${periodChange.followers >= 0 ? 'subiram' : 'caíram'} ${Math.abs(periodChange.followers * 100).toFixed(1)}% contra o período anterior.`
      );
      lines.push(
        `Views ${periodChange.views >= 0 ? 'subiram' : 'caíram'} ${Math.abs(periodChange.views * 100).toFixed(1)}% no mesmo comparativo.`
      );
      lines.push(
        `Receita ${periodChange.revenue >= 0 ? 'subiu' : 'caiu'} ${Math.abs(periodChange.revenue * 100).toFixed(1)}% frente ao recorte anterior.`
      );
    }
    if (retentionRows.length) {
      const bestRetention = [...retentionRows].sort((a, b) => b.rate - a.rate)[0];
      if (bestRetention) {
        lines.push(
          `${bestRetention.workTitle} segura melhor a base em Cap ${bestRetention.fromChapterNumber} → ${bestRetention.toChapterNumber} com ${formatPercent(bestRetention.rate)}.`
        );
      }
    }
    if (topWorks.length) {
      lines.push(`${topWorks[0].title} é a obra com melhor resposta geral no momento.`);
    }
    return lines.slice(0, 4);
  }, [periodChange, retentionRows, topWorks]);

  return (
    <div className="creator-frame-page">
      <section className="creator-frame-shell">
        <header className="creator-frame-hero">
          <div>
            <p className="creator-frame-eyebrow">Audiência do creator</p>
            <h1>Audiência, retenção e monetização</h1>
            <p>
              Leia o tamanho da sua base, o nível de engajamento, a retenção entre capítulos e a conversão em membros
              sem calcular tudo na mão.
            </p>
          </div>
          <div className="creator-frame-actions">
            {creatorMonetizationIsActive ? <button type="button" className="creator-frame-btn" onClick={() => navigate('/creator/promocoes')}>
              Ver monetização
            </button> : null}
            <button type="button" className="creator-frame-btn is-primary" onClick={() => navigate('/perfil')}>
              Meu perfil
            </button>
          </div>
        </header>

        <section className="creator-frame-notes">
          <article className="creator-frame-note">
            <strong>Audiência</strong>
            <p>Seguidores, leitores e views mostram o topo do funil da sua obra.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Engajamento</strong>
            <p>Likes, comentários e capítulos fortes revelam o que realmente prende a base.</p>
          </article>
          <article className="creator-frame-note">
            <strong>Monetização</strong>
            <p>Veja quem virou membro, quanto entrou e quão perto sua audiência está de pagar.</p>
          </article>
        </section>

        <section className="creator-audience-filters">
          {[
            { id: '7d', label: 'Últimos 7 dias' },
            { id: '30d', label: 'Últimos 30 dias' },
            { id: 'all', label: 'Tudo' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              className={`creator-frame-btn ${range === item.id ? 'is-primary' : ''}`}
              onClick={() => setRange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </section>

        <section className="creator-metrics-grid">
          <article className="creator-metric-card">
            <span>Seguidores</span>
            <strong>{formatCompactNumber(totals.followersCount)}</strong>
            <small>+{formatCompactNumber(periodSummary.followersAdded)} no período</small>
          </article>
          <article className="creator-metric-card">
            <span>Views</span>
            <strong>{formatCompactNumber(totals.totalViews)}</strong>
            <small>{formatCompactNumber(periodSummary.views)} no período</small>
          </article>
          <article className="creator-metric-card">
            <span>Membros</span>
            <strong>{formatCompactNumber(totals.membersCount)}</strong>
            <small>{formatPercent(conversionRate)} de conversão</small>
          </article>
          <article className="creator-metric-card">
            <span>Ganhos</span>
            <strong>{formatCurrency(totals.revenueTotal)}</strong>
            <small>{formatCurrency(periodSummary.revenue)} no período</small>
          </article>
        </section>

        {audienceInsights.length ? (
          <section className="creator-panel-card creator-panel-card--wide">
            <div className="creator-panel-head">
              <div>
                <p className="creator-frame-eyebrow">Insights</p>
                <h2>Leitura rápida da sua audiência</h2>
              </div>
            </div>
            <ul className="creator-insights-list">
              {audienceInsights.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="creator-panel-card creator-panel-card--wide">
          <div className="creator-panel-head">
            <div>
              <p className="creator-frame-eyebrow">Crescimento</p>
              <h2>Crescimento ao longo do tempo</h2>
            </div>
          </div>
          <AudienceLineChart rows={graphRows} />
        </section>

        <section className="creator-grid-two">
          <article className="creator-panel-card">
            <div className="creator-panel-head">
              <div>
                <p className="creator-frame-eyebrow">Engajamento</p>
                <h2>Engajamento</h2>
              </div>
            </div>
            <ul className="creator-data-list">
              <li><span>Likes totais</span><strong>{formatCompactNumber(totals.likesTotal)}</strong></li>
              <li><span>Comentários totais</span><strong>{formatCompactNumber(totals.commentsTotal)}</strong></li>
              <li><span>Leitores únicos</span><strong>{formatCompactNumber(totals.uniqueReaders)}</strong></li>
              <li><span>Média de likes por capítulo</span><strong>{averageLikesPerChapter.toFixed(1)}</strong></li>
            </ul>
          </article>

          <article className="creator-panel-card">
            <div className="creator-panel-head">
              <div>
                <p className="creator-frame-eyebrow">Top capítulos</p>
                <h2>Capítulos com melhor resposta</h2>
              </div>
            </div>
            {!topChapters.length ? (
              <p className="creator-empty-copy">Quando seus capítulos começarem a acumular leitura e reação, o ranking aparece aqui.</p>
            ) : (
              <ul className="creator-activity-list">
                {topChapters.map((chapter) => (
                  <li key={chapter.id}>
                    <div>
                      <strong>{chapter.title}</strong>
                      <span>{chapter.workTitle}</span>
                    </div>
                    <div>
                      <strong>{formatCompactNumber(chapter.views)} views</strong>
                      <span>{chapter.likes} likes · {chapter.comments} comentários</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>

        <section className="creator-panel-card creator-panel-card--wide">
          <div className="creator-panel-head">
            <div>
              <p className="creator-frame-eyebrow">Melhores obras</p>
              <h2>Obras com melhor desempenho</h2>
            </div>
          </div>
          {!topWorks.length ? (
            <p className="creator-empty-copy">Assim que suas obras acumularem audiência, esta leitura mostra quais puxam mais views e resposta.</p>
          ) : (
            <ul className="creator-activity-list">
              {topWorks.map((work) => (
                <li key={work.id}>
                  <div>
                    <strong>{work.title}</strong>
                    <span>{formatCompactNumber(work.views)} views · {work.likes} likes · {work.comments} comentários</span>
                  </div>
                  <div>
                    <strong>{formatPercent(work.estimatedConversion)}</strong>
                    <span>conversão estimada da base</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="creator-grid-two">
          <article className="creator-panel-card">
            <div className="creator-panel-head">
              <div>
                <p className="creator-frame-eyebrow">Retenção</p>
                <h2>Capítulo por capítulo</h2>
              </div>
            </div>
            {!retentionRows.length ? (
              <p className="creator-empty-copy">A retenção aparece quando leitores logados começam a avançar entre capítulos em sequência.</p>
            ) : (
              <ul className="creator-activity-list">
                {retentionRows.slice(0, 8).map((row) => (
                  <li key={row.id}>
                    <div>
                      <strong>{row.workTitle}</strong>
                      <span>Cap {row.fromChapterNumber} → {row.toChapterNumber}</span>
                    </div>
                    <div>
                      <strong>{formatPercent(row.rate)}</strong>
                      <span>{row.retainedReaders}/{row.fromReaders} leitores retidos</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="creator-panel-card">
            <div className="creator-panel-head">
              <div>
                <p className="creator-frame-eyebrow">Monetização</p>
                <h2>Base pagante</h2>
              </div>
            </div>
            <ul className="creator-data-list">
              <li><span>Membros ativos</span><strong>{formatCompactNumber(totals.membersCount)}</strong></li>
              <li><span>Receita total</span><strong>{formatCurrency(totals.revenueTotal)}</strong></li>
              <li><span>Receita no período</span><strong>{formatCurrency(periodSummary.revenue)}</strong></li>
              <li><span>Conversão seguidores → membros</span><strong>{formatPercent(conversionRate)}</strong></li>
            </ul>
          </article>
        </section>
      </section>
    </div>
  );
}

