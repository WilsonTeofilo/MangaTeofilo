function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function chapterCoverStyle(capaAjuste) {
  if (capaAjuste?.rendered === true || capaAjuste?.mode === 'responsive-fit') {
    return {};
  }
  const zoom = clamp(Number(capaAjuste?.zoom ?? 1), 1, 3);
  const x = clamp(Number(capaAjuste?.x ?? 0), -100, 100);
  const y = clamp(Number(capaAjuste?.y ?? 0), -100, 100);

  // Conversao para object-position com faixa conservadora (evita corte extremo).
  const posX = clamp(50 + x * 0.25, 0, 100);
  const posY = clamp(50 + y * 0.25, 0, 100);

  return {
    objectPosition: `${posX}% ${posY}%`,
    transform: `scale(${zoom})`,
    transformOrigin: `${posX}% ${posY}%`,
  };
}

