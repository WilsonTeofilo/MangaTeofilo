/**
 * Alinha com AvatarAdmin / Perfil: VIP, premium e valores desconhecidos = restrito.
 * Cadastro e login só devem oferecer avatares `publico`.
 */
export function normalizarAcessoAvatar(item) {
  const raw = item?.access;
  if (raw == null || String(raw).trim() === '') return 'publico';
  const v = String(raw).toLowerCase().trim();
  if (v === 'premium' || v === 'vip' || v === 'exclusivo_vip') return 'premium';
  if (v === 'publico' || v === 'public' || v === 'comum' || v === 'free') return 'publico';
  return 'premium';
}

export function avatarEhPublicoNoCadastro(item) {
  return normalizarAcessoAvatar(item) === 'publico';
}
