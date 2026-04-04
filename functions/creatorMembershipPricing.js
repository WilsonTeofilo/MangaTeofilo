/**
 * Membership do autor: acesso antecipado às obras daquele criador (não confundir com Premium da plataforma).
 * Valores são definidos pelo criador no perfil após a equipe aprovar a monetização.
 */
export const CREATOR_MEMBERSHIP_PRICE_MIN_BRL = 7;
export const CREATOR_MEMBERSHIP_PRICE_MAX_BRL = 18;

export function isValidCreatorMembershipPriceBRL(n) {
  const x = Number(n);
  return (
    Number.isFinite(x) &&
    x >= CREATOR_MEMBERSHIP_PRICE_MIN_BRL &&
    x <= CREATOR_MEMBERSHIP_PRICE_MAX_BRL
  );
}

/** Pronto para exibir assinatura/apoio sugerido no perfil público (checkout). */
export function hasPublicCreatorMembershipOffer(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.creatorMembershipEnabled === false) return false;
  const p = Number(row.creatorMembershipPriceBRL);
  const d = Number(row.creatorDonationSuggestedBRL);
  return isValidCreatorMembershipPriceBRL(p) && isValidCreatorMembershipPriceBRL(d);
}
