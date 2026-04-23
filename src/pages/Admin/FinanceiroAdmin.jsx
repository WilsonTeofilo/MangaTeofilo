import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { labelPrecoPremium } from '../../config/premiumAssinatura';
import {
  PRECO_BASE,
  PROMO_TEMPLATES,
  avisosAntesPublicarComEmail,
  downloadCsv,
  humanizarDuracaoMs,
  statusCampanhaDerivado,
  textoResumoEmailPromocao,
  toDatetimeLocal,
} from './financeiroAdminUtils';
import useFinanceiroPromoPanel from './hooks/useFinanceiroPromoPanel';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { formatarDataHoraSegBr } from '../../utils/datasBr';
import { brl, formatMonthKeyBr, linePath, pct } from './dashboardAdminUtils';
import './FinanceiroAdmin.css';

const adminDashboardResumo = httpsCallable(functions, 'adminDashboardResumo');
const adminAuditCreatorLedgerReconciliation = httpsCallable(functions, 'adminAuditCreatorLedgerReconciliation');
const adminRepairCreatorLifetimeNet = httpsCallable(functions, 'adminRepairCreatorLifetimeNet');
const adminObterPromocaoPremium = httpsCallable(functions, 'adminObterPromocaoPremium');
const adminSalvarPromocaoPremium = httpsCallable(functions, 'adminSalvarPromocaoPremium');

/** Se o campo de início está claramente "velho" (ex.: página aberta há minutos), alinhar ao relógio atual. */
const MARGEM_INICIO_NO_PASSADO_MS = 2 * 60 * 1000;

/** Ao salvar campanha nova: início muito no passado vira "agora" (evita promo de 10 min virar 2 por campo desatualizado). */
const AJUSTE_INICIO_AO_SALVAR_MS = 3 * 60 * 1000;

/** Segunda confirmação ao publicar com e-mail se a janela útil for curta ou o desconto for mínimo. */
const MS_PROMO_CONFIRMA_CURTA = 6 * 60 * 60 * 1000;
export default function FinanceiroAdmin() {
  const navigate = useNavigate();
  const [aba, setAba] = useState('visao');
  const [nowMs, setNowMs] = useState(Date.now());
  const [loadingPromo, setLoadingPromo] = useState(false);
  const [msgPromo, setMsgPromo] = useState('');
  const [promoAtual, setPromoAtual] = useState(null);
  const [promoHistory, setPromoHistory] = useState([]);
  const [lastCampaign, setLastCampaign] = useState(null);
  const [currentPerformance, setCurrentPerformance] = useState(null);
  const [templateAtivo, setTemplateAtivo] = useState('');

  const [promoNome, setPromoNome] = useState('Campanha Premium MangaTeofilo');
  const [promoMensagem, setPromoMensagem] = useState('');
  const [promoPreco, setPromoPreco] = useState('19.90');
  const [promoInicio, setPromoInicio] = useState(() => toDatetimeLocal(Date.now()));
  const [durDias, setDurDias] = useState('0');
  const [durHoras, setDurHoras] = useState('24');
  const [durMin, setDurMin] = useState('0');
  const [durSeg, setDurSeg] = useState('0');
  const [notifyUsers, setNotifyUsers] = useState(true);
  const [modalCampanha, setModalCampanha] = useState({ aberto: false, titulo: '', detalhes: '' });
  const [durPreset, setDurPreset] = useState('24h');
  const [configHint, setConfigHint] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditMsg, setAuditMsg] = useState('');
  const [auditNote, setAuditNote] = useState('');
  const [auditSummary, setAuditSummary] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [auditCreatorId, setAuditCreatorId] = useState('');
  const [auditMaxCreators, setAuditMaxCreators] = useState('80');
  const [repairCreatorId, setRepairCreatorId] = useState('');
  const [repairAdjustAvailable, setRepairAdjustAvailable] = useState(false);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairResult, setRepairResult] = useState(null);
  const [repairMsg, setRepairMsg] = useState('');
  const [financeSummary, setFinanceSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const exportarHistoricoCampanhasCsv = () => {
    downloadCsv(
      'premium-campaign-history.csv',
      ['promoId', 'name', 'status', 'priceBRL', 'startsAt', 'endsAt', 'sentEmails', 'clicks', 'checkouts', 'payments', 'revenue'],
      promoHistory.map((camp) => {
        const perf = camp?.performance || {};
        return [
          camp?.promoId || '',
          camp?.name || '',
          statusCampanhaDerivado(camp, nowMs),
          Number(camp?.priceBRL || 0).toFixed(2),
          formatarDataHoraSegBr(camp?.startsAt, { seVazio: '' }),
          formatarDataHoraSegBr(camp?.endsAt, { seVazio: '' }),
          Number(perf?.sentEmails || 0),
          Number(perf?.clicks || 0),
          Number(perf?.checkouts || 0),
          Number(perf?.payments || 0),
          Number(perf?.revenue || 0).toFixed(2),
        ];
      })
    );
  };

  useEffect(() => {
    const temPromoComTempo = Boolean(promoAtual?.startsAt) && Boolean(promoAtual?.endsAt);
    if (aba !== 'visao' || !temPromoComTempo) return undefined;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      setNowMs(Date.now());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [aba, promoAtual?.startsAt, promoAtual?.endsAt]);

  const duracaoMs = useMemo(() => {
    const d = Number(durDias || 0);
    const h = Number(durHoras || 0);
    const m = Number(durMin || 0);
    const s = Number(durSeg || 0);
    return (
      Math.max(0, d) * 24 * 60 * 60 * 1000 +
      Math.max(0, h) * 60 * 60 * 1000 +
      Math.max(0, m) * 60 * 1000 +
      Math.max(0, s) * 1000
    );
  }, [durDias, durHoras, durMin, durSeg]);

  const precoNumerico = useMemo(
    () => Number(String(promoPreco || '').replace(',', '.')),
    [promoPreco]
  );

  const carregarPromo = async () => {
    setLoadingPromo(true);
    setMsgPromo('');
    try {
      const { data } = await adminObterPromocaoPremium();
      const promo = data?.parsedPromo || null;
      setPromoAtual(promo);
      setPromoHistory(Array.isArray(data?.promoHistory) ? data.promoHistory : []);
      setLastCampaign(data?.lastCampaign || null);
      setCurrentPerformance(data?.currentPerformance || null);
      if (promo) {
        setPromoNome(promo.name || 'Campanha Premium MangaTeofilo');
        setPromoMensagem(promo.message || '');
        setPromoPreco(String(promo.priceBRL));
        setPromoInicio(toDatetimeLocal(promo.startsAt || Date.now()));
      } else {
        setPromoInicio(toDatetimeLocal(Date.now()));
      }
    } catch (err) {
      setMsgPromo(mensagemErroCallable(err));
    } finally {
      setLoadingPromo(false);
    }
  };

  useEffect(() => {
    carregarPromo().catch(() => {});
  }, []);

  useEffect(() => {
    const carregarResumo = async () => {
      setLoadingSummary(true);
      try {
        const agora = Date.now();
        const { data } = await adminDashboardResumo({
          startAt: agora - 30 * 86400000,
          endAt: agora,
        });
        setFinanceSummary(data || null);
      } catch {
        setFinanceSummary(null);
      } finally {
        setLoadingSummary(false);
      }
    };
    carregarResumo().catch(() => {});
  }, []);

  const salvarPromo = async () => {
    setLoadingPromo(true);
    setMsgPromo('');
    try {
      let inicio = new Date(promoInicio).getTime();
      if (!Number.isFinite(inicio)) {
        setMsgPromo('Data de início inválida.');
        setLoadingPromo(false);
        return;
      }
      const agora = Date.now();
      if (!promoAtual && inicio < agora - AJUSTE_INICIO_AO_SALVAR_MS) {
        inicio = agora;
      }
      if (duracaoMs <= 0) {
        setMsgPromo('Defina uma duração maior que zero.');
        setLoadingPromo(false);
        return;
      }
      const fim = inicio + duracaoMs;
      const preco = Number(String(promoPreco).replace(',', '.'));
      if (!Number.isFinite(preco) || preco <= 0) {
        setMsgPromo('Preço promocional inválido.');
        setLoadingPromo(false);
        return;
      }
      if (preco >= PRECO_BASE) {
        setMsgPromo(`O preço promocional precisa ser menor que o preço base (${labelPrecoPremium()}).`);
        setLoadingPromo(false);
        return;
      }
      if (notifyUsers) {
        const avisos = avisosAntesPublicarComEmail(
          agora,
          inicio,
          fim,
          preco,
          PRECO_BASE,
          MS_PROMO_CONFIRMA_CURTA
        );
        if (avisos.length) {
          const ok = window.confirm(
            `Antes de enviar e-mails:\n\n${avisos.map((a) => `• ${a}`).join('\n')}\n\nPublicar e enviar mesmo assim?`
          );
          if (!ok) {
            setLoadingPromo(false);
            return;
          }
        }
      }
      const { data } = await adminSalvarPromocaoPremium({
        enabled: true,
        name: promoNome,
        message: promoMensagem,
        priceBRL: preco,
        startsAt: inicio,
        endsAt: fim,
        notifyUsers,
      });
      await carregarPromo();
      setMsgPromo('');
      setAba('visao');
      setModalCampanha({
        aberto: true,
        titulo: data?.notifyUsers ? 'Campanha lançada' : 'Campanha salva',
        detalhes: data?.notifyUsers
          ? textoResumoEmailPromocao(data?.emailStats)
          : 'Promoção ativa sem envio de e-mail. Use a visão geral para acompanhar o tempo e encerrar quando quiser.',
      });
    } catch (err) {
      setMsgPromo(mensagemErroCallable(err));
    } finally {
      setLoadingPromo(false);
    }
  };

  const {
    promoAtivaAgora,
    promoAgendada,
    simulador,
    fimCampanhaEstimadoMs,
    cenarioRecomendado,
    warningsConfig,
  } = useFinanceiroPromoPanel({
    promoAtual,
    nowMs,
    currentPerformance,
    promoHistory,
    lastCampaign,
    precoNumerico,
    promoInicio,
    duracaoMs,
  });
  const abrirAbaConfigPromo = () => {
    setConfigHint('');
    setPromoInicio((atual) => {
      if (promoAtual) return atual;
      const t = new Date(atual).getTime();
      if (!Number.isFinite(t) || t < Date.now() - MARGEM_INICIO_NO_PASSADO_MS) {
        return toDatetimeLocal(Date.now());
      }
      return atual;
    });
    setAba('config');
  };

  const aplicarPresetDuracao = (id) => {
    setDurPreset(id);
    if (id === '1h') {
      setDurDias('0');
      setDurHoras('1');
      setDurMin('0');
      setDurSeg('0');
    } else if (id === '24h') {
      setDurDias('0');
      setDurHoras('24');
      setDurMin('0');
      setDurSeg('0');
    } else if (id === '3d') {
      setDurDias('3');
      setDurHoras('0');
      setDurMin('0');
      setDurSeg('0');
    }
  };

  const aplicarTemplate = (tpl) => {
    const precoCalc = PRECO_BASE * (1 - tpl.descontoPct / 100);
    setTemplateAtivo(tpl.id);
    setPromoNome(tpl.nome);
    setPromoMensagem(tpl.mensagem);
    setPromoPreco(String(Math.round(precoCalc * 100) / 100));
    setDurDias(String(tpl.dias));
    setDurHoras(String(tpl.horas));
    setDurMin(String(tpl.minutos));
    setDurSeg(String(tpl.segundos));
    if (tpl.dias === 0 && tpl.horas === 1 && tpl.minutos === 0 && tpl.segundos === 0) setDurPreset('1h');
    else if (tpl.dias === 0 && tpl.horas === 24 && tpl.minutos === 0 && tpl.segundos === 0) setDurPreset('24h');
    else if (tpl.dias === 3 && tpl.horas === 0 && tpl.minutos === 0 && tpl.segundos === 0) setDurPreset('3d');
    else setDurPreset('custom');
    setConfigHint('');
    setPromoInicio(toDatetimeLocal(Date.now()));
    setAba('config');
  };

  const marcarDuracaoCustom = () => setDurPreset('custom');

  const recarregarFormularioPromo = () => {
    if (!window.confirm('Descartar alterações não salvas e recarregar os dados do servidor?')) return;
    setConfigHint('');
    carregarPromo();
  };

  const rodarAuditoriaLedger = async () => {
    setAuditMsg('');
    setAuditLoading(true);
    try {
      const cid = String(auditCreatorId || '').trim();
      const maxN = Number(auditMaxCreators);
      const payload = {
        maxCreators: Number.isFinite(maxN) ? maxN : 80,
      };
      if (cid) payload.creatorId = cid;
      const { data } = await adminAuditCreatorLedgerReconciliation(payload);
      if (!data?.ok) {
        setAuditSummary(null);
        setAuditRows([]);
        setAuditNote('');
        setAuditMsg('Resposta inesperada do servidor.');
        return;
      }
      setAuditNote(String(data.note || ''));
      setAuditSummary({
        scanned: Number(data.scanned || 0),
        mismatches: Number(data.mismatches || 0),
      });
      setAuditRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setAuditSummary(null);
      setAuditRows([]);
      setAuditNote('');
      setAuditMsg(mensagemErroCallable(e, 'Não foi possível executar a auditoria.'));
    } finally {
      setAuditLoading(false);
    }
  };

  const preverReparoLifetime = async () => {
    setRepairMsg('');
    setRepairResult(null);
    const cid = String(repairCreatorId || '').trim();
    if (!cid) {
      setRepairMsg('Informe o Creator ID para reparo.');
      return;
    }
    setRepairLoading(true);
    try {
      const { data } = await adminRepairCreatorLifetimeNet({
        creatorId: cid,
        apply: false,
        adjustAvailable: false,
      });
      setRepairResult(data);
    } catch (e) {
      setRepairMsg(mensagemErroCallable(e, 'Não foi possível calcular o reparo.'));
    } finally {
      setRepairLoading(false);
    }
  };

  const aplicarReparoLifetime = async () => {
    setRepairMsg('');
    const cid = String(repairCreatorId || '').trim();
    if (!cid) {
      setRepairMsg('Informe o Creator ID.');
      return;
    }
    const adj = repairAdjustAvailable
      ? '\n\nTambém ajustar "disponível" pelo mesmo Î” (pode errar se já houve saques).'
      : '';
    if (
      !window.confirm(
        `Aplicar reparo em ${cid}? Isto grava lifetimeNetBRL = soma de payments (aprovados, sem refunded).${adj}`
      )
    ) {
      return;
    }
    setRepairLoading(true);
    try {
      const { data } = await adminRepairCreatorLifetimeNet({
        creatorId: cid,
        apply: true,
        adjustAvailable: repairAdjustAvailable,
      });
      setRepairResult(data);
      if (data?.apply && data?.wouldChange === false) {
        setRepairMsg('Nada a alterar (Î” já dentro da tolerância).');
      }
    } catch (e) {
      setRepairMsg(mensagemErroCallable(e, 'Não foi possível aplicar o reparo.'));
    } finally {
      setRepairLoading(false);
    }
  };

  const resumoFinanceiro = financeSummary?.current?.totals || {};
  const premiumBreakdown = financeSummary?.current?.premiumBreakdown || {};
  const novosAssinantesResumo = (financeSummary?.crescimentoPremium || []).reduce(
    (sum, row) => sum + Number(row?.novosVip || 0),
    0
  );
  const topCreatorsFinanceiro = (financeSummary?.analytics?.creatorDashboard?.topByRevenue || []).slice(0, 5);
  const topWorksFinanceiro = (financeSummary?.analytics?.contentDashboard?.topWorksByViews || []).slice(0, 5);
  const topDoadoresFinanceiro = (financeSummary?.current?.topDoadores || []).slice(0, 5);
  const totalFinanceiro = Number(resumoFinanceiro.totalAmount || 0);
  const chartMonths = useMemo(() => {
    const currentRows = financeSummary?.current?.monthlySeries || [];
    const compareRows = financeSummary?.compare?.monthlySeries || [];
    const monthSet = new Set();
    currentRows.forEach((row) => monthSet.add(row.key));
    compareRows.forEach((row) => monthSet.add(row.key));
    const months = [...monthSet].sort();
    const currentByMonth = Object.fromEntries(currentRows.map((row) => [row.key, Number(row.totalAmount || 0)]));
    const compareByMonth = Object.fromEntries(compareRows.map((row) => [row.key, Number(row.totalAmount || 0)]));
    const currentVals = months.map((key) => currentByMonth[key] || 0);
    const compareVals = months.map((key) => compareByMonth[key] || 0);
    return {
      months,
      currentVals,
      compareVals,
      currentPath: linePath(currentVals, 920, 280, 22),
      comparePath: linePath(compareVals, 920, 280, 22),
    };
  }, [financeSummary]);
  const receitaRecorrente = Number(premiumBreakdown.platformAmount || 0) + Number(premiumBreakdown.creatorLinkAmount || 0);
  const statusCampanhaAtual = promoAtual
    ? promoAtivaAgora
      ? 'Ao vivo'
      : promoAgendada
        ? 'Agendada'
        : 'Encerrada'
    : 'Sem campanha';

  return (
    <main className="admin-empty-page">
      <section className="admin-empty-card financeiro-card">
        <header className="financeiro-header">
          <div>
            <h1>Financeiro</h1>
            <p>Receita real da MangaTeofilo, com leitura separada entre plataforma, creators e doacoes.</p>
          </div>
          <div className="financeiro-header-actions">
            <button type="button" className="financeiro-btn-primary" onClick={abrirAbaConfigPromo}>
              Criar nova promoção
            </button>
            <button type="button" onClick={() => navigate('/admin/dashboard')}>
              Voltar ao dashboard
            </button>
          </div>
        </header>

        <section className="financeiro-executive-strip">
          <article className="financeiro-executive-card">
            <span>Receita total</span>
            <strong>{brl(resumoFinanceiro.totalAmount || 0)}</strong>
            <small>{loadingSummary ? 'Atualizando...' : 'Janela padrao: ultimos 30 dias'}</small>
          </article>
          <article className="financeiro-executive-card">
            <span>Assinaturas da plataforma</span>
            <strong>{brl(premiumBreakdown.platformAmount || 0)}</strong>
            <small>{premiumBreakdown.platformCount || 0} pagamentos</small>
          </article>
          <article className="financeiro-executive-card">
            <span>Assinaturas via creators</span>
            <strong>{brl(premiumBreakdown.creatorLinkAmount || 0)}</strong>
            <small>{premiumBreakdown.creatorLinkCount || 0} pagamentos</small>
          </article>
          <article className="financeiro-executive-card">
            <span>Doacoes totais</span>
            <strong>{brl(resumoFinanceiro.apoioAmount || 0)}</strong>
            <small>{resumoFinanceiro.apoioCount || 0} apoios</small>
          </article>
          <article className="financeiro-executive-card">
            <span>Novos assinantes</span>
            <strong>{novosAssinantesResumo || 0}</strong>
            <small>{financeSummary?.comparativo?.deltaPercent == null ? 'Sem comparacao' : `${financeSummary.comparativo.deltaPercent >= 0 ? '+' : ''}${financeSummary.comparativo.deltaPercent}% de crescimento`}</small>
          </article>
        </section>

        <section className="financeiro-breakdown-strip">
          <div>
            <h2>Separacao de receita</h2>
            <p>O financeiro agora responde primeiro: quanto entrou, de onde veio e qual parte veio de links de creators.</p>
          </div>
          <div className="financeiro-breakdown-grid">
            <article>
              <strong>{brl(premiumBreakdown.platformAmount || 0)}</strong>
              <span>Premium da plataforma</span>
            </article>
            <article>
              <strong>{brl(premiumBreakdown.creatorLinkAmount || 0)}</strong>
              <span>Premium via creators</span>
            </article>
            <article>
              <strong>{brl(resumoFinanceiro.apoioAmount || 0)}</strong>
              <span>Doacoes</span>
            </article>
          </div>
        </section>

        <div className="financeiro-tabs">
          <button type="button" className={aba === 'visao' ? 'active' : ''} onClick={() => setAba('visao')}>
            Visão geral
          </button>
          <button type="button" className={aba === 'config' ? 'active' : ''} onClick={abrirAbaConfigPromo}>
            Criar promoção
          </button>
          <button type="button" className={aba === 'integridade' ? 'active' : ''} onClick={() => setAba('integridade')}>
            Integridade (ledger)
          </button>
        </div>

        {aba === 'visao' && (
          <div className="financeiro-promocao financeiro-visao financeiro-ux">
            <div className="financeiro-ux-head">
              <div>
                <h2 className="financeiro-visao-titulo">Resumo executivo</h2>
                <p className="financeiro-visao-sub">
                  Em 5 segundos: quanto entrou, de onde veio, quem puxou a receita e o que merece decisao agora.
                </p>
              </div>
              <div className="financeiro-ux-campaign">
                <span className={`financeiro-pill-status financeiro-pill-status--${promoAtual ? (promoAtivaAgora ? 'active' : promoAgendada ? 'scheduled' : 'ended') : 'draft'}`}>
                  {statusCampanhaAtual}
                </span>
                <strong>{promoAtual?.name || 'Nenhuma campanha ativa'}</strong>
                <small>
                  {promoAtual
                    ? `${labelPrecoPremium(promoAtual.priceBRL)} · ate ${formatarDataHoraSegBr(promoAtual.endsAt, { seVazio: '--' })}`
                    : 'Promocoes ficam na aba de campanha, nao no resumo financeiro.'}
                </small>
              </div>
            </div>

            <section className="financeiro-main-chart-card">
              <div className="financeiro-main-chart-head">
                <div>
                  <h3>Receita ao longo do tempo</h3>
                  <p>Uma linha dominante para acompanhar caixa e comparar janela atual vs anterior.</p>
                </div>
                <div className="financeiro-main-chart-legend">
                  <span><i className="dot-main" /> Atual</span>
                  <span><i className="dot-compare" /> Comparado</span>
                </div>
              </div>
              {chartMonths.months.length ? (
                <>
                  <div className="financeiro-main-chart-wrap">
                    <svg viewBox="0 0 920 280" role="img" aria-label="Grafico de receita mensal">
                      <path d={chartMonths.comparePath} className="line-compare" />
                      <path d={chartMonths.currentPath} className="line-main" />
                    </svg>
                  </div>
                  <div className="financeiro-main-chart-labels">
                    {chartMonths.months.map((key) => (
                      <span key={key}>{formatMonthKeyBr(key)}</span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="promo-timer">Sem dados suficientes para o grafico principal.</p>
              )}
            </section>

            <div className="financeiro-ux-grid">
              <section className="financeiro-summary-panel">
                <div className="financeiro-summary-panel__head">
                  <h3>Breakdown de receita</h3>
                  <small>Sem misturar growth, produto ou manutencao.</small>
                </div>
                <div className="financeiro-breakdown-grid financeiro-breakdown-grid--executive">
                  <article>
                    <strong>{brl(premiumBreakdown.platformAmount || 0)}</strong>
                    <span>Plataforma</span>
                    <small>{totalFinanceiro > 0 ? pct((Number(premiumBreakdown.platformAmount || 0) / totalFinanceiro) * 100) : '--'} do total</small>
                  </article>
                  <article>
                    <strong>{brl(premiumBreakdown.creatorLinkAmount || 0)}</strong>
                    <span>Creators</span>
                    <small>{totalFinanceiro > 0 ? pct((Number(premiumBreakdown.creatorLinkAmount || 0) / totalFinanceiro) * 100) : '--'} do total</small>
                  </article>
                  <article>
                    <strong>{brl(resumoFinanceiro.apoioAmount || 0)}</strong>
                    <span>Doacoes</span>
                    <small>{totalFinanceiro > 0 ? pct((Number(resumoFinanceiro.apoioAmount || 0) / totalFinanceiro) * 100) : '--'} do total</small>
                  </article>
                  <article>
                    <strong>{brl(receitaRecorrente || 0)}</strong>
                    <span>Receita recorrente</span>
                    <small>{resumoFinanceiro.premiumCount || 0} assinaturas aprovadas</small>
                  </article>
                </div>
              </section>

              <section className="financeiro-summary-panel">
                <div className="financeiro-summary-panel__head">
                  <h3>Acoes administrativas</h3>
                  <small>Separadas da leitura financeira.</small>
                </div>
                <div className="financeiro-action-grid">
                  <button type="button" className="financeiro-btn-primary financeiro-btn-cta-lg" onClick={abrirAbaConfigPromo}>
                    Gerenciar campanhas
                  </button>
                  <button type="button" className="financeiro-btn-secondary-lg" onClick={() => navigate('/admin/dashboard?tab=growth')}>
                    Abrir growth
                  </button>
                  <button type="button" className="financeiro-btn-secondary-lg" onClick={() => navigate('/admin/criadores')}>
                    Ver creators
                  </button>
                  <button
                    type="button"
                    className="financeiro-btn-secondary-lg"
                    onClick={exportarHistoricoCampanhasCsv}
                    disabled={!promoHistory.length}
                  >
                    Exportar CSV
                  </button>
                </div>
                {msgPromo && <p className="financeiro-migracao-msg">{msgPromo}</p>}
              </section>
            </div>

            <div className="financeiro-ranking-grid">
              <section className="financeiro-ranking-card">
                <div className="financeiro-summary-panel__head">
                  <h3>Top creators por receita</h3>
                  <small>Quem mais trouxe caixa na janela atual.</small>
                </div>
                <div className="financeiro-ranking-list">
                  {topCreatorsFinanceiro.map((row, index) => (
                    <div key={row.uid} className="financeiro-ranking-row">
                      <span className="financeiro-ranking-rank">{index + 1}</span>
                      <div className="financeiro-ranking-copy">
                        <strong>{row.displayName}</strong>
                        <small>{row.username ? `@${row.username}` : 'sem @username'}</small>
                      </div>
                      <strong>{brl(row.periodRevenue || 0)}</strong>
                    </div>
                  ))}
                  {!topCreatorsFinanceiro.length && <p className="promo-timer">Sem creators com receita nesta janela.</p>}
                </div>
              </section>

              <section className="financeiro-ranking-card">
                <div className="financeiro-summary-panel__head">
                  <h3>Top obras por visualizacao</h3>
                  <small>Contexto rapido para relacionar caixa e produto.</small>
                </div>
                <div className="financeiro-ranking-list">
                  {topWorksFinanceiro.map((row, index) => (
                    <div key={row.workId} className="financeiro-ranking-row">
                      <span className="financeiro-ranking-rank">{index + 1}</span>
                      <div className="financeiro-ranking-copy">
                        <strong>{row.title}</strong>
                        <small>{row.authorUsername ? `@${row.authorUsername}` : row.authorName}</small>
                      </div>
                      <strong>{row.viewsCount || 0}</strong>
                    </div>
                  ))}
                  {!topWorksFinanceiro.length && <p className="promo-timer">Sem obras com tracao suficiente nesta janela.</p>}
                </div>
              </section>

              <section className="financeiro-ranking-card">
                <div className="financeiro-summary-panel__head">
                  <h3>Top doadores</h3>
                  <small>Quem mais apoiou financeiramente.</small>
                </div>
                <div className="financeiro-ranking-list">
                  {topDoadoresFinanceiro.map((row, index) => (
                    <div key={row.uid} className="financeiro-ranking-row">
                      <span className="financeiro-ranking-rank">{index + 1}</span>
                      <div className="financeiro-ranking-copy">
                        <strong>{row.userName || 'Leitor'}</strong>
                        <small>{row.gender || 'nao informado'}</small>
                      </div>
                      <strong>{brl(row.amount || 0)}</strong>
                    </div>
                  ))}
                  {!topDoadoresFinanceiro.length && <p className="promo-timer">Sem doadores na janela selecionada.</p>}
                </div>
              </section>
            </div>
          </div>
        )}

        {aba === 'config' && (
          <div className="financeiro-promocao financeiro-config">
            <h2 className="financeiro-config-titulo">Criar / editar campanha</h2>
            <p className="financeiro-config-lead">
              Fluxo sugerido: template ? preço e tempo ? simulador ? prévia do e-mail abaixo ? publicar (depois use a visão geral para link da Apoie e acompanhamento).
            </p>
            {configHint && (
              <div className="financeiro-config-hint" role="status">
                {configHint}
              </div>
            )}

            <div className="financeiro-resumo-topo">
              <h3 className="financeiro-resumo-topo-titulo">Resumo da campanha</h3>
              <div className="financeiro-resumo-grid">
                <div>
                  <span className="financeiro-resumo-label">Preço</span>
                  <p className="financeiro-resumo-valor">
                    {labelPrecoPremium(PRECO_BASE)} ? <strong>{labelPrecoPremium(precoNumerico)}</strong>
                  </p>
                </div>
                <div>
                  <span className="financeiro-resumo-label">Desconto</span>
                  <p className="financeiro-resumo-valor">
                    <strong>{simulador.descontoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong>
                  </p>
                </div>
                <div>
                  <span className="financeiro-resumo-label">Duração</span>
                  <p className="financeiro-resumo-valor">{humanizarDuracaoMs(duracaoMs)}</p>
                </div>
                <div>
                  <span className="financeiro-resumo-label">Término estimado</span>
                  <p className="financeiro-resumo-valor">
                    {fimCampanhaEstimadoMs ? formatarDataHoraSegBr(fimCampanhaEstimadoMs, { seVazio: '—' }) : '—'}
                  </p>
                </div>
                <div>
                  <span className="financeiro-resumo-label">Impacto estimado (cenário médio)</span>
                  <p className={`financeiro-resumo-valor ${cenarioRecomendado && cenarioRecomendado.delta >= 0 ? 'financeiro-resumo-valor--up' : 'financeiro-resumo-valor--down'}`}>
                    {cenarioRecomendado
                      ? `${cenarioRecomendado.delta >= 0 ? '+' : ''}${labelPrecoPremium(Math.abs(cenarioRecomendado.delta))} vs receita base`
                      : '—'}
                  </p>
                </div>
              </div>
            </div>

            <div className="financeiro-form-section">
              <h3>Templates</h3>
              <p className="financeiro-section-hint">Escolha um ponto de partida; você ajusta tudo depois.</p>
              <div className="financeiro-template-cards">
                {PROMO_TEMPLATES.map((tpl) => (
                  <button
                    type="button"
                    key={tpl.id}
                    className={`financeiro-template-card ${templateAtivo === tpl.id ? 'active' : ''}`}
                    onClick={() => aplicarTemplate(tpl)}
                  >
                    <span className="financeiro-template-card-tag">{tpl.tag}</span>
                    <strong>{tpl.nome}</strong>
                    <span className="financeiro-template-card-hint">{tpl.hint}</span>
                    <span className="financeiro-template-card-meta">~{tpl.descontoPct}% off · {humanizarDuracaoMs(
                      tpl.dias * 86400000 + tpl.horas * 3600000 + tpl.minutos * 60000 + tpl.segundos * 1000
                    )}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="financeiro-form-section">
              <h3>Dados da campanha</h3>
              <div className="financeiro-grid">
                <label>
                  Nome da campanha
                  <input value={promoNome} onChange={(e) => setPromoNome(e.target.value)} />
                </label>
                <label>
                  Preço promocional (R$)
                  <input value={promoPreco} onChange={(e) => setPromoPreco(e.target.value)} inputMode="decimal" />
                </label>
              </div>
              <div className="financeiro-preco-contexto">
                <p>
                  <span>Preço original (base)</span> <strong>{labelPrecoPremium(PRECO_BASE)}</strong>
                </p>
                <p>
                  <span>Preço promocional</span> <strong>{labelPrecoPremium(precoNumerico)}</strong>
                </p>
                <p>
                  <span>Desconto calculado</span>{' '}
                  <strong>{simulador.descontoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong>
                </p>
              </div>
            </div>

            <div className="financeiro-form-section">
              <h3>Tempo</h3>
              <p className="financeiro-section-hint">Presets rápidos ou personalizado (avançado).</p>
              <div className="financeiro-duracao-presets" role="group" aria-label="Duração da promoção">
                {[
                  { id: '1h', label: '1 hora' },
                  { id: '24h', label: '24 horas' },
                  { id: '3d', label: '3 dias' },
                ].map((p) => (
                  <label key={p.id} className={`financeiro-duracao-radio ${durPreset === p.id ? 'checked' : ''}`}>
                    <input
                      type="radio"
                      name="dur-preset"
                      checked={durPreset === p.id}
                      onChange={() => aplicarPresetDuracao(p.id)}
                    />
                    {p.label}
                  </label>
                ))}
                <label className={`financeiro-duracao-radio ${durPreset === 'custom' ? 'checked' : ''}`}>
                  <input
                    type="radio"
                    name="dur-preset"
                    checked={durPreset === 'custom'}
                    onChange={() => setDurPreset('custom')}
                  />
                  Personalizado
                </label>
              </div>
              <div className="financeiro-grid financeiro-grid--tempo">
                <label className="financeiro-grid-full">
                  Início (relógio do dispositivo)
                  <input
                    type="datetime-local"
                    value={promoInicio}
                    onChange={(e) => {
                      marcarDuracaoCustom();
                      setPromoInicio(e.target.value);
                    }}
                  />
                  <small className="financeiro-hint-datetime">
                    Se o início estiver muito no passado ao publicar uma campanha nova, o painel corrige para agora.
                  </small>
                </label>
                {durPreset === 'custom' && (
                  <>
                    <label>
                      Dias
                      <input type="number" min="0" value={durDias} onChange={(e) => { marcarDuracaoCustom(); setDurDias(e.target.value); }} />
                    </label>
                    <label>
                      Horas
                      <input type="number" min="0" value={durHoras} onChange={(e) => { marcarDuracaoCustom(); setDurHoras(e.target.value); }} />
                    </label>
                    <label>
                      Minutos
                      <input type="number" min="0" value={durMin} onChange={(e) => { marcarDuracaoCustom(); setDurMin(e.target.value); }} />
                    </label>
                    <label>
                      Segundos
                      <input type="number" min="0" value={durSeg} onChange={(e) => { marcarDuracaoCustom(); setDurSeg(e.target.value); }} />
                    </label>
                  </>
                )}
              </div>
            </div>

            <div className="financeiro-form-section financeiro-simulador-section">
              <h3>Simulador de impacto</h3>
              <p className="financeiro-section-hint">Use como bússola — o cenário médio costuma ser o mais realista.</p>
              <div className="financeiro-simulador-kpis financeiro-simulador-kpis--lg">
                <article>
                  <small>Desconto aplicado</small>
                  <strong>{simulador.descontoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong>
                </article>
                <article>
                  <small>Base de referência</small>
                  <strong>{simulador.baselineAssinaturas} assinaturas</strong>
                </article>
                <article>
                  <small>Break-even</small>
                  <strong>{simulador.breakEvenAssinaturas} assinaturas</strong>
                </article>
                <article>
                  <small>Receita base</small>
                  <strong>{labelPrecoPremium(simulador.receitaBase)}</strong>
                </article>
              </div>
              <div className="financeiro-simulador-cenarios financeiro-simulador-cenarios--lg">
                {simulador.cenarios.map((c) => (
                  <article key={c.id} className={c.id === 'medio' ? 'financeiro-cenario--pick' : ''}>
                    {c.id === 'medio' && <span className="financeiro-cenario-badge">Recomendado</span>}
                    <h4>{c.nome}</h4>
                    <p>{c.assinaturas} assinaturas estimadas</p>
                    <strong>{labelPrecoPremium(c.receita)}</strong>
                    <small className={c.delta >= 0 ? 'ok' : 'bad'}>
                      {c.delta >= 0 ? '+' : ''}{labelPrecoPremium(Math.abs(c.delta))} vs base
                    </small>
                  </article>
                ))}
              </div>
              {!!warningsConfig.length && (
                <ul className="financeiro-alertas">
                  {warningsConfig.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="financeiro-form-section">
              <h3>Comunicação</h3>
              <div className="financeiro-grid">
                <label className="financeiro-grid-full">
                  Mensagem do e-mail promocional (opcional)
                  <textarea
                    rows={3}
                    value={promoMensagem}
                    onChange={(e) => setPromoMensagem(e.target.value)}
                    placeholder="Ex.: Promoção relâmpago para virar Nobre da Tempestade."
                  />
                </label>
              </div>
              <div className="financeiro-email-preview">
                <span className="financeiro-email-preview-label">Prévia do e-mail</span>
                <p className="financeiro-email-preview-subject">
                  Assunto: <strong>{promoNome || 'Campanha Premium MangaTeofilo'}</strong>
                </p>
                <div className="financeiro-email-preview-body">
                  {promoMensagem?.trim()
                    ? promoMensagem
                    : 'Sua mensagem aparece aqui. Quem recebe clica no link rastreado para cair na página Apoie com a promo aplicada.'}
                </div>
              </div>
              <label className="financeiro-check">
                <input
                  type="checkbox"
                  checked={notifyUsers}
                  onChange={(e) => setNotifyUsers(e.target.checked)}
                />
                Enviar e-mail aos usuários ao publicar (desmarque para só ativar preço no checkout)
              </label>
            </div>

            <div className="financeiro-acoes financeiro-acoes--config">
              <button
                type="button"
                className="financeiro-btn-primary financeiro-btn-cta-lg"
                disabled={loadingPromo}
                onClick={salvarPromo}
              >
                {loadingPromo ? 'Publicando...' : 'Publicar campanha'}
              </button>
              <button
                type="button"
                className="financeiro-btn-secondary-lg"
                disabled={loadingPromo}
                onClick={recarregarFormularioPromo}
                title="Recarrega nome, preço e datas a partir do servidor."
              >
                Descartar e recarregar
              </button>
            </div>
            {msgPromo && <p className="financeiro-migracao-msg">{msgPromo}</p>}
          </div>
        )}

        {aba === 'integridade' && (
          <div className="financeiro-migracao financeiro-integridade">
            <h2>Auditoria de ledger (somente leitura)</h2>
            <p className="financeiro-migracao-texto">
              Compara a soma de <code className="financeiro-inline-code">creatorData/.../payments</code> (aprovados, sem
              refunded) com <code className="financeiro-inline-code">lifetimeNetBRL</code>. Serve como alerta — não altera
              saldos.
            </p>
            <div className="financeiro-grid financeiro-integridade-form">
              <label>
                Creator ID (opcional)
                <input
                  type="text"
                  value={auditCreatorId}
                  onChange={(e) => setAuditCreatorId(e.target.value)}
                  placeholder="Deixe vazio para varrer vários criadores"
                  autoComplete="off"
                />
              </label>
              <label>
                Máx. criadores a varrer
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={auditMaxCreators}
                  onChange={(e) => setAuditMaxCreators(e.target.value)}
                />
              </label>
            </div>
            <div className="financeiro-acoes financeiro-acoes--config">
              <button
                type="button"
                className="financeiro-btn-primary financeiro-btn-cta-lg"
                disabled={auditLoading}
                onClick={rodarAuditoriaLedger}
              >
                {auditLoading ? 'A executar...' : 'Executar auditoria'}
              </button>
            </div>
            {auditNote ? <p className="financeiro-migracao-texto financeiro-integridade-note">{auditNote}</p> : null}
            {auditSummary ? (
              <p className="financeiro-migracao-texto">
                Varredura: <strong>{auditSummary.scanned}</strong> criador(es) · divergências (Î” &gt; R$ 0,05):{' '}
                <strong>{auditSummary.mismatches}</strong>
              </p>
            ) : null}
            {auditMsg ? <p className="financeiro-migracao-msg">{auditMsg}</p> : null}
            {auditRows.length > 0 ? (
              <div className="financeiro-integridade-table-wrap">
                <table className="financeiro-integridade-table">
                  <thead>
                    <tr>
                      <th>Creator</th>
                      <th>Soma payments</th>
                      <th>lifetimeNet</th>
                      <th>Disponível</th>
                      <th>Pendente</th>
                      <th>Î” (soma âˆ’ lifetime)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((r) => (
                      <tr key={r.creatorId} className={r.mismatch ? 'financeiro-integridade-row--warn' : ''}>
                        <td>
                          <code className="financeiro-inline-code">{r.creatorId}</code>
                        </td>
                        <td>{Number(r.sumPaymentAmounts || 0).toFixed(2)}</td>
                        <td>{Number(r.lifetimeNetBRL || 0).toFixed(2)}</td>
                        <td>{Number(r.availableBRL || 0).toFixed(2)}</td>
                        <td>{Number(r.pendingPayoutBRL || 0).toFixed(2)}</td>
                        <td>{Number(r.deltaSumVsLifetime || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="financeiro-grid financeiro-integridade-form">
              <label>
                Creator ID (obrigatório)
                <input
                  type="text"
                  value={repairCreatorId}
                  onChange={(e) => setRepairCreatorId(e.target.value)}
                  placeholder="UID do criador em creatorData"
                  autoComplete="off"
                />
              </label>
              <label className="financeiro-check financeiro-integridade-check">
                <input
                  type="checkbox"
                  checked={repairAdjustAvailable}
                  onChange={(e) => setRepairAdjustAvailable(e.target.checked)}
                />
                Ao aplicar, também ajustar disponível (availableBRL += Î”)
              </label>
            </div>
            <div className="financeiro-acoes financeiro-acoes--config">
              <button
                type="button"
                className="financeiro-btn-secondary-lg"
                disabled={repairLoading}
                onClick={preverReparoLifetime}
              >
                {repairLoading ? '...' : 'Pré-visualizar'}
              </button>
              <button
                type="button"
                className="financeiro-btn-primary financeiro-btn-cta-lg"
                disabled={repairLoading}
                onClick={aplicarReparoLifetime}
              >
                Aplicar reparo
              </button>
            </div>
            {repairMsg ? <p className="financeiro-migracao-msg">{repairMsg}</p> : null}
            {Array.isArray(repairResult?.warnings) && repairResult.warnings.length > 0 ? (
              <ul className="financeiro-migracao-list financeiro-integridade-warnings">
                {repairResult.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            {repairResult ? (
              <pre className="financeiro-integridade-json">{JSON.stringify(repairResult, null, 2)}</pre>
            ) : null}
          </div>
        )}
      </section>

      {modalCampanha.aberto && (
        <div
          className="financeiro-modal-backdrop"
          role="presentation"
          onClick={() => setModalCampanha({ aberto: false, titulo: '', detalhes: '' })}
        >
          <div
            className="financeiro-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="financeiro-modal-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="financeiro-modal-titulo">{modalCampanha.titulo}</h3>
            <p>{modalCampanha.detalhes}</p>
            <button
              type="button"
              className="financeiro-btn-primary"
              onClick={() => setModalCampanha({ aberto: false, titulo: '', detalhes: '' })}
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </main>
  );
}







