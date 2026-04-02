/**
 * Normalização e validação de chave PIX por tipo (compliance / repasse).
 */

import { normalizeAndValidateCpf, onlyDigits } from './creatorCompliance.js';

export const PAYOUT_PIX_TYPES = Object.freeze(['cpf', 'email', 'phone', 'random']);

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

export function inferPayoutPixTypeFromKey(keyClean) {
  const t = String(keyClean || '').trim();
  if (!t) return 'random';
  const d = onlyDigits(t);
  if (d.length === 11 && normalizeAndValidateCpf(d)) return 'cpf';
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

export function coercePayoutPixType(declaredRaw, keyClean) {
  const s = String(declaredRaw || '').trim().toLowerCase();
  if (PAYOUT_PIX_TYPES.includes(s)) return s;
  return inferPayoutPixTypeFromKey(keyClean);
}

export function normalizePixPayoutKey(typeRaw, rawInput) {
  let type = String(typeRaw || '').trim().toLowerCase();
  if (!PAYOUT_PIX_TYPES.includes(type)) {
    type = inferPayoutPixTypeFromKey(String(rawInput || '').trim());
  }
  const raw = String(rawInput || '');
  if (type === 'cpf') {
    return onlyDigits(raw).slice(0, 11);
  }
  if (type === 'email') {
    return raw.trim().toLowerCase();
  }
  if (type === 'phone') {
    let d = onlyDigits(raw);
    if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
    return d.slice(0, 11);
  }
  if (type === 'random') {
    return raw.trim().slice(0, 2000);
  }
  return raw.trim();
}

export function validatePixPayout(typeRaw, keyNormalized) {
  const type = String(typeRaw || '').trim().toLowerCase();
  const k = String(keyNormalized || '');
  if (!PAYOUT_PIX_TYPES.includes(type)) {
    return { ok: false, message: 'Tipo de chave Pix invalido.' };
  }
  if (!k) {
    return { ok: false, message: 'Informe sua chave PIX para repasse manual.' };
  }
  if (type === 'cpf') {
    if (k.length !== 11 || !normalizeAndValidateCpf(k)) {
      return { ok: false, message: 'Chave PIX CPF invalida (verifique os digitos).' };
    }
    return { ok: true };
  }
  if (type === 'email') {
    if (k.length > 254) {
      return { ok: false, message: 'E-mail muito longo.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) {
      return { ok: false, message: 'Informe um e-mail valido para a chave PIX.' };
    }
    return { ok: true };
  }
  if (type === 'phone') {
    const d = onlyDigits(k);
    if (d.length !== 10 && d.length !== 11) {
      return { ok: false, message: 'Telefone PIX: use DDD + numero (10 ou 11 digitos).' };
    }
    const ddd = Number(d.slice(0, 2));
    if (ddd < 11 || ddd > 99) {
      return { ok: false, message: 'DDD invalido na chave PIX telefone.' };
    }
    return { ok: true };
  }
  if (!validateRandomPixKey(k)) {
    return {
      ok: false,
      message: 'Chave aleatoria invalida (UUID 32 hex, com ou sem hifens).',
    };
  }
  return { ok: true };
}
