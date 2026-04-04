/**
 * Data de nascimento: armazenamento em ISO (AAAA-MM-DD); digitação e exibição em pt-BR (DD/MM/AAAA).
 */

function digitsToBrDisplay(digits) {
  const d = digits.slice(0, 2);
  const m = digits.slice(2, 4);
  const y = digits.slice(4, 8);
  let s = d;
  if (digits.length > 2) s += `/${m}`;
  if (digits.length > 4) s += `/${y}`;
  return s;
}

/** ISO yyyy-mm-dd válido -> "28/12/2001" */
export function formatBirthDateIsoToBr(iso) {
  const p = parseBirthDateLocal(iso);
  if (!p) return '';
  const dd = String(p.d).padStart(2, '0');
  const mm = String(p.m).padStart(2, '0');
  return `${dd}/${mm}/${p.y}`;
}

/** Durante a digitação: só números, máx. 8, máscara dd/mm/aaaa */
export function normalizeBirthDateBrTyping(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  return digitsToBrDisplay(digits);
}

/**
 * "28/12/2001" ou 8 dígitos (ddmmyyyy) -> ISO yyyy-mm-dd ou '' se inválido/futuro.
 */
export function parseBirthDateBr(display) {
  const trimmed = String(display || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  let d;
  let mo;
  let y;
  if (digits.length === 8) {
    d = digits.slice(0, 2);
    mo = digits.slice(2, 4);
    y = digits.slice(4, 8);
  } else {
    const m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return '';
    d = m[1];
    mo = m[2];
    y = m[3];
  }
  const iso = `${y}-${mo}-${d}`;
  return parseBirthDateLocal(iso) ? iso : '';
}

/**
 * Ordem: DD/MM/AAAA (ou 8 dígitos), ISO AAAA-MM-DD no texto, depois fallback em estado (já ISO).
 */
export function parseBirthDateFlexible(display, isoFallback = '') {
  const fromBr = parseBirthDateBr(display);
  if (fromBr) return fromBr;
  const t = String(display || '').trim();
  if (parseBirthDateLocal(t)) return t;
  const fb = String(isoFallback || '').trim();
  if (parseBirthDateLocal(fb)) return fb;
  return '';
}

export function parseBirthDateLocal(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return null;
  if (!Number.isInteger(mo) || mo < 1 || mo > 12) return null;
  if (!Number.isInteger(d) || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cmp = new Date(y, mo - 1, d);
  if (cmp > today) return null;
  return { y, m: mo, d };
}

export function ageFromBirthDateLocal(iso) {
  const parsed = parseBirthDateLocal(iso);
  if (!parsed) return null;
  const today = new Date();
  let age = today.getFullYear() - parsed.y;
  const hadBirthday =
    today.getMonth() + 1 > parsed.m ||
    (today.getMonth() + 1 === parsed.m && today.getDate() >= parsed.d);
  if (!hadBirthday) age -= 1;
  return age;
}

export function isMinorFromBirthDateLocal(iso) {
  const age = ageFromBirthDateLocal(iso);
  if (age == null) return false;
  return age < 18;
}

export function birthDateFromYearOnly(yearStr) {
  const y = Number(yearStr);
  if (!Number.isInteger(y) || y < 1900) return '';
  return `${y}-01-01`;
}
