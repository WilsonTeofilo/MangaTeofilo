/**
 * Mensagens de agradecimento após retorno do checkout (modal no site).
 * Não substitui confirmação oficial do MP — só UX.
 */

export const MENSAGEM_POR_PLANO = {
  cafe:
    'Valeu pelo café! ☕ Cada gole vira traço na página — você faz parte da tempestade.',
  marmita:
    'Marmita recebida com honra! 🍱 Força de guerreiro pra seguir desenhando o próximo capítulo.',
  lendario:
    'LENDÁRIO! 🔥 Esse apoio mexe com o cosmos da obra — obrigado de coração, guerreiro(a).',
};

/**
 * Doação com valor livre (Pix/checkout) — faixas em R$.
 */
export function mensagemDoacaoLivre(valorNum) {
  const v = Number(valorNum);
  if (!Number.isFinite(v) || v < 1) {
    return 'Obrigado por apoiar Shito! Sua energia fortalece a história.';
  }
  if (v < 20) {
    return 'Obrigado pela doação! Cada real conta — você ajuda a manter a tempestade viva.';
  }
  if (v < 50) {
    return 'Nossa, que gesto FORTE! ⚡ Esse apoio dá fôlego sério pro mangá — muito obrigado!';
  }
  return 'Você foi além! 🌩️ Um agradecimento enorme — esse nível de apoio marca a obra. Obrigado de verdade!';
}

export function montarTituloModalAgradecimento({ planId, valorCustom }) {
  if (planId && MENSAGEM_POR_PLANO[planId]) return 'Tempestade agradece!';
  if (valorCustom != null) return 'Doação recebida!';
  return 'Obrigado!';
}
