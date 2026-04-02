/**
 * Leitura / liberação de capítulos e re-export de entitlements.
 * A regra de negócio vive em `auth/entitlementsClean.js`.
 */

export {
  assinaturaPlataformaPremiumAtiva,
  assinaturaPremiumAtiva,
  creatorMembershipDoAutorAtiva,
  creatorMembershipAtiva,
  algumaMembershipDeCriadorAtiva,
  algumaCreatorMembershipAtiva,
  listarMembershipsDeCriadorAtivas,
  obterUserEntitlements,
  obterEntitlementPremiumGlobal,
  obterEntitlementCriador,
  usuarioTemPapelAdminPlataforma,
  podeLerCapituloAntecipado,
  usuarioTemAcessoAntecipado,
  resolverCreatorIdDoCapitulo,
  capituloLiberadoParaUsuario,
  podeUsarAvataresPremiumDaLoja,
  descontoVipLojaAtivo,
} from '../auth/entitlementsClean';

export { formatarDataLancamentoCapitulo as formatarDataLancamento } from './datasBr';

