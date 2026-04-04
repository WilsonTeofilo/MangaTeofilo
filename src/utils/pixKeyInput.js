import { isValidBrazilianCpfDigits } from './cpfValidate';

/** @typedef {'cpf' | 'email' | 'phone' | 'random'} PayoutPixType */

export const PAYOUT_PIX_TYPE_OPTIONS = Object.freeze([
  { value: 'cpf', label: 'CPF' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'random', label: 'Aleatória' },
]);

const TYPES = new Set(['cpf', 'email', 'phone', 'random']);

/** Chave PIX aleatória = UUID (32 hex + 4 hífens = 36 caracteres). */
export const MAX_RANDOM_PIX_KEY_CHARS = 36;

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

function onlyHexChars(s) {
  return String(s || '').replace(/[^0-9a-fA-F]/g, '');
}

/**
 * Máscara UUID para chave PIX aleatória: só aceita hex; insere hífens 8-4-4-4-12.
 * @param {string} inputValue
 */
export function formatPixRandomDraft(inputValue) {
  const h = onlyHexChars(inputValue).slice(0, 32).toLowerCase();
  if (!h) return '';
  const a = h.slice(0, 8);
  const b = h.slice(8, 12);
  const c = h.slice(12, 16);
  const d = h.slice(16, 20);
  const e = h.slice(20, 32);
  let out = a;
  if (b) out += `-${b}`;
  if (c) out += `-${c}`;
  if (d) out += `-${d}`;
  if (e) out += `-${e}`;
  return out;
}

export function formatPixCpfDraft(digits) {
  const d = onlyDigits(digits).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatPixPhoneBrDraft(digits) {
  const d = onlyDigits(digits).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

/** @param {string} stored - valor já normalizado (sem máscara) */
export function storedPixKeyToDraft(type, stored) {
  const t = String(type || '').toLowerCase();
  const s = String(stored || '');
  if (!s) return '';
  if (t === 'cpf') return formatPixCpfDraft(s);
  if (t === 'phone') return formatPixPhoneBrDraft(s);
  if (t === 'email') return s.toLowerCase();
  if (t === 'random') {
    return formatPixRandomDraft(s);
  }
  return s;
}

/**
 * Normaliza valor para persistência (sem máscara onde aplicável).
 * @param {PayoutPixType | string} type
 * @param {string} draft - texto do input (pode ter máscara)
 */
export function normalizePixKeyForStorage(type, draft) {
  const t = String(type || '').toLowerCase();
  const raw = String(draft || '');
  if (t === 'cpf') {
    return onlyDigits(raw).slice(0, 11);
  }
  if (t === 'email') {
    return raw.trim().toLowerCase();
  }
  if (t === 'phone') {
    let d = onlyDigits(raw);
    if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
    return d.slice(0, 11);
  }
  if (t === 'random') {
    return formatPixRandomDraft(raw);
  }
  return raw.trim();
}

function validateRandomPixKey(k) {
  const t = k.trim();
  if (!t) return false;
  if (t.length === 36 && t.includes('-')) {
    const hex = t.replace(/-/g, '');
    if (!/^[0-9a-f]{32}$/i.test(hex)) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
  }
  if (t.length === 32) {
    return /^[0-9a-f]{32}$/i.test(t);
  }
  return false;
}

/**
 * @param {PayoutPixType | string} type
 * @param {string} normalized - resultado de normalizePixKeyForStorage
 * @returns {{ ok: boolean, message?: string }}
 */
export function validateNormalizedPixKey(type, normalized) {
  const t = String(type || '').toLowerCase();
  const k = String(normalized || '');
  if (!TYPES.has(t)) {
    return { ok: false, message: 'Selecione o tipo da chave PIX.' };
  }
  if (!k) {
    return { ok: false, message: 'Informe sua chave PIX.' };
  }
  if (t === 'cpf') {
    if (k.length !== 11 || !isValidBrazilianCpfDigits(k)) {
      return { ok: false, message: 'CPF inválido para chave PIX.' };
    }
    return { ok: true };
  }
  if (t === 'email') {
    if (k.length > 254) {
      return { ok: false, message: 'E-mail muito longo.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) {
      return { ok: false, message: 'E-mail inválido.' };
    }
    return { ok: true };
  }
  if (t === 'phone') {
    if (k.length !== 10 && k.length !== 11) {
      return { ok: false, message: 'Use DDD + número (10 ou 11 dígitos).' };
    }
    const ddd = Number(k.slice(0, 2));
    if (ddd < 11 || ddd > 99) {
      return { ok: false, message: 'DDD inválido.' };
    }
    return { ok: true };
  }
  if (!validateRandomPixKey(k)) {
    return {
      ok: false,
      message: 'Chave aleatória inválida (UUID 32 hex, com ou sem hífens).',
    };
  }
  return { ok: true };
}

/** Heurística para dados antigos sem `payoutPixType`. */
export function inferPayoutPixTypeFromStoredKey(keyClean) {
  const t = String(keyClean || '').trim();
  if (!t) return 'random';
  const d = onlyDigits(t);
  if (d.length === 11 && isValidBrazilianCpfDigits(d)) return 'cpf';
  if (t.includes('@') && !/\s/.test(t)) return 'email';
  let phone = d;
  if (phone.length === 13 && phone.startsWith('55')) phone = phone.slice(2);
  if (phone.length === 10 || phone.length === 11) {
    const ddd = Number(phone.slice(0, 2));
    if (ddd >= 11 && ddd <= 99) return 'phone';
  }
  if (validateRandomPixKey(t)) return 'random';
  return 'random';
}

export function coercePayoutPixType(declared, keyClean) {
  const s = String(declared || '').trim().toLowerCase();
  if (TYPES.has(s)) return /** @type {PayoutPixType} */ (s);
  return inferPayoutPixTypeFromStoredKey(keyClean);
}

export function pixKeyPlaceholder(type) {
  switch (String(type || '').toLowerCase()) {
    case 'cpf':
      return '000.000.000-00';
    case 'email':
      return 'seu@email.com';
    case 'phone':
      return '(11) 91234-5678';
    default:
      return 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
  }
}

/**
 * Atualiza o rascunho do input conforme o tipo (máscaras / lowercase).
 * @param {PayoutPixType | string} type
 * @param {string} inputValue - valor vindo do onChange
 */
export function applyPixDraftChange(type, inputValue) {
  const t = String(type || '').toLowerCase();
  const v = String(inputValue ?? '');
  if (t === 'cpf') {
    return formatPixCpfDraft(v);
  }
  if (t === 'phone') {
    return formatPixPhoneBrDraft(v);
  }
  if (t === 'email') {
    return v.toLowerCase();
  }
  if (t === 'random') {
    return formatPixRandomDraft(v);
  }
  return v;
}
