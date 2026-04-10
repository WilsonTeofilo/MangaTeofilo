const DEFAULT_TRUSTED_BUCKETS = [
  'shitoproject-ed649.firebasestorage.app',
  'shitoproject-ed649.appspot.com',
  'demo-shitomanga-local.appspot.com',
];

function normalizedBuckets() {
  const envBuckets = [
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    import.meta.env.VITE_FIREBASE_EMULATOR_PROJECT_ID
      ? `${String(import.meta.env.VITE_FIREBASE_EMULATOR_PROJECT_ID).trim()}.appspot.com`
      : '',
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_TRUSTED_BUCKETS, ...envBuckets])];
}

function hasExpectedFileExtension(pathname, allowedExtensions) {
  if (!allowedExtensions?.length) return true;
  const lower = String(pathname || '').toLowerCase();
  return allowedExtensions.some((ext) => lower.endsWith(ext));
}

function pathLooksLikeTrustedFirebaseObject(parsed, buckets) {
  const host = String(parsed.hostname || '').trim().toLowerCase();
  const pathname = String(parsed.pathname || '').trim();
  if (/^(127\.0\.0\.1|localhost)$/.test(host) && parsed.port === '9199') {
    return buckets.some((bucket) => pathname.includes(`/b/${bucket}/o/`));
  }
  if (host === 'firebasestorage.googleapis.com') {
    return buckets.some((bucket) => pathname.includes(`/b/${bucket}/o/`));
  }
  if (host === 'storage.googleapis.com') {
    return buckets.some((bucket) => pathname.startsWith(`/${bucket}/`));
  }
  return false;
}

export function isTrustedPlatformAssetUrl(
  url,
  { allowLocalAssets = false, allowedExtensions = [] } = {}
) {
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
    return pathLooksLikeTrustedFirebaseObject(parsed, normalizedBuckets());
  } catch {
    return false;
  }
}

/**
 * Imagens validas para o app: assets locais do projeto ou arquivos do bucket da plataforma.
 * Nao use isso para incentivar o usuario a colar URL manual; o fluxo comum deve ser upload.
 */
export function filterTrustedPlatformImageUrls(urls, { allowLocalAssets = false } = {}) {
  return (Array.isArray(urls) ? urls : []).filter((url) =>
    isTrustedPlatformAssetUrl(url, {
      allowLocalAssets,
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
    })
  );
}
