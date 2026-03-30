export function sanitizeTrackingValue(v, maxLen = 120) {
  const s = String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-:]/g, '');
  if (!s) return null;
  return s.slice(0, maxLen);
}

export function normalizeTrackingSource(v) {
  const s = sanitizeTrackingValue(v, 40);
  if (!s) return null;
  const allowed = new Set([
    'promo_email',
    'chapter_email',
    'home_multi',
    'normal',
    'direct',
    'unknown',
  ]);
  return allowed.has(s) ? s : 'unknown';
}

export function normalizeTrackingEventType(v) {
  const s = sanitizeTrackingValue(v, 60);
  if (!s) return null;
  const allowed = new Set([
    'promo_email_sent',
    'promo_landing',
    'chapter_email_sent',
    'chapter_landing',
    'chapter_read',
    'premium_checkout_started',
    'home_block_impression',
    'home_block_click',
  ]);
  return allowed.has(s) ? s : null;
}

export function trackingDedupKey(eventType, clickId) {
  const evt = sanitizeTrackingValue(eventType, 60);
  const cid = sanitizeTrackingValue(clickId, 100);
  if (!evt || !cid) return null;
  return `${evt}|${cid}`;
}

export function buildTrackingClickId(prefix, uid, at = Date.now()) {
  const p = sanitizeTrackingValue(prefix, 24) || 'track';
  const u = sanitizeTrackingValue(uid, 48) || 'anon';
  const rand = Math.random().toString(36).slice(2, 8);
  return `${p}_${u}_${at}_${rand}`;
}
