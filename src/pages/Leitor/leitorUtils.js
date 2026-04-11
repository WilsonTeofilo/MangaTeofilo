import { isCreatorPublicProfile } from '../../utils/publicUserProfile';
import { resolvePublicProfilePath } from '../../utils/publicProfilePaths';
import { isReaderPublicProfileEffective } from '../../utils/readerPublicProfile';
import { obterEntitlementPremiumGlobal } from '../../auth/userEntitlements';

export function commentSortTs(c) {
  if (typeof c?.data === 'number' && Number.isFinite(c.data)) return c.data;
  return 0;
}

export function mergeCapitulosLists(...lists) {
  const map = new Map();
  lists.flat().forEach((item) => {
    const id = String(item?.id || '').trim();
    if (!id) return;
    map.set(id, item);
  });
  return Array.from(map.values()).sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));
}

/** Perfil público unificado: mesma URL para autor e leitor (abas no `/criador/:uid`). */
export function publicCriadorProfilePath(perfilPublico, uid) {
  const u = String(uid || '').trim();
  if (!u || !perfilPublico) return null;
  const readerOk = isReaderPublicProfileEffective(perfilPublico);
  const looksCreator = isCreatorPublicProfile(perfilPublico);
  if (!readerOk && !looksCreator) return null;
  const tab = looksCreator ? 'works' : 'likes';
  return resolvePublicProfilePath(perfilPublico, u, { tab });
}

export function buildCommentThreads(flat, filtro) {
  const map = new Map(flat.map((c) => [c.id, { ...c, replies: [] }]));
  const roots = [];
  for (const c of flat) {
    const node = map.get(c.id);
    const pid = c.parentId ? String(c.parentId).trim() : '';
    if (pid && map.has(pid)) {
      map.get(pid).replies.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRoots = (a, b) =>
    filtro === 'relevantes'
      ? (b.likes || 0) - (a.likes || 0)
      : commentSortTs(b) - commentSortTs(a);
  const sortReplies = (a, b) => commentSortTs(a) - commentSortTs(b);
  roots.sort(sortRoots);
  const walk = (n) => {
    n.replies.sort(sortReplies);
    n.replies.forEach(walk);
  };
  roots.forEach(walk);
  return roots;
}

/** Distintivo nos comentários: apenas para o próprio usuário (entitlement canônico). */
export function isContaPremium(commentUid, currentUser, currentProfile) {
  if (!currentUser?.uid || !currentProfile) return false;
  if (String(commentUid || '') !== String(currentUser.uid)) return false;
  return obterEntitlementPremiumGlobal(currentProfile).isPremium === true;
}
