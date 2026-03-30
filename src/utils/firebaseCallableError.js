/**
 * Extrai mensagem legível de erro do httpsCallable (Firebase Functions).
 */
export function mensagemErroCallable(err) {
  if (!err) return 'Erro desconhecido.';
  const code = err.code || '';
  const msg = err.message || '';

  if (code === 'functions/failed-precondition') {
    return msg || 'Servidor não configurado (ex.: secret MP_ACCESS_TOKEN).';
  }
  if (code === 'functions/invalid-argument') {
    return msg || 'Dados inválidos.';
  }
  if (code === 'functions/unavailable') {
    return 'Serviço temporariamente indisponível. Tente de novo em instantes.';
  }
  if (code === 'functions/permission-denied') {
    return msg || 'Permissão negada ao chamar a função.';
  }
  if (msg) return msg;
  return 'Não foi possível abrir o checkout.';
}
