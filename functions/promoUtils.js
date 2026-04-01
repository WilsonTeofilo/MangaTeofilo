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
    emailStats: (() => {
      const es = raw.emailStats;
      if (!es || typeof es !== 'object') {
        return {
          sent: 0,
          failed: 0,
          skipped: 0,
          skippedNoOptIn: null,
          skippedOptInNoEmail: null,
          optInAtivos: null,
        };
      }
      const v2 = es.optInAtivos !== undefined && es.optInAtivos !== null;
      return {
        sent: toNum(es.sent, 0),
        failed: toNum(es.failed, 0),
        skipped: toNum(es.skipped, 0),
        skippedNoOptIn: v2 ? toNum(es.skippedNoOptIn, 0) : null,
        skippedOptInNoEmail: v2 ? toNum(es.skippedOptInNoEmail, 0) : null,
        optInAtivos: v2 ? toNum(es.optInAtivos, 0) : null,
      };
    })(),
    goalPayments: (() => {
      const g = Number(raw.goalPayments);
      return Number.isFinite(g) && g > 0 ? Math.floor(g) : null;
    })(),
  };
}

export async function getPremiumOfferAt(db, now = Date.now(), basePriceBRL = 23) {
  const basePrice = validPromoPrice(basePriceBRL) || 23;
  const snap = await db.ref('financas/promocoes/premiumAtual').get();
  const promo = parsePromoConfig(snap.val());
  if (!promo) {
    return {
      currentPriceBRL: basePrice,
      basePriceBRL: basePrice,
      isPromoActive: false,
      promoStatus: 'none',
      promo: null,
    };
  }
  const active = now >= promo.startsAt && now <= promo.endsAt;
  const scheduled = now < promo.startsAt;
  return {
    currentPriceBRL: active ? promo.priceBRL : basePrice,
    basePriceBRL: basePrice,
    isPromoActive: active,
    promoStatus: active ? 'active' : (scheduled ? 'scheduled' : 'ended'),
    promo,
  };
}
