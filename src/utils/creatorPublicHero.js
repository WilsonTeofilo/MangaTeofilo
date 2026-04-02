/**
 * URL da imagem usada no hero público do criador (avatar; banner manual foi removido).
 */
export function creatorPublicHeroImageUrl(perfilPublico) {
  const fromProfile = String(perfilPublico?.creatorProfile?.avatarUrl || '').trim();
  const fromUser = String(perfilPublico?.userAvatar || '').trim();
  const u = fromProfile || fromUser;
  if (u.length > 4 && /^https?:\/\//i.test(u)) return u;
  return '/assets/fotos/shito.jpg';
}
