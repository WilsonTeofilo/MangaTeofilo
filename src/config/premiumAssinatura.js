/**
 * Preço exibido no site e enviado ao checkout Premium.
 * Deve ser o mesmo valor que PREMIUM_PRICE_BRL em functions/mercadoPagoPremium.js
 *
 * Produção: 23 — Teste barato: 0.1 (dez centavos)
 */
export const PREMIUM_PRECO_BRL = 0.1;

export function labelPrecoPremium() {
  return PREMIUM_PRECO_BRL.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
