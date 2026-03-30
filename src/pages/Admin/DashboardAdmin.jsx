import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../services/firebase';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import './DashboardAdmin.css';

const adminDashboardResumo = httpsCallable(functions, 'adminDashboardResumo');
const adminDashboardIntegridade = httpsCallable(functions, 'adminDashboardIntegridade');
const adminDashboardRebuildRollup = httpsCallable(functions, 'adminDashboardRebuildRollup');
const adminBackfillEventosLegados = httpsCallable(functions, 'adminBackfillEventosLegados');

function toInputDate(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toBrDate(isoDate) {
  if (!isoDate) return '';
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function maskBrDate(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseBrToIso(brDate) {
  const m = String(brDate || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(yyyy, mm - 1, dd);
  if (
    d.getFullYear() !== yyyy ||
    d.getMonth() !== mm - 1 ||
    d.getDate() !== dd
  ) {
    return '';
  }
  return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function startOfDayMs(dateInput) {
  return new Date(`${dateInput}T00:00:00`).getTime();
}

function endOfDayMs(dateInput) {
  return new Date(`${dateInput}T23:59:59`).getTime();
}

function brl(v) {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBr(ms) {
  if (!ms) return '--';
  try {
    return new Date(ms).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return '--';
  }
}

function formatMonthKeyBr(key) {
  const m = String(key || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return key;
  const y = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(month)) return key;
  return new Date(Date.UTC(y, month - 1, 1)).toLocaleDateString('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

function pct(v) {
  if (v == null) return '--';
  const abs = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${v >= 0 ? '+' : '-'}${abs}%`;
}

function formatGender(g) {
  const map = {
    masculino: 'Masculino',
    feminino: 'Feminino',
    outro: 'Outro',
    nao_informado: 'Não informado',
  };
  return map[g] || 'Não informado';
}

function linePath(values, width, height, pad) {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  const xStep = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * xStep;
      const y = height - pad - ((v || 0) / max) * (height - pad * 2);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

const DASHBOARD_TABS = ['visao-geral', 'rankings', 'assinaturas', 'doacoes'];
const PAGE_SIZE = 10;

function parseTab(value) {
  const t = String(value || '').trim();
  return DASHBOARD_TABS.includes(t) ? t : 'visao-geral';
}

function paginate(rows, page, size = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * size;
  return {
    totalPages,
    page: safePage,
    rows: rows.slice(start, start + size),
  };
}

function formatTempoAssinatura(totalDays) {
  const days = Number(totalDays || 0);
  if (!days) return '--';
  const months = days / 30;
  const m = months.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${m} meses (${days} dias)`;
}

function rankBadge(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `${rank}.`;
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

  const carregar = async () => {
    setErro('');
    setOpsMsg('');
    if (!startDate || !endDate) {
      setErro('Preencha início e fim no formato dd/mm/aaaa.');
      return;
    }
    if ((compareStartBr && !compareStart) || (compareEndBr && !compareEnd)) {
      setErro('Complete as datas de comparação no formato dd/mm/aaaa ou deixe em branco.');
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

  const topSexDoa = useMemo(() => {
    const map = dados?.current?.demografia?.doacaoPorSexo || {};
    return Object.entries(map).sort((a, b) => (b[1]?.amount || 0) - (a[1]?.amount || 0))[0]?.[0] || '--';
  }, [dados]);

  const topSexAssina = useMemo(() => {
    const map = dados?.current?.demografia?.assinaturaPorSexo || {};
    return Object.entries(map).sort((a, b) => (b[1]?.amount || 0) - (a[1]?.amount || 0))[0]?.[0] || '--';
  }, [dados]);

  const lineChart = useMemo(() => {
    const currentRows = dados?.current?.monthlySeries || [];
    const compareRows = dados?.compare?.monthlySeries || [];
    const monthSet = new Set();
    currentRows.forEach((r) => monthSet.add(r.key));
    compareRows.forEach((r) => monthSet.add(r.key));
    const months = [...monthSet].sort();
    const currentByMonth = Object.fromEntries(currentRows.map((r) => [r.key, Number(r.totalAmount || 0)]));
    const compareByMonth = Object.fromEntries(compareRows.map((r) => [r.key, Number(r.totalAmount || 0)]));
    const currentVals = months.map((m) => currentByMonth[m] || 0);
    const compareVals = months.map((m) => compareByMonth[m] || 0);
    return {
      months,
      currentVals,
      compareVals,
      currentPath: linePath(currentVals, 920, 280, 22),
      comparePath: linePath(compareVals, 920, 280, 22),
    };
  }, [dados]);

  const pieShare = useMemo(() => {
    const ass = Number(dados?.current?.assinaturaVsDoacao?.assinatura || 0);
    const doa = Number(dados?.current?.assinaturaVsDoacao?.doacao || 0);
    const total = Math.max(ass + doa, 1);
    const assPct = Math.round((ass / total) * 100);
    return { ass, doa, assPct };
  }, [dados]);

  const analytics = dados?.analytics || {};
  const subscriptionStats = analytics.subscriptionStats || [];
  const donationStats = analytics.donationStats || [];
  const historyByUid = analytics.userHistoryByUid || {};
  const subsByUid = useMemo(
    () => Object.fromEntries(subscriptionStats.map((r) => [r.uid, r])),
    [subscriptionStats]
  );

  const filteredRankingRows = useMemo(() => {
    const base = rankingMode === 'assinaturas' ? subscriptionStats : donationStats;
    const q = rankingSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((row) =>
      String(row.userName || 'Guerreiro').toLowerCase().includes(q)
    );
  }, [rankingMode, rankingSearch, subscriptionStats, donationStats]);

  const filteredSubsRows = useMemo(() => {
    const q = subsSearch.trim().toLowerCase();
    if (!q) return subscriptionStats;
    return subscriptionStats.filter((row) =>
      String(row.userName || 'Guerreiro').toLowerCase().includes(q)
    );
  }, [subsSearch, subscriptionStats]);

  const filteredDoaRows = useMemo(() => {
    const q = doaSearch.trim().toLowerCase();
    if (!q) return donationStats;
    return donationStats.filter((row) =>
      String(row.userName || 'Guerreiro').toLowerCase().includes(q)
    );
  }, [doaSearch, donationStats]);

  const rankingPaginated = useMemo(
    () => paginate(filteredRankingRows, rankingPage),
    [filteredRankingRows, rankingPage]
  );
  const subsPaginated = useMemo(
    () => paginate(filteredSubsRows, subsPage),
    [filteredSubsRows, subsPage]
  );
  const doaPaginated = useMemo(
    () => paginate(filteredDoaRows, doaPage),
    [filteredDoaRows, doaPage]
  );

  useEffect(() => setRankingPage(1), [rankingSearch, rankingMode]);
  useEffect(() => setSubsPage(1), [subsSearch]);
  useEffect(() => setDoaPage(1), [doaSearch]);

  const selectedHistory = selectedUid ? historyByUid[selectedUid] || null : null;
  const selectedUser =
    (selectedUid && (subsByUid[selectedUid] || donationStats.find((d) => d.uid === selectedUid))) || null;

  const runIntegridade = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminDashboardIntegridade();
      const r = data?.integrity || {};
      setOpsMsg(
        `Integridade: ${r.totalEvents || 0} eventos, duplicados: ${r.duplicatePaymentIdsCount || 0}, sem uid: ${r.withoutUid || 0}, sem amount: ${r.withoutAmount || 0}.`
      );
    } catch (e) {
      setOpsMsg(mensagemErroCallable(e));
    }
  };

  const runRollup = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminDashboardRebuildRollup();
      setOpsMsg(`Rollup mensal recalculado para ${data?.months || 0} meses.`);
    } catch (e) {
      setOpsMsg(mensagemErroCallable(e));
    }
  };

  const runBackfillLegado = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminBackfillEventosLegados();
      setOpsMsg(
        `Backfill finalizado: ${data?.created || 0} evento(s) criado(s) (${data?.createdPremium || 0} premium, ${data?.createdApoio || 0} apoio).`
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
            <h1>Dashboard de Monetização</h1>
            <p>
              Controle total das assinaturas, receita e crescimento do Shito.
              {dados?.period?.startAt && dados?.period?.endAt
                ? ` Período: ${formatDateBr(dados.period.startAt)} até ${formatDateBr(dados.period.endAt)}.`
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
              <option value="30d">Últimos 30 dias</option>
              <option value="mesAtual">Mês atual</option>
              <option value="mesAnterior">Mês anterior</option>
              <option value="custom">Customizado</option>
            </select>
          </div>
          <div className="dashboard-filtro-item">
            <label>Início</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/aaaa"
              value={startDateBr}
              onChange={(e) => handleDateInput(e.target.value, setStartDateBr, setStartDate)}
            />
          </div>
          <div className="dashboard-filtro-item">
            <label>Fim</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/aaaa"
              value={endDateBr}
              onChange={(e) => handleDateInput(e.target.value, setEndDateBr, setEndDate)}
            />
          </div>
          <div className="dashboard-filtro-item">
            <label>Comparar início (opcional)</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/aaaa"
              value={compareStartBr}
              onChange={(e) => handleDateInput(e.target.value, setCompareStartBr, setCompareStart)}
            />
          </div>
          <div className="dashboard-filtro-item">
            <label>Comparar fim (opcional)</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/aaaa"
              value={compareEndBr}
              onChange={(e) => handleDateInput(e.target.value, setCompareEndBr, setCompareEnd)}
            />
          </div>
          <button type="button" className="dashboard-btn dashboard-btn-primary" onClick={carregar} disabled={loading}>
            {loading ? 'Aplicando...' : 'Aplicar filtros'}
          </button>
        </div>

        {erro && <p className="dashboard-erro">{erro}</p>}

        <div className="dashboard-content-tabs">
          <button type="button" className={activeTab === 'visao-geral' ? 'active' : ''} onClick={() => handleTabChange('visao-geral')}>
            Visão Geral
          </button>
          <button type="button" className={activeTab === 'rankings' ? 'active' : ''} onClick={() => handleTabChange('rankings')}>
            Rankings
          </button>
          <button type="button" className={activeTab === 'assinaturas' ? 'active' : ''} onClick={() => handleTabChange('assinaturas')}>
            Assinaturas
          </button>
          <button type="button" className={activeTab === 'doacoes' ? 'active' : ''} onClick={() => handleTabChange('doacoes')}>
            Doações
          </button>
        </div>

        {activeTab === 'visao-geral' && (
          <>
            <div className="dashboard-kpis dashboard-kpis--hero">
              <article className="kpi-card kpi-card--revenue">
                <h3>💰 Receita total</h3>
                <strong>{brl(dados?.current?.totals?.totalAmount || 0)}</strong>
                <small>{`vs período comparado: ${pct(dados?.comparativo?.deltaPercent)}`}</small>
              </article>
              <article className="kpi-card kpi-card--vip">
                <h3>🔥 VIPs no período</h3>
                <strong>{dados?.current?.totals?.premiumCount || 0}</strong>
                <small>{brl(dados?.current?.totals?.premiumAmount || 0)}</small>
              </article>
              <article className="kpi-card kpi-card--growth">
                <h3>📈 Crescimento</h3>
                <strong>{pct(dados?.comparativo?.deltaPercent)}</strong>
                <small>{`Diferença absoluta: ${brl(dados?.comparativo?.deltaAmount || 0)}`}</small>
              </article>
              <article className="kpi-card kpi-card--donation">
                <h3>💸 Doações</h3>
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
                  <svg viewBox="0 0 920 280" role="img" aria-label="Gráfico de receita mensal">
                    <path d={lineChart.comparePath} className="line-compare" />
                    <path d={lineChart.currentPath} className="line-main" />
                  </svg>
                  <div className="line-legend">
                    <span><i className="dot-main" /> Período atual</span>
                    <span><i className="dot-compare" /> Período comparado</span>
                  </div>
                </div>
              ) : (
                <p className="dashboard-empty">Sem dados suficientes para o gráfico principal.</p>
              )}
            </section>

            <div className="dashboard-sessoes-grid dashboard-sessoes-grid--three">
              <article className="kpi-card">
                <h3>Sexo que mais doa</h3>
                <strong>{topSexDoa}</strong>
                <small>Base: doações aprovadas no período</small>
              </article>
              <article className="kpi-card">
                <h3>Sexo que mais assina</h3>
                <strong>{topSexAssina}</strong>
                <small>Base: assinatura premium aprovada</small>
              </article>
              <article className="kpi-card">
                <h3>Média de idade</h3>
                <strong>
                  {dados?.current?.demografia?.mediaIdadeAssinantes ?? '--'} / {dados?.current?.demografia?.mediaIdadeDoadores ?? '--'}
                </strong>
                <small>Assinantes / Doadores</small>
              </article>
              <section className="dashboard-sec">
                <h2>Assinatura vs Doação</h2>
                <div className="pie-wrap">
                  <div
                    className="pie-chart"
                    style={{
                      background: `conic-gradient(#ffcc00 ${pieShare.assPct}%, #5aa7ff ${pieShare.assPct}% 100%)`,
                    }}
                    aria-label="Pizza assinatura versus doacao"
                  />
                  <div className="pie-legend">
                    <p><span className="legend-box legend-ass" /> Assinatura: {brl(pieShare.ass)}</p>
                    <p><span className="legend-box legend-doa" /> Doação: {brl(pieShare.doa)}</p>
                  </div>
                </div>
              </section>

              <section className="dashboard-sec">
                <h2>Crescimento de base Premium</h2>
                <ul className="lista-mensal lista-mensal--bars">
                  {(dados?.crescimentoPremium || []).map((row) => (
                    <li key={row.month}>
                      <span>{formatMonthKeyBr(row.month)}</span>
                      <div className="bar-inline">
                        <i style={{ width: `${Math.max(8, Math.min(100, row.novosVip * 10))}%` }} />
                      </div>
                      <strong>{row.novosVip}</strong>
                    </li>
                  ))}
                  {!dados?.crescimentoPremium?.length && <li>Sem dados no período.</li>}
                </ul>
              </section>
              <section className="dashboard-sec">
                <h2>Arrecadação mensal (resumo)</h2>
                <div className="top-table top-table--compact">
                  {(dados?.current?.monthlySeries || []).slice(-6).map((m) => (
                    <div key={m.key} className="top-row">
                      <span>{formatMonthKeyBr(m.key)}</span>
                      <span>Premium: {brl(m.premiumAmount || 0)}</span>
                      <span>Doação: {brl(m.apoioAmount || 0)}</span>
                      <strong>{brl(m.totalAmount || 0)}</strong>
                    </div>
                  ))}
                  {!dados?.current?.monthlySeries?.length && <p>Sem meses no período.</p>}
                </div>
              </section>
            </div>

            <section className="dashboard-sec">
              <h2>Top Doadores</h2>
              <div className="top-table">
                <div className="top-row top-row--head">
                  <span>#</span>
                  <span>Nome</span>
                  <span>Sexo</span>
                  <strong>Total gasto</strong>
                </div>
                {(dados?.current?.topDoadores || []).map((u, idx) => (
                  <div key={u.uid} className={`top-row ${idx === 0 ? 'top-row--winner' : ''}`}>
                    <span>{idx === 0 ? '🥇' : `${idx + 1}.`}</span>
                    <span>{u.userName || 'Guerreiro'}</span>
                    <span>{formatGender(u.gender || 'nao_informado')}</span>
                    <strong>{brl(u.amount || 0)}</strong>
                  </div>
                ))}
                {!dados?.current?.topDoadores?.length && <p>Sem doadores no período selecionado.</p>}
              </div>
            </section>

            <section className="dashboard-sec">
              <h2>Segurança e Escala</h2>
              <div className="dashboard-actions-inline">
                <button type="button" className="dashboard-btn" onClick={runIntegridade}>
                  Rodar checagem de integridade
                </button>
                <button type="button" className="dashboard-btn" onClick={runRollup}>
                  Recalcular rollup mensal
                </button>
                <button type="button" className="dashboard-btn" onClick={runBackfillLegado}>
                  Backfill de eventos legados
                </button>
                <button type="button" className="dashboard-btn" onClick={() => navigate('/admin/financeiro')}>
                  Ir para Financeiro
                </button>
                <button type="button" className="dashboard-btn" onClick={() => navigate('/')}>
                  Voltar para início
                </button>
              </div>
              {opsMsg && <p className="dashboard-ops-msg">{opsMsg}</p>}
              <p className="dashboard-integrity-resumo">
                Integridade atual: eventos {dados?.integrity?.totalEvents || 0}, duplicados{' '}
                {dados?.integrity?.duplicatePaymentIdsCount || 0}, sem uid {dados?.integrity?.withoutUid || 0}, sem amount{' '}
                {dados?.integrity?.withoutAmount || 0}.
              </p>
            </section>
          </>
        )}

        {activeTab === 'rankings' && (
          <section className="dashboard-sec">
            <div className="dashboard-sec-head">
              <h2>Ranking de Receita</h2>
              <small>Top usuários por valor no período selecionado</small>
            </div>
            <div className="analytics-toolbar">
              <div className="analytics-toggle">
                <button type="button" className={rankingMode === 'assinaturas' ? 'active' : ''} onClick={() => setRankingMode('assinaturas')}>
                  Assinaturas
                </button>
                <button type="button" className={rankingMode === 'doacoes' ? 'active' : ''} onClick={() => setRankingMode('doacoes')}>
                  Doações
                </button>
              </div>
              <input
                type="text"
                placeholder="Buscar usuário..."
                value={rankingSearch}
                onChange={(e) => setRankingSearch(e.target.value)}
              />
            </div>
            <div className="analytics-table">
              <div className="analytics-row analytics-row--head analytics-row--rankings">
                <span>Rank</span>
                <span>Usuário</span>
                <span>Total gasto</span>
                <span>Qtd.</span>
                <span>Tempo ativo</span>
                <span>Última atividade</span>
              </div>
              {rankingPaginated.rows.map((row) => {
                const subRef = subsByUid[row.uid] || null;
                const totalDays = subRef?.totalDays || 0;
                return (
                  <button
                    type="button"
                    key={`${rankingMode}-${row.uid}`}
                    className={`analytics-row analytics-row--rankings analytics-row--click ${row.rank <= 3 ? `analytics-row--top${row.rank}` : ''}`}
                    onClick={() => setSelectedUid(row.uid)}
                  >
                    <span>{rankBadge(row.rank)}</span>
                    <span>{row.userName || 'Guerreiro'}</span>
                    <span>{brl(row.totalSpent || 0)}</span>
                    <span>{row.count || 0}</span>
                    <span>{formatTempoAssinatura(totalDays)}</span>
                    <span>{formatDateBr(row.lastAt)}</span>
                  </button>
                );
              })}
              {!rankingPaginated.rows.length && <p className="dashboard-empty">Sem usuários no ranking para este filtro.</p>}
            </div>
            <div className="analytics-pagination">
              <button type="button" disabled={rankingPaginated.page <= 1} onClick={() => setRankingPage((p) => Math.max(1, p - 1))}>
                Anterior
              </button>
              <span>Página {rankingPaginated.page} de {rankingPaginated.totalPages}</span>
              <button type="button" disabled={rankingPaginated.page >= rankingPaginated.totalPages} onClick={() => setRankingPage((p) => p + 1)}>
                Próxima
              </button>
            </div>
          </section>
        )}

        {activeTab === 'assinaturas' && (
          <section className="dashboard-sec">
            <div className="dashboard-sec-head">
              <h2>Assinaturas por usuário</h2>
              <small>Recorrência, valor médio, tempo acumulado e status</small>
            </div>
            <div className="analytics-toolbar">
              <input
                type="text"
                placeholder="Buscar usuário..."
                value={subsSearch}
                onChange={(e) => setSubsSearch(e.target.value)}
              />
            </div>
            <div className="analytics-table">
              <div className="analytics-row analytics-row--head analytics-row--subs">
                <span>Usuário</span>
                <span>Nº assinaturas</span>
                <span>Total gasto</span>
                <span>Preço médio</span>
                <span>Tempo total</span>
                <span>Status</span>
                <span>Última compra</span>
              </div>
              {subsPaginated.rows.map((row) => (
                <button type="button" key={row.uid} className="analytics-row analytics-row--subs analytics-row--click" onClick={() => setSelectedUid(row.uid)}>
                  <span>{row.userName || 'Guerreiro'}</span>
                  <span>{row.count || 0}</span>
                  <span>{brl(row.totalSpent || 0)}</span>
                  <span>{brl(row.averagePrice || 0)}</span>
                  <span>{formatTempoAssinatura(row.totalDays)}</span>
                  <span>
                    <i className={`status-dot ${row.status === 'ativo' ? 'active' : 'expired'}`} />
                    {row.status === 'ativo' ? 'Ativo' : 'Expirado'}
                  </span>
                  <span>{formatDateBr(row.lastAt)}</span>
                </button>
              ))}
              {!subsPaginated.rows.length && <p className="dashboard-empty">Sem assinaturas para este recorte.</p>}
            </div>
            <div className="analytics-pagination">
              <button type="button" disabled={subsPaginated.page <= 1} onClick={() => setSubsPage((p) => Math.max(1, p - 1))}>
                Anterior
              </button>
              <span>Página {subsPaginated.page} de {subsPaginated.totalPages}</span>
              <button type="button" disabled={subsPaginated.page >= subsPaginated.totalPages} onClick={() => setSubsPage((p) => p + 1)}>
                Próxima
              </button>
            </div>
          </section>
        )}

        {activeTab === 'doacoes' && (
          <section className="dashboard-sec">
            <div className="dashboard-sec-head">
              <h2>Doações por usuário</h2>
              <small>Frequência, ticket médio e data da última contribuição</small>
            </div>
            <div className="analytics-toolbar">
              <input
                type="text"
                placeholder="Buscar usuário..."
                value={doaSearch}
                onChange={(e) => setDoaSearch(e.target.value)}
              />
            </div>
            <div className="analytics-table">
              <div className="analytics-row analytics-row--head analytics-row--don">
                <span>Usuário</span>
                <span>Nº doações</span>
                <span>Total doado</span>
                <span>Média por doação</span>
                <span>Última doação</span>
              </div>
              {doaPaginated.rows.map((row) => (
                <button type="button" key={row.uid} className="analytics-row analytics-row--don analytics-row--click" onClick={() => setSelectedUid(row.uid)}>
                  <span>{row.userName || 'Guerreiro'}</span>
                  <span>{row.count || 0}</span>
                  <span>{brl(row.totalSpent || 0)}</span>
                  <span>{brl(row.averageDonation || 0)}</span>
                  <span>{formatDateBr(row.lastAt)}</span>
                </button>
              ))}
              {!doaPaginated.rows.length && <p className="dashboard-empty">Sem doações para este recorte.</p>}
            </div>
            <div className="analytics-pagination">
              <button type="button" disabled={doaPaginated.page <= 1} onClick={() => setDoaPage((p) => Math.max(1, p - 1))}>
                Anterior
              </button>
              <span>Página {doaPaginated.page} de {doaPaginated.totalPages}</span>
              <button type="button" disabled={doaPaginated.page >= doaPaginated.totalPages} onClick={() => setDoaPage((p) => p + 1)}>
                Próxima
              </button>
            </div>
          </section>
        )}
      </section>

      {selectedUid && (
        <div className="analytics-modal-backdrop" onClick={() => setSelectedUid('')} role="presentation">
          <section className="analytics-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>{selectedUser?.userName || 'Usuário'} — Histórico financeiro</h3>
              <button type="button" onClick={() => setSelectedUid('')}>Fechar</button>
            </header>
            <div className="analytics-modal-body">
              <article>
                <h4>Histórico de assinaturas</h4>
                <ul>
                  {(selectedHistory?.subscriptions || []).map((item) => (
                    <li key={`sub-${item.at}-${item.amount}`}>
                      <span>{formatDateBr(item.at)}</span>
                      <strong>{brl(item.amount)}</strong>
                      <em>{item.isPromotion ? `Promoção${item.promoName ? `: ${item.promoName}` : ''}` : 'Preço base'}</em>
                    </li>
                  ))}
                  {!selectedHistory?.subscriptions?.length && <li>Sem assinaturas nesse período.</li>}
                </ul>
              </article>
              <article>
                <h4>Histórico de doações</h4>
                <ul>
                  {(selectedHistory?.donations || []).map((item) => (
                    <li key={`doa-${item.at}-${item.amount}`}>
                      <span>{formatDateBr(item.at)}</span>
                      <strong>{brl(item.amount)}</strong>
                      <em>{item.origem || 'Doação'}</em>
                    </li>
                  ))}
                  {!selectedHistory?.donations?.length && <li>Sem doações nesse período.</li>}
                </ul>
              </article>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
