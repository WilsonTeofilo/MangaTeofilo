/**
 * Preferencia e status de monetizacao exibidos na UI (perfil / workspace).
 * Se a preferencia nao e monetizar, o status efetivo e sempre "disabled" para rotulos.
 */
export function normalizeCreatorMonetizationPreference(v) {
  return String(v || 'publish_only').trim().toLowerCase() === 'monetize' ? 'monetize' : 'publish_only';
}

/**
 * Consolida status quando `usuarios/{uid}` tem valores divergentes
 * (raiz vs `creatorProfile` vs `creator.monetization` apos migracoes ou updates parciais).
 */
export function resolveCreatorMonetizationStatusFromDb(row) {
  if (!row || typeof row !== 'object') return '';
  const top = String(row.creatorMonetizationStatus || '').trim().toLowerCase();
  const prof = String(row.creatorProfile?.monetizationStatus || '').trim().toLowerCase();
  const mon = row.creator?.monetization;
  const nestedActive = mon && typeof mon === 'object' && mon.enabled === true && mon.approved === true;
  if (nestedActive) return 'active';
  const pool = [top, prof].filter(Boolean);
  if (pool.includes('active')) return 'active';
  if (pool.includes('blocked_underage')) return 'blocked_underage';
  if (pool.includes('disabled')) return 'disabled';
  if (pool.includes('pending_review')) {
    return row?.creatorMonetizationApprovedOnce === true ? 'active' : 'disabled';
  }
  return top || prof || '';
}

export function effectiveCreatorMonetizationStatus(preference, status) {
  if (normalizeCreatorMonetizationPreference(preference) !== 'monetize') return 'disabled';
  return String(status || 'disabled').trim().toLowerCase();
}

export function creatorMonetizationStatusLabel(preference, status) {
  const pref = normalizeCreatorMonetizationPreference(preference);
  const norm = effectiveCreatorMonetizationStatus(preference, status);
  if (pref !== 'monetize') return 'Apenas publicar';
  if (norm === 'active') return 'Monetizacao ativa - recebendo repasses';
  if (norm === 'blocked_underage') return 'Monetizacao bloqueada por idade';
  return 'Configuracao pendente';
}
