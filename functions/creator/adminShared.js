import { round2 } from '../orders/storeCommon.js';
import { resolveCreatorMonetizationPreferenceFromDb } from '../creatorRecord.js';

export function resolveCreatorRequestedAtMs(row, app) {
  const top = Number(row?.creatorRequestedAt || 0);
  if (Number.isFinite(top) && top > 0) return top;
  const monetizationRequestedAt = Number(
    row?.creator?.monetization?.application?.requestedAt || row?.creatorMonetizationReviewRequestedAt || 0
  );
  if (Number.isFinite(monetizationRequestedAt) && monetizationRequestedAt > 0) return monetizationRequestedAt;
  const c1 = Number(app?.createdAt || 0);
  if (Number.isFinite(c1) && c1 > 0) return c1;
  const c2 = Number(app?.updatedAt || 0);
  if (Number.isFinite(c2) && c2 > 0) return c2;
  return 0;
}

export function slugifyCreatorUsername(input, uid) {
  const base = String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = String(uid || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  return `${base || 'criador'}${suffix ? `-${suffix}` : ''}`;
}

export function buildCreatorLifecycleEmail(base, payload) {
  const profilePath = `${base}/perfil`;
  return {
    subject: String(payload?.subject || 'Atualizacao da sua conta').trim() || 'Atualizacao da sua conta',
    text: `${String(payload?.message || '').trim()}\n\nAbra seu perfil: ${profilePath}`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#f2f2f2;padding:28px;border-radius:10px;">
        <h2 style="margin:0 0 12px;color:#ffcc00;">${String(payload?.title || 'Atualizacao')}</h2>
        <p style="margin:0 0 18px;color:#d0d0d0;">${String(payload?.message || '').trim()}</p>
        <a href="${profilePath}" style="display:inline-block;background:#ffcc00;color:#000;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">
          Abrir meu perfil
        </a>
      </div>
    `,
  };
}

export function normalizeReviewReason(raw, fallback = '') {
  return String(raw || fallback || '').trim().slice(0, 500);
}

export function resolveCreatorMonetizationPreference(row, app = null) {
  return resolveCreatorMonetizationPreferenceFromDb(row, app?.monetizationPreference || 'publish_only');
}

export function maskPixKeyForAdminSnapshot(rawPixKey) {
  const value = String(rawPixKey || '').trim();
  if (!value) return null;
  if (value.length <= 6) return value;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export function normalizePayoutRequestStatus(raw) {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'pending' || status === 'paid' || status === 'rejected' || status === 'cancelled') {
    return status;
  }
  return 'pending';
}

export function buildCreatorPayoutRequestsAdmin(rows) {
  if (!rows || typeof rows !== 'object') return [];
  return Object.entries(rows)
    .map(([requestId, row]) => {
      const current = row && typeof row === 'object' ? row : {};
      return {
        requestId: String(requestId || ''),
        creatorId: String(current.creatorId || ''),
        amount: round2(Number(current.amount || 0)),
        currency: String(current.currency || 'BRL'),
        status: normalizePayoutRequestStatus(current.status),
        requestedAt: Number(current.requestedAt || 0) || null,
        requestedByUid: String(current.requestedByUid || ''),
        availableSnapshotBRL: round2(Number(current.availableSnapshotBRL || 0)),
        pendingPayoutSnapshotBRL: round2(Number(current.pendingPayoutSnapshotBRL || 0)),
        notes: String(current.notes || ''),
        reviewedAt: Number(current.reviewedAt || 0) || null,
        reviewedByUid: String(current.reviewedByUid || ''),
        payoutId: String(current.payoutId || ''),
      };
    })
    .sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));
}

export function buildPublicCreatorProfileDoc({
  uid,
  currentPublicProfile = null,
  displayName,
  bioShort,
  bioFull = '',
  avatarUrl,
  bannerUrl = '',
  instagramUrl,
  youtubeUrl,
  monetizationPreference,
  monetizationStatus,
  monetizationApplicationStatus = null,
  monetizationFinancialStatus = null,
  supportOffer = null,
  status,
  createdAt,
  now,
}) {
  const current =
    currentPublicProfile && typeof currentPublicProfile === 'object' ? currentPublicProfile : {};
  const financialStatus =
    String(monetizationFinancialStatus || '').trim().toLowerCase() ||
    (monetizationStatus === 'active' ? 'active' : 'inactive');
  const applicationStatus =
    String(monetizationApplicationStatus || '').trim().toLowerCase() ||
    (monetizationPreference === 'monetize' ? 'approved' : 'not_requested');
  return {
    creatorId: uid,
    userId: uid,
    displayName,
    username: current.username || '',
    bioShort,
    bioFull: String(bioFull || '').trim(),
    avatarUrl: avatarUrl || '',
    bannerUrl: String(bannerUrl || current.bannerUrl || '').trim(),
    socialLinks: {
      instagramUrl: instagramUrl || null,
      youtubeUrl: youtubeUrl || null,
    },
    supportOffer:
      supportOffer && typeof supportOffer === 'object'
        ? {
            membershipEnabled: supportOffer.membershipEnabled === true,
            membershipPriceBRL: Number(supportOffer.membershipPriceBRL || 0) || null,
            donationSuggestedBRL: Number(supportOffer.donationSuggestedBRL || 0) || null,
            updatedAt: Number(supportOffer.updatedAt || now) || now,
          }
        : null,
    monetization: {
      preference: monetizationPreference,
      applicationStatus,
      financialStatus,
      status: monetizationStatus,
      isApproved: applicationStatus === 'approved',
      isActive: monetizationStatus === 'active',
      supportOffer:
        supportOffer && typeof supportOffer === 'object'
          ? {
              membershipEnabled: supportOffer.membershipEnabled === true,
              membershipPriceBRL: Number(supportOffer.membershipPriceBRL || 0) || null,
              donationSuggestedBRL: Number(supportOffer.donationSuggestedBRL || 0) || null,
              updatedAt: Number(supportOffer.updatedAt || now) || now,
            }
          : {
              membershipEnabled: false,
              membershipPriceBRL: null,
              donationSuggestedBRL: null,
              updatedAt: now,
            },
    },
    monetizationPreference,
    monetizationStatus,
    monetizationEnabled: monetizationStatus === 'active',
    isMonetizationActive: monetizationStatus === 'active',
    isApproved: applicationStatus === 'approved',
    ageVerified: current.ageVerified === true || current.ageVerified === false ? current.ageVerified : null,
    status,
    createdAt,
    updatedAt: now,
  };
}
