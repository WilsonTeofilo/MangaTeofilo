/**
 * Espelha a checagem do admin antes de liberar monetização (UI + disable botão).
 * Usa `creatorComplianceAdmin` retornado pela lista de candidatos (super-admin).
 */

import { isValidBrazilianCpfDigits } from './cpfValidate';
import {
  legalFullNameHasMinThreeWords,
  legalFullNameHasNoDigits,
} from './creatorRecord';
import { inferPayoutPixTypeFromStoredKey, validateNormalizedPixKey } from './pixKeyInput';

/**
 * @param {object | null | undefined} complianceAdmin - creatorComplianceAdmin da API
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function evaluateMonetizationComplianceAdmin(complianceAdmin) {
  const reasons = [];
  if (!complianceAdmin || typeof complianceAdmin !== 'object') {
    return {
      ok: false,
      reasons: ['Nenhum dado de compliance gravado no servidor (nome legal, CPF, PIX).'],
    };
  }
  const legalFullName = String(complianceAdmin.legalFullName || '').trim();
  if (!legalFullName) {
    reasons.push('Nome completo (documento) ausente.');
  } else if (!legalFullNameHasNoDigits(legalFullName)) {
    reasons.push('Nome legal não pode conter números.');
  } else if (!legalFullNameHasMinThreeWords(legalFullName)) {
    reasons.push('Nome legal incompleto (mínimo três partes, ex.: Nome Sobrenome Filho).');
  }

  const taxDigits = String(complianceAdmin.taxIdDigits || '').replace(/\D/g, '');
  if (taxDigits.length !== 11) {
    reasons.push('CPF ausente ou incompleto (11 dígitos).');
  } else if (!isValidBrazilianCpfDigits(taxDigits)) {
    reasons.push('CPF inválido (dígitos verificadores).');
  }

  const pixKey = String(complianceAdmin.payoutKey || '').trim();
  if (!pixKey) {
    reasons.push('Chave PIX ausente.');
  } else {
    const pixType =
      String(complianceAdmin.payoutPixType || '').trim().toLowerCase() ||
      inferPayoutPixTypeFromStoredKey(pixKey);
    const v = validateNormalizedPixKey(pixType, pixKey);
    if (!v.ok) {
      reasons.push(v.message || 'Chave PIX inválida para o tipo informado.');
    }
  }

  return { ok: reasons.length === 0, reasons };
}
