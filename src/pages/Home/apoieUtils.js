export function textoCountdownPromoSegundos(totalSegundos) {
  const s = Math.max(0, Math.floor(Number(totalSegundos) || 0));
  const dd = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  if (dd > 0) return `${dd}d ${p2(hh)}:${p2(mm)}:${p2(sec)}`;
  return `${p2(hh)}:${p2(mm)}:${p2(sec)}`;
}

export function formatarPrecoBrl(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n);
}

export function sanitizeCreatorId(raw) {
  const c = String(raw || '').trim();
  if (c.length < 10 || c.length > 128) return null;
  return /^[a-zA-Z0-9_-]+$/.test(c) ? c : null;
}
