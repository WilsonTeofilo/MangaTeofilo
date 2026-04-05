import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { onValueWritten } from 'firebase-functions/v2/database';
import { buildUserEntitlementsPatch } from '../userEntitlements.js';

function sameJsonShape(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export const seedUserEntitlementsOnUsuarioCreate = onValueWritten(
  {
    ref: '/usuarios/{uid}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!before || !after) return;
    if (before.exists()) return;
    if (!after.exists()) return;

    const uid = String(event.params?.uid || '').trim();
    if (!uid) return;

    const val = after.val();
    if (!val || typeof val !== 'object') return;
    if (val.userEntitlements?.global && typeof val.userEntitlements.global === 'object') return;

    const db = getDatabase();
    const patch = buildUserEntitlementsPatch(val);
    try {
      await db.ref(`usuarios/${uid}/userEntitlements`).set(patch.userEntitlements);
      logger.info('userEntitlements semeado (novo usuario)', { uid });
    } catch (e) {
      logger.error('seedUserEntitlements falhou', { uid, error: e?.message });
    }
  }
);

export const syncCanonicalUserEntitlementsOnUsuarioWrite = onValueWritten(
  {
    ref: '/usuarios/{uid}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists()) return;
    const uid = String(event.params?.uid || '').trim();
    if (!uid) return;
    const row = after.val() || {};
    if (!row || typeof row !== 'object') return;

    const nextEntitlements = buildUserEntitlementsPatch(row).userEntitlements;
    const patch = {};
    if (!sameJsonShape(row.userEntitlements || null, nextEntitlements)) {
      patch.userEntitlements = nextEntitlements;
    }
    if (
      Object.prototype.hasOwnProperty.call(row, 'creatorMemberships') &&
      row.creatorMemberships != null
    ) {
      patch.creatorMemberships = null;
    }

    const currentAccountType = String(row.accountType || 'comum').trim().toLowerCase();
    const nextAccountType =
      currentAccountType === 'admin'
        ? 'admin'
        : (nextEntitlements.global.isPremium === true ? 'premium' : 'comum');
    const nextMembershipStatus = String(nextEntitlements.global.status || 'inativo').trim() || 'inativo';
    const nextMemberUntil = Number.isFinite(Number(nextEntitlements.global.memberUntil))
      ? Number(nextEntitlements.global.memberUntil)
      : null;

    if (currentAccountType !== nextAccountType) patch.accountType = nextAccountType;
    if (String(row.membershipStatus || 'inativo').trim().toLowerCase() !== nextMembershipStatus) {
      patch.membershipStatus = nextMembershipStatus;
    }
    if ((row.memberUntil ?? null) !== nextMemberUntil) patch.memberUntil = nextMemberUntil;
    if (nextAccountType !== 'premium' && nextAccountType !== 'admin' && row.currentPlanId != null) {
      patch.currentPlanId = null;
    }

    if (!Object.keys(patch).length) return;
    try {
      await getDatabase().ref(`usuarios/${uid}`).update(patch);
    } catch (error) {
      logger.error('syncCanonicalUserEntitlementsOnUsuarioWrite falhou', { uid, error: error?.message });
    }
  }
);
