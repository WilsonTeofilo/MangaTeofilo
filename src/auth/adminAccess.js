import { getIdTokenResult } from 'firebase/auth';
import { isAdminUser } from '../constants';

export function emptyAdminAccess() {
  return {
    byClaim: false,
    byAllowlist: false,
    canAccessAdmin: false,
    claimChecked: false,
  };
}

/**
 * Resolve acesso admin unificando custom claim e allowlist legada.
 * Mantemos os dois por compatibilidade enquanto as claims sao padronizadas.
 */
export async function resolveAdminAccess(user) {
  if (!user) return emptyAdminAccess();

  const byAllowlist = isAdminUser(user);
  let byClaim = false;
  let claimChecked = false;

  try {
    const tokenResult = await getIdTokenResult(user, false);
    byClaim = tokenResult?.claims?.admin === true;
    claimChecked = true;
  } catch {
    claimChecked = false;
  }

  return {
    byClaim,
    byAllowlist,
    canAccessAdmin: byAllowlist || byClaim,
    claimChecked,
  };
}
