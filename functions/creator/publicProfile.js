import { HttpsError } from 'firebase-functions/v2/https';
import { sanitizeCreatorId } from '../creatorDataLedger.js';
import {
  readCreatorSupportOfferFromDb,
  readCreatorStatsFromDb,
  resolveCreatorFinancialStatusFromDb,
  resolveCreatorMonetizationApplicationStatusFromDb,
  resolveCreatorMonetizationPreferenceFromDb,
  resolveCreatorMonetizationStatusFromDb,
} from '../creatorRecord.js';
import { buildPublicProfileFromUsuarioRow } from '../shared/publicUserProfile.js';

export async function getMonetizableCreatorPublicProfile(
  db,
  creatorId,
  { requireMembershipEnabled = false } = {}
) {
  const cid = sanitizeCreatorId(creatorId);
  if (!cid) {
    throw new HttpsError('invalid-argument', 'creatorId invalido.');
  }
  const [privateSnap, statsSnap] = await Promise.all([
    db.ref(`usuarios/${cid}`).get(),
    db.ref(`creators/${cid}/stats`).get(),
  ]);
  if (!privateSnap.exists()) {
    throw new HttpsError('not-found', 'Perfil publico do criador nao encontrado.');
  }
  const creatorPrivate = privateSnap.val() || {};
  const creatorPublic =
    creatorPrivate?.publicProfile && typeof creatorPrivate.publicProfile === 'object'
      ? creatorPrivate.publicProfile
      : buildPublicProfileFromUsuarioRow(creatorPrivate, cid);
  const creatorMonetizationPreference = resolveCreatorMonetizationPreferenceFromDb({
    ...creatorPublic,
    ...creatorPrivate,
  });
  const creatorMonetizationApplicationStatus =
    creatorMonetizationPreference === 'monetize'
      ? resolveCreatorMonetizationApplicationStatusFromDb(creatorPrivate)
      : 'not_requested';
  const creatorFinancialStatus =
    creatorMonetizationPreference === 'monetize'
      ? resolveCreatorFinancialStatusFromDb(creatorPrivate)
      : 'inactive';
  const creatorMonetizationStatus =
    creatorMonetizationPreference === 'monetize'
      ? resolveCreatorMonetizationStatusFromDb(creatorPrivate)
      : 'disabled';
  const creatorSupportOffer = readCreatorSupportOfferFromDb(creatorPrivate);
  const creatorMonetizationApproved = creatorMonetizationApplicationStatus === 'approved';
  const creatorMonetizationActive = creatorFinancialStatus === 'active';
  if (creatorMonetizationActive !== true || creatorMonetizationApproved !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Este criador esta em modo apenas publicar e nao pode receber agora.'
    );
  }
  if (requireMembershipEnabled && creatorSupportOffer.membershipEnabled !== true) {
    throw new HttpsError('failed-precondition', 'Este criador ainda nao ativou a membership publica.');
  }
  const creatorStats = readCreatorStatsFromDb(
    { ...creatorPublic, ...creatorPrivate },
    statsSnap.exists() ? statsSnap.val() || {} : {}
  );
  const publicCreatorProfile =
    creatorPublic?.creatorProfile && typeof creatorPublic.creatorProfile === 'object'
      ? creatorPublic.creatorProfile
      : {};
  return {
    ...creatorPublic,
    creatorProfile: {
      ...publicCreatorProfile,
      monetizationPreference: creatorMonetizationPreference,
      monetizationApplicationStatus: creatorMonetizationApplicationStatus,
      monetizationStatus: creatorMonetizationStatus,
      monetizationEnabled: creatorMonetizationActive,
      isMonetizationActive: creatorMonetizationActive,
      isApproved: creatorMonetizationApproved,
      financialStatus: creatorFinancialStatus,
      supportOffer: creatorSupportOffer,
    },
    stats: creatorStats,
    followersCount: creatorStats.followersCount,
    creatorSupportOffer,
    creatorMonetizationPreference,
    creatorMonetizationApplicationStatus,
    creatorMonetizationStatus,
    creatorFinancialStatus,
    isApproved: creatorMonetizationApproved,
    isMonetizationActive: creatorMonetizationActive,
  };
}
