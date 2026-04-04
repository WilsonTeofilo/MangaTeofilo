/**
 * Espelha usuarios/{uid}/engagementCycle → campos engagement* em usuarios_publicos (só servidor).
 * Mantém a mesma lógica que o cliente usava em creatorEngagementCycle.js.
 */

/**
 * @param {Record<string, unknown> | null} state
 * @param {number} [nowMs]
 * @returns {{ engagementBoostMul: number | null, engagementBoostUntil: number | null, engagementBadgeTier: number | null }}
 */
export function buildPublicEngagementFromCycle(state, nowMs = Date.now()) {
  const now = Number(nowMs) || Date.now();
  if (!state || typeof state !== 'object') {
    return {
      engagementBoostMul: null,
      engagementBoostUntil: null,
      engagementBadgeTier: null,
    };
  }
  let activeBoostMul = state.activeBoostMul != null ? Number(state.activeBoostMul) : null;
  const activeBoostUntil = state.activeBoostUntil != null ? Number(state.activeBoostUntil) : null;
  let badgeTier = Math.floor(Number(state.badgeTier) || 0);
  if (!Number.isFinite(badgeTier) || badgeTier < 0) badgeTier = 0;
  if (badgeTier > 3) badgeTier = 3;
  if (activeBoostMul != null) {
    if (!Number.isFinite(activeBoostMul) || activeBoostMul < 1) activeBoostMul = 1;
    if (activeBoostMul > 3) activeBoostMul = 3;
  }
  const boostActive =
    Number.isFinite(activeBoostUntil) &&
    activeBoostUntil > now &&
    activeBoostMul != null &&
    Number.isFinite(activeBoostMul) &&
    activeBoostMul > 1;
  return {
    engagementBoostMul: boostActive ? activeBoostMul : null,
    engagementBoostUntil: boostActive ? activeBoostUntil : null,
    engagementBadgeTier: badgeTier > 0 ? badgeTier : null,
  };
}
