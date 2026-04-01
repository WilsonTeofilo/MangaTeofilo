/**
 * Texto amigável para tempo restante de assinatura Premium (memberUntil em ms).
 * Ex.: 60+ dias → "2 meses"; mistura → "1 mês e 25 dias"; só dias → "5 dias".
 */
export function formatarTempoRestanteAssinatura(memberUntilMs, nowMs = Date.now()) {
  const end = Number(memberUntilMs);
  if (!Number.isFinite(end) || end <= nowMs) {
    return { texto: 'Assinatura encerrada ou expirada.', ativo: false };
  }
  const diff = end - nowMs;
  const diasTotais = Math.floor(diff / 86400000);
  const horasRest = Math.floor((diff % 86400000) / 3600000);

  if (diasTotais <= 0) {
    if (horasRest <= 0) return { texto: 'Menos de 1 hora restante.', ativo: true };
    const h = horasRest;
    return {
      texto: `${h} ${h === 1 ? 'hora' : 'horas'} restantes.`,
      ativo: true,
    };
  }

  const meses = Math.floor(diasTotais / 30);
  const dias = diasTotais % 30;

  const partes = [];
  if (meses > 0) {
    partes.push(`${meses} ${meses === 1 ? 'mês' : 'meses'}`);
  }
  if (dias > 0) {
    partes.push(`${dias} ${dias === 1 ? 'dia' : 'dias'}`);
  }

  if (partes.length === 0) {
    return { texto: 'Menos de 1 dia restante.', ativo: true };
  }

  let texto;
  if (partes.length === 1) {
    texto = `Faltam ${partes[0]}.`;
  } else {
    texto = `Faltam ${partes[0]} e ${partes[1]}.`;
  }

  return { texto, ativo: true, diasTotais, meses, dias };
}
