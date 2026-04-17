import { useMemo } from 'react';

import { formatUserDisplayFromMixed } from '../../../utils/publicCreatorName';
import {
  distribuicaoSexoReceita,
  formatPct0,
  linePath,
  paginate,
  pct,
  percentOf,
  scoreFromPercent,
  sumNovosVip,
} from '../dashboardAdminUtils';

export default function useDashboardAdminAnalytics({
  dados,
  rankingMode,
  rankingSearch,
  subsSearch,
  doaSearch,
  rankingPage,
  subsPage,
  doaPage,
  selectedUid,
}) {
  const lineChart = (() => {
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
  })();

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

  const dashboardInsights = (() => {
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
        lines.push(
          `Receita total caiu ${Math.abs(dp).toFixed(1)}% vs período comparado — vale revisar promoções (Financeiro) e e-mails de aquisição.`
        );
      } else if (dp > 12) {
        lines.push(
          `Receita total subiu ${dp.toFixed(1)}% vs comparado — identifique o que mudou (preço, tráfego, campanha) para repetir.`
        );
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
  })();

  const ultimosMesesReceita = (() => {
    const series = dados?.current?.monthlySeries || [];
    return series.slice(-6);
  })();

  const analytics = useMemo(() => dados?.analytics || {}, [dados]);
  const acquisition = useMemo(() => analytics.acquisition || { promo: {}, chapter: {} }, [analytics]);
  const subscriptionStats = useMemo(() => analytics.subscriptionStats || [], [analytics]);
  const donationStats = useMemo(() => analytics.donationStats || [], [analytics]);
  const historyByUid = useMemo(() => analytics.userHistoryByUid || {}, [analytics]);
  const subsByUid = useMemo(
    () => Object.fromEntries(subscriptionStats.map((r) => [r.uid, r])),
    [subscriptionStats]
  );

  const filteredRankingRows = useMemo(() => {
    const base = rankingMode === 'assinaturas' ? subscriptionStats : donationStats;
    const q = rankingSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((row) => {
      const label = formatUserDisplayFromMixed(row).toLowerCase();
      return label.includes(q) || String(row.uid || '').toLowerCase().includes(q);
    });
  }, [rankingMode, rankingSearch, subscriptionStats, donationStats]);

  const filteredSubsRows = useMemo(() => {
    const q = subsSearch.trim().toLowerCase();
    if (!q) return subscriptionStats;
    return subscriptionStats.filter((row) => {
      const label = formatUserDisplayFromMixed(row).toLowerCase();
      return label.includes(q) || String(row.uid || '').toLowerCase().includes(q);
    });
  }, [subsSearch, subscriptionStats]);

  const filteredDoaRows = useMemo(() => {
    const q = doaSearch.trim().toLowerCase();
    if (!q) return donationStats;
    return donationStats.filter((row) => {
      const label = formatUserDisplayFromMixed(row).toLowerCase();
      return label.includes(q) || String(row.uid || '').toLowerCase().includes(q);
    });
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

  const promoScore = useMemo(
    () => scoreFromPercent(promoFunnel.paidFromSent),
    [promoFunnel.paidFromSent]
  );
  const chapterScore = useMemo(
    () => scoreFromPercent(chapterFunnel.readShare),
    [chapterFunnel.readShare]
  );

  return {
    lineChart,
    pieShare,
    distAssinaSexo,
    distDoaSexo,
    novosVipStats,
    dashboardInsights,
    ultimosMesesReceita,
    analytics,
    acquisition,
    subscriptionStats,
    donationStats,
    subsByUid,
    filteredRankingRows,
    filteredSubsRows,
    filteredDoaRows,
    rankingPaginated,
    subsPaginated,
    doaPaginated,
    selectedHistory,
    selectedUser,
    promoFunnel,
    chapterFunnel,
    promoScore,
    chapterScore,
  };
}
