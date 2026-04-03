function normalizeUrlWithHttps(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function matchesKnownHost(url, allowedHosts) {
  const host = String(url.hostname || '').trim().toLowerCase();
  return allowedHosts.some((item) => host === item || host.endsWith(`.${item}`));
}

export function normalizeCreatorInstagramUrl(raw) {
  const normalized = normalizeUrlWithHttps(raw);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (!matchesKnownHost(url, ['instagram.com'])) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeCreatorYoutubeUrl(raw) {
  const normalized = normalizeUrlWithHttps(raw);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (!matchesKnownHost(url, ['youtube.com', 'youtu.be'])) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function validateCreatorSocialLinks({ instagramUrl, youtubeUrl, requireOne = false }) {
  const instagramNormalized = normalizeCreatorInstagramUrl(instagramUrl);
  const youtubeNormalized = normalizeCreatorYoutubeUrl(youtubeUrl);
  const hasInstagramInput = String(instagramUrl || '').trim().length > 0;
  const hasYoutubeInput = String(youtubeUrl || '').trim().length > 0;

  if (hasInstagramInput && !instagramNormalized) {
    return {
      ok: false,
      message: 'Instagram invalido. Use um link real de perfil do Instagram.',
      instagramUrl: '',
      youtubeUrl: youtubeNormalized,
    };
  }

  if (hasYoutubeInput && !youtubeNormalized) {
    return {
      ok: false,
      message: 'YouTube invalido. Use um link real de canal/video do YouTube.',
      instagramUrl: instagramNormalized,
      youtubeUrl: '',
    };
  }

  if (requireOne && !instagramNormalized && !youtubeNormalized) {
    return {
      ok: false,
      message: 'Informe pelo menos um link valido de Instagram ou YouTube.',
      instagramUrl: '',
      youtubeUrl: '',
    };
  }

  return {
    ok: true,
    message: '',
    instagramUrl: instagramNormalized,
    youtubeUrl: youtubeNormalized,
  };
}
