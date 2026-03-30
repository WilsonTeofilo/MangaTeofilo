function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function validPromoPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function parsePromoConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const enabled = raw.enabled === true;
  const priceBRL = validPromoPrice(raw.priceBRL);
  const startsAt = Number(raw.startsAt || 0);
  const endsAt = Number(raw.endsAt || 0);
  if (!enabled || priceBRL == null || !Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
    return null;
  }
  if (startsAt <= 0 || endsAt <= startsAt) return null;
  return {
    promoId: String(raw.promoId || `promo_${startsAt}`),
    name: String(raw.name || 'Promocao Premium').trim() || 'Promocao Premium',
    message: String(raw.message || '').trim(),
    enabled,
    priceBRL,
    startsAt,
    endsAt,
    updatedAt: Number(raw.updatedAt || Date.now()),
  };
}

export function normalizePromoHistoryItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const promoId = String(raw.promoId || '').trim();
  if (!promoId) return null;
  const startsAt = Number(raw.startsAt || 0);
  const endsAt = Number(raw.endsAt || 0);
  const priceBRL = validPromoPrice(raw.priceBRL);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt <= 0 || endsAt <= startsAt || priceBRL == null) {
    return null;
  }
  return {
    promoId,
    name: String(raw.name || 'Promocao Premium').trim() || 'Promocao Premium',
    message: String(raw.message || '').trim(),
    priceBRL,
    startsAt,
    endsAt,
    createdAt: Number(raw.createdAt || raw.updatedAt || Date.now()),
    updatedAt: Number(raw.updatedAt || Date.now()),
    createdBy: raw.createdBy ? String(raw.createdBy) : null,
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : null,
    status: String(raw.status || 'scheduled'),
    disabledAt: Number(raw.disabledAt || 0) || null,
    emailStats: raw.emailStats && typeof raw.emailStats === 'object'
      ? {
          sent: toNum(raw.emailStats.sent, 0),
          skipped: toNum(raw.emailStats.skipped, 0),
          failed: toNum(raw.emailStats.failed, 0),
        }
      : { sent: 0, skipped: 0, failed: 0 },
  };
}

export async function getPremiumOfferAt(db, now = Date.now(), basePriceBRL = 23) {
  const snap = await db.ref('financas/promocoes/premiumAtual').get();
  const promo = parsePromoConfig(snap.val());
  if (!promo) {
    return {
      currentPriceBRL: basePriceBRL,
      basePriceBRL,
      isPromoActive: false,
      promo: null,
    };
  }
  const active = now >= promo.startsAt && now <= promo.endsAt;
  return {
    currentPriceBRL: active ? promo.priceBRL : basePriceBRL,
    basePriceBRL,
    isPromoActive: active,
    promo,
  };
}
