import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import DashboardDateInput from './components/DashboardDateInput';
import useDashboardAdminAnalytics from './hooks/useDashboardAdminAnalytics';
import {
  brl,
  endOfDayMs,
  maskBrDate,
  parseBrToIso,
  parseTab,
  pct,
  startOfDayMs,
  toBrDate,
  toInputDate,
} from './dashboardAdminUtils';
import './DashboardAdmin.css';

const adminDashboardResumo = httpsCallable(functions, 'adminDashboardResumo');
const adminDashboardIntegridade = httpsCallable(functions, 'adminDashboardIntegridade');
const adminDashboardRebuildRollup = httpsCallable(functions, 'adminDashboardRebuildRollup');
const adminBackfillEventosLegados = httpsCallable(functions, 'adminBackfillEventosLegados');

function shortHandle(username) {
  const value = String(username || '').trim();
  return value ? `@${value}` : 'sem @username';
}

function safeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

export default function DashboardAdmin() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTabFromUrl = parseTab(searchParams.get('tab'));
  const now = Date.now();
  const [preset, setPreset] = useState('30d');
  const [startDate, setStartDate] = useState(toInputDate(now - 30 * 86400000));
  const [endDate, setEndDate] = useState(toInputDate(now));
  const [startDateBr, setStartDateBr] = useState(toBrDate(toInputDate(now - 30 * 86400000)));
  const [endDateBr, setEndDateBr] = useState(toBrDate(toInputDate(now)));
  const [compareStart, setCompareStart] = useState('');
  const [compareEnd, setCompareEnd] = useState('');
  const [compareStartBr, setCompareStartBr] = useState('');
  const [compareEndBr, setCompareEndBr] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [dados, setDados] = useState(null);
  const [opsMsg, setOpsMsg] = useState('');
  const [activeTab, setActiveTab] = useState(currentTabFromUrl);

  useEffect(() => {
    const hoje = Date.now();
    if (preset === '30d') {
      const ini = toInputDate(hoje - 30 * 86400000);
      const fim = toInputDate(hoje);
      setStartDate(ini);
      setEndDate(fim);
      setStartDateBr(toBrDate(ini));
      setEndDateBr(toBrDate(fim));
      return;
    }
    if (preset === '7d') {
      const ini = toInputDate(hoje - 7 * 86400000);
      const fim = toInputDate(hoje);
      setStartDate(ini);
      setEndDate(fim);
      setStartDateBr(toBrDate(ini));
      setEndDateBr(toBrDate(fim));
      return;
    }
    if (preset === 'mesAtual') {
      const d = new Date();
      const ini = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const iniIso = toInputDate(ini);
      const fimIso = toInputDate(hoje);
      setStartDate(iniIso);
      setEndDate(fimIso);
      setStartDateBr(toBrDate(iniIso));
      setEndDateBr(toBrDate(fimIso));
      return;
    }
    if (preset === 'mesAnterior') {
      const d = new Date();
      const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
      const fim = new Date(d.getFullYear(), d.getMonth(), 0).getTime();
      const iniIso = toInputDate(ini);
      const fimIso = toInputDate(fim);
      setStartDate(iniIso);
      setEndDate(fimIso);
      setStartDateBr(toBrDate(iniIso));
      setEndDateBr(toBrDate(fimIso));
    }
  }, [preset]);

  useEffect(() => {
    setActiveTab(currentTabFromUrl);
  }, [currentTabFromUrl]);

  const handleDateInput = (rawValue, setBr, setIso) => {
    const masked = maskBrDate(rawValue);
    setBr(masked);
    if (!masked) {
      setIso('');
      return;
    }
    const iso = parseBrToIso(masked);
    setIso(iso || '');
  };

  const handleCalendarPick = (iso, setBr, setIso) => {
    if (!iso) return;
    setIso(iso);
    setBr(toBrDate(iso));
    setPreset('custom');
  };

  const carregar = async () => {
    setErro('');
    setOpsMsg('');
    if (!startDate || !endDate) {
      setErro('Preencha inicio e fim no formato dd/mm/aaaa.');
      return;
    }
    if ((compareStartBr && !compareStart) || (compareEndBr && !compareEnd)) {
      setErro('Complete as datas de comparacao no formato dd/mm/aaaa ou deixe em branco.');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        startAt: startOfDayMs(startDate),
        endAt: endOfDayMs(endDate),
      };
      if (compareStart && compareEnd) {
        payload.compareStartAt = startOfDayMs(compareStart);
        payload.compareEndAt = endOfDayMs(compareEnd);
      }
      const { data } = await adminDashboardResumo(payload);
      setDados(data || null);
    } catch (e) {
      setErro(mensagemErroCallable(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { lineChart, acquisition, novosVipStats, promoFunnel, chapterFunnel, promoScore, chapterScore } =
    useDashboardAdminAnalytics({
      dados,
      rankingMode: 'assinaturas',
      rankingSearch: '',
      subsSearch: '',
      doaSearch: '',
      rankingPage: 1,
      subsPage: 1,
      doaPage: 1,
      selectedUid: '',
    });

  const creatorsSummary = dados?.analytics?.creatorDashboard?.summary || {};
  const topCreatorsByRevenue = safeRows(dados?.analytics?.creatorDashboard?.topByRevenue);
  const topCreatorsByViews = safeRows(dados?.analytics?.creatorDashboard?.topByViews);
  const topCreatorsByEngagement = safeRows(dados?.analytics?.creatorDashboard?.topByEngagement);

  const contentSummary = dados?.analytics?.contentDashboard?.summary || {};
  const topWorksByViews = safeRows(dados?.analytics?.contentDashboard?.topWorksByViews);
  const topWorksByEngagement = safeRows(dados?.analytics?.contentDashboard?.topWorksByEngagement);
  const topChaptersByViews = safeRows(dados?.analytics?.contentDashboard?.topChaptersByViews);

  const financeSummary = dados?.current?.totals || {};
  const premiumBreakdown = dados?.current?.premiumBreakdown || {};

  const growthCards = useMemo(
    () => [
      {
        title: 'Novos assinantes',
        value: novosVipStats.atual || 0,
        meta: novosVipStats.vsPct == null ? 'sem comparacao' : `${pct(novosVipStats.vsPct)} vs comparado`,
      },
      {
        title: 'Crescimento de receita',
        value: pct(dados?.comparativo?.deltaPercent),
        meta: brl(dados?.comparativo?.deltaAmount || 0),
      },
      {
        title: 'Pagamentos via promo',
        value: acquisition.promo?.premiumPaymentsFromPromoEmail || 0,
        meta: brl(acquisition.promo?.premiumRevenueFromPromoEmail || 0),
      },
      {
        title: 'Premium vindo de capitulo',
        value: acquisition.chapter?.premiumPaymentsFromChapterEmail || 0,
        meta: brl(acquisition.chapter?.premiumRevenueFromChapterEmail || 0),
      },
    ],
    [acquisition, dados, novosVipStats]
  );

  const runIntegridade = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminDashboardIntegridade();
      const r = data?.integrity || {};
      setOpsMsg(
        `Verificacao concluida: ${r.totalEvents || 0} lancamentos analisados. Problemas potenciais: ${r.duplicatePaymentIdsCount || 0} duplicados, ${r.withoutUid || 0} sem usuario, ${r.withoutAmount || 0} sem valor.`
      );
    } catch (e) {
      setOpsMsg(mensagemErroCallable(e));
    }
  };

  const runRollup = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminDashboardRebuildRollup();
      setOpsMsg(`Metricas mensais recalculadas (${data?.months || 0} meses). Recarregue o painel para revisar a leitura consolidada.`);
    } catch (e) {
      setOpsMsg(mensagemErroCallable(e));
    }
  };

  const runBackfillLegado = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminBackfillEventosLegados();
      setOpsMsg(
        `Historico corrigido: ${data?.created || 0} evento(s) recuperados (${data?.createdPremium || 0} Premium, ${data?.createdApoio || 0} Apoie).`
      );
      await carregar();
    } catch (e) {
      setOpsMsg(mensagemErroCallable(e));
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <main className="admin-empty-page">
      <section className="admin-empty-card admin-dashboard-card">
        <header className="dashboard-hero">
          <div>
            <h1>Dashboards operacionais</h1>
            <p>
              Cada vista responde uma pergunta diferente: quem gera tracao, qual conteudo puxa a plataforma e o que esta convertendo agora.
            </p>
          </div>
          <div className="dashboard-hero-actions">
            <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={() => navigate('/admin/financeiro')}>
              Abrir financeiro
            </button>
            <button type="button" className="dashboard-btn" onClick={() => navigate('/admin/criadores')}>
              Criadores
            </button>
            <button type="button" className="dashboard-btn" onClick={() => navigate('/')}>
              Voltar ao site
            </button>
          </div>
        </header>

        <div className="dashboard-filtros">
          <div className="dashboard-filtro-item">
            <label>Janela</label>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="7d">Ultimos 7 dias</option>
              <option value="30d">Ultimos 30 dias</option>
              <option value="mesAtual">Mes atual</option>
              <option value="mesAnterior">Mes anterior</option>
              <option value="custom">Customizado</option>
            </select>
          </div>
          <div className="dashboard-filtro-item">
            <label htmlFor="dash-date-ini">Inicio</label>
            <DashboardDateInput
              id="dash-date-ini"
              brValue={startDateBr}
              isoValue={startDate}
              onBrInputChange={(e) => handleDateInput(e.target.value, setStartDateBr, setStartDate)}
              onIsoPicked={(iso) => handleCalendarPick(iso, setStartDateBr, setStartDate)}
              ariaLabelCalendar="Data inicio - abrir calendario"
            />
          </div>
          <div className="dashboard-filtro-item">
            <label htmlFor="dash-date-fim">Fim</label>
            <DashboardDateInput
              id="dash-date-fim"
              brValue={endDateBr}
              isoValue={endDate}
              onBrInputChange={(e) => handleDateInput(e.target.value, setEndDateBr, setEndDate)}
              onIsoPicked={(iso) => handleCalendarPick(iso, setEndDateBr, setEndDate)}
              ariaLabelCalendar="Data fim - abrir calendario"
            />
          </div>
          <div className="dashboard-filtro-item">
            <label htmlFor="dash-date-cmp-ini">Comparar inicio</label>
            <DashboardDateInput
              id="dash-date-cmp-ini"
              brValue={compareStartBr}
              isoValue={compareStart}
              onBrInputChange={(e) => handleDateInput(e.target.value, setCompareStartBr, setCompareStart)}
              onIsoPicked={(iso) => handleCalendarPick(iso, setCompareStartBr, setCompareStart)}
              ariaLabelCalendar="Comparar inicio - abrir calendario"
            />
          </div>
          <div className="dashboard-filtro-item">
            <label htmlFor="dash-date-cmp-fim">Comparar fim</label>
            <DashboardDateInput
              id="dash-date-cmp-fim"
              brValue={compareEndBr}
              isoValue={compareEnd}
              onBrInputChange={(e) => handleDateInput(e.target.value, setCompareEndBr, setCompareEnd)}
              onIsoPicked={(iso) => handleCalendarPick(iso, setCompareEndBr, setCompareEnd)}
              ariaLabelCalendar="Comparar fim - abrir calendario"
            />
          </div>
          <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={carregar} disabled={loading}>
            {loading ? 'Aplicando...' : 'Aplicar filtros'}
          </button>
        </div>

        {erro && <p className="dashboard-erro">{erro}</p>}

        <div className="dashboard-content-tabs">
          <button type="button" className={activeTab === 'creators' ? 'active' : ''} onClick={() => handleTabChange('creators')}>
            Creators
          </button>
          <button type="button" className={activeTab === 'conteudo' ? 'active' : ''} onClick={() => handleTabChange('conteudo')}>
            Conteudo
          </button>
          <button type="button" className={activeTab === 'growth' ? 'active' : ''} onClick={() => handleTabChange('growth')}>
            Growth
          </button>
        </div>

        {activeTab === 'creators' && (
          <>
            <div className="dashboard-kpis dashboard-kpis--hero">
              <article className="kpi-card">
                <h3>Creators totais</h3>
                <strong>{creatorsSummary.totalCreators || 0}</strong>
                <small>Base cadastrada no ecossistema</small>
              </article>
              <article className="kpi-card">
                <h3>Creators ativos</h3>
                <strong>{creatorsSummary.activeCreators || 0}</strong>
                <small>Com tracao ou publico real</small>
              </article>
              <article className="kpi-card kpi-card--growth">
                <h3>Receita de creators</h3>
                <strong>{brl(creatorsSummary.periodRevenue || 0)}</strong>
                <small>No periodo filtrado</small>
              </article>
              <article className="kpi-card kpi-card--vip">
                <h3>Followers ganhos</h3>
                <strong>{creatorsSummary.periodFollowers || 0}</strong>
                <small>Movimento no periodo</small>
              </article>
            </div>

            <div className="dashboard-split-grid">
              <section className="dashboard-sec">
                <div className="dashboard-sec-head">
                  <h2>Quem mais gera receita</h2>
                  <small>Receita de creator no periodo + acumulado</small>
                </div>
                <div className="analytics-table">
                  <div className="analytics-row analytics-row--head dashboard-row-creators">
                    <span>Criador</span>
                    <span>Receita periodo</span>
                    <span>Receita total</span>
                    <span>Nivel</span>
                  </div>
                  {topCreatorsByRevenue.map((row) => (
                    <div key={`rev-${row.uid}`} className="analytics-row dashboard-row-creators">
                      <span className="dashboard-cell-primary">
                        <strong>{row.displayName}</strong>
                        <small>{shortHandle(row.username)}</small>
                      </span>
                      <span>{brl(row.periodRevenue || 0)}</span>
                      <span>{brl(row.totalRevenue || 0)}</span>
                      <span>{row.monetizationLevel || 0}</span>
                    </div>
                  ))}
                  {!topCreatorsByRevenue.length && <p className="dashboard-empty">Sem creators com receita rastreada nesta janela.</p>}
                </div>
              </section>

              <section className="dashboard-sec">
                <div className="dashboard-sec-head">
                  <h2>Quem mais puxa audiencia</h2>
                  <small>Views, likes e followers no periodo</small>
                </div>
                <div className="analytics-table">
                  <div className="analytics-row analytics-row--head dashboard-row-creator-views">
                    <span>Criador</span>
                    <span>Views</span>
                    <span>Likes</span>
                    <span>Followers</span>
                    <span>Score</span>
                  </div>
                  {topCreatorsByViews.map((row) => (
                    <div key={`views-${row.uid}`} className="analytics-row dashboard-row-creator-views">
                      <span className="dashboard-cell-primary">
                        <strong>{row.displayName}</strong>
                        <small>{shortHandle(row.username)}</small>
                      </span>
                      <span>{row.periodViews || 0}</span>
                      <span>{row.periodLikes || 0}</span>
                      <span>{row.periodFollowers || 0}</span>
                      <span>{row.engagementScore || 0}</span>
                    </div>
                  ))}
                  {!topCreatorsByViews.length && <p className="dashboard-empty">Sem creators com audiencia recente nesta janela.</p>}
                </div>
              </section>
            </div>

            <section className="dashboard-sec">
              <div className="dashboard-sec-head">
                <h2>Creators em destaque operacional</h2>
                <small>Leitura rapida para equipe agir em apoio, loja ou crescimento</small>
              </div>
              <div className="dashboard-highlight-grid">
                {topCreatorsByEngagement.map((row) => (
                  <article key={`eng-${row.uid}`} className="dashboard-highlight-card">
                    <div className="dashboard-highlight-head">
                      <strong>{row.displayName}</strong>
                      <span>{shortHandle(row.username)}</span>
                    </div>
                    <p>{row.periodViews || 0} views · {row.periodLikes || 0} likes · {row.periodReaders || 0} leitores unicos</p>
                  </article>
                ))}
                {!topCreatorsByEngagement.length && <p className="dashboard-empty">Nenhum creator com score de engajamento nesta janela.</p>}
              </div>
            </section>
          </>
        )}

        {activeTab === 'conteudo' && (
          <>
            <div className="dashboard-kpis dashboard-kpis--hero">
              <article className="kpi-card">
                <h3>Obras no catalogo</h3>
                <strong>{contentSummary.works || 0}</strong>
                <small>Total ativo no banco</small>
              </article>
              <article className="kpi-card">
                <h3>Capitulos</h3>
                <strong>{contentSummary.chapters || 0}</strong>
                <small>Volume editorial publicado</small>
              </article>
              <article className="kpi-card kpi-card--growth">
                <h3>Views acumuladas</h3>
                <strong>{contentSummary.totalViews || 0}</strong>
                <small>Tracao atual do catalogo</small>
              </article>
              <article className="kpi-card">
                <h3>Engajamento acumulado</h3>
                <strong>{(contentSummary.totalLikes || 0) + (contentSummary.totalComments || 0)}</strong>
                <small>{contentSummary.totalLikes || 0} likes · {contentSummary.totalComments || 0} comentarios</small>
              </article>
            </div>

            <div className="dashboard-split-grid">
              <section className="dashboard-sec">
                <div className="dashboard-sec-head">
                  <h2>Obras com mais tracao</h2>
                  <small>Views totais da plataforma</small>
                </div>
                <div className="analytics-table">
                  <div className="analytics-row analytics-row--head dashboard-row-content">
                    <span>Obra</span>
                    <span>Autor</span>
                    <span>Views</span>
                    <span>Likes</span>
                    <span>Capitulos</span>
                  </div>
                  {topWorksByViews.map((row) => (
                    <div key={row.workId} className="analytics-row dashboard-row-content">
                      <span className="dashboard-cell-primary">
                        <strong>{row.title}</strong>
                        <small>{row.commentsCount || 0} comentarios</small>
                      </span>
                      <span>{row.authorUsername ? `@${row.authorUsername}` : row.authorName}</span>
                      <span>{row.viewsCount || 0}</span>
                      <span>{row.likesCount || 0}</span>
                      <span>{row.chapterCount || 0}</span>
                    </div>
                  ))}
                  {!topWorksByViews.length && <p className="dashboard-empty">Sem obras com tracao suficiente para ranking.</p>}
                </div>
              </section>

              <section className="dashboard-sec">
                <div className="dashboard-sec-head">
                  <h2>Capitulos com mais leitura</h2>
                  <small>Leitura acumulada por capitulo</small>
                </div>
                <div className="analytics-table">
                  <div className="analytics-row analytics-row--head dashboard-row-chapters">
                    <span>Capitulo</span>
                    <span>Obra</span>
                    <span>Autor</span>
                    <span>Views</span>
                  </div>
                  {topChaptersByViews.map((row) => (
                    <div key={row.chapterId} className="analytics-row dashboard-row-chapters">
                      <span className="dashboard-cell-primary">
                        <strong>{row.title}</strong>
                        <small>{row.likesCount || 0} likes · {row.commentsCount || 0} comentarios</small>
                      </span>
                      <span>{row.workTitle}</span>
                      <span>{row.authorUsername ? `@${row.authorUsername}` : row.authorName}</span>
                      <span>{row.viewsCount || 0}</span>
                    </div>
                  ))}
                  {!topChaptersByViews.length && <p className="dashboard-empty">Sem capitulos com leitura suficiente para ranking.</p>}
                </div>
              </section>
            </div>

            <section className="dashboard-sec">
              <div className="dashboard-sec-head">
                <h2>Obras com melhor engajamento</h2>
                <small>Leitura que ajuda a decidir destaque e curadoria</small>
              </div>
              <div className="dashboard-highlight-grid">
                {topWorksByEngagement.map((row) => (
                  <article key={`eng-${row.workId}`} className="dashboard-highlight-card">
                    <div className="dashboard-highlight-head">
                      <strong>{row.title}</strong>
                      <span>{row.authorUsername ? `@${row.authorUsername}` : row.authorName}</span>
                    </div>
                    <p>{row.likesCount || 0} likes · {row.commentsCount || 0} comentarios · {row.viewsCount || 0} views</p>
                  </article>
                ))}
                {!topWorksByEngagement.length && <p className="dashboard-empty">Sem obras com sinais de engajamento ainda.</p>}
              </div>
            </section>
          </>
        )}

        {activeTab === 'growth' && (
          <>
            <div className="dashboard-kpis dashboard-kpis--hero">
              {growthCards.map((card) => (
                <article key={card.title} className="kpi-card">
                  <h3>{card.title}</h3>
                  <strong>{card.value}</strong>
                  <small>{card.meta}</small>
                </article>
              ))}
            </div>

            <section className="dashboard-sec dashboard-sec--chart">
              <div className="dashboard-sec-head">
                <h2>Receita ao longo do tempo</h2>
                <small>Leitura consolidada para acompanhar a janela escolhida</small>
              </div>
              {lineChart.months.length ? (
                <div className="line-chart-wrap">
                  <svg viewBox="0 0 920 280" role="img" aria-label="Grafico de receita mensal">
                    <path d={lineChart.comparePath} className="line-compare" />
                    <path d={lineChart.currentPath} className="line-main" />
                  </svg>
                  <div className="line-legend">
                    <span><i className="dot-main" /> Periodo atual</span>
                    <span><i className="dot-compare" /> Periodo comparado</span>
                  </div>
                </div>
              ) : (
                <p className="dashboard-empty">Sem dados suficientes para montar o grafico principal.</p>
              )}
            </section>

            <div className="conversion-score-grid">
              <article className={`conversion-score-card tone-${promoScore.tone}`}>
                <p>Score de aquisicao por promocao</p>
                <strong>{promoScore.grade}</strong>
                <span>
                  {promoFunnel.paidFromSent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% pago por e-mail enviado · {promoScore.label}
                </span>
              </article>
              <article className={`conversion-score-card tone-${chapterScore.tone}`}>
                <p>Score de notificacao de capitulo</p>
                <strong>{chapterScore.grade}</strong>
                <span>
                  {chapterFunnel.readShare.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% de leitura via e-mail · {chapterScore.label}
                </span>
              </article>
            </div>

            <div className="conversion-funnel-grid">
              <article className="conversion-card">
                <h3>Promocao</h3>
                <div className="conversion-kpis">
                  <p>Enviados: <strong>{acquisition.promo?.sentEmails || 0}</strong></p>
                  <p>Cliques: <strong>{acquisition.promo?.promoLandingClicks || 0}</strong></p>
                  <p>Checkouts: <strong>{acquisition.promo?.premiumCheckoutsFromPromoEmail || 0}</strong></p>
                  <p>Pagos: <strong>{acquisition.promo?.premiumPaymentsFromPromoEmail || 0}</strong></p>
                </div>
                <ul className="conversion-steps">
                  {promoFunnel.steps.map((step) => (
                    <li key={`promo-${step.id}`}>
                      <div className="conversion-steps-head">
                        <span>{step.label}</span>
                        <strong>{step.value}</strong>
                      </div>
                      <div className="conversion-bar">
                        <i style={{ width: `${Math.max(4, step.barPct)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="conversion-card">
                <h3>Notificacao de capitulo</h3>
                <div className="conversion-kpis">
                  <p>Enviados: <strong>{acquisition.chapter?.sentEmails || 0}</strong></p>
                  <p>Cliques: <strong>{acquisition.chapter?.chapterLandingClicks || 0}</strong></p>
                  <p>Leituras via e-mail: <strong>{acquisition.chapter?.chapterReadsFromEmail || 0}</strong></p>
                  <p>Leituras normais: <strong>{acquisition.chapter?.chapterReadsNormal || 0}</strong></p>
                </div>
                <ul className="conversion-steps">
                  {chapterFunnel.steps.map((step) => (
                    <li key={`chapter-${step.id}`}>
                      <div className="conversion-steps-head">
                        <span>{step.label}</span>
                        <strong>{step.value}</strong>
                      </div>
                      <div className="conversion-bar conversion-bar--chapter">
                        <i style={{ width: `${Math.max(4, step.barPct)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            </div>

            <section className="dashboard-sec dashboard-sec--actions">
              <div className="dashboard-sec-head">
                <h2>Controle de exposicao</h2>
                <small>Boost manual e moderacao ficam aqui, fora do financeiro</small>
              </div>
              <div className="dashboard-action-grid">
                <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={() => navigate('/admin/criadores')}>
                  Abrir creators
                </button>
                <button type="button" className="dashboard-btn" onClick={() => navigate('/admin/obras')}>
                  Curadoria de obras
                </button>
                <button type="button" className="dashboard-btn" onClick={() => navigate('/admin/usuarios')}>
                  Moderacao de usuarios
                </button>
              </div>
              <p className="dashboard-actions-note">
                O financeiro fica focado em caixa. Destaque manual, impulsionamento e acao operacional ficam nesta camada de growth/moderacao.
              </p>
            </section>

            <details className="dashboard-sec dashboard-sec--sistema">
              <summary className="dashboard-sistema-summary">
                Sistema e manutencao <span className="dashboard-sistema-tag">avancado</span>
              </summary>
              <p className="dashboard-sistema-lead">
                Ferramentas de consistencia e reparo historico. So use quando a equipe realmente estiver corrigindo base.
              </p>
              <div className="dashboard-actions-inline">
                <button type="button" className="dashboard-btn" onClick={runIntegridade}>
                  Verificar dados
                </button>
                <button type="button" className="dashboard-btn" onClick={runRollup}>
                  Recalcular metricas
                </button>
                <button type="button" className="dashboard-btn" onClick={runBackfillLegado}>
                  Corrigir historico antigo
                </button>
              </div>
              {opsMsg && <p className="dashboard-ops-msg">{opsMsg}</p>}
              <p className="dashboard-integrity-resumo">
                Ultima leitura: {dados?.integrity?.totalEvents || 0} eventos · {dados?.integrity?.duplicatePaymentIdsCount || 0} IDs duplicados · {dados?.integrity?.withoutUid || 0} sem usuario · {dados?.integrity?.withoutAmount || 0} sem valor.
              </p>
            </details>
          </>
        )}

        <section className="dashboard-sec dashboard-sec--finance-snapshot">
          <div className="dashboard-sec-head">
            <h2>Snapshot financeiro atual</h2>
            <small>Caixa da plataforma, separado da operacao de growth</small>
          </div>
          <div className="dashboard-finance-strip">
            <article>
              <h3>Receita total</h3>
              <strong>{brl(financeSummary.totalAmount || 0)}</strong>
            </article>
            <article>
              <h3>Assinaturas plataforma</h3>
              <strong>{brl(premiumBreakdown.platformAmount || 0)}</strong>
              <small>{premiumBreakdown.platformCount || 0} pagamentos</small>
            </article>
            <article>
              <h3>Assinaturas via creator</h3>
              <strong>{brl(premiumBreakdown.creatorLinkAmount || 0)}</strong>
              <small>{premiumBreakdown.creatorLinkCount || 0} pagamentos</small>
            </article>
            <article>
              <h3>Doacoes</h3>
              <strong>{brl(financeSummary.apoioAmount || 0)}</strong>
              <small>{financeSummary.apoioCount || 0} apoios</small>
            </article>
          </div>
        </section>
      </section>
    </main>
  );
}
