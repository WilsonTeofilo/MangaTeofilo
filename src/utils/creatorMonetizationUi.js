/**
 * Preferência e status de monetização exibidos na UI (perfil / workspace).
 * Se a preferência não é monetizar, o status efetivo é sempre "disabled" para rótulos,
 * mesmo que o RTDB ainda tenha um valor antigo (ex.: pending_review).
 */
export function normalizeCreatorMonetizationPreference(v) {
  return String(v || 'publish_only').trim().toLowerCase() === 'monetize' ? 'monetize' : 'publish_only';
}

export function effectiveCreatorMonetizationStatus(preference, status) {
  if (normalizeCreatorMonetizationPreference(preference) !== 'monetize') return 'disabled';
  return String(status || 'disabled').trim().toLowerCase();
}

export function creatorMonetizationStatusLabel(preference, status) {
  const pref = normalizeCreatorMonetizationPreference(preference);
  const norm = effectiveCreatorMonetizationStatus(preference, status);
  if (pref !== 'monetize') return 'Apenas publicar';
  if (norm === 'active') return 'Monetizacao ativa';
  if (norm === 'pending_review') return 'Monetizacao em revisao';
  if (norm === 'blocked_underage') return 'Monetizacao bloqueada por idade';
  return 'Configuracao pendente';
}
