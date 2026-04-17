import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../services/firebase';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { formatarTempoRestanteAssinatura } from '../../utils/assinaturaTempoRestante';
import { formatarDataHoraBr } from '../../utils/datasBr';
import { formatUserDisplayFromMixed } from '../../utils/publicCreatorName';
import DashboardDateInput from './components/DashboardDateInput';
import useDashboardAdminAnalytics from './hooks/useDashboardAdminAnalytics';
import {
  DASHBOARD_TABS,
  TITLE_COL_ESTIMATIVA,
  brl,
  endOfDayMs,
  formatGender,
  formatMonthKeyBr,
  maskBrDate,
  parseBrToIso,
  parseTab,
  pct,
  percentOf,
  rankBadge,
  scoreFromPercent,
  sexoBarClass,
  startOfDayMs,
  textoEstimativaPagamentosNoFiltro,
  toBrDate,
  toInputDate,
} from './dashboardAdminUtils';
import './DashboardAdmin.css';

const adminDashboardResumo = httpsCallable(functions, 'adminDashboardResumo');
const adminDashboardIntegridade = httpsCallable(functions, 'adminDashboardIntegridade');
const adminDashboardRebuildRollup = httpsCallable(functions, 'adminDashboardRebuildRollup');
const adminBackfillEventosLegados = httpsCallable(functions, 'adminBackfillEventosLegados');

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
  const [rankingMode, setRankingMode] = useState('assinaturas');
  const [rankingSearch, setRankingSearch] = useState('');
  const [subsSearch, setSubsSearch] = useState('');
  const [doaSearch, setDoaSearch] = useState('');
  const [rankingPage, setRankingPage] = useState(1);
  const [subsPage, setSubsPage] = useState(1);
  const [doaPage, setDoaPage] = useState(1);
  const [selectedUid, setSelectedUid] = useState('');

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

  const {
    lineChart,
    pieShare,
    distAssinaSexo,
    distDoaSexo,
    novosVipStats,
    dashboardInsights,
    ultimosMesesReceita,
    acquisition,
    rankingPaginated,
    subsPaginated,
    doaPaginated,
    subsByUid,
    selectedHistory,
    selectedUser,
    promoFunnel,
    chapterFunnel,
    promoScore,
    chapterScore,
  } = useDashboardAdminAnalytics({
    dados,
    rankingMode,
    rankingSearch,
    subsSearch,
    doaSearch,
    rankingPage,
    subsPage,
    doaPage,
    selectedUid,
  });

  useEffect(() => setRankingPage(1), [rankingSearch, rankingMode]);
  useEffect(() => setSubsPage(1), [subsSearch]);
  useEffect(() => setDoaPage(1), [doaSearch]);

  const runIntegridade = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminDashboardIntegridade();
      const r = data?.integrity || {};
      setOpsMsg(
        `Verificacao concluida: ${r.totalEvents || 0} lancamentos analisados. Possiveis problemas: ${r.duplicatePaymentIdsCount || 0} duplicados, ${r.withoutUid || 0} sem usuario, ${r.withoutAmount || 0} sem valor.`
      );
    } catch (e) {
      setOpsMsg(mensagemErroCallable(e));
    }
  };

  const runRollup = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminDashboardRebuildRollup();
      setOpsMsg(`Metricas mensais recalculadas (${data?.months || 0} meses). O grafico e o resumo por mes devem refletir isso apos atualizar a pagina.`);
    } catch (e) {
      setOpsMsg(mensagemErroCallable(e));
    }
  };

  const runBackfillLegado = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminBackfillEventosLegados();
      setOpsMsg(
        `Historico corrigido: ${data?.created || 0} lancamento(s) recuperados (${data?.createdPremium || 0} Premium, ${data?.createdApoio || 0} Apoie).`
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
            <h1>Dashboard de Monetizacao</h1>
            <p>
              Controle total das assinaturas, receita e crescimento de Kokuin.
              {dados?.period?.startAt && dados?.period?.endAt
                ? ` Periodo: ${formatarDataHoraBr(dados.period.startAt, { seVazio: '--' })} ate ${formatarDataHoraBr(dados.period.endAt, { seVazio: '--' })}.`
                : ''}
            </p>
          </div>
          <div className="dashboard-hero-actions">
            <button type="button" className="dashboard-btn" onClick={() => navigate('/admin/financeiro')}>
              Financeiro & Promos
            </button>
            <button type="button" className="dashboard-btn" onClick={() => navigate('/')}>
              Voltar ao site
            </button>
          </div>
        </header>

        <div className="dashboard-filtros">
          <div className="dashboard-filtro-item">
            <label>Preset</label>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
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
            <label htmlFor="dash-date-cmp-ini">Comparar inicio (opcional)</label>
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
            <label htmlFor="dash-date-cmp-fim">Comparar fim (opcional)</label>
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
          <button type="button" className={activeTab === 'visao-geral' ? 'active' : ''} onClick={() => handleTabChange('visao-geral')}>
            Visao Geral
          </button>
          <button type="button" className={activeTab === 'rankings' ? 'active' : ''} onClick={() => handleTabChange('rankings')}>
            Rankings
          </button>
          <button type="button" className={activeTab === 'assinaturas' ? 'active' : ''} onClick={() => handleTabChange('assinaturas')}>
            Assinaturas
          </button>
          <button type="button" className={activeTab === 'doacoes' ? 'active' : ''} onClick={() => handleTabChange('doacoes')}>
            Doacoes
          </button>
          <button type="button" className={activeTab === 'aquisicao' ? 'active' : ''} onClick={() => handleTabChange('aquisicao')}>
            Aquisicao
          </button>
        </div>

        {activeTab === 'visao-geral' && (
          <>
            <div className="dashboard-kpis dashboard-kpis--hero">
              <article className="kpi-card kpi-card--revenue">
                <h3>Receita total</h3>
                <strong>{brl(dados?.current?.totals?.totalAmount || 0)}</strong>
                <small>{`vs periodo comparado: ${pct(dados?.comparativo?.deltaPercent)}`}</small>
              </article>
              <article className="kpi-card kpi-card--vip">
                <h3>VIPs no periodo</h3>
                <strong>{dados?.current?.totals?.premiumCount || 0}</strong>
                <small>{brl(dados?.current?.totals?.premiumAmount || 0)}</small>
              </article>
              <article className="kpi-card kpi-card--growth">
                <h3>Crescimento</h3>
                <strong>{pct(dados?.comparativo?.deltaPercent)}</strong>
                <small>{`Diferenca absoluta: ${brl(dados?.comparativo?.deltaAmount || 0)}`}</small>
              </article>
              <article className="kpi-card kpi-card--donation">
                <h3>Doacoes</h3>
                <strong>{dados?.current?.totals?.apoioCount || 0}</strong>
                <small>{brl(dados?.current?.totals?.apoioAmount || 0)}</small>
              </article>
            </div>

            <section className="dashboard-sec dashboard-sec--chart">
              <div className="dashboard-sec-head">
                <h2>Receita ao longo do tempo</h2>
                <small>{lineChart.months.length} meses no recorte atual</small>
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
                <p className="dashboard-empty">Sem dados suficientes para o grafico principal.</p>
              )}
            </section>

            <section className="dashboard-sec dashboard-sec--insights">
              <div className="dashboard-sec-head">
                <h2>Insights automaticos</h2>
                <small>Traduz numeros em decisao: o que esta puxando receita e onde agir primeiro.</small>
              </div>
              <ul className="dashboard-insights-list">
                {dashboardInsights.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
                {!dashboardInsights.length && (
                  <li className="dashboard-insights-muted">Aplique os filtros e carregue o periodo para gerar os insights.</li>
                )}
              </ul>
            </section>

            <section className="dashboard-sec dashboard-sec--teaser">
              <div className="dashboard-sec-head">
                <h2>Impacto rapido ? aquisicao por e-mail</h2>
                <small>Pagamentos ligados a promo e a aviso de capitulo (periodo filtrado)</small>
              </div>
              <div className="dashboard-teaser-kpis">
                <article>
                  <h3>Promocao</h3>
                  <strong>{acquisition.promo?.premiumPaymentsFromPromoEmail || 0}</strong>
                  <small>{brl(acquisition.promo?.premiumRevenueFromPromoEmail || 0)}</small>
                </article>
                <article>
                  <h3>Capitulo</h3>
                  <strong>{acquisition.chapter?.premiumPaymentsFromChapterEmail || 0}</strong>
                  <small>{brl(acquisition.chapter?.premiumRevenueFromChapterEmail || 0)}</small>
                </article>
              </div>
              <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={() => handleTabChange('aquisicao')}>
                Abrir funil completo
              </button>
            </section>

            <div className="dashboard-sessoes-grid dashboard-sessoes-grid--insights">
              <article className="dashboard-sec dashboard-sec--demografia">
                <h2>Receita Premium por sexo (distribuicao)</h2>
                <p className="dash-demografia-hint">% sobre o valor de assinaturas aprovadas no periodo com sexo preenchido.</p>
                {!distAssinaSexo.length ? (
                  <p className="dashboard-empty">Sem dados de sexo para assinaturas neste recorte.</p>
                ) : (
                  <>
                    <div className="dash-sexo-stack" role="img" aria-label="Distribuicao por sexo nas assinaturas">
                      {distAssinaSexo.map((r) => (
                        <div
                          key={r.key}
                          className={`dash-sexo-seg ${sexoBarClass(r.key)}`}
                          style={{ flex: `0 0 ${Math.max(3, r.pct)}%` }}
                    title={`${r.label}: ${r.pct.toFixed(1)}% · ${brl(r.amount)}`}
                        />
                      ))}
                    </div>
                    <ul className="dash-sexo-list">
                      {distAssinaSexo.map((r) => (
                        <li key={r.key}>
                          <span className={`dash-sexo-dot ${sexoBarClass(r.key)}`} />
                          <span className="dash-sexo-list-label">{r.label}</span>
                          <strong>{r.pct.toFixed(1)}%</strong>
                          <small>{brl(r.amount)}</small>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </article>

              <article className="dashboard-sec dashboard-sec--demografia">
                <h2>Doacoes por sexo (distribuicao)</h2>
                <p className="dash-demografia-hint">% sobre o valor doado no periodo.</p>
                {!distDoaSexo.length ? (
                  <p className="dashboard-empty">Nenhuma doacao com sexo rastreado - ou ainda nao houve doacoes.</p>
                ) : (
                  <>
                    <div className="dash-sexo-stack" role="img" aria-label="Distribuicao por sexo nas doacoes">
                      {distDoaSexo.map((r) => (
                        <div
                          key={r.key}
                          className={`dash-sexo-seg ${sexoBarClass(r.key)}`}
                          style={{ flex: `0 0 ${Math.max(3, r.pct)}%` }}
                    title={`${r.label}: ${r.pct.toFixed(1)}% · ${brl(r.amount)}`}
                        />
                      ))}
                    </div>
                    <ul className="dash-sexo-list">
                      {distDoaSexo.map((r) => (
                        <li key={r.key}>
                          <span className={`dash-sexo-dot ${sexoBarClass(r.key)}`} />
                          <span className="dash-sexo-list-label">{r.label}</span>
                          <strong>{r.pct.toFixed(1)}%</strong>
                          <small>{brl(r.amount)}</small>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </article>

              <article className="kpi-card kpi-card--idade">
                <h3>Media de idade</h3>
                <strong>
                  {dados?.current?.demografia?.mediaIdadeAssinantes ?? '--'} <span className="dash-idade-sep">/</span>{' '}
                  {dados?.current?.demografia?.mediaIdadeDoadores ?? '--'}
                </strong>
                <small>Assinantes ? Doadores (quando ha ano de nascimento no perfil)</small>
              </article>

              <section className="dashboard-sec dashboard-sec--pizza">
                <h2>Quem domina a receita</h2>
                <p className="dash-demografia-hint">Assinatura recorrente vs doacoes avulsas no periodo.</p>
                {pieShare.total <= 0 ? (
                  <p className="dashboard-empty">Sem receita classificada neste periodo.</p>
                ) : (
                  <div className="pie-wrap pie-wrap--lg">
                    <div
                      className="pie-chart pie-chart--lg"
                      style={{
                        background: `conic-gradient(#ffcc00 0% ${pieShare.assPct}%, #5aa7ff ${pieShare.assPct}% 100%)`,
                      }}
                    aria-label="Distribuicao assinatura versus doacao"
                    />
                    <div className="pie-legend pie-legend--lg">
                      <p>
                        <span className="legend-box legend-ass" />
                        <span>
                          Assinatura: <strong>{brl(pieShare.ass)}</strong>
                          <em>({pieShare.assPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)</em>
                        </span>
                      </p>
                      <p>
                        <span className="legend-box legend-doa" />
                        <span>
                          Doacao: <strong>{brl(pieShare.doa)}</strong>
                          <em>({pieShare.doaPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)</em>
                        </span>
                      </p>
                    </div>
                  </div>
                )}
              </section>

              <section className="dashboard-sec dashboard-sec--crescimento">
                <h2>Novos assinantes (primeira compra)</h2>
                <p className="dash-crescimento-lead">
                  <strong className="dash-crescimento-num">+{novosVipStats.atual}</strong>
                  <span> novos no periodo</span>
                  {novosVipStats.vsPct != null && Number.isFinite(novosVipStats.vsPct) && (
                    <span className={`dash-crescimento-vs ${novosVipStats.vsPct >= 0 ? 'dash-delta--up' : 'dash-delta--down'}`}>
                    {' '}· {pct(novosVipStats.vsPct)} vs periodo de comparacao automatico
                    </span>
                  )}
                </p>
                <ul className="lista-mensal lista-mensal--bars">
                  {(dados?.crescimentoPremium || []).map((row) => {
                    const maxV = Math.max(1, ...((dados?.crescimentoPremium || []).map((x) => Number(x.novosVip || 0))));
                    const w = Math.round((Number(row.novosVip || 0) / maxV) * 100);
                    return (
                      <li key={row.month}>
                        <span>{formatMonthKeyBr(row.month)}</span>
                        <div className="bar-inline">
                          <i style={{ width: `${Math.max(10, w)}%` }} />
                        </div>
                        <strong>{row.novosVip}</strong>
                      </li>
                    );
                  })}
                  {!dados?.crescimentoPremium?.length && <li className="dashboard-empty">Sem novos assinantes rastreados mes a mes neste recorte.</li>}
                </ul>
              </section>

              <section className="dashboard-sec dashboard-sec--mensal-destaque">
                <div className="dashboard-sec-head">
                  <h2>Arrecadacao mensal</h2>
                  <small>Total, Premium e doacoes - ultimos meses do periodo</small>
                </div>
                <div className="dash-mensal-cards">
                  {ultimosMesesReceita.map((m) => (
                    <article key={m.key} className="dash-mensal-card">
                      <h3>{formatMonthKeyBr(m.key)}</h3>
                      <p className="dash-mensal-total">{brl(m.totalAmount || 0)}</p>
                      <p className="dash-mensal-line">
                        Premium <strong>{brl(m.premiumAmount || 0)}</strong>
                      </p>
                      <p className="dash-mensal-line">
                        Doacoes <strong>{brl(m.apoioAmount || 0)}</strong>
                      </p>
                    </article>
                  ))}
                </div>
                {!ultimosMesesReceita.length && <p className="dashboard-empty">Nenhum mes com movimento no periodo selecionado.</p>}
              </section>
            </div>

            <section className="dashboard-sec dashboard-sec--top-doadores">
              <div className="dashboard-sec-head">
                <h2>Top doadores</h2>
                <small>Quem mais contribuiu com doacoes (Apoie) no periodo</small>
              </div>
              <div className="top-table">
                <div className="top-row top-row--head">
                  <span>#</span>
                  <span>Nome</span>
                  <span>Sexo</span>
                  <strong>Total</strong>
                </div>
                {(dados?.current?.topDoadores || []).map((u, idx) => (
                  <div key={u.uid} className={`top-row ${idx === 0 ? 'top-row--winner' : ''}`}>
                    <span>{idx === 0 ? '#1' : `${idx + 1}.`}</span>
                    <span>{formatUserDisplayFromMixed(u)}</span>
                    <span>{formatGender(u.gender || 'nao_informado')}</span>
                    <strong>{brl(u.amount || 0)}</strong>
                  </div>
                ))}
              </div>
              {!dados?.current?.topDoadores?.length && (
                <div className="dashboard-empty-state">
                  <p className="dashboard-empty-title">Nenhum doador ainda neste periodo</p>
                  <p className="dashboard-empty-text">
                    Isso e normal em recortes curtos ou quando o publico ainda nao usa a Apoie. Experimente metas visiveis, recompensas exclusivas
                    ou mencao aos apoiadores no final dos capitulos.
                  </p>
                </div>
              )}
            </section>

            <details className="dashboard-sec dashboard-sec--sistema">
              <summary className="dashboard-sistema-summary">
                Sistema e manutencao <span className="dashboard-sistema-tag">avancado</span>
              </summary>
              <p className="dashboard-sistema-lead">
                Ferramentas para conferir consistencia dos dados e recalcular agregados. Use so se precisar corrigir base historica.
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
                <button type="button" className="dashboard-btn" onClick={() => navigate('/admin/financeiro')}>
                  Ir para Financeiro
                </button>
                <button type="button" className="dashboard-btn" onClick={() => navigate('/')}>
                  Voltar ao site
                </button>
              </div>
              {opsMsg && <p className="dashboard-ops-msg">{opsMsg}</p>}
              <p className="dashboard-integrity-resumo">
                  Ultima leitura: {dados?.integrity?.totalEvents || 0} eventos no banco · {dados?.integrity?.duplicatePaymentIdsCount || 0} IDs
                  duplicados · {dados?.integrity?.withoutUid || 0} sem usuario · {dados?.integrity?.withoutAmount || 0} sem valor.
              </p>
            </details>
          </>
        )}

        {activeTab === 'rankings' && (
          <section className="dashboard-sec">
            <div className="dashboard-sec-head">
              <h2>Ranking de Receita</h2>
              <small>Top usuarios por valor no periodo selecionado</small>
            </div>
            <div className="analytics-toolbar">
              <div className="analytics-toggle">
                <button type="button" className={rankingMode === 'assinaturas' ? 'active' : ''} onClick={() => setRankingMode('assinaturas')}>
                  Assinaturas
                </button>
                <button type="button" className={rankingMode === 'doacoes' ? 'active' : ''} onClick={() => setRankingMode('doacoes')}>
                  Doacoes
                </button>
              </div>
              <input
                type="text"
                placeholder="Buscar usuario..."
                value={rankingSearch}
                onChange={(e) => setRankingSearch(e.target.value)}
              />
            </div>
            <div className="analytics-table">
              <div className="analytics-row analytics-row--head analytics-row--rankings">
                <span>Rank</span>
                <span>Usuario</span>
                <span>Total gasto</span>
                <span>Qtd.</span>
                <span title={rankingMode === 'assinaturas' ? TITLE_COL_ESTIMATIVA : undefined}>
                  {rankingMode === 'assinaturas' ? 'Est. no filtro' : '--'}
                </span>
                <span>Ultima atividade</span>
              </div>
              {rankingPaginated.rows.map((row) => {
                const subRef = subsByUid[row.uid] || null;
                return (
                  <button
                    type="button"
                    key={`${rankingMode}-${row.uid}`}
                    className={`analytics-row analytics-row--rankings analytics-row--click ${row.rank <= 3 ? `analytics-row--top${row.rank}` : ''}`}
                    onClick={() => setSelectedUid(row.uid)}
                  >
                    <span>{rankBadge(row.rank)}</span>
                    <span>{formatUserDisplayFromMixed(row)}</span>
                    <span>{brl(row.totalSpent || 0)}</span>
                    <span>{row.count || 0}</span>
                    <span title={rankingMode === 'assinaturas' ? TITLE_COL_ESTIMATIVA : undefined}>
                      {rankingMode === 'assinaturas' ? textoEstimativaPagamentosNoFiltro(subRef) : '--'}
                    </span>
                    <span>{formatarDataHoraBr(row.lastAt, { seVazio: '--' })}</span>
                  </button>
                );
              })}
              {!rankingPaginated.rows.length && <p className="dashboard-empty">Sem usuarios no ranking para este filtro.</p>}
            </div>
            <div className="analytics-pagination">
              <button type="button" disabled={rankingPaginated.page <= 1} onClick={() => setRankingPage((p) => Math.max(1, p - 1))}>
                Anterior
              </button>
              <span>Pagina {rankingPaginated.page} de {rankingPaginated.totalPages}</span>
              <button type="button" disabled={rankingPaginated.page >= rankingPaginated.totalPages} onClick={() => setRankingPage((p) => p + 1)}>
                Proxima
              </button>
            </div>
          </section>
        )}

        {activeTab === 'assinaturas' && (
          <section className="dashboard-sec">
            <div className="dashboard-sec-head">
              <h2>Assinaturas por usuario</h2>
              <small>
                "Restante agora" e a data de expiracao vem do cadastro (renovacoes somam 30 em 30 dias). A coluna de estimativa so conta pagamentos
                dentro do periodo filtrado - nao e o saldo de tempo.
              </small>
            </div>
            <div className="analytics-toolbar">
              <input
                type="text"
                placeholder="Buscar usuario..."
                value={subsSearch}
                onChange={(e) => setSubsSearch(e.target.value)}
              />
            </div>
            <div className="analytics-table">
              <div className="analytics-row analytics-row--head analytics-row--subs">
                <span>Usuario</span>
                <span>No. assinaturas</span>
                <span>Total gasto</span>
                <span>Preco medio</span>
                <span title={TITLE_COL_ESTIMATIVA}>No periodo (~30d/pg)</span>
                <span>Restante agora</span>
                <span>Status</span>
                <span>Ultima compra</span>
              </div>
              {subsPaginated.rows.map((row) => {
                const rest = formatarTempoRestanteAssinatura(row.memberUntil, Date.now());
                const restTxt = row.status === 'ativo' && rest.ativo ? rest.texto : '--';
                return (
                <button type="button" key={row.uid} className="analytics-row analytics-row--subs analytics-row--click" onClick={() => setSelectedUid(row.uid)}>
                  <span>{formatUserDisplayFromMixed(row)}</span>
                  <span>{row.count || 0}</span>
                  <span>{brl(row.totalSpent || 0)}</span>
                  <span>{brl(row.averagePrice || 0)}</span>
                  <span title={TITLE_COL_ESTIMATIVA}>{textoEstimativaPagamentosNoFiltro(row)}</span>
                  <span className="analytics-cell-muted analytics-cell-stack">
                    <span>{restTxt}</span>
                    {row.status === 'ativo' && row.memberUntil && rest.ativo && (
                      <small className="analytics-expira">
                        ate {formatarDataHoraBr(row.memberUntil, { seVazio: '' })}
                      </small>
                    )}
                  </span>
                  <span>
                    <i className={`status-dot ${row.status === 'ativo' ? 'active' : 'expired'}`} />
                    {row.status === 'ativo' ? 'Ativo' : 'Expirado'}
                  </span>
                  <span>{formatarDataHoraBr(row.lastAt, { seVazio: '--' })}</span>
                </button>
              );})}
              {!subsPaginated.rows.length && <p className="dashboard-empty">Sem assinaturas para este recorte.</p>}
            </div>
            <div className="analytics-pagination">
              <button type="button" disabled={subsPaginated.page <= 1} onClick={() => setSubsPage((p) => Math.max(1, p - 1))}>
                Anterior
              </button>
              <span>Pagina {subsPaginated.page} de {subsPaginated.totalPages}</span>
              <button type="button" disabled={subsPaginated.page >= subsPaginated.totalPages} onClick={() => setSubsPage((p) => p + 1)}>
                Proxima
              </button>
            </div>
          </section>
        )}

        {activeTab === 'doacoes' && (
          <section className="dashboard-sec">
            <div className="dashboard-sec-head">
              <h2>Doacoes por usuario</h2>
              <small>Frequencia, ticket medio e data da ultima contribuicao</small>
            </div>
            <div className="analytics-toolbar">
              <input
                type="text"
                placeholder="Buscar usuario..."
                value={doaSearch}
                onChange={(e) => setDoaSearch(e.target.value)}
              />
            </div>
            <div className="analytics-table">
              <div className="analytics-row analytics-row--head analytics-row--don">
                <span>Usuario</span>
                <span>No. doacoes</span>
                <span>Total doado</span>
                <span>Media por doacao</span>
                <span>Ultima doacao</span>
              </div>
              {doaPaginated.rows.map((row) => (
                <button type="button" key={row.uid} className="analytics-row analytics-row--don analytics-row--click" onClick={() => setSelectedUid(row.uid)}>
                  <span>{formatUserDisplayFromMixed(row)}</span>
                  <span>{row.count || 0}</span>
                  <span>{brl(row.totalSpent || 0)}</span>
                  <span>{brl(row.averageDonation || 0)}</span>
                  <span>{formatarDataHoraBr(row.lastAt, { seVazio: '--' })}</span>
                </button>
              ))}
              {!doaPaginated.rows.length && <p className="dashboard-empty">Sem doacoes para este recorte.</p>}
            </div>
            <div className="analytics-pagination">
              <button type="button" disabled={doaPaginated.page <= 1} onClick={() => setDoaPage((p) => Math.max(1, p - 1))}>
                Anterior
              </button>
              <span>Pagina {doaPaginated.page} de {doaPaginated.totalPages}</span>
              <button type="button" disabled={doaPaginated.page >= doaPaginated.totalPages} onClick={() => setDoaPage((p) => p + 1)}>
                Proxima
              </button>
            </div>
          </section>
        )}

        {activeTab === 'aquisicao' && (
          <>
            <section className="dashboard-sec">
              <div className="dashboard-sec-head">
                <h2>Aquisicao por Promocao</h2>
                <small>Da notificacao por e-mail ate pagamento aprovado</small>
              </div>
              <div className="dashboard-kpis">
                <article className="kpi-card">
                  <h3>Emails enviados</h3>
                  <strong>{acquisition.promo?.sentEmails || 0}</strong>
                  <small>Campanhas promocionais no periodo</small>
                </article>
                <article className="kpi-card">
                  <h3>Cliques no link</h3>
                  <strong>{acquisition.promo?.promoLandingClicks || 0}</strong>
                  <small>Unicos: {acquisition.promo?.promoLandingUniqueClicks || 0}</small>
                </article>
                <article className="kpi-card">
                  <h3>Checkouts iniciados</h3>
                  <strong>{acquisition.promo?.premiumCheckoutsFromPromoEmail || 0}</strong>
                  <small>Origem: promo_email</small>
                </article>
                <article className="kpi-card">
                  <h3>Pagamentos aprovados</h3>
                  <strong>{acquisition.promo?.premiumPaymentsFromPromoEmail || 0}</strong>
                  <small>{brl(acquisition.promo?.premiumRevenueFromPromoEmail || 0)}</small>
                </article>
              </div>
            </section>

            <section className="dashboard-sec">
              <div className="dashboard-sec-head">
                <h2>Aquisicao por Notificacao de Capitulo</h2>
                <small>Comparativo notificados x leitura normal</small>
              </div>
              <div className="dashboard-kpis">
                <article className="kpi-card">
                  <h3>Emails de capitulo</h3>
                  <strong>{acquisition.chapter?.sentEmails || 0}</strong>
                  <small>Notificacoes enviadas</small>
                </article>
                <article className="kpi-card">
                  <h3>Leituras via e-mail</h3>
                  <strong>{acquisition.chapter?.chapterReadsFromEmail || 0}</strong>
                  <small>{acquisition.chapter?.chapterReadsFromEmailPct || 0}% das leituras rastreadas</small>
                </article>
                <article className="kpi-card">
                  <h3>Leituras normais</h3>
                  <strong>{acquisition.chapter?.chapterReadsNormal || 0}</strong>
                  <small>Total rastreado: {acquisition.chapter?.chapterReadsTotal || 0}</small>
                </article>
                <article className="kpi-card">
                  <h3>Premium vindo de capitulo</h3>
                  <strong>{acquisition.chapter?.premiumPaymentsFromChapterEmail || 0}</strong>
                  <small>{brl(acquisition.chapter?.premiumRevenueFromChapterEmail || 0)}</small>
                </article>
              </div>
            </section>

            <section className="dashboard-sec">
              <div className="dashboard-sec-head">
                <h2>Receita por promocao</h2>
                <small>Receita por promocao e pagamentos atribuidos</small>
              </div>
              <div className="analytics-table">
                <div className="analytics-row analytics-row--head analytics-row--campaign">
                  <span>Campanha</span>
                  <span>Pagamentos</span>
                  <span>Via e-mail promo</span>
                  <span>Receita</span>
                  <span>Score</span>
                </div>
                {(acquisition.promo?.campaigns || []).map((row) => (
                  <div key={row.campaignId} className="analytics-row analytics-row--campaign">
                    <span>{row.promoName || row.promoId || row.campaignId || 'Sem campanha'}</span>
                    <span>{row.payments || 0}</span>
                    <span>{row.fromPromoEmailPayments || 0}</span>
                    <span>{brl(row.revenue || 0)}</span>
                    <span>
                      {(() => {
                        const score = scoreFromPercent(
                          percentOf(row.fromPromoEmailPayments || 0, row.payments || 0)
                        );
                        return <i className={`score-badge tone-${score.tone}`}>{score.grade}</i>;
                      })()}
                    </span>
                  </div>
                ))}
                {!acquisition.promo?.campaigns?.length && (
                <p className="dashboard-empty">Sem campanhas com dados neste periodo.</p>
                )}
              </div>
            </section>

            <section className="dashboard-sec">
              <div className="dashboard-sec-head">
                <h2>Funil de Conversao</h2>
                <small>Leitura rapida de eficiencia por canal</small>
              </div>
              <div className="conversion-score-grid">
                <article className={`conversion-score-card tone-${promoScore.tone}`}>
                  <p>Score da Campanha Promo</p>
                  <strong>{promoScore.grade}</strong>
                  <span>
                    {promoFunnel.paidFromSent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% pago por e-mail enviado ? {promoScore.label}
                  </span>
                </article>
                <article className={`conversion-score-card tone-${chapterScore.tone}`}>
                  <p>Score da Notificacao de Capitulo</p>
                  <strong>{chapterScore.grade}</strong>
                  <span>
                    {chapterFunnel.readShare.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% de leitura via e-mail ? {chapterScore.label}
                  </span>
                </article>
              </div>
              <div className="conversion-funnel-grid">
                <article className="conversion-card">
                  <h3>Promocao (e-mail)</h3>
                  <div className="conversion-kpis">
                    <p>CTR: <strong>{promoFunnel.ctr.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
                    <p>Clique para checkout: <strong>{promoFunnel.clickToCheckout.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
                    <p>Checkout para pago: <strong>{promoFunnel.checkoutToPaid.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
                    <p>Pago / Enviado: <strong>{promoFunnel.paidFromSent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
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
                  <h3>Capitulo (notificacao)</h3>
                  <div className="conversion-kpis">
                    <p>CTR: <strong>{chapterFunnel.ctr.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
                    <p>Clique para leitura: <strong>{chapterFunnel.clickToRead.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
                    <p>Leitura via e-mail / Total: <strong>{chapterFunnel.readShare.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
                    <p>Leituras normais: <strong>{chapterFunnel.readsNormal}</strong></p>
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
            </section>
          </>
        )}
      </section>

      {selectedUid && (
        <div className="analytics-modal-backdrop" onClick={() => setSelectedUid('')} role="presentation">
          <section className="analytics-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header>
                <h3>{formatUserDisplayFromMixed(selectedUser)} - Historico financeiro</h3>
              <button type="button" onClick={() => setSelectedUid('')}>Fechar</button>
            </header>
            <div className="analytics-modal-body">
              <article>
                  <h4>Historico de assinaturas</h4>
                <ul>
                  {(selectedHistory?.subscriptions || []).map((item) => (
                    <li key={`sub-${item.at}-${item.amount}`}>
                      <span>{formatarDataHoraBr(item.at, { seVazio: '--' })}</span>
                      <strong>{brl(item.amount)}</strong>
                        <em>{item.isPromotion ? `Promocao${item.promoName ? `: ${item.promoName}` : ''}` : 'Preco base'}</em>
                    </li>
                  ))}
                  {!selectedHistory?.subscriptions?.length && <li>Sem assinaturas nesse periodo.</li>}
                </ul>
              </article>
              <article>
                  <h4>Historico de doacoes</h4>
                <ul>
                  {(selectedHistory?.donations || []).map((item) => (
                    <li key={`doa-${item.at}-${item.amount}`}>
                      <span>{formatarDataHoraBr(item.at, { seVazio: '--' })}</span>
                      <strong>{brl(item.amount)}</strong>
                        <em>{item.origem || 'Doacao'}</em>
                    </li>
                  ))}
                  {!selectedHistory?.donations?.length && <li>Sem doacoes nesse periodo.</li>}
                </ul>
              </article>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}


