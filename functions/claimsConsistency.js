/**
 * Matriz de sinais de acesso ao painel / RTDB / Storage (resumo):
 *
 * | Fonte | Onde vale | Notas |
 * |-------|-----------|--------|
 * | `admins/registry` + listas super (UID/e-mail) | `getAdminAuthContext` | Fonte de verdade do backend para permissões do painel. |
 * | `auth.token.panelRole` | Rules RTDB/Storage, cliente após refresh | Sincronizado por `adminGetMyAdminProfile` (`mangaka` \| `admin` \| `super_admin`). |
 * | `auth.token.admin` (boolean) | Algumas rules legadas | Não substitui registry; super costuma ter ambos após claims antigos. |
 * | `usuarios/{uid}/role === 'admin'` | Rules de leitura de perfil (legado) | Staff novo deve receber `panelRole` no JWT; role RTDB pode ser `user` após reconciliação mangaka→user. |
 *
 * Testes: `claimsConsistency.test.js` garantem o mesmo `panelRole` que o callable expõe.
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
