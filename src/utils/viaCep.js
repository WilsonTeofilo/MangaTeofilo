/**
 * Consulta ViaCEP (8 dígitos). Uso em checkout de endereço.
 * @param {string} cepRaw
 * @returns {Promise<{ ok: true, state: string, city: string, neighborhood: string, street: string } | { ok: false, error: string }>}
 */
export async function fetchViaCep(cepRaw) {
  const c = String(cepRaw || '').replace(/\D/g, '');
  if (c.length !== 8) {
    return { ok: false, error: 'CEP precisa ter 8 dígitos.' };
  }
  try {
    const res = await fetch(`https://viacep.com.br/ws/${c}/json/`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.erro) {
      return { ok: false, error: 'CEP não encontrado. Confira os números.' };
    }
    return {
      ok: true,
      state: String(data.uf || '').toUpperCase().slice(0, 2),
      city: String(data.localidade || '').trim(),
      neighborhood: String(data.bairro || '').trim(),
      street: String(data.logradouro || '').trim(),
    };
  } catch {
    return { ok: false, error: 'Não foi possível validar o CEP. Tente de novo.' };
  }
}
