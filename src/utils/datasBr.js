/** Fuso padrão do produto (exibição de datas no site). */
export const FUSO_BRASIL = 'America/Sao_Paulo';

function asMs(ms) {
  const n = Number(ms);
  return Number.isFinite(n) ? n : NaN;
}

/** dd/mm/aaaa */
export function formatarDataBr(ms, { seVazio = '—' } = {}) {
  const n = asMs(ms);
  if (!Number.isFinite(n) || n <= 0) return seVazio;
  try {
    return new Date(n).toLocaleDateString('pt-BR', {
      timeZone: FUSO_BRASIL,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return seVazio;
  }
}

/** dd/mm/aaaa, hh:mm (sem segundos) */
export function formatarDataHoraBr(ms, { seVazio = '—' } = {}) {
  const n = asMs(ms);
  if (!Number.isFinite(n) || n <= 0) return seVazio;
  try {
    return new Date(n).toLocaleString('pt-BR', {
      timeZone: FUSO_BRASIL,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return seVazio;
  }
}

/** dd/mm/aaaa, hh:mm:ss */
export function formatarDataHoraSegBr(ms, { seVazio = '—' } = {}) {
  const n = asMs(ms);
  if (!Number.isFinite(n) || n <= 0) return seVazio;
  try {
    return new Date(n).toLocaleString('pt-BR', {
      timeZone: FUSO_BRASIL,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return seVazio;
  }
}

/** 31 de março de 2026 */
export function formatarDataLongaBr(ms, { seVazio = '' } = {}) {
  const n = asMs(ms);
  if (!Number.isFinite(n) || n <= 0) return seVazio;
  try {
    return new Date(n).toLocaleDateString('pt-BR', {
      timeZone: FUSO_BRASIL,
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return seVazio;
  }
}

/** Somente hora (para mensagens do tipo “confirmado às …”) */
export function formatarHoraBr(ms, { seVazio = '—' } = {}) {
  const n = asMs(ms);
  if (!Number.isFinite(n) || n <= 0) return seVazio;
  try {
    return new Date(n).toLocaleTimeString('pt-BR', {
      timeZone: FUSO_BRASIL,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return seVazio;
  }
}

/**
 * Data/hora em texto editável admin: dd/mm/aaaa HH:mm (24h).
 * Mesmo contrato que o input de liberação pública no painel.
 */
export function formatarDataHora24Br(ms) {
  if (!ms || !Number.isFinite(Number(ms))) return '';
  try {
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO_BRASIL,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date(Number(ms)));
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
  } catch {
    return '';
  }
}

/** Ex.: 31 de mar. de 2026, 14:30 — listas de capítulo / leitor */
export function formatarDataLancamentoCapitulo(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return '';
  try {
    return new Date(Number(ms)).toLocaleString('pt-BR', {
      timeZone: FUSO_BRASIL,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** `dataUpload` em ISO ou timestamp numérico → data curta BR */
export function formatarDataBrPartirIsoOuMs(valor, { seVazio = 'Sem data' } = {}) {
  if (valor == null || valor === '') return seVazio;
  const ms = typeof valor === 'number' ? valor : Date.parse(String(valor));
  if (!Number.isFinite(ms)) return seVazio;
  return formatarDataBr(ms, { seVazio });
}
