/**
 * Preferencia e status de monetizacao exibidos na UI (perfil / workspace).
 * Se a preferencia nao e monetizar, o status efetivo e sempre "disabled" para rotulos.
 */
export function normalizeCreatorMonetizationPreference(v) {
  return String(v || 'publish_only').trim().toLowerCase() === 'monetize' ? 'monetize' : 'publish_only';
}

export function resolveCreatorMonetizationPreferenceFromDb(row) {
  const publicMon = row?.creatorProfile?.monetization;
  if (publicMon && typeof publicMon === 'object' && String(publicMon.preference || '').trim()) {
    return normalizeCreatorMonetizationPreference(publicMon.preference);
  }
  const mon = row?.creator?.monetization;
  if (mon && typeof mon === 'object') {
    if (String(mon.preference || '').trim().length > 0) {
      return normalizeCreatorMonetizationPreference(mon.preference);
    }
    const applicationStatus = String(mon?.application?.status || '').trim().toLowerCase();
    const financialStatus = String(mon?.financial?.status || '').trim().toLowerCase();
    if (
      ['pending', 'approved', 'rejected', 'blocked_underage'].includes(applicationStatus) ||
      ['active', 'paused'].includes(financialStatus) ||
      Boolean(mon.legal) ||
      Boolean(mon.payout)
    ) {
      return 'monetize';
    }
  }
  return 'publish_only';
}

export function resolveCreatorMonetizationApplicationStatusFromDb(row) {
  if (!row || typeof row !== 'object') return 'not_requested';
  const publicMon = row?.creatorProfile?.monetization;
  const projected = String(publicMon?.applicationStatus || '').trim().toLowerCase();
  if (projected) return projected;
  const mon = row?.creator?.monetization;
  const canonical = String(mon?.application?.status || '').trim().toLowerCase();
  if (canonical) return canonical;
  if (row?.creator?.meta?.isAdult === false) return 'blocked_underage';
  return 'not_requested';
}

export function resolveCreatorFinancialStatusFromDb(row) {
  if (!row || typeof row !== 'object') return 'inactive';
  const publicMon = row?.creatorProfile?.monetization;
  const projected = String(publicMon?.financialStatus || '').trim().toLowerCase();
  if (projected === 'active' || projected === 'inactive' || projected === 'paused') {
    return projected;
  }
  const mon = row?.creator?.monetization;
  const canonical = String(mon?.financial?.status || '').trim().toLowerCase();
  if (canonical === 'active' || canonical === 'inactive' || canonical === 'paused') {
    return canonical;
  }
  return 'inactive';
}

export function resolveCreatorMonetizationFlags(row) {
  const approved = resolveCreatorMonetizationApplicationStatusFromDb(row) === 'approved';
  const active = resolveCreatorFinancialStatusFromDb(row) === 'active';
  return { isApproved: approved, isMonetizationActive: active };
}

export function resolveCreatorSupportOfferFromDb(row) {
  const publicOffer =
    row?.creatorProfile?.monetization?.supportOffer &&
    typeof row.creatorProfile.monetization.supportOffer === 'object'
      ? row.creatorProfile.monetization.supportOffer
      : row?.creatorProfile?.supportOffer &&
          typeof row.creatorProfile.supportOffer === 'object'
        ? row.creatorProfile.supportOffer
        : null;
  const publicProjectedOffer =
    row?.publicProfile?.creatorProfile?.monetization?.supportOffer &&
    typeof row.publicProfile.creatorProfile.monetization.supportOffer === 'object'
      ? row.publicProfile.creatorProfile.monetization.supportOffer
      : row?.publicProfile?.creatorProfile?.supportOffer &&
          typeof row.publicProfile.creatorProfile.supportOffer === 'object'
        ? row.publicProfile.creatorProfile.supportOffer
        : null;
  const canonicalOffer =
    row?.creator?.monetization?.offer && typeof row.creator.monetization.offer === 'object'
      ? row.creator.monetization.offer
      : publicOffer || publicProjectedOffer || null;
  const source = canonicalOffer || {};
  const price = Number(source.membershipPriceBRL);
  const donation = Number(source.donationSuggestedBRL);
  return {
    membershipEnabled: canonicalOffer?.membershipEnabled === true,
    membershipPriceBRL: Number.isFinite(price) ? price : null,
    donationSuggestedBRL: Number.isFinite(donation) ? donation : null,
    updatedAt: Number(source.updatedAt || 0) || 0,
  };
}

/**
 * Consolida status quando `usuarios/{uid}` tem valores divergentes
 * (raiz vs `creatorProfile` vs `creator.monetization` apos migracoes ou updates parciais).
 */
export function resolveCreatorMonetizationStatusFromDb(row) {
  if (!row || typeof row !== 'object') return '';
  const publicMon = row?.creatorProfile?.monetization;
  const projected = String(publicMon?.status || '').trim().toLowerCase();
  if (projected === 'active' || projected === 'disabled' || projected === 'blocked_underage') {
    return projected;
  }
  const applicationStatus = resolveCreatorMonetizationApplicationStatusFromDb(row);
  const financialStatus = resolveCreatorFinancialStatusFromDb(row);
  if (applicationStatus === 'blocked_underage') return 'blocked_underage';
  if (applicationStatus === 'approved' && financialStatus === 'active') return 'active';
  if (row?.creator?.meta?.isAdult === false) return 'blocked_underage';
  return 'disabled';
}

export function effectiveCreatorMonetizationStatus(preference, status) {
  if (normalizeCreatorMonetizationPreference(preference) !== 'monetize') return 'disabled';
  return String(status || 'disabled').trim().toLowerCase();
}

export function resolveEffectiveCreatorMonetizationStatusFromDb(row) {
  return effectiveCreatorMonetizationStatus(
    resolveCreatorMonetizationPreferenceFromDb(row),
    resolveCreatorMonetizationStatusFromDb(row)
  );
}

export function creatorMonetizationCanToggle(row, preference) {
  const pref = normalizeCreatorMonetizationPreference(preference);
  return pref === 'monetize' && resolveCreatorMonetizationApplicationStatusFromDb(row) === 'approved';
}

export function creatorMonetizationStatusLabel(preference, status) {
  const pref = normalizeCreatorMonetizationPreference(preference);
  const norm = effectiveCreatorMonetizationStatus(preference, status);
  if (pref !== 'monetize') return 'Apenas publicar';
  if (norm === 'active') return 'Monetizacao ativa - recebendo repasses';
  if (norm === 'blocked_underage') return 'Monetizacao bloqueada por idade';
  return 'Solicitacao em analise';
}
