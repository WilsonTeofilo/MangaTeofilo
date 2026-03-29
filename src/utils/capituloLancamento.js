import { isAdminUser } from '../constants';

/** Membro/premium com assinatura ativa e não expirada. */
export function usuarioTemAcessoAntecipado(user, perfil) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  const tipo = String(perfil?.accountType ?? 'comum').toLowerCase();
  if (tipo === 'admin') return true;
  if (tipo !== 'membro' && tipo !== 'premium') return false;
  if (perfil?.membershipStatus !== 'ativo') return false;
  const until = perfil?.memberUntil;
  if (typeof until === 'number' && until < Date.now()) return false;
  return true;
}

/**
 * Capítulo visível para leitura (lista / abrir leitor).
 * Sem publicReleaseAt → público como antes.
 * Com data futura: só membros com antecipadoMembros, ou admin.
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

export function formatarDataLancamento(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return '';
  try {
    return new Date(Number(ms)).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
