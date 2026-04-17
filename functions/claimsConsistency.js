/**
 * Matriz de sinais de acesso ao painel / RTDB / Storage (resumo):
 *
 * | Fonte | Onde vale | Notas |
 * |-------|-----------|--------|
 * | `admins/registry` + listas super (UID/e-mail) | `getAdminAuthContext` | Fonte de verdade do backend para permissoes do painel. |
 * | `auth.token.panelRole` | Rules RTDB/Storage, cliente apos refresh | Sincronizado por `adminGetMyAdminProfile` (`mangaka` | `admin` | `super_admin`). |
 * | `auth.token.admin` (boolean) | Compatibilidade residual | Nao substitui registry e nao deve ser tratado como fonte canonica nova. |
 * | `usuarios/{uid}/role === 'admin'` | Resquicio legado em dados antigos | Nao e mais contrato vigente para acesso; manter apenas como contexto historico durante reconciliacao. |
 *
 * Testes: `claimsConsistency.test.js` garantem o mesmo `panelRole` que o callable expoe.
 */

/**
 * @param {{ super?: boolean, mangaka?: boolean } | null | undefined} ctx
 * @returns {'mangaka' | 'admin' | 'super_admin' | null}
 */
export function panelRoleFromAdminContext(ctx) {
  if (!ctx) return null;
  if (ctx.mangaka === true) return 'mangaka';
  if (ctx.super === true) return 'super_admin';
  return 'admin';
}
