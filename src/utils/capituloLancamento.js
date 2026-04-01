import { isAdminUser } from '../constants';

/**
 * Assinatura Premium (Mercado Pago) ativa e dentro do prazo.
 * Doações e conta “membro” manual não entram — só premium pago.
 */
export function assinaturaPremiumAtiva(perfil) {
  if (!perfil) return false;
  if (String(perfil.accountType ?? 'comum').toLowerCase() !== 'premium') return false;
  if (perfil.membershipStatus !== 'ativo') return false;
  const until = perfil.memberUntil;
  if (typeof until === 'number' && until < Date.now()) return false;
  return true;
}

/** Acesso antecipado a capítulos (agendados): só Premium ativo ou admin. */
export function usuarioTemAcessoAntecipado(user, perfil) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  const tipo = String(perfil?.accountType ?? 'comum').toLowerCase();
  if (tipo === 'admin') return true;
  return assinaturaPremiumAtiva(perfil);
}

/**
 * Capítulo visível para leitura (lista / abrir leitor).
 * Sem publicReleaseAt → público como antes.
 * Com data futura: só Premium (assinatura) com antecipadoMembros, ou admin.
 */
export function capituloLiberadoParaUsuario(cap, user, perfil) {
  if (!cap) return false;
  if (user && isAdminUser(user)) return true;

  const raw = cap.publicReleaseAt;
  const release = typeof raw === 'number' ? raw : raw != null ? Number(raw) : null;
  if (release == null || Number.isNaN(release) || release <= Date.now()) return true;

  if (!cap.antecipadoMembros) return false;
  return usuarioTemAcessoAntecipado(user, perfil);
}

/** Valor para input type="datetime-local" (horário local). */
export function msParaDatetimeLocal(ms) {
  if (ms == null || ms === '') return '';
  const n = Number(ms);
  if (Number.isNaN(n)) return '';
  const d = new Date(n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export { formatarDataLancamentoCapitulo as formatarDataLancamento } from './datasBr';
