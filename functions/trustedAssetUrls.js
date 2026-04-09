const TRUSTED_BUCKETS = new Set([
  'shitoproject-ed649.firebasestorage.app',
  'shitoproject-ed649.appspot.com',
  'demo-shitomanga-local.appspot.com',
]);

function hasExpectedFileExtension(pathname, allowedExtensions) {
  if (!allowedExtensions?.length) return true;
  const lower = String(pathname || '').toLowerCase();
  return allowedExtensions.some((ext) => lower.endsWith(ext));
}

function pathLooksLikeTrustedFirebaseObject(parsed) {
  const host = String(parsed.hostname || '').trim().toLowerCase();
  const pathname = String(parsed.pathname || '').trim();
  if (/^(127\.0\.0\.1|localhost)$/.test(host) && parsed.port === '9199') {
    return [...TRUSTED_BUCKETS].some((bucket) => pathname.includes(`/b/${bucket}/o/`));
  }
  if (host === 'firebasestorage.googleapis.com') {
    return [...TRUSTED_BUCKETS].some((bucket) => pathname.includes(`/b/${bucket}/o/`));
  }
  if (host === 'storage.googleapis.com') {
    return [...TRUSTED_BUCKETS].some((bucket) => pathname.startsWith(`/${bucket}/`));
  }
  return false;
}

export function isTrustedPlatformAssetUrl(url, { allowLocalAssets = false, allowedExtensions = [] } = {}) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (allowLocalAssets && raw.startsWith('/assets/')) {
    return hasExpectedFileExtension(raw.split(/[?#]/)[0], allowedExtensions);
  }
  try {
    const parsed = new URL(raw);
    if (!['https:', 'http:'].includes(parsed.protocol)) return false;
    const cleanPath = decodeURIComponent(String(parsed.pathname || '').split(/[?#]/)[0]);
    if (!hasExpectedFileExtension(cleanPath, allowedExtensions)) return false;
    return pathLooksLikeTrustedFirebaseObject(parsed);
  } catch {
    return false;
  }
}
