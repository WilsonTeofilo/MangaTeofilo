/**
 * Validação obrigatória antes de liberar monetização no admin (identidade + PIX).
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { normalizeAndValidateCpf } from './creatorCompliance.js';
import { coercePayoutPixType, normalizePixPayoutKey, validatePixPayout } from './pixKey.js';
import {
  legalFullNameHasMinThreeWords,
  legalFullNameHasNoDigits,
} from './creatorRecord.js';

/**
 * @param {object | null} compliance - usuarios/{uid}/creatorCompliance
 */
export function requireMonetizationComplianceOrThrow(compliance) {
  if (!compliance || typeof compliance !== 'object') {
    throw new HttpsError(
      'failed-precondition',
      'Sem dados de compliance para monetizacao. O criador precisa enviar nome legal, CPF valido e chave PIX no pedido ou perfil.'
    );
  }
  const legalFullName = String(compliance.legalFullName || '').trim();
  if (!legalFullNameHasNoDigits(legalFullName)) {
    throw new HttpsError(
      'failed-precondition',
      'Nome legal invalido: nao pode conter numeros.'
    );
  }
  if (!legalFullNameHasMinThreeWords(legalFullName)) {
    throw new HttpsError(
      'failed-precondition',
      'Nome legal incompleto: informe nome completo com pelo menos tres partes.'
    );
  }
  const cpfOk = normalizeAndValidateCpf(String(compliance.taxId || ''));
  if (!cpfOk) {
    throw new HttpsError(
      'failed-precondition',
      'CPF invalido ou ausente no cadastro de monetizacao.'
    );
  }
  const rawPix = String(compliance.payoutInstructions || '').trim();
  const pixType = coercePayoutPixType(
    String(compliance.payoutPixType || '').trim().toLowerCase(),
    rawPix
  );
  const pixKey = normalizePixPayoutKey(pixType, rawPix);
  const pixVal = validatePixPayout(pixType, pixKey);
  if (!pixVal.ok) {
    throw new HttpsError('failed-precondition', pixVal.message || 'Chave PIX invalida.');
  }
}
