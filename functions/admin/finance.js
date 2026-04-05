import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { normalizePromoHistoryItem, parsePromoConfig, validPromoPrice } from '../promoUtils.js';
import { requireAdminAuth, requirePermission } from '../adminRbac.js';
import { auditCreatorLedgerVsPayments, repairCreatorLifetimeNetFromPaymentsSum } from '../ledgerReconciliation.js';
import { pushMarketingEvent } from '../payments/marketing.js';
import { APP_BASE_URL } from '../payments/config.js';
import { SMTP_FROM, SMTP_HOST, SMTP_PASS, SMTP_PORT, SMTP_USER, getSmtpFrom, getTransporter } from '../notifications/delivery.js';
import { pushUserNotification } from '../notificationPush.js';
import { buildTrackingClickId, sanitizeTrackingValue } from '../trackingUtils.js';

const PREMIUM_PROMO_PATH = 'financas/promocoes/premiumAtual';
const PREMIUM_PROMO_HISTORY_PATH = 'financas/promocoes/premiumHistorico';
const PREMIUM_PROMO_LOG_PATH = 'financas/promocoes/premiumLog';

function toNum(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatarDataBr(ms) {
  try {
    return new Date(ms).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return String(ms || '');
  }
}

function notificationPrefsFromProfile(profile) {
  const prefs =
    profile?.notificationPrefs && typeof profile.notificationPrefs === 'object'
      ? profile.notificationPrefs
      : {};
  return {
    inAppEnabled: true,
    emailEnabled: prefs?.promotionsEmail === true || profile?.notifyPromotions === true,
    promotionsInApp: true,
    promotionsEmail: prefs?.promotionsEmail === true || profile?.notifyPromotions === true,
  };
}

async function appendPremiumPromoLog(db, entry) {
  await db.ref(PREMIUM_PROMO_LOG_PATH).push({
    at: Date.now(),
    ...entry,
  });
}

async function enviarEmailPromocaoPremium(db, promo) {
  const usersSnap = await db.ref('usuarios').get();
  if (!usersSnap.exists()) {
    return {
      sent: 0,
      failed: 0,
      skippedNoOptIn: 0,
      skippedOptInNoEmail: 0,
      optInAtivos: 0,
      skipped: 0,
    };
  }
  const users = usersSnap.val() || {};
  const transporter = getTransporter();
  const from = getSmtpFrom();
  const base = APP_BASE_URL.value().replace(/\/$/, '');
  let sent = 0;
  let failed = 0;
  let skippedNoOptIn = 0;
  let skippedOptInNoEmail = 0;

  for (const [uid, profile] of Object.entries(users)) {
    const appStatus = profile?.status;
    const prefs = notificationPrefsFromProfile(profile || {});
    const canInApp = prefs.inAppEnabled && prefs.promotionsInApp;
    const canEmail = prefs.emailEnabled && prefs.promotionsEmail;
    if (appStatus !== 'ativo' || (!canInApp && !canEmail)) {
      skippedNoOptIn += 1;
      continue;
    }
    try {
      const clickId = buildTrackingClickId('promo', uid);
      const trackedUrl = `${base}/apoie?src=promo_email&camp=${encodeURIComponent(
        String(promo?.promoId || '')
      )}&cid=${encodeURIComponent(clickId)}`;
      let to = '';
      if (canEmail) {
        const authUser = await getAuth().getUser(uid);
        to = authUser?.email || '';
        if (!to || authUser.disabled) {
          skippedOptInNoEmail += 1;
          if (!canInApp) continue;
        }
      }
      if (canInApp) {
        await pushUserNotification(db, uid, {
          type: 'promotion',
          title: promo?.name || 'Promocao Premium',
          message: promo?.message || 'A promocao Premium esta ativa por tempo limitado.',
          data: {
            promoId: String(promo?.promoId || ''),
            readPath: '/apoie',
          },
        });
      }
      if (canEmail) {
        await transporter.sendMail({
          from,
          to,
          subject: 'MangaTeofilo - promocao Premium ativa por tempo limitado',
          text: `${promo.name}\n\nValor promocional: R$ ${promo.priceBRL.toFixed(2)}\nValida ate: ${formatarDataBr(promo.endsAt)}\n\nAssine em: ${trackedUrl}`,
          html: `
            <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#f2f2f2;padding:28px;border-radius:10px;">
              <h2 style="margin:0 0 10px;color:#ffcc00;">${promo.name}</h2>
              <p style="margin:0 0 12px;color:#d0d0d0;">${promo.message || 'A promocao Premium esta ativa por tempo limitado.'}</p>
              <p style="margin:0 0 8px;">Valor promocional: <strong style="color:#ffcc00;">R$ ${promo.priceBRL.toFixed(2)}</strong></p>
              <p style="margin:0 0 18px;">Validade: <strong>${formatarDataBr(promo.endsAt)}</strong></p>
              <a href="${trackedUrl}" style="display:inline-block;background:#ffcc00;color:#000;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">
                Quero virar Membro MangaTeofilo
              </a>
            </div>
          `,
        });
        await pushMarketingEvent(db, {
          eventType: 'promo_email_sent',
          source: 'promo_email',
          campaignId: promo?.promoId || null,
          clickId,
          uid,
        });
        sent += 1;
      }
    } catch (err) {
      failed += 1;
      logger.error('Promo premium: erro ao enviar email', { uid, error: err?.message });
    }
  }

  const optInAtivos = sent + failed + skippedOptInNoEmail;
  return {
    sent,
    failed,
    skippedNoOptIn,
    skippedOptInNoEmail,
    optInAtivos,
    skipped: skippedNoOptIn + skippedOptInNoEmail,
  };
}

function buildPromoPerformanceByCampaign(financeEvents, marketingEvents, campaignIds = []) {
  const idSet = new Set(
    (campaignIds || [])
      .map((value) => sanitizeTrackingValue(value, 100))
      .filter(Boolean)
  );
  if (idSet.size === 0) return {};

  const base = {};
  for (const id of idSet) {
    base[id] = { sentEmails: 0, clicks: 0, checkouts: 0, payments: 0, revenue: 0 };
  }

  for (const ev of marketingEvents) {
    const cid = sanitizeTrackingValue(ev?.campaignId, 100);
    if (!cid || !idSet.has(cid)) continue;
    const eventType = String(ev?.eventType || '');
    if (eventType === 'promo_email_sent') base[cid].sentEmails += 1;
    if (eventType === 'promo_landing') base[cid].clicks += 1;
    if (eventType === 'premium_checkout_started' && String(ev?.source || '') === 'promo_email') {
      base[cid].checkouts += 1;
    }
  }

  for (const ev of financeEvents) {
    if (String(ev?.tipo || '') !== 'premium_aprovado') continue;
    const promoId = sanitizeTrackingValue(ev?.promoId, 100);
    const trafficCid = sanitizeTrackingValue(ev?.trafficCampaign, 100);
    const cid = promoId || trafficCid;
    if (!cid || !idSet.has(cid)) continue;
    base[cid].payments += 1;
    base[cid].revenue += toNum(ev?.amount, 0);
  }

  const out = {};
  for (const [cid, row] of Object.entries(base)) {
    const clicks = row.clicks;
    const sent = row.sentEmails;
    const checkouts = row.checkouts;
    const payments = row.payments;
    out[cid] = {
      sentEmails: sent,
      clicks,
      checkouts,
      payments,
      revenue: Math.round(row.revenue * 100) / 100,
      ctrPct: sent > 0 ? Math.round((clicks / sent) * 1000) / 10 : 0,
      clickToCheckoutPct: clicks > 0 ? Math.round((checkouts / clicks) * 1000) / 10 : 0,
      checkoutToPaidPct: checkouts > 0 ? Math.round((payments / checkouts) * 1000) / 10 : 0,
      paidFromSentPct: sent > 0 ? Math.round((payments / sent) * 1000) / 10 : 0,
    };
  }
  return out;
}

export const adminObterPromocaoPremium = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'financeiro');
  const db = getDatabase();
  const [snap, historySnap, financeSnap, marketingSnap, logSnap] = await Promise.all([
    db.ref(PREMIUM_PROMO_PATH).get(),
    db.ref(PREMIUM_PROMO_HISTORY_PATH).get(),
    db.ref('financas/eventos').get(),
    db.ref('marketing/eventos').get(),
    db.ref(PREMIUM_PROMO_LOG_PATH).orderByKey().limitToLast(40).get(),
  ]);
  const raw = snap.val() || null;
  const parsed = parsePromoConfig(raw);
  const historyRaw = historySnap.exists() ? historySnap.val() || {} : {};
  const history = Object.values(historyRaw)
    .map((row) => normalizePromoHistoryItem(row))
    .filter(Boolean)
    .sort((a, b) => Number(b.startsAt || 0) - Number(a.startsAt || 0))
    .slice(0, 60);

  const financeEventsRaw = financeSnap.exists() ? Object.values(financeSnap.val() || {}) : [];
  const marketingEventsRaw = marketingSnap.exists() ? Object.values(marketingSnap.val() || {}) : [];
  const campaignIds = new Set(history.map((entry) => entry.promoId));
  if (parsed?.promoId) campaignIds.add(parsed.promoId);
  const campaigns = history.slice(0, 60);
  if (parsed?.promoId && parsed?.startsAt && parsed?.endsAt) {
    campaigns.push({ promoId: parsed.promoId, startsAt: parsed.startsAt, endsAt: parsed.endsAt });
  }
  const starts = campaigns.map((c) => toNum(c?.startsAt, 0)).filter((v) => Number.isFinite(v) && v > 0);
  const ends = campaigns.map((c) => toNum(c?.endsAt, 0)).filter((v) => Number.isFinite(v) && v > 0);
  const minAt = starts.length ? Math.min(...starts) - 24 * 60 * 60 * 1000 : 0;
  const maxAt = ends.length ? Math.max(...ends) + 24 * 60 * 60 * 1000 : Date.now() + 24 * 60 * 60 * 1000;
  const financeEvents = financeEventsRaw.filter((ev) => {
    const at = toNum(ev?.at, 0);
    return at && at >= minAt && at <= maxAt && String(ev?.tipo || '') === 'premium_aprovado';
  });
  const marketingEvents = marketingEventsRaw.filter((ev) => {
    const at = toNum(ev?.at, 0);
    return at >= minAt && at <= maxAt;
  });
  const performanceByCampaign = buildPromoPerformanceByCampaign(financeEvents, marketingEvents, [...campaignIds]);
  const historyWithPerformance = history.map((row) => ({
    ...row,
    performance: performanceByCampaign[row.promoId] || {
      sentEmails: 0,
      clicks: 0,
      checkouts: 0,
      payments: 0,
      revenue: 0,
      ctrPct: 0,
      clickToCheckoutPct: 0,
      checkoutToPaidPct: 0,
      paidFromSentPct: 0,
    },
  }));
  const lastCampaign = historyWithPerformance[0] || null;

  const promoActivityLog = [];
  if (logSnap.exists()) {
    logSnap.forEach((child) => {
      promoActivityLog.push({ id: child.key, ...(child.val() || {}) });
    });
  }
  promoActivityLog.reverse();

  return {
    ok: true,
    promo: raw,
    parsedPromo: parsed,
    promoHistory: historyWithPerformance,
    currentPerformance: parsed?.promoId ? performanceByCampaign[parsed.promoId] || null : null,
    lastCampaign,
    promoActivityLog,
  };
});

export const adminAuditCreatorLedgerReconciliation = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'financeiro');
  const db = getDatabase();
  const payload = request.data && typeof request.data === 'object' ? request.data : {};
  return auditCreatorLedgerVsPayments(db, {
    creatorId: payload.creatorId,
    maxCreators: payload.maxCreators,
  });
});

export const adminRepairCreatorLifetimeNet = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'financeiro');
  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const creatorId = String(body.creatorId || '').trim();
  if (!creatorId) throw new HttpsError('invalid-argument', 'creatorId obrigatorio.');
  const db = getDatabase();
  const result = await repairCreatorLifetimeNetFromPaymentsSum(db, creatorId, {
    apply: body.apply === true,
    adjustAvailable: body.adjustAvailable === true,
  });
  if (!result.ok) {
    throw new HttpsError('not-found', result.error === 'creator_sem_creatorData' ? 'Sem creatorData.' : 'Pedido invalido.');
  }
  return result;
});

export const adminSalvarPromocaoPremium = onCall(
  { region: 'us-central1', secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'financeiro');
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const enabled = body.enabled === true;
    const now = Date.now();
    const db = getDatabase();
    const atualSnap = await db.ref(PREMIUM_PROMO_PATH).get();
    const promoAtualRaw = atualSnap.val() || null;
    const promoAtualParsed = parsePromoConfig(promoAtualRaw);

    if (!enabled) {
      if (promoAtualParsed?.promoId) {
        await db.ref(`${PREMIUM_PROMO_HISTORY_PATH}/${promoAtualParsed.promoId}`).update({
          status: 'encerrada_manual',
          disabledAt: now,
          updatedAt: now,
          updatedBy: request.auth.uid,
        });
      }
      await appendPremiumPromoLog(db, {
        action: 'disable',
        uid: request.auth.uid,
        promoId: promoAtualParsed?.promoId || null,
        detail: { name: promoAtualParsed?.name || null },
      });
      await db.ref(PREMIUM_PROMO_PATH).set({ enabled: false, updatedAt: now, updatedBy: request.auth.uid });
      return { ok: true, disabled: true };
    }

    const priceBRL = validPromoPrice(body.priceBRL);
    const startsAt = Number(body.startsAt || now);
    const endsAt = Number(body.endsAt || 0);
    if (priceBRL == null) throw new HttpsError('invalid-argument', 'Preco promocional invalido.');
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt <= 0 || endsAt <= startsAt) {
      throw new HttpsError('invalid-argument', 'Janela de tempo invalida para promocao.');
    }

    const promo = {
      enabled: true,
      promoId: String(body.promoId || `promo_${startsAt}`),
      name: String(body.name || 'Promocao Membro MangaTeofilo').trim() || 'Promocao Membro MangaTeofilo',
      message: String(body.message || '').trim(),
      priceBRL,
      startsAt,
      endsAt,
      updatedAt: now,
      updatedBy: request.auth.uid,
    };

    if (promoAtualParsed?.promoId && promoAtualParsed.promoId !== promo.promoId) {
      await db.ref(`${PREMIUM_PROMO_HISTORY_PATH}/${promoAtualParsed.promoId}`).update({
        status: 'substituida',
        disabledAt: now,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
    }
    await db.ref(PREMIUM_PROMO_PATH).set(promo);

    let emailStats = {
      sent: 0,
      failed: 0,
      skippedNoOptIn: 0,
      skippedOptInNoEmail: 0,
      optInAtivos: 0,
      skipped: 0,
    };
    if (body.notifyUsers === true) {
      emailStats = await enviarEmailPromocaoPremium(db, promo);
    }

    const historicoRef = db.ref(`${PREMIUM_PROMO_HISTORY_PATH}/${promo.promoId}`);
    const historicoSnap = await historicoRef.get();
    const createdAt = historicoSnap.exists() ? Number(historicoSnap.val()?.createdAt || startsAt || now) : now;
    await historicoRef.update({
      promoId: promo.promoId,
      name: promo.name,
      message: promo.message,
      priceBRL: promo.priceBRL,
      startsAt: promo.startsAt,
      endsAt: promo.endsAt,
      createdAt,
      createdBy: historicoSnap.exists() ? historicoSnap.val()?.createdBy || request.auth.uid : request.auth.uid,
      updatedAt: now,
      updatedBy: request.auth.uid,
      status: startsAt > now ? 'agendada' : endsAt >= now ? 'ativa' : 'encerrada',
      emailStats,
    });

    await appendPremiumPromoLog(db, {
      action: 'publish',
      uid: request.auth.uid,
      promoId: promo.promoId,
      detail: {
        name: promo.name,
        priceBRL: promo.priceBRL,
        startsAt: promo.startsAt,
        endsAt: promo.endsAt,
        notifyUsers: body.notifyUsers === true,
      },
    });

    return { ok: true, promo, notifyUsers: body.notifyUsers === true, emailStats };
  }
);

export const adminIncrementarDuracaoPromocaoPremium = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'financeiro');
  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const days = Math.max(0, Math.floor(Number(body.days || 0)));
  const hours = Math.max(0, Math.floor(Number(body.hours || 0)));
  const minutes = Math.max(0, Math.floor(Number(body.minutes || 0)));
  const extraMs = days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000 + minutes * 60 * 1000;
  if (extraMs <= 0) throw new HttpsError('invalid-argument', 'Informe um incremento maior que zero.');

  const db = getDatabase();
  const now = Date.now();
  const snap = await db.ref(PREMIUM_PROMO_PATH).get();
  const promo = parsePromoConfig(snap.val());
  if (!promo) throw new HttpsError('failed-precondition', 'Nao existe promocao premium ativa/configurada.');
  if (!(now >= Number(promo.startsAt || 0) && now <= Number(promo.endsAt || 0))) {
    throw new HttpsError('failed-precondition', 'So e possivel incrementar a duracao de uma promocao ativa.');
  }
  const currentEnd = Number(promo.endsAt);
  if (!Number.isFinite(currentEnd) || currentEnd <= now) {
    throw new HttpsError('failed-precondition', 'Data de termino da promocao invalida ou ja expirada.');
  }
  const newEndsAt = currentEnd + extraMs;
  if (!Number.isFinite(newEndsAt) || newEndsAt <= currentEnd) {
    throw new HttpsError('internal', 'Falha ao calcular novo termino da promocao.');
  }

  await db.ref(PREMIUM_PROMO_PATH).update({ endsAt: newEndsAt, updatedAt: now, updatedBy: request.auth.uid });
  await db.ref(`${PREMIUM_PROMO_HISTORY_PATH}/${promo.promoId}`).update({
    endsAt: newEndsAt,
    updatedAt: now,
    updatedBy: request.auth.uid,
    status: 'ativa',
  });
  await appendPremiumPromoLog(db, {
    action: 'extend',
    uid: request.auth.uid,
    promoId: promo.promoId,
    detail: { added: { days, hours, minutes }, endsAtBefore: currentEnd, endsAtAfter: newEndsAt },
  });
  return { ok: true, promoId: promo.promoId, added: { days, hours, minutes, ms: extraMs }, endsAt: newEndsAt };
});

export const adminDefinirMetaPromocaoPremium = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'financeiro');
  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const rawGoal = body.goalPayments;
  let goalPayments = null;
  if (rawGoal !== undefined && rawGoal !== null && rawGoal !== '') {
    const parsed = Math.floor(Number(rawGoal));
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new HttpsError('invalid-argument', 'Meta invalida: use um inteiro >= 0 ou vazio para limpar.');
    }
    if (parsed > 0) goalPayments = parsed;
  }

  const db = getDatabase();
  const now = Date.now();
  const snap = await db.ref(PREMIUM_PROMO_PATH).get();
  const promo = parsePromoConfig(snap.val());
  if (!promo) {
    throw new HttpsError('failed-precondition', 'Nao ha promocao premium ativa para associar a meta.');
  }
  if (!(now >= Number(promo.startsAt || 0) && now <= Number(promo.endsAt || 0))) {
    throw new HttpsError('failed-precondition', 'Meta so pode ser definida com a promocao ao vivo (nao em campanha apenas agendada).');
  }
  const patch =
    goalPayments == null
      ? { goalPayments: null, goalUpdatedAt: now, goalUpdatedBy: request.auth.uid }
      : { goalPayments, goalUpdatedAt: now, goalUpdatedBy: request.auth.uid };
  await db.ref(`${PREMIUM_PROMO_HISTORY_PATH}/${promo.promoId}`).update(patch);
  await appendPremiumPromoLog(db, {
    action: 'meta',
    uid: request.auth.uid,
    promoId: promo.promoId,
    detail: { goalPayments },
  });
  return { ok: true, promoId: promo.promoId, goalPayments };
});
