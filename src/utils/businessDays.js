/**
 * Prazos em dias úteis (aprox.) — avança a data ignorando sábado e domingo no fuso local.
 */

export function addBusinessDaysLocal(startMs, businessDays) {
  const n = Math.max(0, Math.floor(Number(businessDays) || 0));
  if (n === 0) return Number(startMs) || Date.now();
  const d = new Date(Number(startMs) || Date.now());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return d.getTime();
}
