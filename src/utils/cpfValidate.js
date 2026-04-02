/** Validação de CPF (11 dígitos) — espelho da lógica usada nas Cloud Functions. */

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
 * @returns {boolean}
 */
export function isValidBrazilianCpfDigits(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (CPF_INVALID.has(d)) return false;
  const d9 = cpfCheckDigit(d.slice(0, 9), 10);
  if (d9 !== Number(d[9])) return false;
  const d10 = cpfCheckDigit(d.slice(0, 10), 11);
  return d10 === Number(d[10]);
}

/** Exibição: 12345678901 → 123.456.789-01 */
export function formatCpfForDisplay(digits) {
  const d = String(digits || '').replace(/\D/g, '').slice(0, 11);
  if (d.length !== 11) return d || '—';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
