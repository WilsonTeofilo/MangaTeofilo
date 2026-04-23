export function toInputDate(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toBrDate(isoDate) {
  if (!isoDate) return '';
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function maskBrDate(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseBrToIso(brDate) {
  const m = String(brDate || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) {
    return '';
  }
  return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function startOfDayMs(dateInput) {
  return new Date(`${dateInput}T00:00:00`).getTime();
}

export function endOfDayMs(dateInput) {
  return new Date(`${dateInput}T23:59:59`).getTime();
}

export function brl(v) {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatMonthKeyBr(key) {
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

export function pct(v) {
  if (v == null) return '--';
  const abs = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${v >= 0 ? '+' : '-'}${abs}%`;
}

export function formatGender(g) {
  const map = {
    masculino: 'Masculino',
    feminino: 'Feminino',
    outro: 'Outro',
    nao_informado: 'Nao informado',
  };
  return map[g] || 'Nao informado';
}

export function linePath(values, width, height, pad) {
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

export const DASHBOARD_TABS = ['creators', 'conteudo', 'growth'];
export const PAGE_SIZE = 10;

export function parseTab(value) {
  const t = String(value || '').trim();
  return DASHBOARD_TABS.includes(t) ? t : 'creators';
}

export function paginate(rows, page, size = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * size;
  return {
    totalPages,
    page: safePage,
    rows: rows.slice(start, start + size),
  };
}

export function textoEstimativaPagamentosNoFiltro(row) {
  const n = Number(row?.count || 0);
  const d = Number(row?.totalDays || 0);
  if (!n) return '--';
  return `${n} pg · ~${d}d`;
}

export const TITLE_COL_ESTIMATIVA =
  'Soma 30 dias por cada pagamento Premium entre as datas do filtro. Nao e o tempo restante da assinatura; use "Restante agora" e a data de expiracao.';

export function rankBadge(rank) {
  if (rank === 1) return '1º';
  if (rank === 2) return '2º';
  if (rank === 3) return '3º';
  return `${rank}.`;
}

export function percentOf(part, total) {
  const p = Number(part || 0);
  const t = Number(total || 0);
  if (!t || t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((p / t) * 1000) / 10));
}

export function sumNovosVip(rows) {
  return (rows || []).reduce((s, r) => s + Number(r?.novosVip || 0), 0);
}

export function distribuicaoSexoReceita(map) {
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

export function sexoBarClass(key) {
  const k = String(key || '');
  if (k === 'masculino') return 'dash-sexo-seg--m';
  if (k === 'feminino') return 'dash-sexo-seg--f';
  if (k === 'outro') return 'dash-sexo-seg--o';
  return 'dash-sexo-seg--ni';
}

export function formatPct0(n) {
  if (n == null || Number.isNaN(n)) return '--';
  return `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
}

export function scoreFromPercent(percent) {
  const p = Number(percent || 0);
  if (p >= 8) return { grade: 'A', label: 'Excelente', tone: 'a' };
  if (p >= 4) return { grade: 'B', label: 'Muito bom', tone: 'b' };
  if (p >= 2) return { grade: 'C', label: 'Bom', tone: 'c' };
  if (p >= 1) return { grade: 'D', label: 'Baixo', tone: 'd' };
  return { grade: 'E', label: 'Muito baixo', tone: 'e' };
}
