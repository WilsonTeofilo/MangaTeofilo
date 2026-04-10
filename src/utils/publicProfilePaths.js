import { normalizePublicHandle } from './publicCreatorName';

export function resolvePublicProfilePath(profile, uid, { tab = '' } = {}) {
  const cleanUid = String(uid || profile?.uid || '').trim();
  const handle = normalizePublicHandle(profile);
  const base = cleanUid ? `/criador/${encodeURIComponent(cleanUid)}` : handle ? `/@${handle}` : '/works';
  const cleanTab = String(tab || '').trim().toLowerCase();
  return cleanTab ? `${base}?tab=${encodeURIComponent(cleanTab)}` : base;
}
