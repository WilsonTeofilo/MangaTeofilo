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
 * - Fonte real: `admins/registry` + claim `panelRole` resolvida no shell.
 * - `perfil.role` legado nao deve ser tratado como fonte unica para staff.
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

export function usuarioTemPapelAdminPlataforma(user, perfil, adminAccess = null) {
  if (!user) return false;
  if (adminAccess?.canAccessAdmin === true && adminAccess?.isMangaka !== true) return true;
  return false;
}

export function podeLerCapituloAntecipado(user, perfil, creatorIdResolvido, adminAccess = null) {
  if (!user) return false;
  if (usuarioTemPapelAdminPlataforma(user, perfil, adminAccess)) return true;
  const cid = String(creatorIdResolvido || '').trim();
  if (!cid) return false;
  return creatorMembershipDoAutorAtiva(perfil, cid);
}

export function usuarioTemAcessoAntecipado(user, perfil, creatorId = null, adminAccess = null) {
  return podeLerCapituloAntecipado(user, perfil, creatorId, adminAccess);
}

export function resolverCreatorIdDoCapitulo(cap) {
  const fromCap = String(cap?.creatorId || '').trim();
  if (fromCap) return fromCap;
  const fromProfile = String(cap?.creatorProfile?.creatorId || cap?.creatorProfile?.userId || '').trim();
  if (fromProfile) return fromProfile;
  const fromOwner = String(cap?.userId || cap?.uid || '').trim();
  return fromOwner || null;
}

export function capituloLiberadoParaUsuario(cap, user, perfil, options = {}) {
  if (!cap) return false;
  if (user && usuarioTemPapelAdminPlataforma(user, perfil, options.adminAccess || null)) return true;

  const raw = cap.publicReleaseAt;
  const release = typeof raw === 'number' ? raw : raw != null ? Number(raw) : null;
  if (release == null || Number.isNaN(release) || release <= Date.now()) return true;

  if (!cap.antecipadoMembros) return false;
  const resolved = resolverCreatorIdDoCapitulo(cap);
  return podeLerCapituloAntecipado(user, perfil, resolved, options.adminAccess || null);
}

export function podeUsarAvataresPremiumDaLoja(user, perfil, adminAccess = null) {
  if (usuarioTemPapelAdminPlataforma(user, perfil, adminAccess)) return true;
  return assinaturaPlataformaPremiumAtiva(perfil);
}

export function descontoVipLojaAtivo(perfil, user, adminAccess = null) {
  if (usuarioTemPapelAdminPlataforma(user, perfil, adminAccess)) return true;
  return assinaturaPlataformaPremiumAtiva(perfil);
}

export { obterUserEntitlements, obterEntitlementPremiumGlobal, obterEntitlementCriador };
