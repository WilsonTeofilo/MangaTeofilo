import { labelPrecoPremium, PREMIUM_PRECO_BRL } from '../../config/premiumAssinatura';
import { formatarDataHoraSegBr } from '../../utils/datasBr';

export function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(filename, headers, rows) {
  const csv = [headers.join(';'), ...rows.map((row) => row.map(escapeCsv).join(';'))].join('\r\n');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatarPct1(n) {
  return `${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function kpisPerformance(perf) {
  if (!perf) return null;
  const sent = Number(perf.sentEmails || 0);
  const clicks = Number(perf.clicks || 0);
  const checkouts = Number(perf.checkouts || 0);
  const payments = Number(perf.payments || 0);
  const revenue = Number(perf.revenue || 0);
  const ctrPct = sent > 0 ? (clicks / sent) * 100 : Number(perf.ctrPct || 0);
  const conversaoPct = sent > 0 ? (payments / sent) * 100 : Number(perf.paidFromSentPct || 0);
  const ticketMedio = payments > 0 ? revenue / payments : 0;
  const checkoutToPaid = Number(perf.checkoutToPaidPct || 0);
  const abandonoCheckoutPct = checkouts > 0 ? Math.max(0, 100 - checkoutToPaid) : null;
  return {
    sent,
    clicks,
    checkouts,
    payments,
    revenue,
    ctrPct,
    conversaoPct,
    ticketMedio,
    abandonoCheckoutPct,
    checkoutToPaidPct: checkoutToPaid,
  };
}

export function humanizarDuracaoMs(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d} ${d === 1 ? 'dia' : 'dias'}`);
  if (h) parts.push(`${h} h`);
  if (m || parts.length === 0) parts.push(`${m} min`);
  return parts.join(' · ');
}

export function pillClassCampanhaStatus(st) {
  const x = String(st || '').toLowerCase();
  if (x.includes('agend')) return 'agendada';
  if (x.includes('encerr')) return 'encerrada';
  if (x.includes('ativa')) return 'ativa';
  return 'neutro';
}

export function sugestaoPorHistorico(history) {
  const rows = (history || []).filter((c) => Number(c?.performance?.sentEmails || 0) >= 8);
  if (rows.length < 4) return null;
  const under = rows.filter((c) => Number(c.priceBRL) < 20);
  const over = rows.filter((c) => Number(c.priceBRL) >= 20);
  if (under.length < 2 || over.length < 2) return null;
  const avg = (arr) =>
    arr.reduce((s, c) => s + Number(c?.performance?.paidFromSentPct || 0), 0) / arr.length;
  const a = avg(under);
  const b = avg(over);
  if (a > b * 1.25) {
    return `No seu histórico, campanhas abaixo de R$ 20 tiveram conversão média de ${formatarPct1(a)} frente a ${formatarPct1(b)} nas de R$ 20 ou mais (mín. 8 e-mails/campanha).`;
  }
  if (b > a * 1.25) {
    return `No seu histórico, preços a partir de R$ 20 tiveram conversão média de ${formatarPct1(b)} vs ${formatarPct1(a)} nas mais baratas — vale testar faixas diferentes.`;
  }
  return null;
}

export const PRECO_BASE = Number(PREMIUM_PRECO_BRL || 23);
export const PROMO_TEMPLATES = [
  {
    id: 'flash24',
    nome: 'Flash 24h',
    tag: 'Alta urgência',
    hint: 'Boa para picos de conversão em janela curta.',
    mensagem: 'Oferta relâmpago para virar Membro Kokuin nas próximas 24h.',
    dias: 0,
    horas: 24,
    minutos: 0,
    segundos: 0,
    descontoPct: 13,
  },
  {
    id: 'fimSemana',
    nome: 'Fim de semana da Tempestade',
    tag: 'Receita estável',
    hint: 'Mais tempo para o funil respirar.',
    mensagem: 'Promo de fim de semana para reforçar a base premium.',
    dias: 2,
    horas: 0,
    minutos: 0,
    segundos: 0,
    descontoPct: 18,
  },
  {
    id: 'retomada7d',
    nome: 'Retomada da Guilda (7 dias)',
    tag: 'Volume',
    hint: 'Útil para reativar quem parou na metade.',
    mensagem: 'Campanha de retomada para acelerar assinaturas no início do mês.',
    dias: 7,
    horas: 0,
    minutos: 0,
    segundos: 0,
    descontoPct: 10,
  },
];

export function toDatetimeLocal(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildApoieTrackedUrl(promoId) {
  if (typeof window === 'undefined' || !promoId) return '';
  const camp = encodeURIComponent(String(promoId));
  return `${window.location.origin}/apoie?src=promo_admin&camp=${camp}`;
}

export function avisosAntesPublicarComEmail(agora, inicioMs, fimMs, preco, precoBase, msPromoConfirmaCurta) {
  const avisos = [];
  const inicioEfetivo = Math.max(inicioMs, agora);
  const duracaoVisivel = fimMs - inicioEfetivo;
  if (duracaoVisivel > 0 && duracaoVisivel < msPromoConfirmaCurta) {
    avisos.push(
      `A janela da promo no ar (a partir de agora) é de ${humanizarDuracaoMs(duracaoVisivel)} — e-mail em massa com pouco tempo pode frustrar quem abre tarde.`
    );
  }
  if (precoBase > 0 && preco < precoBase) {
    const pctOff = ((precoBase - preco) / precoBase) * 100;
    if (pctOff < 1) {
      avisos.push(
        `O desconto sobre o preço base é de apenas ${pctOff.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%. Confira se o valor está certo.`
      );
    }
  }
  return avisos;
}

export function textoResumoEmailPromocao(stats) {
  const s = stats || {};
  const sent = Number(s.sent || 0);
  const failed = Number(s.failed || 0);
  const tail =
    ' Os links usam a página Apoie (/apoie) com rastreio; se abrir só a home sem parâmetros, o clique não entra no funil.';
  const optInKnown = s.optInAtivos != null && Number.isFinite(Number(s.optInAtivos));
  if (optInKnown) {
    const optIn = Number(s.optInAtivos);
    const noEmail = Number(s.skippedOptInNoEmail || 0);
    if (optIn <= 0) {
      return `Nenhuma conta elegível para receber e-mail (cadastro ativo + notificação de promo nas preferências).${tail}`;
    }
    let msg = `${sent} e-mail(s) enviado(s) para quem ativou notificação de promo no app (${optIn} ${optIn === 1 ? 'conta elegível' : 'contas elegíveis'}).`;
    if (failed > 0) msg += ` Falhas na entrega: ${failed}.`;
    if (noEmail > 0) {
      msg += ` ${noEmail} ${noEmail === 1 ? 'conta' : 'contas'} com notificação ativada sem e-mail válido no login (Auth).`;
    }
    return msg + tail;
  }
  const skipped = Number(s.skipped || 0);
  if (sent > 0 || failed > 0 || skipped > 0) {
    return `${sent} enviado(s), ${failed} falha(s). (Campanha antiga no histórico — sem detalhe de opt-in.)${tail}`;
  }
  return `Nenhum envio registrado nesta rodada.${tail}`;
}

export function textoLogPromocao(entry) {
  const at = formatarDataHoraSegBr(entry.at, { seVazio: '—' });
  const d = entry.detail || {};
  if (entry.action === 'publish') {
    const mail = d.notifyUsers ? 'com envio de e-mail' : 'sem e-mail (só checkout)';
    return `${at} · Publicação ${mail} · ${d.name || 'Campanha'} · término ${formatarDataHoraSegBr(d.endsAt, { seVazio: '—' })}`;
  }
  if (entry.action === 'extend') {
    const ad = d.added || {};
    return `${at} · Tempo estendido (+${ad.days || 0}d ${ad.hours || 0}h ${ad.minutes || 0}min) · novo término ${formatarDataHoraSegBr(d.endsAtAfter, { seVazio: '—' })}`;
  }
  if (entry.action === 'disable') {
    return `${at} · Encerrada ou cancelada manualmente · ${d.name || entry.promoId || '—'}`;
  }
  if (entry.action === 'meta') {
    return `${at} · Meta de pagamentos ${d.goalPayments != null ? `definida: ${d.goalPayments}` : 'removida'}`;
  }
  return `${at} · ${entry.action || 'evento'}`;
}

export function statusCampanhaDerivado(camp, nowMs = Date.now()) {
  if (!camp) return '—';
  const s = Number(camp.startsAt || 0);
  const e = Number(camp.endsAt || 0);
  if (!s || !e) return String(camp.status || 'registrada');
  if (nowMs < s) return 'Agendada';
  if (nowMs <= e) return 'Ativa';
  return 'Encerrada';
}

export function formatCampaignPrice(preco) {
  return labelPrecoPremium(preco);
}
