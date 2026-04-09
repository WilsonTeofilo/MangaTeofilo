import { normalizePublicHandle } from './publicCreatorName';

export function resolvePublicProfilePath(profile, uid, { tab = '' } = {}) {
  const handle = normalizePublicHandle(profile);
  const cleanUid = String(uid || profile?.uid || '').trim();
  const base = handle ? `/@${handle}` : cleanUid ? `/criador/${encodeURIComponent(cleanUid)}` : '/works';
  const cleanTab = String(tab || '').trim().toLowerCase();
  return cleanTab ? `${base}?tab=${encodeURIComponent(cleanTab)}` : base;
}
