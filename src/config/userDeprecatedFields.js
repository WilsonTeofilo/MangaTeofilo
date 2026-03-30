/**
 * Campos que você removeu do modelo de dados.
 * Coloque o nome exato da chave no Realtime Database.
 *
 * - No próximo login, `cleanupDeprecatedUsuarioFields` remove de `usuarios/{uid}`
 *   e de `usuarios_publicos/{uid}` (só as chaves listadas em cada array).
 * - Migração para quem nunca logou de novo: rode a Cloud Function
 *   `adminMigrateDeprecatedUserFields` (painel Financeiro, botão).
 *
 * Mantenha `functions/deprecatedUserFields.js` alinhado com este arquivo.
 */
export const USUARIOS_DEPRECATED_KEYS = [
  // exemplo: 'statusMember',
];

export const USUARIOS_PUBLICOS_DEPRECATED_KEYS = [
  // exemplo: 'legacyBadge',
];
