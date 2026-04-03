const STORAGE_KEY = 'shito.lastAttribution';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function clean(value, maxLen = 120) {
  const s = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-:]/g, '');
  if (!s) return null;
  return s.slice(0, maxLen);
}

function normalizeSource(raw) {
  const s = clean(raw, 40);
  if (!s) return null;
  const allowed = new Set(['promo_email', 'promo_admin', 'chapter_email', 'normal', 'direct', 'unknown']);
  return allowed.has(s) ? s : 'unknown';
}

function normalizeCreatorId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.length < 10 || s.length > 128) return null;
  return /^[a-zA-Z0-9_-]+$/.test(s) ? s : null;
}

export function parseAttributionFromSearch(searchParams) {
  if (!searchParams) return null;
  const source = normalizeSource(searchParams.get('src') || searchParams.get('utm_source'));
  const campaignId = clean(searchParams.get('camp') || searchParams.get('utm_campaign'), 100);
  const clickId = clean(searchParams.get('cid') || searchParams.get('click_id'), 120);
  const creatorId = normalizeCreatorId(searchParams.get('creatorId') || searchParams.get('criador'));
  if (!source && !campaignId && !clickId && !creatorId) return null;
  return {
    source: source || 'unknown',
    campaignId: campaignId || null,
    clickId: clickId || null,
    creatorId,
    capturedAt: Date.now(),
  };
}

export function persistAttribution(attribution) {
  if (typeof window === 'undefined') return;
  if (!attribution || !attribution.source) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // noop
  }
}

export function getAttribution(maxAgeMs = MAX_AGE_MS) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const source = normalizeSource(parsed?.source);
    if (!source) return null;
    const capturedAt = Number(parsed?.capturedAt || 0);
    if (!capturedAt || Date.now() - capturedAt > maxAgeMs) return null;
    return {
      source,
      campaignId: clean(parsed?.campaignId, 100),
      clickId: clean(parsed?.clickId, 120),
      creatorId: normalizeCreatorId(parsed?.creatorId),
      capturedAt,
    };
  } catch {
    return null;
  }
}

export function clearAttribution() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
