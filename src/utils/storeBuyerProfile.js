function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

export function normalizeBuyerProfile(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    fullName: String(src.fullName || '').trim(),
    cpf: onlyDigits(src.cpf).slice(0, 11),
    phone: onlyDigits(src.phone).slice(0, 11),
    postalCode: onlyDigits(src.postalCode).slice(0, 8),
    state: String(src.state || '').trim().toUpperCase().slice(0, 2),
    city: String(src.city || '').trim(),
    neighborhood: String(src.neighborhood || '').trim(),
    addressLine1: String(src.addressLine1 || '').trim(),
    addressLine2: String(src.addressLine2 || '').trim(),
  };
}

export function getStoreBuyerProfileMissingFields(raw) {
  const profile = normalizeBuyerProfile(raw);
  const missing = [];
  if (profile.fullName.length < 6) missing.push('nome completo');
  if (profile.cpf.length !== 11) missing.push('CPF');
  if (profile.phone.length < 10) missing.push('telefone');
  if (profile.postalCode.length !== 8) missing.push('CEP');
  if (profile.state.length !== 2) missing.push('estado');
  if (profile.city.length < 2) missing.push('cidade');
  if (profile.neighborhood.length < 2) missing.push('bairro');
  if (profile.addressLine1.length < 6) missing.push('endereço');
  return missing;
}

export function storeBuyerProfileIsComplete(raw) {
  return getStoreBuyerProfileMissingFields(raw).length === 0;
}

/**
 * Para gravar no RTDB: campos opcionais incompletos viram vazio (evita validação rules com CPF/CEP a meio).
 */
export function sanitizeBuyerProfileForSave(raw) {
  const p = normalizeBuyerProfile(raw);
  const cpf = p.cpf;
  const phone = p.phone;
  const postalCode = p.postalCode;
  const state = p.state;
  return {
    ...p,
    cpf: cpf.length === 11 ? cpf : '',
    phone: phone.length >= 10 && phone.length <= 11 ? phone : '',
    postalCode: postalCode.length === 8 ? postalCode : '',
    state: state.length === 2 ? state : '',
  };
}

