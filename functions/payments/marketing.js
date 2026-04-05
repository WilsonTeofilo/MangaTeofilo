import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getPremiumOfferAt } from '../promoUtils.js';
import {
  sanitizeTrackingValue,
  normalizeTrackingEventType,
  normalizeTrackingSource,
  trackingDedupKey,
} from '../trackingUtils.js';
import { PREMIUM_PRICE_BRL } from '../mercadoPagoPremium.js';

function toNum(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function pushMarketingEvent(db, event) {
  try {
    const eventType = normalizeTrackingEventType(event?.eventType);
    if (!eventType) return;
    const source = normalizeTrackingSource(event?.source) || 'unknown';
    const payload = {
      eventType,
      source,
      campaignId: sanitizeTrackingValue(event?.campaignId, 100),
      clickId: sanitizeTrackingValue(event?.clickId, 120),
      uid: sanitizeTrackingValue(event?.uid, 64),
      chapterId: sanitizeTrackingValue(event?.chapterId, 64),
      at: toNum(event?.at, Date.now()),
    };
    await db.ref('marketing/eventos').push(payload);
  } catch (err) {
    logger.error('pushMarketingEvent falhou', { error: err?.message });
  }
}

export const obterOfertaPremiumPublica = onCall(
  {
    region: 'us-central1',
    cors: true,
    invoker: 'public',
  },
  async () => {
    const db = getDatabase();
    const now = Date.now();
    const offer = await getPremiumOfferAt(db, now, PREMIUM_PRICE_BRL);
    return {
      ok: true,
      now,
      currentPriceBRL: offer.currentPriceBRL,
      basePriceBRL: offer.basePriceBRL,
      isPromoActive: offer.isPromoActive,
      promoStatus: offer.promoStatus || 'none',
      promo: offer.promo
        ? {
            promoId: offer.promo?.promoId || null,
            name: offer.promo?.name || null,
            message: offer.promo?.message || '',
            priceBRL: offer.promo?.priceBRL || null,
            startsAt: offer.promo?.startsAt || null,
            endsAt: offer.promo?.endsAt || null,
          }
        : null,
    };
  }
);

export const registrarAttributionEvento = onCall(
  {
    region: 'us-central1',
    cors: true,
    invoker: 'public',
  },
  async (request) => {
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const eventType = normalizeTrackingEventType(body.eventType);
    if (!eventType) {
      throw new HttpsError('invalid-argument', 'eventType invalido.');
    }

    const source = normalizeTrackingSource(body.source) || 'unknown';
    const campaignId = sanitizeTrackingValue(body.campaignId, 100);
    const clickId = sanitizeTrackingValue(body.clickId, 120);
    const chapterId = sanitizeTrackingValue(body.chapterId, 64);
    const uid = request.auth?.uid ? String(request.auth.uid) : null;
    const now = Date.now();
    const db = getDatabase();

    const dedupeKey = trackingDedupKey(eventType, clickId);
    if (dedupeKey && (eventType === 'promo_landing' || eventType === 'chapter_landing')) {
      const dedupeRef = db.ref(`marketing/dedup/${dedupeKey}`);
      const trx = await dedupeRef.transaction((curr) => {
        if (curr) return;
        return { at: now };
      });
      if (!trx.committed) {
        return { ok: true, deduped: true };
      }
    }

    await pushMarketingEvent(db, {
      eventType,
      source,
      campaignId,
      clickId,
      chapterId,
      uid,
      at: now,
    });
    return { ok: true };
  }
);
