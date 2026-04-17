import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../services/firebase';
import { labelPrecoPremium } from '../../config/premiumAssinatura';
import {
  PRECO_BASE,
  PROMO_TEMPLATES,
  avisosAntesPublicarComEmail,
  buildApoieTrackedUrl,
  downloadCsv,
  formatarPct1,
  humanizarDuracaoMs,
  kpisPerformance,
  pillClassCampanhaStatus,
  statusCampanhaDerivado,
  textoLogPromocao,
  textoResumoEmailPromocao,
  toDatetimeLocal,
} from './financeiroAdminUtils';
import useFinanceiroPromoPanel from './hooks/useFinanceiroPromoPanel';
import { mensagemErroCallable } from '../../utils/firebaseCallableError';
import { formatarDataHoraSegBr } from '../../utils/datasBr';
import './FinanceiroAdmin.css';

const adminAuditCreatorLedgerReconciliation = httpsCallable(functions, 'adminAuditCreatorLedgerReconciliation');
const adminRepairCreatorLifetimeNet = httpsCallable(functions, 'adminRepairCreatorLifetimeNet');
const adminObterPromocaoPremium = httpsCallable(functions, 'adminObterPromocaoPremium');
const adminSalvarPromocaoPremium = httpsCallable(functions, 'adminSalvarPromocaoPremium');
const adminIncrementarDuracaoPromocaoPremium = httpsCallable(functions, 'adminIncrementarDuracaoPromocaoPremium');
const adminDefinirMetaPromocaoPremium = httpsCallable(functions, 'adminDefinirMetaPromocaoPremium');

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

  const [promoNome, setPromoNome] = useState('Promoção Membro Kokuin');
  const [promoMensagem, setPromoMensagem] = useState('');
  const [promoPreco, setPromoPreco] = useState('19.90');
  const [promoInicio, setPromoInicio] = useState(() => toDatetimeLocal(Date.now()));
  const [durDias, setDurDias] = useState('0');
  const [durHoras, setDurHoras] = useState('24');
  const [durMin, setDurMin] = useState('0');
  const [durSeg, setDurSeg] = useState('0');
  const [notifyUsers, setNotifyUsers] = useState(true);
  const [incDias, setIncDias] = useState('0');
  const [incHoras, setIncHoras] = useState('1');
  const [incMin, setIncMin] = useState('0');
  const [modalCampanha, setModalCampanha] = useState({ aberto: false, titulo: '', detalhes: '' });
  const [durPreset, setDurPreset] = useState('24h');
  const [configHint, setConfigHint] = useState('');
  const [promoActivityLog, setPromoActivityLog] = useState([]);
  const [metaPagamentosInput, setMetaPagamentosInput] = useState('');
  const [salvandoMeta, setSalvandoMeta] = useState(false);
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

  const exportarLogCampanhasCsv = () => {
    downloadCsv(
      'premium-campaign-activity-log.csv',
      ['at', 'action', 'promoId', 'detail'],
      promoActivityLog.map((entry) => [
        formatarDataHoraSegBr(entry?.at, { seVazio: '' }),
        entry?.action || '',
        entry?.promoId || '',
        textoLogPromocao(entry),
      ])
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
      setPromoActivityLog(Array.isArray(data?.promoActivityLog) ? data.promoActivityLog : []);
      setLastCampaign(data?.lastCampaign || null);
      setCurrentPerformance(data?.currentPerformance || null);
      if (promo) {
        setPromoNome(promo.name || 'Promoção Membro Kokuin');
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
    if (!promoAtual?.promoId) {
      setMetaPagamentosInput('');
      return;
    }
    const row = promoHistory.find((h) => h.promoId === promoAtual.promoId);
    setMetaPagamentosInput(row?.goalPayments != null ? String(row.goalPayments) : '');
  }, [promoAtual?.promoId, promoHistory]);

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

  const encerrarPromo = async ({ agendada = false } = {}) => {
    const pergunta = agendada
      ? 'Deseja cancelar esta campanha agendada?'
      : 'Deseja encerrar esta promoção agora?';
    if (!window.confirm(pergunta)) return;
    setLoadingPromo(true);
    setMsgPromo('');
    try {
      await adminSalvarPromocaoPremium({ enabled: false });
      setPromoAtual(null);
      setMsgPromo(
        agendada
          ? 'Campanha agendada cancelada. O checkout segue no preço base.'
          : 'Promoção encerrada. O checkout voltou ao preço base.'
      );
    } catch (err) {
      setMsgPromo(mensagemErroCallable(err));
    } finally {
      setLoadingPromo(false);
    }
  };

  const salvarMetaPagamentos = async () => {
    if (!promoAtivaAgora) {
      setMsgPromo('A meta só pode ser usada com a promoção ao vivo. Na campanha agendada, aguarde o horário de início.');
      return;
    }
    if (!promoAtual?.promoId) {
      setMsgPromo('Não há campanha ativa para associar à meta.');
      return;
    }
    const trimmed = metaPagamentosInput.trim();
    if (trimmed !== '' && (!Number.isFinite(Number(trimmed)) || Number(trimmed) < 0)) {
      setMsgPromo('Meta inválida: use um número inteiro >= 0 ou deixe em branco para limpar.');
      return;
    }
    setSalvandoMeta(true);
    setMsgPromo('');
    try {
      await adminDefinirMetaPromocaoPremium({
        goalPayments: trimmed === '' ? null : Math.floor(Number(trimmed)),
      });
      await carregarPromo();
      setMsgPromo('Meta de pagamentos atualizada.');
    } catch (err) {
      setMsgPromo(mensagemErroCallable(err));
    } finally {
      setSalvandoMeta(false);
    }
  };

  const copiarLinkApoieRastreado = async () => {
    const url = buildApoieTrackedUrl(promoAtual?.promoId);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMsgPromo('Link da Apoie copiado (rastreio promo_admin + campanha).');
    } catch {
      setMsgPromo('Não foi possível copiar. Selecione o campo do link e copie manualmente.');
    }
  };

  const incrementarDuracao = async (preset = null) => {
    const dias = Math.max(0, Math.floor(Number(preset?.days ?? incDias ?? 0)));
    const horas = Math.max(0, Math.floor(Number(preset?.hours ?? incHoras ?? 0)));
    const minutos = Math.max(0, Math.floor(Number(preset?.minutes ?? incMin ?? 0)));
    if (!promoAtivaAgora) {
      setMsgPromo('Só é possível incrementar o tempo quando a promoção está ativa.');
      return;
    }
    if (dias + horas + minutos <= 0) {
      setMsgPromo('Informe pelo menos dias, horas ou minutos para incrementar.');
      return;
    }
    setLoadingPromo(true);
    setMsgPromo('');
    try {
      const { data } = await adminIncrementarDuracaoPromocaoPremium({
        days: dias,
        hours: horas,
        minutes: minutos,
      });
      setMsgPromo(
        `Tempo adicionado com sucesso (+${dias}d ${horas}h ${minutos}min). Novo término: ${formatarDataHoraSegBr(data?.endsAt, { seVazio: '--' })}.`
      );
      await carregarPromo();
    } catch (err) {
      setMsgPromo(mensagemErroCallable(err));
    } finally {
      setLoadingPromo(false);
    }
  };

  const {
    promoAtivaAgora,
    promoAgendada,
    promoEncerrada,
    timerFormatado,
    kpisPainel,
    metaAtualCampanha,
    sugestaoHistorica,
    kpisUltimaCampanha,
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

  const duplicarCampanha = (campanha) => {
    if (!campanha) return;
    const spanMs = Math.max(
      3600000,
      Number(campanha.endsAt || 0) - Number(campanha.startsAt || 0)
    );
    const totalSecCopy = Math.floor(spanMs / 1000);
    const diasCopy = Math.floor(totalSecCopy / 86400);
    const horasCopy = Math.floor((totalSecCopy % 86400) / 3600);
    const minCopy = Math.floor((totalSecCopy % 3600) / 60);
    const secCopy = totalSecCopy % 60;
    setPromoNome(`${campanha.name || 'Promoção'} (Cópia)`);
    setPromoMensagem(campanha.message || '');
    setPromoPreco(String(campanha.priceBRL || PRECO_BASE));
    setPromoInicio(toDatetimeLocal(Date.now()));
    setDurDias(String(diasCopy));
    setDurHoras(String(horasCopy));
    setDurMin(String(minCopy));
    setDurSeg(String(secCopy));
    setTemplateAtivo('');
    setDurPreset('custom');
    setConfigHint(
      'Campanha duplicada: preço promocional, duração e mensagem do e-mail foram copiados. Ajuste o nome e publique quando estiver pronto.'
    );
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

  return (
    <main className="admin-empty-page">
      <section className="admin-empty-card financeiro-card">
        <header className="financeiro-header">
          <div>
            <h1>Promoções do Premium</h1>
            <p>Controle de campanhas que impactam diretamente a receita de assinaturas.</p>
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
          <div className="financeiro-promocao financeiro-visao">
            <h2 className="financeiro-visao-titulo">Visão geral · decisão rápida</h2>
            <p className="financeiro-visao-sub">
              Esta aba responde em segundos: a campanha foi forte? Onde o funil parou? O que repetir?
            </p>
            {promoAtual ? (
              <div className={`promo-banner promo-banner--hero ${promoAtivaAgora ? 'promo-banner--active' : ''} ${promoEncerrada ? 'promo-banner--ended' : ''} ${promoAgendada ? 'promo-banner--scheduled' : ''}`}>
                <div className="promo-banner-head">
                  <div>
                    <p className="promo-status-mega">
                      {promoAtivaAgora
                        ? 'Promoção ativa agora'
                        : promoAgendada
                          ? 'Campanha agendada'
                          : 'Campanha encerrada'}
                    </p>
                    <span className={`promo-status-chip ${promoAtivaAgora ? 'active' : promoAgendada ? 'scheduled' : 'ended'}`}>
                      {promoAtivaAgora ? 'AO VIVO' : promoAgendada ? 'AGENDADA' : 'ENCERRADA'}
                    </span>
                  </div>
                </div>
                <p className="promo-campaign-name promo-campaign-name--lg">{promoAtual.name}</p>
                <p className="promo-price-line">
                  <strong>R$ {promoAtual.priceBRL?.toFixed(2)}</strong>
                  <span className="promo-price-was">era {labelPrecoPremium()}</span>
                </p>
                <p className="promo-dates-line">
                  {formatarDataHoraSegBr(promoAtual.startsAt, { seVazio: '--' })} ? {formatarDataHoraSegBr(promoAtual.endsAt, { seVazio: '--' })}
                </p>
                {(promoAtivaAgora || promoAgendada) && promoAtual.promoId ? (
                  <div className="financeiro-promo-quicklinks">
                    <h4 className="financeiro-promo-quicklinks-titulo">Página Apoie e rastreio</h4>
                    <p className="financeiro-promo-quicklinks-hint">
                      Termina em <strong>{formatarDataHoraSegBr(promoAtual.endsAt, { seVazio: '--' })}</strong> · preço{' '}
                      <strong>{labelPrecoPremium(promoAtual.priceBRL)}</strong>. Link com{' '}
                      <code className="financeiro-inline-code">src=promo_admin</code> e{' '}
                      <code className="financeiro-inline-code">camp=id</code> para o funil do dashboard.
                    </p>
                    <div className="financeiro-promo-link-row">
                      <input
                        readOnly
                        className="financeiro-promo-link-input"
                        value={buildApoieTrackedUrl(promoAtual.promoId)}
                        aria-label="URL da Apoie com rastreio"
                      />
                      <button type="button" className="financeiro-btn-secondary-lg" onClick={copiarLinkApoieRastreado}>
                        Copiar link
                      </button>
                      <button
                        type="button"
                        className="financeiro-btn-secondary-lg"
                        onClick={() =>
                          window.open(buildApoieTrackedUrl(promoAtual.promoId), '_blank', 'noopener,noreferrer')
                        }
                      >
                        Abrir Apoie
                      </button>
                    </div>
                  </div>
                ) : null}
                {promoAtivaAgora ? (
                  <div className="financeiro-promo-meta">
                    <h4 className="financeiro-promo-quicklinks-titulo">Meta de pagamentos (só painel)</h4>
                    <p className="financeiro-promo-quicklinks-hint">
                      Opcional. Comparar com pagamentos rastreados nesta campanha — não altera checkout nem e-mail.
                    </p>
                    {metaAtualCampanha != null && kpisPainel ? (
                      <p className="financeiro-promo-meta-progresso">
                        Progresso: <strong>{kpisPainel.payments}</strong> / {metaAtualCampanha} pagamentos
                        {metaAtualCampanha > 0 ? (
                          <span className="financeiro-promo-meta-pct">
                            {' '}
                            ({Math.min(100, Math.round((kpisPainel.payments / metaAtualCampanha) * 100))}%)
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    <div className="financeiro-promo-meta-row">
                      <label className="financeiro-promo-meta-label">
                        Meta (pagamentos)
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={metaPagamentosInput}
                          onChange={(e) => setMetaPagamentosInput(e.target.value)}
                          placeholder="Ex.: 30"
                        />
                      </label>
                      <button
                        type="button"
                        className="financeiro-btn-secondary-lg"
                        disabled={salvandoMeta || loadingPromo}
                        onClick={salvarMetaPagamentos}
                      >
                        {salvandoMeta ? 'Salvando...' : 'Salvar meta'}
                      </button>
                    </div>
                  </div>
                ) : null}
                {kpisPainel && (kpisPainel.sent > 0 || kpisPainel.payments > 0) ? (
                  <div className="financeiro-kpi-hero">
                    <article>
                      <span className="financeiro-kpi-label">Conversão</span>
                      <strong className="financeiro-kpi-num">{formatarPct1(kpisPainel.conversaoPct)}</strong>
                      <small>pagos / enviados</small>
                    </article>
                    <article>
                      <span className="financeiro-kpi-label">Receita</span>
                      <strong className="financeiro-kpi-num financeiro-kpi-num--money">{labelPrecoPremium(kpisPainel.revenue)}</strong>
                      <small>rastreada nesta campanha</small>
                    </article>
                    <article>
                      <span className="financeiro-kpi-label">CTR</span>
                      <strong className="financeiro-kpi-num">{formatarPct1(kpisPainel.ctrPct)}</strong>
                      <small>cliques / enviados</small>
                    </article>
                    <article>
                      <span className="financeiro-kpi-label">Ticket médio</span>
                      <strong className="financeiro-kpi-num financeiro-kpi-num--money">
                        {kpisPainel.payments > 0 ? labelPrecoPremium(kpisPainel.ticketMedio) : '—'}
                      </strong>
                      <small>receita / pagamento</small>
                    </article>
                    <article>
                      <span className="financeiro-kpi-label">Abandono checkout</span>
                      <strong className={`financeiro-kpi-num ${(kpisPainel.abandonoCheckoutPct || 0) > 40 ? 'financeiro-kpi-num--warn' : ''}`}>
                        {kpisPainel.abandonoCheckoutPct != null ? formatarPct1(kpisPainel.abandonoCheckoutPct) : '—'}
                      </strong>
                      <small>não concluíram o pagamento</small>
                    </article>
                  </div>
                ) : (
                  <p className="promo-timer promo-timer--soft">
                    Métricas de e-mail e funil aparecem quando houver envios rastreados para esta campanha.
                  </p>
                )}
                {promoAtivaAgora ? (
                  <>
                    <div className="promo-countdown-block">
                      <small>Tempo restante</small>
                      <strong>{timerFormatado}</strong>
                    </div>
                    <div className="promo-incremento">
                      <h4>Incrementar duração da promoção ativa</h4>
                      <div className="promo-incremento-grid">
                        <label>
                          Dias
                          <input type="number" min="0" value={incDias} onChange={(e) => setIncDias(e.target.value)} />
                        </label>
                        <label>
                          Horas
                          <input type="number" min="0" value={incHoras} onChange={(e) => setIncHoras(e.target.value)} />
                        </label>
                        <label>
                          Minutos
                          <input type="number" min="0" value={incMin} onChange={(e) => setIncMin(e.target.value)} />
                        </label>
                      </div>
                      <div className="promo-incremento-acoes">
                        <button type="button" disabled={loadingPromo} onClick={() => incrementarDuracao()}>
                          {loadingPromo ? 'Aplicando...' : 'Aplicar incremento'}
                        </button>
                        <button type="button" disabled={loadingPromo} onClick={() => incrementarDuracao({ minutes: 15 })}>
                          +15 min
                        </button>
                        <button type="button" disabled={loadingPromo} onClick={() => incrementarDuracao({ hours: 1 })}>
                          +1h
                        </button>
                        <button type="button" disabled={loadingPromo} onClick={() => incrementarDuracao({ days: 1 })}>
                          +1 dia
                        </button>
                      </div>
                    </div>
                  </>
                ) : promoAgendada ? (
                  <p className="promo-timer">
                    Promoção cadastrada, aguardando o horário de início.
                  </p>
                ) : (
                  <p className="promo-timer">
                    Esta campanha já finalizou em {formatarDataHoraSegBr(promoAtual.endsAt, { seVazio: '--' })}.
                  </p>
                )}
              </div>
            ) : (
              <div className="promo-banner promo-banner--inactive promo-banner--hero">
                <div className="promo-empty-icon" aria-hidden="true">ðŸ“£</div>
                <p className="promo-status-mega">Nenhuma campanha no ar</p>
                <p className="promo-empty-lead">Lance uma promoção com preço e janela claros — o painel mostra conversão, CTR e onde o funil perde força.</p>
                <button type="button" className="financeiro-btn-primary financeiro-btn-cta-lg" onClick={abrirAbaConfigPromo}>
                  Criar nova campanha
                </button>
              </div>
            )}
            {promoActivityLog.length > 0 && (
              <section className="financeiro-atividade-promo">
                <h3 className="financeiro-atividade-promo-titulo">Atividade recente</h3>
                <p className="financeiro-promo-quicklinks-hint">
                  Publicações, extensões de tempo, encerramentos e alteração de meta (últimos eventos no servidor).
                </p>
                <ul className="financeiro-atividade-lista">
                  {promoActivityLog.map((e, idx) => (
                    <li key={e.id || `${e.at}-${e.action}-${idx}`}>{textoLogPromocao(e)}</li>
                  ))}
                </ul>
              </section>
            )}

            <div className="financeiro-acoes financeiro-acoes--visao">
              <button type="button" className="financeiro-btn-primary financeiro-btn-cta-lg" onClick={abrirAbaConfigPromo}>
                {promoAtual ? 'Ajustar campanha atual' : 'Criar nova campanha'}
              </button>
              {lastCampaign && (
                <button type="button" className="financeiro-btn-secondary-lg" onClick={() => duplicarCampanha(lastCampaign)}>
                  Duplicar última campanha
                </button>
              )}
              <button
                type="button"
                className="financeiro-btn-ghost"
                disabled={loadingPromo}
                onClick={() => carregarPromo()}
                title="Sincroniza promo, histórico e métricas com o Firebase (outro dispositivo ou alteração manual)."
              >
                Sincronizar dados
              </button>
              <button
                type="button"
                className="financeiro-btn-secondary-lg"
                onClick={exportarHistoricoCampanhasCsv}
                disabled={!promoHistory.length}
              >
                Exportar histórico CSV
              </button>
              <button
                type="button"
                className="financeiro-btn-secondary-lg"
                onClick={exportarLogCampanhasCsv}
                disabled={!promoActivityLog.length}
              >
                Exportar log CSV
              </button>
              {(promoAtivaAgora || promoAgendada) && (
                <button
                  type="button"
                  className="financeiro-btn-encerrar"
                  disabled={loadingPromo || !promoAtual}
                  onClick={() => encerrarPromo({ agendada: promoAgendada })}
                >
                  {promoAgendada ? 'Cancelar campanha' : 'Encerrar agora'}
                </button>
              )}
            </div>
            {msgPromo && <p className="financeiro-migracao-msg">{msgPromo}</p>}
            {sugestaoHistorica && (
              <div className="financeiro-sugestao" role="status">
                <strong>Sugestão com base no histórico</strong>
                <p>{sugestaoHistorica}</p>
              </div>
            )}

            <section className="financeiro-resultados">
              <div className="financeiro-resultados-head financeiro-resultados-head--lg">
                <div>
                  <h3>Ãšltima campanha no histórico</h3>
                  <p className="financeiro-resultados-lead">Onde essa campanha converteu — ou onde morreu no funil.</p>
                </div>
                {lastCampaign && (
                  <button type="button" className="financeiro-btn-secondary-lg" onClick={() => duplicarCampanha(lastCampaign)}>
                    Duplicar esta campanha
                  </button>
                )}
              </div>
              {lastCampaign ? (
                <>
                  <div className="financeiro-ultima-meta">
                    <strong>{lastCampaign.name}</strong>
                    <span>{labelPrecoPremium(lastCampaign.priceBRL)}</span>
                    <span className={`financeiro-pill-status financeiro-pill-status--${pillClassCampanhaStatus(statusCampanhaDerivado(lastCampaign, nowMs))}`}>
                      {statusCampanhaDerivado(lastCampaign, nowMs)}
                    </span>
                  </div>
                  <div className="financeiro-kpi-strip">
                    <article>
                      <span>Conversão</span>
                      <strong>{formatarPct1(kpisUltimaCampanha?.conversaoPct)}</strong>
                    </article>
                    <article>
                      <span>Receita</span>
                      <strong>{labelPrecoPremium(lastCampaign?.performance?.revenue || 0)}</strong>
                    </article>
                    <article>
                      <span>CTR</span>
                      <strong>{formatarPct1(kpisUltimaCampanha?.ctrPct)}</strong>
                    </article>
                    <article>
                      <span>Ticket médio</span>
                      <strong>
                        {kpisUltimaCampanha?.payments > 0
                          ? labelPrecoPremium(kpisUltimaCampanha.ticketMedio)
                          : '—'}
                      </strong>
                    </article>
                    <article>
                      <span>Abandono checkout</span>
                      <strong>
                        {kpisUltimaCampanha?.abandonoCheckoutPct != null
                          ? formatarPct1(kpisUltimaCampanha.abandonoCheckoutPct)
                          : '—'}
                      </strong>
                    </article>
                  </div>
                  <p className="financeiro-funil-caption">Funil rastreado (e-mail promocional)</p>
                  <div className="financeiro-funil-visual">
                    {(() => {
                      const perf = lastCampaign.performance || {};
                      const sent = Number(perf.sentEmails || 0);
                      const clicks = Number(perf.clicks || 0);
                      const checkouts = Number(perf.checkouts || 0);
                      const payments = Number(perf.payments || 0);
                      const base = Math.max(sent, 1);
                      const steps = [
                        { key: 'e', label: 'E-mails enviados', n: sent, w: 100 },
                        { key: 'c', label: 'Cliques', n: clicks, w: sent > 0 ? (clicks / base) * 100 : 0 },
                        { key: 'k', label: 'Checkouts', n: checkouts, w: sent > 0 ? (checkouts / base) * 100 : 0 },
                        { key: 'p', label: 'Pagamentos', n: payments, w: sent > 0 ? (payments / base) * 100 : 0 },
                      ];
                      const ctr = sent > 0 ? (clicks / sent) * 100 : 0;
                      const c2k = clicks > 0 ? (checkouts / clicks) * 100 : 0;
                      const k2p = checkouts > 0 ? (payments / checkouts) * 100 : 0;
                      const bridges = [
                        { label: 'CTR', pct: ctr },
                        { label: 'Clique ? checkout', pct: c2k },
                        { label: 'Checkout ? pago', pct: k2p },
                      ];
                      return (
                        <div className="financeiro-funil-row">
                          {steps.map((step, i) => (
                            <React.Fragment key={step.key}>
                              <div className="financeiro-funil-stage">
                                <div className="financeiro-funil-bar-wrap">
                                  <div className="financeiro-funil-bar" style={{ width: `${Math.min(100, Math.max(4, step.w))}%` }} />
                                </div>
                                <span className="financeiro-funil-count">{step.n}</span>
                                <span className="financeiro-funil-label">{step.label}</span>
                              </div>
                              {i < steps.length - 1 && (
                                <div className="financeiro-funil-bridge">
                                  <span className="financeiro-funil-bridge-arrow" aria-hidden="true">?</span>
                                  <span className="financeiro-funil-bridge-pct">{formatarPct1(bridges[i].pct)}</span>
                                  <span className="financeiro-funil-bridge-hint">{bridges[i].label}</span>
                                </div>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <p className="promo-timer">Ainda não há campanha no histórico com métricas para comparar.</p>
              )}
            </section>

            <section className="financeiro-historico">
              <div className="financeiro-historico-head">
                <h3>Histórico comparável</h3>
                <small>Compare receita e conversão entre campanhas; use Duplicar para reaproveitar o que funcionou.</small>
              </div>
              <div className="financeiro-historico-table-wrap">
                <div className="financeiro-historico-table">
                  <div className="financeiro-historico-row financeiro-historico-row--head">
                    <span>Campanha</span>
                    <span>Receita</span>
                    <span>Conversão</span>
                    <span>CTR</span>
                    <span>Status</span>
                    <span />
                  </div>
                  {promoHistory.map((camp) => {
                    const k = kpisPerformance(camp.performance);
                    const st = statusCampanhaDerivado(camp, nowMs);
                    return (
                      <div key={camp.promoId} className="financeiro-historico-row">
                        <span className="financeiro-hist-name">
                          <strong>{camp.name}</strong>
                          <small>{labelPrecoPremium(camp.priceBRL)}</small>
                        </span>
                        <span className="financeiro-hist-money">{labelPrecoPremium(camp?.performance?.revenue || 0)}</span>
                        <span>{formatarPct1(k?.conversaoPct)}</span>
                        <span>{formatarPct1(k?.ctrPct)}</span>
                        <span>
                          <span className={`financeiro-pill-status financeiro-pill-status--${pillClassCampanhaStatus(st)}`}>{st}</span>
                        </span>
                        <span className="financeiro-hist-acao">
                          <button type="button" onClick={() => duplicarCampanha(camp)}>Duplicar</button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                {!promoHistory.length && <p className="promo-timer financeiro-hist-empty">Sem campanhas anteriores registradas.</p>}
              </div>
            </section>
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
                  Assunto: <strong>{promoNome || 'Campanha Premium Kokuin'}</strong>
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







