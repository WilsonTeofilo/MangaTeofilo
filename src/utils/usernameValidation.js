/** Handles públicos: min 3, max 20, [a-z0-9_], não começa com número, não termina com _, sem __, não só dígitos. */

export const USERNAME_HANDLE_MIN = 3;
export const USERNAME_HANDLE_MAX = 20;

const RESERVED = new Set([
  'admin',
  'administrator',
  'support',
  'suporte',
  'api',
  'root',
  'staff',
  'moderador',
  'moderation',
  'mangateofilo',
  'shito',
  'sistema',
  'oficial',
  'help',
  'contato',
  'equipe',
  'team',
  'null',
  'undefined',
  'login',
  'logout',
  'perfil',
  'criador',
  'creator',
  'ler',
  'work',
  'loja',
  'store',
]);

/**
 * Remove @, espaços, converte para minúsculas (valor canônico no RTDB).
 * @param {string} raw
 */
export function normalizeUsernameInput(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (s.startsWith('@')) s = s.slice(1).trim();
  return s;
}

/**
 * @param {string} norm — já normalizado
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateUsernameHandle(norm) {
  const h = String(norm || '').trim().toLowerCase();
  if (!h) {
    return { ok: false, message: 'Escolha um @username.' };
  }
  if (h.length < USERNAME_HANDLE_MIN || h.length > USERNAME_HANDLE_MAX) {
    return {
      ok: false,
      message: `Use entre ${USERNAME_HANDLE_MIN} e ${USERNAME_HANDLE_MAX} caracteres.`,
    };
  }
  if (!/^[a-z]/.test(h)) {
    return { ok: false, message: 'O @username deve começar com uma letra.' };
  }
  if (h.endsWith('_')) {
    return { ok: false, message: 'O @username não pode terminar com underscore.' };
  }
  if (!/^[a-z0-9_]+$/.test(h)) {
    return { ok: false, message: 'Use apenas letras minúsculas, números e underscore.' };
  }
  if (/__/.test(h)) {
    return { ok: false, message: 'Não use dois underscores seguidos.' };
  }
  if (/^\d+$/.test(h)) {
    return { ok: false, message: 'O @username não pode ser só números.' };
  }
  if (RESERVED.has(h)) {
    return { ok: false, message: 'Este @username é reservado. Escolha outro.' };
  }
  return { ok: true };
}

/**
 * Sugestão a partir do nome de exibição (sem garantir disponibilidade).
 * @param {string} displayName
 */
export function suggestUsernameFromDisplayName(displayName) {
  const base = String(displayName || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) return '';
  const sliced = base.slice(0, USERNAME_HANDLE_MAX).replace(/_+$/g, '');
  if (sliced.length < USERNAME_HANDLE_MIN) return '';
  if (!/^[a-z]/.test(sliced)) return `u_${sliced}`.slice(0, USERNAME_HANDLE_MAX);
  return sliced;
}
