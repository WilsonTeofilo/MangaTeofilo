/**
 * Idade a partir de data (YYYY-MM-DD), fuso local do servidor (UTC em Cloud Functions).
 * Para compliance simples usamos comparação em UTC date-only.
 */

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * @param {string} iso YYYY-MM-DD
 * @returns {{ y: number, m: number, d: number } | null}
 */
function parseBirthDateStrict(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) return null;
  if (!Number.isInteger(mo) || mo < 1 || mo > 12) return null;
  if (!Number.isInteger(d) || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const today = new Date();
  const ty = today.getUTCFullYear();
  const tm = today.getUTCMonth() + 1;
  const td = today.getUTCDate();
  if (y > ty || (y === ty && mo > tm) || (y === ty && mo === tm && d > td)) return null;
  return { y, m: mo, d };
}

/**
 * Idade em anos completos (regra aniversário).
 * @param {string} iso
 * @returns {number | null}
 */
function ageFromBirthDateIso(iso) {
  const parsed = parseBirthDateStrict(iso);
  if (!parsed) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - parsed.y;
  const hadBirthday =
    today.getUTCMonth() + 1 > parsed.m ||
    (today.getUTCMonth() + 1 === parsed.m && today.getUTCDate() >= parsed.d);
  if (!hadBirthday) age -= 1;
  return age;
}

function creatorAgeFromBirthYear(birthYear) {
  const year = Number(birthYear);
  if (!Number.isInteger(year) || year < 1900) return null;
  return new Date().getUTCFullYear() - year;
}

function resolveCreatorAgeYears(row) {
  const iso = String(row?.birthDate || '').trim();
  if (iso) {
    const a = ageFromBirthDateIso(iso);
    if (a != null) return a;
  }
  return creatorAgeFromBirthYear(row?.birthYear);
}

const CPF_INVALID = new Set([
  '00000000000',
  '11111111111',
  '22222222222',
  '33333333333',
  '44444444444',
  '55555555555',
  '66666666666',
  '77777777777',
  '88888888888',
  '99999999999',
]);

function cpfCheckDigit(base10, factorStart) {
  let sum = 0;
  for (let i = 0; i < base10.length; i += 1) {
    sum += Number(base10[i]) * (factorStart - i);
  }
  const mod = (sum * 10) % 11;
  return mod === 10 ? 0 : mod;
}

/**
 * @param {string} raw
 * @returns {string | null} 11 dígitos ou null
 */
function normalizeAndValidateCpf(raw) {
  const d = onlyDigits(raw);
  if (d.length !== 11) return null;
  if (CPF_INVALID.has(d)) return null;
  const d9 = cpfCheckDigit(d.slice(0, 9), 10);
  if (d9 !== Number(d[9])) return null;
  const d10 = cpfCheckDigit(d.slice(0, 10), 11);
  if (d10 !== Number(d[10])) return null;
  return d;
}

function looksLikeLegalFullName(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (t.length < 6) return false;
  return /\s/.test(t);
}

export {
  parseBirthDateStrict,
  ageFromBirthDateIso,
  creatorAgeFromBirthYear,
  resolveCreatorAgeYears,
  normalizeAndValidateCpf,
  looksLikeLegalFullName,
  onlyDigits,
};
