import { HttpsError } from 'firebase-functions/v2/https';
import { sanitizeCreatorId } from '../creatorDataLedger.js';

export async function getMonetizableCreatorPublicProfile(
  db,
  creatorId,
  { requireMembershipEnabled = false } = {}
) {
  const cid = sanitizeCreatorId(creatorId);
  if (!cid) {
    throw new HttpsError('invalid-argument', 'creatorId invalido.');
  }
  const [publicSnap, privateSnap] = await Promise.all([
    db.ref(`usuarios_publicos/${cid}`).get(),
    db.ref(`usuarios/${cid}`).get(),
  ]);
  if (!publicSnap.exists()) {
    throw new HttpsError('not-found', 'Perfil publico do criador nao encontrado.');
  }
  const creatorPublic = publicSnap.val() || {};
  const creatorPrivate = privateSnap.exists() ? privateSnap.val() || {} : {};
  const creatorMonetizationPreference = String(
    creatorPrivate.creatorMonetizationPreference ||
      creatorPublic.creatorMonetizationPreference ||
      'publish_only'
  )
    .trim()
    .toLowerCase();
  const creatorMonetizationStatus =
    creatorMonetizationPreference === 'monetize'
      ? String(
          creatorPrivate.creatorMonetizationStatus || creatorPublic.creatorMonetizationStatus || ''
        )
          .trim()
          .toLowerCase()
      : 'disabled';
  const creatorMonetizationApprovedOnce =
    creatorPrivate.creatorMonetizationApprovedOnce === true ||
    creatorPrivate?.creator?.monetization?.approved === true;
  if (creatorMonetizationStatus !== 'active' || creatorMonetizationApprovedOnce !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Este criador esta em modo apenas publicar e nao pode receber agora.'
    );
  }
  if (requireMembershipEnabled && creatorPrivate.creatorMembershipEnabled !== true) {
    throw new HttpsError('failed-precondition', 'Este criador ainda nao ativou a membership publica.');
  }
  return {
    ...creatorPublic,
    creatorMembershipEnabled: creatorPrivate.creatorMembershipEnabled === true,
    creatorMembershipPriceBRL:
      creatorPrivate.creatorMembershipPriceBRL ?? creatorPublic.creatorMembershipPriceBRL,
    creatorDonationSuggestedBRL:
      creatorPrivate.creatorDonationSuggestedBRL ?? creatorPublic.creatorDonationSuggestedBRL,
    creatorMonetizationPreference,
    creatorMonetizationStatus,
    creatorMonetizationApprovedOnce,
  };
}
