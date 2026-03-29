import { applyActionCode } from 'firebase/auth';

/** Firebase pode enviar mode/oob na query ou no hash. */
export function parseAuthEmailLinkParams() {
  const search = new URLSearchParams(window.location.search);
  let mode = search.get('mode');
  let oobCode = search.get('oobCode');
  if (oobCode && mode) return { mode, oobCode };

  const hash = window.location.hash || '';
  if (hash) {
    const q = hash.indexOf('?');
    const raw = q >= 0 ? hash.slice(q + 1) : hash.replace(/^#/, '');
    const hp = new URLSearchParams(raw);
    mode = mode || hp.get('mode');
    oobCode = oobCode || hp.get('oobCode');
  }
  return { mode, oobCode };
}

/** Processa o link de verificação do Firebase (sem flags locais). */
export async function applyVerifyEmailCode(auth, oobCode) {
  await applyActionCode(auth, oobCode);
}
