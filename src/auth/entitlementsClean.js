/**
 * Entitlements — regras centralizadas de acesso pago / perks.
 *
 * PREMIUM DA PLATAFORMA (global)
 * - Canonico: `usuarios/{uid}/userEntitlements/global`
 * - Fonte unica: `usuarios/{uid}/userEntitlements/global`
 * - Beneficios: remocao de anuncios, perks globais e cosmeticos globais.
 * - Nao libera conteudo antecipado de criadores.
 *
 * MEMBERSHIP DO CRIADOR (por autor)
 * - `usuarios/{uid}/userEntitlements/creators/{creatorId}`: status, memberUntil
 * - Beneficios: acesso antecipado somente aos capitulos daquele creatorId.
 * - Nao herda perks globais do Premium da plataforma.
 *
 * ADMIN
 * - Papel admin/super_admin no perfil RTDB.
 * - Bypass total para leitura antecipada.
 */
import {
  obterEntitlementCriador,
  obterEntitlementPremiumGlobal,
  obterUserEntitlements,
  listarEntitlementsDeCriador,
} from './userEntitlements';

function toMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function membershipRowAtiva(row) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.status || 'inativo') !== 'ativo') return false;
  return toMs(row.memberUntil) > Date.now();
}

export function assinaturaPlataformaPremiumAtiva(perfil) {
  return obterEntitlementPremiumGlobal(perfil).isPremium === true;
}

export const assinaturaPremiumAtiva = assinaturaPlataformaPremiumAtiva;

export function creatorMembershipDoAutorAtiva(perfil, creatorId) {
  const row = obterEntitlementCriador(perfil, creatorId);
  return membershipRowAtiva(row);
}

export function algumaMembershipDeCriadorAtiva(perfil) {
  return listarEntitlementsDeCriador(perfil).some((row) => membershipRowAtiva(row));
}

export function listarMembershipsDeCriadorAtivas(perfil) {
  return listarEntitlementsDeCriador(perfil).filter((row) => membershipRowAtiva(row));
}

export const creatorMembershipAtiva = creatorMembershipDoAutorAtiva;
export const algumaCreatorMembershipAtiva = algumaMembershipDeCriadorAtiva;

export function usuarioTemPapelAdminPlataforma(user, perfil) {
  if (!user) return false;
  const role = String(perfil?.role ?? '').toLowerCase();
  return role === 'admin' || role === 'super_admin';
}

export function podeLerCapituloAntecipado(user, perfil, creatorIdResolvido) {
  if (!user) return false;
  if (usuarioTemPapelAdminPlataforma(user, perfil)) return true;
  const cid = String(creatorIdResolvido || '').trim();
  if (!cid) return false;
  return creatorMembershipDoAutorAtiva(perfil, cid);
}

export function usuarioTemAcessoAntecipado(user, perfil, creatorId = null) {
  return podeLerCapituloAntecipado(user, perfil, creatorId);
}

export function resolverCreatorIdDoCapitulo(cap, creatorIdFallback) {
  const fromCap = String(cap?.creatorId || '').trim();
  if (fromCap) return fromCap;
  const fb = String(creatorIdFallback || '').trim();
  return fb || null;
}

export function capituloLiberadoParaUsuario(cap, user, perfil, options = {}) {
  if (!cap) return false;
  if (user && usuarioTemPapelAdminPlataforma(user, perfil)) return true;

  const raw = cap.publicReleaseAt;
  const release = typeof raw === 'number' ? raw : raw != null ? Number(raw) : null;
  if (release == null || Number.isNaN(release) || release <= Date.now()) return true;

  if (!cap.antecipadoMembros) return false;
  const resolved = resolverCreatorIdDoCapitulo(cap, options.creatorIdFallback ?? null);
  return podeLerCapituloAntecipado(user, perfil, resolved);
}

export function podeUsarAvataresPremiumDaLoja(user, perfil) {
  if (usuarioTemPapelAdminPlataforma(user, perfil)) return true;
  return assinaturaPlataformaPremiumAtiva(perfil);
}

export function descontoVipLojaAtivo(perfil, user) {
  if (usuarioTemPapelAdminPlataforma(user, perfil)) return true;
  return assinaturaPlataformaPremiumAtiva(perfil);
}

export { obterUserEntitlements, obterEntitlementPremiumGlobal, obterEntitlementCriador };
