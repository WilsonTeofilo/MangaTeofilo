import { resolvePublicProfileAvatarUrl } from './publicUserProfile';

/**
 * URL da imagem usada no hero publico do criador (avatar; banner manual foi removido).
 */
export function creatorPublicHeroImageUrl(perfilPublico) {
  const u = resolvePublicProfileAvatarUrl(perfilPublico, { mode: 'creator', fallback: '' });
  if (u.length > 4 && /^https?:\/\//i.test(u)) return u;
  return '/assets/fotos/shito.jpg';
}
