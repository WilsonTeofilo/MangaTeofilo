import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../services/firebase';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { formatarTempoRestanteAssinatura } from '../../utils/assinaturaTempoRestante';
import { formatarDataHoraBr } from '../../utils/datasBr';
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

const DASHBOARD_TABS = ['visao-geral', 'rankings', 'assinaturas', 'doacoes', 'aquisicao'];
const PAGE_SIZE = 10;

function parseTab(value) {
  const t = String(value || '').trim();
  return DASHBOARD_TABS.includes(t) ? t : 'visao-geral';
}

/** Só exibe dd/mm/aaaa no texto; calendário nativo fica oculto (evita MM/DD do Chrome no Windows). */
function DashboardDateInput({ brValue, isoValue, onBrInputChange, onIsoPicked, id, ariaLabelCalendar }) {
  const dateRef = useRef(null);
  const openCalendar = () => {
    const el = dateRef.current;
    if (!el) return;
    try {
      el.showPicker?.();
    } catch {
      el.focus();
      el.click();
    }
  };
  return (
    <div className="dashboard-date-row">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        autoComplete="off"
        value={brValue}
        onChange={onBrInputChange}
        lang="pt-BR"
      />
      <input
        ref={dateRef}
        type="date"
        className="dashboard-date-native-hidden"
        value={isoValue || ''}
        onChange={(e) => onIsoPicked(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        className="dashboard-date-calendar-btn"
        onClick={openCalendar}
        aria-label={ariaLabelCalendar}
        title="Abrir calendário"
      >
        <span aria-hidden="true">📅</span>
      </button>
    </div>
  );
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

/** Texto curto: N pagamentos no filtro × 30d (KPI do período — não espelha memberUntil). */
function textoEstimativaPagamentosNoFiltro(row) {
  const n = Number(row?.count || 0);
  const d = Number(row?.totalDays || 0);
  if (!n) return '—';
  return `${n} pg · ~${d}d`;
}

const TITLE_COL_ESTIMATIVA =
  'Soma 30 dias por cada pagamento Premium entre as datas do filtro. Não é o tempo restante da assinatura — use «Restante agora» e a data de expiração.';

function rankBadge(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `${rank}.`;
}

function percentOf(part, total) {
  const p = Number(part || 0);
  const t = Number(total || 0);
  if (!t || t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((p / t) * 1000) / 10));
}

function sumNovosVip(rows) {
  return (rows || []).reduce((s, r) => s + Number(r?.novosVip || 0), 0);
}

/** Distribuição por sexo usando receita (amount) ou volume (count). */
function distribuicaoSexoReceita(map) {
  const entries = Object.entries(map || {});
  const total = entries.reduce((s, [, v]) => s + Number(v?.amount || 0), 0);
  return entries
    .map(([key, v]) => ({
      key,
      label: formatGender(key),
      amount: Number(v?.amount || 0),
      count: Number(v?.count || 0),
      pct: total > 0 ? (Number(v?.amount || 0) / total) * 100 : 0,
    }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

function sexoBarClass(key) {
  const k = String(key || '');
  if (k === 'masculino') return 'dash-sexo-seg--m';
  if (k === 'feminino') return 'dash-sexo-seg--f';
  if (k === 'outro') return 'dash-sexo-seg--o';
  return 'dash-sexo-seg--ni';
}

function formatPct0(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
}

function scoreFromPercent(percent) {
  const p = Number(percent || 0);
  if (p >= 8) return { grade: 'A', label: 'Excelente', tone: 'a' };
  if (p >= 4) return { grade: 'B', label: 'Muito bom', tone: 'b' };
  if (p >= 2) return { grade: 'C', label: 'Bom', tone: 'c' };
  if (p >= 1) return { grade: 'D', label: 'Baixo', tone: 'd' };
  return { grade: 'E', label: 'Muito baixo', tone: 'e' };
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
    const total = ass + doa;
    if (total <= 0) {
      return { ass, doa, assPct: 0, doaPct: 0, total: 0 };
    }
    const assPct = Math.round((ass / total) * 1000) / 10;
    const doaPct = Math.round((doa / total) * 1000) / 10;
    return { ass, doa, assPct, doaPct, total };
  }, [dados]);

  const distAssinaSexo = useMemo(
    () => distribuicaoSexoReceita(dados?.current?.demografia?.assinaturaPorSexo),
    [dados]
  );
  const distDoaSexo = useMemo(
    () => distribuicaoSexoReceita(dados?.current?.demografia?.doacaoPorSexo),
    [dados]
  );

  const novosVipStats = useMemo(() => {
    const atual = sumNovosVip(dados?.crescimentoPremium);
    const prev = sumNovosVip(dados?.crescimentoPremiumCompare);
    let vsPct = null;
    if (prev > 0) vsPct = Math.round(((atual - prev) / prev) * 1000) / 10;
    else if (atual > 0) vsPct = 100;
    return { atual, prev, vsPct };
  }, [dados]);

  const dashboardInsights = useMemo(() => {
    const lines = [];
    if (!dados?.current) return lines;
    const t = dados.current.totals || {};
    const total = Number(t.totalAmount || 0);
    const prem = Number(t.premiumAmount || 0);
    const apoio = Number(t.apoioAmount || 0);
    if (total <= 0) {
      lines.push('Nenhuma receita no período: amplie as datas ou confira se os pagamentos estão gerando eventos em Finanças.');
      return lines;
    }
    const pPrem = (prem / total) * 100;
    const pApoio = (apoio / total) * 100;
    lines.push(
      `Assinaturas representam ${formatPct0(pPrem)} da receita; doações, ${formatPct0(pApoio)} — fica claro quem puxa o caixa.`
    );
    if (apoio <= 0) {
      lines.push('Nenhuma doação registrada no período. Experimente metas na Apoie, brindes ou menções aos doadores.');
    } else if (pApoio < 12) {
      lines.push('Doações são uma fatia pequena: há espaço para campanhas pontuais sem competir com o Premium.');
    }
    const dp = dados.comparativo?.deltaPercent;
    if (dp != null) {
      if (dp < -8) {
        lines.push(`Receita total caiu ${Math.abs(dp).toFixed(1)}% vs período comparado — vale revisar promoções (Financeiro) e e-mails de aquisição.`);
      } else if (dp > 12) {
        lines.push(`Receita total subiu ${dp.toFixed(1)}% vs comparado — identifique o que mudou (preço, tráfego, campanha) para repetir.`);
      }
    }
    const { atual, vsPct } = novosVipStats;
    if (atual === 0) {
      lines.push('Nenhum novo assinante (primeira compra) no período: foque em tráfego novo ou remarketing.');
    } else if (vsPct != null && vsPct < -25) {
      lines.push(`Novos assinantes desaceleraram (${pct(vsPct)} vs período comparado).`);
    } else if (vsPct != null && vsPct > 30) {
      lines.push(`Novos assinantes aceleraram (${pct(vsPct)} vs período comparado).`);
    }
    return lines.slice(0, 7);
  }, [dados, novosVipStats]);

  const ultimosMesesReceita = useMemo(() => {
    const series = dados?.current?.monthlySeries || [];
    return series.slice(-6);
  }, [dados]);

  const analytics = dados?.analytics || {};
  const acquisition = analytics.acquisition || { promo: {}, chapter: {} };
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

  const promoFunnel = useMemo(() => {
    const sent = Number(acquisition.promo?.sentEmails || 0);
    const clicked = Number(acquisition.promo?.promoLandingClicks || 0);
    const checkout = Number(acquisition.promo?.premiumCheckoutsFromPromoEmail || 0);
    const paid = Number(acquisition.promo?.premiumPaymentsFromPromoEmail || 0);
    return {
      sent,
      clicked,
      checkout,
      paid,
      ctr: percentOf(clicked, sent),
      clickToCheckout: percentOf(checkout, clicked),
      checkoutToPaid: percentOf(paid, checkout),
      paidFromSent: percentOf(paid, sent),
      steps: [
        { id: 'sent', label: 'Enviados', value: sent, barPct: 100 },
        { id: 'clicked', label: 'Cliques', value: clicked, barPct: percentOf(clicked, sent) },
        { id: 'checkout', label: 'Checkout', value: checkout, barPct: percentOf(checkout, sent) },
        { id: 'paid', label: 'Pagos', value: paid, barPct: percentOf(paid, sent) },
      ],
    };
  }, [acquisition.promo]);

  const chapterFunnel = useMemo(() => {
    const sent = Number(acquisition.chapter?.sentEmails || 0);
    const clicked = Number(acquisition.chapter?.chapterLandingClicks || 0);
    const readsEmail = Number(acquisition.chapter?.chapterReadsFromEmail || 0);
    const readsNormal = Number(acquisition.chapter?.chapterReadsNormal || 0);
    const readsTotal = Number(acquisition.chapter?.chapterReadsTotal || readsEmail + readsNormal);
    return {
      sent,
      clicked,
      readsEmail,
      readsNormal,
      readsTotal,
      ctr: percentOf(clicked, sent),
      clickToRead: percentOf(readsEmail, clicked),
      readShare: percentOf(readsEmail, readsTotal),
      steps: [
        { id: 'sent', label: 'Enviados', value: sent, barPct: 100 },
        { id: 'clicked', label: 'Cliques', value: clicked, barPct: percentOf(clicked, sent) },
        { id: 'reads', label: 'Leituras via e-mail', value: readsEmail, barPct: percentOf(readsEmail, sent) },
      ],
    };
  }, [acquisition.chapter]);
  const promoScore = scoreFromPercent(promoFunnel.paidFromSent);
  const chapterScore = scoreFromPercent(chapterFunnel.readShare);

  const runIntegridade = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminDashboardIntegridade();
      const r = data?.integrity || {};
      setOpsMsg(
        `Verificação concluída: ${r.totalEvents || 0} lançamentos analisados. Possíveis problemas: ${r.duplicatePaymentIdsCount || 0} duplicados, ${r.withoutUid || 0} sem usuário, ${r.withoutAmount || 0} sem valor.`
      );
    } catch (e) {
      setOpsMsg(mensagemErroCallable(e));
    }
  };

  const runRollup = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminDashboardRebuildRollup();
      setOpsMsg(`Métricas mensais recalculadas (${data?.months || 0} meses). O gráfico e o resumo por mês devem refletir isso após atualizar a página.`);
    } catch (e) {
      setOpsMsg(mensagemErroCallable(e));
    }
  };

  const runBackfillLegado = async () => {
    setOpsMsg('');
    try {
      const { data } = await adminBackfillEventosLegados();
      setOpsMsg(
        `Histórico corrigido: ${data?.created || 0} lançamento(s) recuperados (${data?.createdPremium || 0} Premium, ${data?.createdApoio || 0} Apoie).`
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
              Controle total das assinaturas, receita e crescimento de Kokuin.
              {dados?.period?.startAt && dados?.period?.endAt
                ? ` Período: ${formatarDataHoraBr(dados.period.startAt, { seVazio: '--' })} até ${formatarDataHoraBr(dados.period.endAt, { seVazio: '--' })}.`
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
            <label htmlFor="dash-date-ini">Início</label>
            <DashboardDateInput
              id="dash-date-ini"
              brValue={startDateBr}
              isoValue={startDate}
              onBrInputChange={(e) => handleDateInput(e.target.value, setStartDateBr, setStartDate)}
              onIsoPicked={(iso) => handleCalendarPick(iso, setStartDateBr, setStartDate)}
              ariaLabelCalendar="Data início — abrir calendário"
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
              ariaLabelCalendar="Data fim — abrir calendário"
            />
          </div>
          <div className="dashboard-filtro-item">
            <label htmlFor="dash-date-cmp-ini">Comparar início (opcional)</label>
            <DashboardDateInput
              id="dash-date-cmp-ini"
              brValue={compareStartBr}
              isoValue={compareStart}
              onBrInputChange={(e) => handleDateInput(e.target.value, setCompareStartBr, setCompareStart)}
              onIsoPicked={(iso) => handleCalendarPick(iso, setCompareStartBr, setCompareStart)}
              ariaLabelCalendar="Comparar início — abrir calendário"
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
              ariaLabelCalendar="Comparar fim — abrir calendário"
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
          <button type="button" className={activeTab === 'aquisicao' ? 'active' : ''} onClick={() => handleTabChange('aquisicao')}>
            Aquisição
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

            <section className="dashboard-sec dashboard-sec--insights">
              <div className="dashboard-sec-head">
                <h2>Insights automáticos</h2>
                <small>Traduz números em decisão — o que está puxando receita e onde agir.</small>
              </div>
              <ul className="dashboard-insights-list">
                {dashboardInsights.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
                {!dashboardInsights.length && (
                  <li className="dashboard-insights-muted">Aplique os filtros e carregue o período para gerar insights.</li>
                )}
              </ul>
            </section>

            <section className="dashboard-sec dashboard-sec--teaser">
              <div className="dashboard-sec-head">
                <h2>Impacto rápido · aquisição por e-mail</h2>
                <small>Pagamentos ligados a promo e a aviso de capítulo (período filtrado)</small>
              </div>
              <div className="dashboard-teaser-kpis">
                <article>
                  <h3>Promoção</h3>
                  <strong>{acquisition.promo?.premiumPaymentsFromPromoEmail || 0}</strong>
                  <small>{brl(acquisition.promo?.premiumRevenueFromPromoEmail || 0)}</small>
                </article>
                <article>
                  <h3>Capítulo</h3>
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
                <h2>Receita Premium por sexo (distribuição)</h2>
                <p className="dash-demografia-hint">% sobre o valor de assinaturas aprovadas no período — perfil com sexo preenchido.</p>
                {!distAssinaSexo.length ? (
                  <p className="dashboard-empty">Sem dados de sexo para assinaturas neste recorte.</p>
                ) : (
                  <>
                    <div className="dash-sexo-stack" role="img" aria-label="Distribuição por sexo nas assinaturas">
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
                <h2>Doações por sexo (distribuição)</h2>
                <p className="dash-demografia-hint">% sobre o valor doado no período.</p>
                {!distDoaSexo.length ? (
                  <p className="dashboard-empty">Nenhuma doação com sexo rastreado — ou ainda não houve doações.</p>
                ) : (
                  <>
                    <div className="dash-sexo-stack" role="img" aria-label="Distribuição por sexo nas doações">
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
                <h3>Média de idade</h3>
                <strong>
                  {dados?.current?.demografia?.mediaIdadeAssinantes ?? '—'} <span className="dash-idade-sep">/</span>{' '}
                  {dados?.current?.demografia?.mediaIdadeDoadores ?? '—'}
                </strong>
                <small>Assinantes · Doadores (quando há ano de nascimento no perfil)</small>
              </article>

              <section className="dashboard-sec dashboard-sec--pizza">
                <h2>Quem domina a receita</h2>
                <p className="dash-demografia-hint">Assinatura recorrente vs doações avulsas no período.</p>
                {pieShare.total <= 0 ? (
                  <p className="dashboard-empty">Sem receita classificada neste período.</p>
                ) : (
                  <div className="pie-wrap pie-wrap--lg">
                    <div
                      className="pie-chart pie-chart--lg"
                      style={{
                        background: `conic-gradient(#ffcc00 0% ${pieShare.assPct}%, #5aa7ff ${pieShare.assPct}% 100%)`,
                      }}
                      aria-label="Distribuição assinatura versus doação"
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
                          Doação: <strong>{brl(pieShare.doa)}</strong>
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
                  <span> novos no período</span>
                  {novosVipStats.vsPct != null && Number.isFinite(novosVipStats.vsPct) && (
                    <span className={`dash-crescimento-vs ${novosVipStats.vsPct >= 0 ? 'dash-delta--up' : 'dash-delta--down'}`}>
                      {' '}· {pct(novosVipStats.vsPct)} vs período de comparação automático
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
                  {!dados?.crescimentoPremium?.length && <li className="dashboard-empty">Sem novos assinantes rastreados mês a mês neste recorte.</li>}
                </ul>
              </section>

              <section className="dashboard-sec dashboard-sec--mensal-destaque">
                <div className="dashboard-sec-head">
                  <h2>Arrecadação mensal</h2>
                  <small>Total, Premium e doações — últimos meses do período</small>
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
                        Doações <strong>{brl(m.apoioAmount || 0)}</strong>
                      </p>
                    </article>
                  ))}
                </div>
                {!ultimosMesesReceita.length && <p className="dashboard-empty">Nenhum mês com movimento no período selecionado.</p>}
              </section>
            </div>

            <section className="dashboard-sec dashboard-sec--top-doadores">
              <div className="dashboard-sec-head">
                <h2>Top doadores</h2>
                <small>Quem mais contribuiu com doações (Apoie) no período</small>
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
                    <span>{idx === 0 ? '🥇' : `${idx + 1}.`}</span>
                    <span>{u.userName || 'Guerreiro'}</span>
                    <span>{formatGender(u.gender || 'nao_informado')}</span>
                    <strong>{brl(u.amount || 0)}</strong>
                  </div>
                ))}
              </div>
              {!dados?.current?.topDoadores?.length && (
                <div className="dashboard-empty-state">
                  <p className="dashboard-empty-title">Nenhum doador ainda neste período</p>
                  <p className="dashboard-empty-text">
                    Isso é normal em recortes curtos ou quando o público ainda não usa a Apoie. Experimente metas visíveis, recompensas exclusivas
                    ou menção aos apoiadores no final dos capítulos.
                  </p>
                </div>
              )}
            </section>

            <details className="dashboard-sec dashboard-sec--sistema">
              <summary className="dashboard-sistema-summary">
                Sistema e manutenção <span className="dashboard-sistema-tag">avançado</span>
              </summary>
              <p className="dashboard-sistema-lead">
                Ferramentas para conferir consistência dos dados e recalcular agregados. Use só se souber o efeito em cada botão.
              </p>
              <div className="dashboard-actions-inline">
                <button type="button" className="dashboard-btn" onClick={runIntegridade}>
                  Verificar dados
                </button>
                <button type="button" className="dashboard-btn" onClick={runRollup}>
                  Recalcular métricas
                </button>
                <button type="button" className="dashboard-btn" onClick={runBackfillLegado}>
                  Corrigir histórico antigo
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
                Última leitura: {dados?.integrity?.totalEvents || 0} eventos no banco · {dados?.integrity?.duplicatePaymentIdsCount || 0} IDs
                duplicados · {dados?.integrity?.withoutUid || 0} sem usuário · {dados?.integrity?.withoutAmount || 0} sem valor.
              </p>
            </details>
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
                <span title={rankingMode === 'assinaturas' ? TITLE_COL_ESTIMATIVA : undefined}>
                  {rankingMode === 'assinaturas' ? 'Est. no filtro' : '—'}
                </span>
                <span>Última atividade</span>
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
                    <span>{row.userName || 'Guerreiro'}</span>
                    <span>{brl(row.totalSpent || 0)}</span>
                    <span>{row.count || 0}</span>
                    <span title={rankingMode === 'assinaturas' ? TITLE_COL_ESTIMATIVA : undefined}>
                      {rankingMode === 'assinaturas' ? textoEstimativaPagamentosNoFiltro(subRef) : '—'}
                    </span>
                    <span>{formatarDataHoraBr(row.lastAt, { seVazio: '--' })}</span>
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
              <small>
                «Restante agora» e a data de expiração vêm do cadastro (renovações somam 30 em 30 dias). A coluna de estimativa só conta pagamentos
                dentro do período filtrado — não é o saldo de tempo.
              </small>
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
                <span title={TITLE_COL_ESTIMATIVA}>No período (~30d/pg)</span>
                <span>Restante agora</span>
                <span>Status</span>
                <span>Última compra</span>
              </div>
              {subsPaginated.rows.map((row) => {
                const rest = formatarTempoRestanteAssinatura(row.memberUntil, Date.now());
                const restTxt = row.status === 'ativo' && rest.ativo ? rest.texto : '—';
                return (
                <button type="button" key={row.uid} className="analytics-row analytics-row--subs analytics-row--click" onClick={() => setSelectedUid(row.uid)}>
                  <span>{row.userName || 'Guerreiro'}</span>
                  <span>{row.count || 0}</span>
                  <span>{brl(row.totalSpent || 0)}</span>
                  <span>{brl(row.averagePrice || 0)}</span>
                  <span title={TITLE_COL_ESTIMATIVA}>{textoEstimativaPagamentosNoFiltro(row)}</span>
                  <span className="analytics-cell-muted analytics-cell-stack">
                    <span>{restTxt}</span>
                    {row.status === 'ativo' && row.memberUntil && rest.ativo && (
                      <small className="analytics-expira">
                        até {formatarDataHoraBr(row.memberUntil, { seVazio: '' })}
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
                  <span>{formatarDataHoraBr(row.lastAt, { seVazio: '--' })}</span>
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

        {activeTab === 'aquisicao' && (
          <>
            <section className="dashboard-sec">
              <div className="dashboard-sec-head">
                <h2>Aquisição por Promoção</h2>
                <small>Da notificação por e-mail até pagamento aprovado</small>
              </div>
              <div className="dashboard-kpis">
                <article className="kpi-card">
                  <h3>Emails enviados</h3>
                  <strong>{acquisition.promo?.sentEmails || 0}</strong>
                  <small>Campanhas promocionais no período</small>
                </article>
                <article className="kpi-card">
                  <h3>Cliques no link</h3>
                  <strong>{acquisition.promo?.promoLandingClicks || 0}</strong>
                  <small>Únicos: {acquisition.promo?.promoLandingUniqueClicks || 0}</small>
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
                <h2>Aquisição por Notificação de Capítulo</h2>
                <small>Comparativo notificados x leitura normal</small>
              </div>
              <div className="dashboard-kpis">
                <article className="kpi-card">
                  <h3>Emails de capítulo</h3>
                  <strong>{acquisition.chapter?.sentEmails || 0}</strong>
                  <small>Notificações enviadas</small>
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
                  <h3>Premium vindo de capítulo</h3>
                  <strong>{acquisition.chapter?.premiumPaymentsFromChapterEmail || 0}</strong>
                  <small>{brl(acquisition.chapter?.premiumRevenueFromChapterEmail || 0)}</small>
                </article>
              </div>
            </section>

            <section className="dashboard-sec">
              <div className="dashboard-sec-head">
                <h2>Performance por Campanha</h2>
                <small>Receita por promoção e pagamentos atribuídos</small>
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
                  <p className="dashboard-empty">Sem campanhas com dados neste período.</p>
                )}
              </div>
            </section>

            <section className="dashboard-sec">
              <div className="dashboard-sec-head">
                <h2>Funil de Conversão</h2>
                <small>Leitura rápida de eficiência por canal</small>
              </div>
              <div className="conversion-score-grid">
                <article className={`conversion-score-card tone-${promoScore.tone}`}>
                  <p>Score da Campanha Promo</p>
                  <strong>{promoScore.grade}</strong>
                  <span>
                    {promoFunnel.paidFromSent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% pago por e-mail enviado · {promoScore.label}
                  </span>
                </article>
                <article className={`conversion-score-card tone-${chapterScore.tone}`}>
                  <p>Score da Notificação de Capítulo</p>
                  <strong>{chapterScore.grade}</strong>
                  <span>
                    {chapterFunnel.readShare.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% de leitura via e-mail · {chapterScore.label}
                  </span>
                </article>
              </div>
              <div className="conversion-funnel-grid">
                <article className="conversion-card">
                  <h3>Promoção (e-mail)</h3>
                  <div className="conversion-kpis">
                    <p>CTR: <strong>{promoFunnel.ctr.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
                    <p>Clique → Checkout: <strong>{promoFunnel.clickToCheckout.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
                    <p>Checkout → Pago: <strong>{promoFunnel.checkoutToPaid.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
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
                  <h3>Capítulo (notificação)</h3>
                  <div className="conversion-kpis">
                    <p>CTR: <strong>{chapterFunnel.ctr.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
                    <p>Clique → Leitura: <strong>{chapterFunnel.clickToRead.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong></p>
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
              <h3>{selectedUser?.userName || 'Usuário'} — Histórico financeiro</h3>
              <button type="button" onClick={() => setSelectedUid('')}>Fechar</button>
            </header>
            <div className="analytics-modal-body">
              <article>
                <h4>Histórico de assinaturas</h4>
                <ul>
                  {(selectedHistory?.subscriptions || []).map((item) => (
                    <li key={`sub-${item.at}-${item.amount}`}>
                      <span>{formatarDataHoraBr(item.at, { seVazio: '--' })}</span>
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
                      <span>{formatarDataHoraBr(item.at, { seVazio: '--' })}</span>
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
