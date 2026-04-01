/**
 * Fase 1 multi-obra: visibilidade no catálogo público vs. arquivo administrativo.
 */

export function obraEstaArquivada(obra) {
  const n = Number(obra?.archivedAt);
  return Number.isFinite(n) && n > 0;
}

/** Lista / home / perfil público do criador: só obras publicadas e não arquivadas. */
export function obraVisivelNoCatalogoPublico(obra) {
  if (!obra || obra.isPublished === false) return false;
  return !obraEstaArquivada(obra);
}
