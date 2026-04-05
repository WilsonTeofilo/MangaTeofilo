/**
 * Preferencia e status de monetizacao exibidos na UI (perfil / workspace).
 * Se a preferencia nao e monetizar, o status efetivo e sempre "disabled" para rotulos.
 */
export function normalizeCreatorMonetizationPreference(v) {
  return String(v || 'publish_only').trim().toLowerCase() === 'monetize' ? 'monetize' : 'publish_only';
}

export function resolveCreatorMonetizationFlags(row) {
  const approved =
    row?.creator?.monetization?.approved === true ||
    row?.creator?.monetization?.isApproved === true;
  const active =
    row?.creator?.monetization?.isMonetizationActive === true ||
    row?.creator?.monetization?.enabled === true;
  return { isApproved: approved, isMonetizationActive: active };
}

/**
 * Consolida status quando `usuarios/{uid}` tem valores divergentes
 * (raiz vs `creatorProfile` vs `creator.monetization` apos migracoes ou updates parciais).
 */
export function resolveCreatorMonetizationStatusFromDb(row) {
  if (!row || typeof row !== 'object') return '';
  const flags = resolveCreatorMonetizationFlags(row);
  if (flags.isMonetizationActive && flags.isApproved) return 'active';
  const mon = row.creator?.monetization;
  if (mon && typeof mon === 'object') {
    const adultBlocked = row?.creator?.meta?.isAdult === false;
    if (adultBlocked) return 'blocked_underage';
    if (mon.enabled === true && (mon.approved === true || mon.isApproved === true)) return 'active';
  }
  if (row?.creator?.meta?.isAdult === false) return 'blocked_underage';
  return 'disabled';
}

export function effectiveCreatorMonetizationStatus(preference, status) {
  if (normalizeCreatorMonetizationPreference(preference) !== 'monetize') return 'disabled';
  return String(status || 'disabled').trim().toLowerCase();
}

export function creatorMonetizationCanToggle(row, preference) {
  const pref = normalizeCreatorMonetizationPreference(preference);
  const flags = resolveCreatorMonetizationFlags(row);
  return pref === 'monetize' && flags.isApproved === true;
}

export function creatorMonetizationStatusLabel(preference, status) {
  const pref = normalizeCreatorMonetizationPreference(preference);
  const norm = effectiveCreatorMonetizationStatus(preference, status);
  if (pref !== 'monetize') return 'Apenas publicar';
  if (norm === 'active') return 'Monetizacao ativa - recebendo repasses';
  if (norm === 'blocked_underage') return 'Monetizacao bloqueada por idade';
  return 'Configuracao pendente';
}
