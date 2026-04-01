/** Evita open-redirect: só caminhos relativos internos. */
export function resolveSafeInternalRedirect(raw) {
  if (raw == null || raw === '') return '/';
  let d;
  try {
    d = decodeURIComponent(String(raw).trim());
  } catch {
    return '/';
  }
  if (!d.startsWith('/') || d.startsWith('//')) return '/';
  if (d.toLowerCase().startsWith('/login')) return '/';
  if (d.includes('://')) return '/';
  return d;
}

/** URL da rota de login com retorno após autenticar (pathname + search do React Router). */
export function buildLoginUrlWithRedirect(pathname, search = '') {
  const q = search && String(search).startsWith('?') ? String(search) : search ? `?${search}` : '';
  const full = `${pathname || '/'}${q}`;
  if (full === '/login' || full.startsWith('/login?')) return '/login';
  return `/login?redirect=${encodeURIComponent(full)}`;
}
