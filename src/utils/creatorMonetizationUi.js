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

import { buildCreatorProgressViewModel, metricsFromUsuarioRow } from './creatorProgression';

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
  if (pref !== 'monetize') return 'Publicacao sem monetizacao';
  if (norm === 'active') return 'Monetizacao ativa';
  if (norm === 'blocked_underage') return 'Monetizacao indisponivel por idade';
  return 'Monetizacao ainda nao liberada';
}

export function resolveCreatorMonetizationEligibilityFromDb(row) {
  const progress = buildCreatorProgressViewModel(metricsFromUsuarioRow(row || {}));
  return {
    level: Number(progress?.level || 0) || 0,
    unlocked: progress?.monetizationThresholdReached === true,
    gapMessage: String(progress?.primaryMonetizationGapPhrase || '').trim(),
    progressPercent: Number(progress?.monetizationProgressPercent || 0) || 0,
  };
}

export function resolveCreatorMonetizationUiState(row) {
  const preference = resolveCreatorMonetizationPreferenceFromDb(row);
  const applicationStatus = resolveCreatorMonetizationApplicationStatusFromDb(row);
  const financialStatus = resolveCreatorFinancialStatusFromDb(row);
  const effectiveStatus = resolveEffectiveCreatorMonetizationStatusFromDb(row);
  const eligibility = resolveCreatorMonetizationEligibilityFromDb(row);
  const creatorAccessStatus = String(row?.creatorApplicationStatus || '').trim().toLowerCase();

  if (creatorAccessStatus !== 'approved') {
    return {
      key: 'creator_access_pending',
      title: 'Acesso de creator em andamento',
      detail:
        'Seu acesso de creator ainda nao foi concluido. A monetizacao so aparece depois que o perfil de creator estiver aprovado.',
      cta: 'Concluir creator',
      canRequestNow: false,
      preference,
      applicationStatus,
      financialStatus,
      effectiveStatus,
      eligibility,
    };
  }

  if (applicationStatus === 'blocked_underage' || row?.creator?.meta?.isAdult === false) {
    return {
      key: 'blocked_underage',
      title: 'Monetizacao indisponivel por idade',
      detail:
        'Voce pode publicar normalmente, mas repasses financeiros so ficam disponiveis para maiores de 18 anos.',
      cta: 'Ver requisitos',
      canRequestNow: false,
      preference,
      applicationStatus,
      financialStatus,
      effectiveStatus,
      eligibility,
    };
  }

  if (!eligibility.unlocked) {
    return {
      key: 'locked_by_level',
      title: 'Monetizacao desbloqueia no nivel 2 da plataforma',
      detail:
        eligibility.gapMessage ||
        `Seu nivel atual e ${eligibility.level}. Continue crescendo para liberar a solicitacao documental.`,
      cta: 'Ver metas',
      canRequestNow: false,
      preference,
      applicationStatus,
      financialStatus,
      effectiveStatus,
      eligibility,
    };
  }

  if (applicationStatus === 'pending') {
    return {
      key: 'documents_under_review',
      title: 'Documentos enviados para analise',
      detail:
        'Sua solicitacao foi enviada. Agora a equipe precisa conferir os dados antes de liberar qualquer repasse.',
      cta: 'Ver solicitacao',
      canRequestNow: false,
      preference,
      applicationStatus,
      financialStatus,
      effectiveStatus,
      eligibility,
    };
  }

  if (applicationStatus === 'rejected') {
    return {
      key: 'documents_rejected',
      title: 'Solicitacao documental nao aprovada',
      detail:
        'A equipe recusou a solicitacao atual. Revise os dados e envie novamente quando estiver tudo certo.',
      cta: 'Revisar dados',
      canRequestNow: true,
      preference,
      applicationStatus,
      financialStatus,
      effectiveStatus,
      eligibility,
    };
  }

  if (applicationStatus === 'approved' && financialStatus === 'active') {
    return {
      key: 'financial_active',
      title: 'Monetizacao ativa',
      detail:
        'Equipe e financeiro ja liberaram sua conta para receber repasses e publicar apoio na pagina.',
      cta: 'Abrir monetizacao',
      canRequestNow: false,
      preference,
      applicationStatus,
      financialStatus,
      effectiveStatus,
      eligibility,
    };
  }

  if (applicationStatus === 'approved') {
    return {
      key: 'documents_approved_waiting_activation',
      title: 'Documentos aprovados pela equipe',
      detail:
        'A revisao manual foi concluida, mas a etapa financeira ainda nao foi ativada para repasses.',
      cta: 'Abrir monetizacao',
      canRequestNow: false,
      preference,
      applicationStatus,
      financialStatus,
      effectiveStatus,
      eligibility,
    };
  }

  return {
    key: 'can_request_documents',
    title: 'Voce ja pode solicitar monetizacao',
    detail:
      'Seu creator ja bateu as metas minimas. O proximo passo e enviar seus dados para a equipe revisar manualmente.',
    cta: 'Solicitar monetizacao',
    canRequestNow: true,
    preference,
    applicationStatus,
    financialStatus,
    effectiveStatus,
    eligibility,
  };
}
