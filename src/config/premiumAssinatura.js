/**
 * Preço exibido no site e enviado ao checkout Premium.
 * Deve ser o mesmo valor que PREMIUM_PRICE_BRL em functions/mercadoPagoPremium.js
 *
 * Produção: 23 — Teste barato: 0.1 (dez centavos)
 */
export const PREMIUM_PRECO_BRL = 23.00;

export function labelPrecoPremium(value = PREMIUM_PRECO_BRL) {
  const n = Number(value);
  const preco = Number.isFinite(n) ? n : PREMIUM_PRECO_BRL;
  return preco.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
