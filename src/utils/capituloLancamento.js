/**
 * Leitura / liberaÃ§Ã£o de capÃ­tulos e re-export de entitlements.
 * A regra de negÃ³cio vive em `auth/entitlementsClean.js`; mantemos este arquivo para imports legados.
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

