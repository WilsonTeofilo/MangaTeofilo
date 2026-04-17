import { useMemo } from 'react';

import {
  PRECO_BASE,
  kpisPerformance,
  sugestaoPorHistorico,
} from '../financeiroAdminUtils';

export default function useFinanceiroPromoPanel({
  promoAtual,
  nowMs,
  currentPerformance,
  promoHistory,
  lastCampaign,
  precoNumerico,
  promoInicio,
  duracaoMs,
}) {
  const promoStartMs = Number(promoAtual?.startsAt || 0);
  const promoEndMs = Number(promoAtual?.endsAt || 0);
  const promoAtivaAgora = Boolean(promoAtual && nowMs >= promoStartMs && nowMs <= promoEndMs);
  const promoAgendada = Boolean(promoAtual && nowMs < promoStartMs);
  const promoEncerrada = Boolean(promoAtual && nowMs > promoEndMs);
  const restante = Math.max(0, promoEndMs - nowMs);
  const totalSec = Math.floor(restante / 1000);
  const dd = String(Math.floor(totalSec / 86400)).padStart(2, '0');
  const hh = String(Math.floor((totalSec % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const timerFormatado = `${dd}:${hh}:${mm}:${ss}`;

  const perfCampanhaPainel = useMemo(() => {
    if (!promoAtual?.promoId) return null;
    if (currentPerformance) return currentPerformance;
    const row = promoHistory.find((h) => h.promoId === promoAtual.promoId);
    return row?.performance || null;
  }, [promoAtual, currentPerformance, promoHistory]);

  const kpisPainel = useMemo(() => kpisPerformance(perfCampanhaPainel), [perfCampanhaPainel]);
  const metaAtualCampanha = (() => {
    if (!promoAtual?.promoId) return null;
    const row = promoHistory.find((h) => h.promoId === promoAtual.promoId);
    return row?.goalPayments ?? null;
  })();
  const sugestaoHistorica = useMemo(() => sugestaoPorHistorico(promoHistory), [promoHistory]);
  const kpisUltimaCampanha = useMemo(() => kpisPerformance(lastCampaign?.performance), [lastCampaign]);

  const simulador = useMemo(() => {
    const preco = Number.isFinite(precoNumerico) ? precoNumerico : 0;
    const descontoPct = PRECO_BASE > 0 ? ((PRECO_BASE - preco) / PRECO_BASE) * 100 : 0;
    const baselineAssinaturas = Math.max(
      10,
      Number(lastCampaign?.performance?.payments || currentPerformance?.payments || 10)
    );
    const receitaBase = PRECO_BASE * baselineAssinaturas;
    const cenarios = [
      { id: 'conservador', nome: 'Conservador', lift: 1.1 },
      { id: 'medio', nome: 'Médio', lift: 1.35 },
      { id: 'agressivo', nome: 'Agressivo', lift: 1.6 },
    ].map((c) => {
      const assinaturas = Math.round(baselineAssinaturas * c.lift);
      const receita = assinaturas * preco;
      const delta = receita - receitaBase;
      return {
        ...c,
        assinaturas,
        receita,
        delta,
      };
    });
    const breakEvenAssinaturas = preco > 0 ? Math.ceil(receitaBase / preco) : 0;
    return {
      descontoPct: Math.round(descontoPct * 10) / 10,
      baselineAssinaturas,
      receitaBase,
      breakEvenAssinaturas,
      cenarios,
    };
  }, [precoNumerico, lastCampaign, currentPerformance]);

  const inicioCampanhaMs = useMemo(() => new Date(promoInicio).getTime(), [promoInicio]);
  const fimCampanhaEstimadoMs = useMemo(() => {
    if (!Number.isFinite(inicioCampanhaMs) || duracaoMs <= 0) return null;
    return inicioCampanhaMs + duracaoMs;
  }, [inicioCampanhaMs, duracaoMs]);
  const cenarioRecomendado = useMemo(
    () => simulador.cenarios.find((c) => c.id === 'medio'),
    [simulador.cenarios]
  );

  const warningsConfig = useMemo(() => {
    const arr = [];
    if (Number.isFinite(precoNumerico) && precoNumerico >= PRECO_BASE) {
      arr.push('O preço promocional precisa ser menor que o preço base da assinatura.');
    }
    if (Number.isFinite(precoNumerico) && precoNumerico > 0 && precoNumerico < 10) {
      arr.push('Promoções muito abaixo de R$ 10 podem reduzir lucro; use só com estratégia clara.');
    }
    if (Number.isFinite(precoNumerico) && precoNumerico < PRECO_BASE * 0.6) {
      arr.push('Preço muito baixo: pode reduzir receita se o volume não subir bastante.');
    }
    if (duracaoMs > 30 * 24 * 60 * 60 * 1000) {
      arr.push('Duração acima de 30 dias: pode banalizar o valor percebido da assinatura.');
    }
    if (duracaoMs <= 0) {
      arr.push('Defina uma duração maior que zero para evitar promoção inválida.');
    }
    return arr;
  }, [precoNumerico, duracaoMs]);

  return {
    promoStartMs,
    promoEndMs,
    promoAtivaAgora,
    promoAgendada,
    promoEncerrada,
    timerFormatado,
    perfCampanhaPainel,
    kpisPainel,
    metaAtualCampanha,
    sugestaoHistorica,
    kpisUltimaCampanha,
    simulador,
    inicioCampanhaMs,
    fimCampanhaEstimadoMs,
    cenarioRecomendado,
    warningsConfig,
  };
}
