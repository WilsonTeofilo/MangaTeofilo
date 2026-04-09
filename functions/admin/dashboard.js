import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { PREMIUM_D_MS, PREMIUM_PLAN_ID } from '../mercadoPagoPremium.js';
import { requireAdminAuth, requirePermission } from '../adminRbac.js';
import { sanitizeTrackingValue, normalizeTrackingSource } from '../trackingUtils.js';
import { gerarRollupMensalFinancas } from '../system/rollup.js';
import { buildPublicProfilesMapFromUsuarios } from '../shared/publicUserProfile.js';

const MS_DAY = 86400000;

function toNum(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeGender(gender) {
  const value = String(gender || '').toLowerCase().trim();
  if (value === 'masculino' || value === 'feminino' || value === 'outro') return value;
  return 'nao_informado';
}

function monthKeyFromMs(ms) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ensurePeriod(input, now) {
  const endAt = toNum(input?.endAt, now);
  const startAt = toNum(input?.startAt, endAt - 30 * MS_DAY);
  if (endAt <= startAt) return { startAt: endAt - 30 * MS_DAY, endAt };
  const maxSpan = 5 * 365 * MS_DAY;
  if (endAt - startAt > maxSpan) return { startAt: endAt - maxSpan, endAt };
  return { startAt, endAt };
}

function defaultComparePeriod(period) {
  const span = period.endAt - period.startAt;
  return { startAt: period.startAt - span, endAt: period.startAt };
}

function round2(value) {
  return Math.round(toNum(value, 0) * 100) / 100;
}

function canonicalPremiumMemberUntil(profile = {}) {
  const raw = profile?.userEntitlements?.global;
  const value = raw?.memberUntil ?? raw?.premiumUntil;
  return toNum(value, 0);
}

function buildUserLabel(uid, usuarios, usuariosPublicos) {
  const pub = usuariosPublicos[uid] || {};
  const priv = usuarios[uid] || {};
  return {
    uid,
    userName: pub.userName || priv.userName || 'Leitor',
    userAvatar: pub.userAvatar || priv.userAvatar || '',
    gender: normalizeGender(priv.gender),
  };
}

function buildAdvancedAnalytics(events, usuarios, usuariosPublicos, period, nowMs) {
  const filtered = events.filter((event) => {
    const at = toNum(event?.at, 0);
    if (at < period.startAt || at >= period.endAt) return false;
    const tipo = String(event?.tipo || '');
    return tipo === 'premium_aprovado' || tipo === 'apoio_aprovado';
  });

  const subscriptionsByUid = new Map();
  const donationsByUid = new Map();
  const historyByUid = {};
  const daysPerSubscription = Math.round(PREMIUM_D_MS / MS_DAY);

  const ensureHistory = (uid) => {
    if (!historyByUid[uid]) {
      historyByUid[uid] = { subscriptions: [], donations: [] };
    }
    return historyByUid[uid];
  };

  for (const event of filtered) {
    const uid = String(event?.uid || '').trim();
    if (!uid) continue;

    const at = toNum(event?.at, 0);
    const amount = toNum(event?.amount, 0);
    const tipo = String(event?.tipo || '');
    const userBase = buildUserLabel(uid, usuarios, usuariosPublicos);
    const profile = usuarios[uid] || {};
    const memberUntil = canonicalPremiumMemberUntil(profile);
    const isActive = memberUntil > nowMs;

    if (tipo === 'premium_aprovado') {
      const current = subscriptionsByUid.get(uid) || {
        ...userBase,
        totalSpent: 0,
        count: 0,
        totalDays: 0,
        lastAt: 0,
        memberUntil: memberUntil || null,
        status: isActive ? 'ativo' : 'expirado',
      };
      current.totalSpent += amount;
      current.count += 1;
      current.totalDays += daysPerSubscription;
      current.lastAt = Math.max(current.lastAt, at);
      current.memberUntil = memberUntil || null;
      current.status = isActive ? 'ativo' : 'expirado';
      subscriptionsByUid.set(uid, current);

      ensureHistory(uid).subscriptions.push({
        at,
        amount: round2(amount),
        promoId: event?.promoId ? String(event.promoId) : null,
        promoName: event?.promoName ? String(event.promoName) : null,
        isPromotion: Boolean(event?.promoId || event?.promoName),
      });
      continue;
    }

    const current = donationsByUid.get(uid) || {
      ...userBase,
      totalSpent: 0,
      count: 0,
      lastAt: 0,
    };
    current.totalSpent += amount;
    current.count += 1;
    current.lastAt = Math.max(current.lastAt, at);
    donationsByUid.set(uid, current);
    ensureHistory(uid).donations.push({
      at,
      amount: round2(amount),
      origem: event?.origem ? String(event.origem) : null,
    });
  }

  for (const uid of Object.keys(historyByUid)) {
    historyByUid[uid].subscriptions.sort((a, b) => b.at - a.at);
    historyByUid[uid].donations.sort((a, b) => b.at - a.at);
  }

  const subscriptionStats = [...subscriptionsByUid.values()]
    .map((user) => ({
      ...user,
      totalSpent: round2(user.totalSpent),
      averagePrice: user.count > 0 ? round2(user.totalSpent / user.count) : 0,
      totalMonths: Math.round((user.totalDays / 30) * 10) / 10,
    }))
    .sort((a, b) => (b.totalSpent - a.totalSpent) || (b.count - a.count) || (b.lastAt - a.lastAt))
    .map((user, index) => ({ ...user, rank: index + 1 }));

  const donationStats = [...donationsByUid.values()]
    .map((user) => ({
      ...user,
      totalSpent: round2(user.totalSpent),
      averageDonation: user.count > 0 ? round2(user.totalSpent / user.count) : 0,
    }))
    .sort((a, b) => (b.totalSpent - a.totalSpent) || (b.count - a.count) || (b.lastAt - a.lastAt))
    .map((user, index) => ({ ...user, rank: index + 1 }));

  return {
    rankings: {
      subscriptions: subscriptionStats,
      donations: donationStats,
    },
    subscriptionStats,
    donationStats,
    userHistoryByUid: historyByUid,
  };
}

function buildAcquisitionAnalytics(financeEvents, marketingEvents, period) {
  const inPeriodFinance = financeEvents.filter((event) => {
    const at = toNum(event?.at, 0);
    return at >= period.startAt && at < period.endAt;
  });
  const inPeriodMarketing = marketingEvents.filter((event) => {
    const at = toNum(event?.at, 0);
    return at >= period.startAt && at < period.endAt;
  });

  const countBy = (predicate) => inPeriodMarketing.filter(predicate).length;
  const uniqueClickSet = new Set();
  for (const event of inPeriodMarketing) {
    if (event?.eventType === 'promo_landing' && event?.source === 'promo_email' && event?.clickId) {
      uniqueClickSet.add(String(event.clickId));
    }
  }

  const premiumFinance = inPeriodFinance.filter((event) => String(event?.tipo || '') === 'premium_aprovado');
  const premiumBySource = {
    promoEmailCount: 0,
    promoEmailAmount: 0,
    chapterEmailCount: 0,
    chapterEmailAmount: 0,
  };
  const promoCampaignMap = new Map();

  for (const event of premiumFinance) {
    const amount = toNum(event?.amount, 0);
    const source = normalizeTrackingSource(event?.trafficSource) || 'unknown';
    const promoId = sanitizeTrackingValue(event?.promoId, 100);
    const promoName = event?.promoName ? String(event.promoName) : null;
    const campaignId = sanitizeTrackingValue(event?.trafficCampaign, 100);

    if (source === 'promo_email') {
      premiumBySource.promoEmailCount += 1;
      premiumBySource.promoEmailAmount += amount;
    } else if (source === 'chapter_email') {
      premiumBySource.chapterEmailCount += 1;
      premiumBySource.chapterEmailAmount += amount;
    }

    const key = promoId || campaignId || 'sem_promocao';
    if (!promoCampaignMap.has(key)) {
      promoCampaignMap.set(key, {
        campaignId: key,
        promoId: promoId || null,
        promoName: promoName || null,
        payments: 0,
        revenue: 0,
        fromPromoEmailPayments: 0,
      });
    }
    const row = promoCampaignMap.get(key);
    row.payments += 1;
    row.revenue += amount;
    if (source === 'promo_email') row.fromPromoEmailPayments += 1;
  }

  const chapterReadsEmail = countBy((event) => event?.eventType === 'chapter_read' && event?.source === 'chapter_email');
  const chapterReadsNormal = countBy((event) => event?.eventType === 'chapter_read' && event?.source !== 'chapter_email');
  const chapterReadsTotal = chapterReadsEmail + chapterReadsNormal;

  return {
    promo: {
      sentEmails: countBy((event) => event?.eventType === 'promo_email_sent'),
      promoLandingClicks: countBy((event) => event?.eventType === 'promo_landing' && event?.source === 'promo_email'),
      promoLandingUniqueClicks: uniqueClickSet.size,
      premiumCheckoutsFromPromoEmail: countBy((event) => event?.eventType === 'premium_checkout_started' && event?.source === 'promo_email'),
      premiumPaymentsFromPromoEmail: premiumBySource.promoEmailCount,
      premiumRevenueFromPromoEmail: round2(premiumBySource.promoEmailAmount),
      campaigns: [...promoCampaignMap.values()]
        .map((row) => ({ ...row, revenue: round2(row.revenue) }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 20),
    },
    chapter: {
      sentEmails: countBy((event) => event?.eventType === 'chapter_email_sent'),
      chapterLandingClicks: countBy((event) => event?.eventType === 'chapter_landing' && event?.source === 'chapter_email'),
      chapterReadsFromEmail: chapterReadsEmail,
      chapterReadsNormal,
      chapterReadsTotal,
      chapterReadsFromEmailPct: chapterReadsTotal > 0 ? Math.round((chapterReadsEmail / chapterReadsTotal) * 1000) / 10 : 0,
      premiumPaymentsFromChapterEmail: premiumBySource.chapterEmailCount,
      premiumRevenueFromChapterEmail: round2(premiumBySource.chapterEmailAmount),
    },
  };
}

function aggregatePeriod(events, usuarios, usuariosPublicos, period) {
  const filtered = events.filter((event) => {
    const at = toNum(event?.at, 0);
    return at >= period.startAt && at < period.endAt;
  });

  const totals = {
    totalAmount: 0,
    premiumAmount: 0,
    apoioAmount: 0,
    premiumCount: 0,
    apoioCount: 0,
    eventsCount: filtered.length,
  };
  const monthlyMap = new Map();
  const doadoresMap = new Map();
  const doacaoSexo = {
    masculino: { amount: 0, count: 0 },
    feminino: { amount: 0, count: 0 },
    outro: { amount: 0, count: 0 },
    nao_informado: { amount: 0, count: 0 },
  };
  const assinaturaSexo = {
    masculino: { amount: 0, count: 0 },
    feminino: { amount: 0, count: 0 },
    outro: { amount: 0, count: 0 },
    nao_informado: { amount: 0, count: 0 },
  };
  const assinaturaIdades = [];
  const doacaoIdades = [];
  const assinantesNoPeriodo = new Set();
  const doadoresNoPeriodo = new Set();

  for (const event of filtered) {
    const tipo = String(event?.tipo || '');
    const uid = String(event?.uid || '').trim();
    const at = toNum(event?.at, 0);
    const amount = toNum(event?.amount, 0);
    const monthKey = monthKeyFromMs(at);
    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, {
        key: monthKey,
        totalAmount: 0,
        premiumAmount: 0,
        apoioAmount: 0,
        premiumCount: 0,
        apoioCount: 0,
      });
    }
    const monthRow = monthlyMap.get(monthKey);
    monthRow.totalAmount += amount;
    totals.totalAmount += amount;

    const perfil = uid ? usuarios[uid] || null : null;
    const sexo = normalizeGender(perfil?.gender);
    const birthYear = toNum(perfil?.birthYear, 0);
    const age = birthYear >= 1900 && birthYear <= new Date().getUTCFullYear()
      ? new Date().getUTCFullYear() - birthYear
      : null;

    if (tipo === 'premium_aprovado') {
      totals.premiumAmount += amount;
      totals.premiumCount += 1;
      monthRow.premiumAmount += amount;
      monthRow.premiumCount += 1;
      assinaturaSexo[sexo].amount += amount;
      assinaturaSexo[sexo].count += 1;
      if (uid && !assinantesNoPeriodo.has(uid) && age != null) assinaturaIdades.push(age);
      if (uid) assinantesNoPeriodo.add(uid);
    } else if (tipo === 'apoio_aprovado') {
      totals.apoioAmount += amount;
      totals.apoioCount += 1;
      monthRow.apoioAmount += amount;
      monthRow.apoioCount += 1;
      doacaoSexo[sexo].amount += amount;
      doacaoSexo[sexo].count += 1;
      if (uid && !doadoresNoPeriodo.has(uid) && age != null) doacaoIdades.push(age);
      if (uid) doadoresNoPeriodo.add(uid);
      if (uid) doadoresMap.set(uid, (doadoresMap.get(uid) || 0) + amount);
    }
  }

  const monthlySeries = [...monthlyMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const topDoadores = [...doadoresMap.entries()]
    .map(([uid, amount]) => {
      const pub = usuariosPublicos[uid] || {};
      const priv = usuarios[uid] || {};
      return {
        uid,
        amount: Math.round(amount * 100) / 100,
        userName: pub.userName || priv.userName || 'Leitor',
        userAvatar: pub.userAvatar || priv.userAvatar || '',
        gender: normalizeGender(priv.gender),
      };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  const avg = (values) => values.length === 0 ? null : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;

  return {
    totals: {
      ...totals,
      totalAmount: Math.round(totals.totalAmount * 100) / 100,
      premiumAmount: Math.round(totals.premiumAmount * 100) / 100,
      apoioAmount: Math.round(totals.apoioAmount * 100) / 100,
    },
    monthlySeries,
    topDoadores,
    assinaturaVsDoacao: {
      assinatura: Math.round(totals.premiumAmount * 100) / 100,
      doacao: Math.round(totals.apoioAmount * 100) / 100,
    },
    demografia: {
      doacaoPorSexo: doacaoSexo,
      assinaturaPorSexo: assinaturaSexo,
      mediaIdadeAssinantes: avg(assinaturaIdades),
      mediaIdadeDoadores: avg(doacaoIdades),
    },
  };
}

function buildCrescimentoPremium(events, period) {
  const firstPremiumAtByUid = new Map();
  for (const event of events) {
    if (String(event?.tipo || '') !== 'premium_aprovado') continue;
    const uid = String(event?.uid || '').trim();
    const at = toNum(event?.at, 0);
    if (!uid || !at) continue;
    const prev = firstPremiumAtByUid.get(uid);
    if (!prev || at < prev) firstPremiumAtByUid.set(uid, at);
  }
  const monthMap = new Map();
  for (const [, at] of firstPremiumAtByUid.entries()) {
    if (at < period.startAt || at >= period.endAt) continue;
    const monthKey = monthKeyFromMs(at);
    monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + 1);
  }
  return [...monthMap.entries()]
    .map(([month, novosVip]) => ({ month, novosVip }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function buildIntegrityReport(events) {
  const seenPaymentIds = new Set();
  const duplicates = [];
  let withoutUid = 0;
  let withoutAmount = 0;
  let invalidType = 0;

  for (const event of events) {
    const tipo = String(event?.tipo || '');
    if (tipo !== 'premium_aprovado' && tipo !== 'apoio_aprovado') invalidType += 1;
    if (!String(event?.uid || '').trim()) withoutUid += 1;
    const amount = toNum(event?.amount, Number.NaN);
    if (!Number.isFinite(amount) || amount <= 0) withoutAmount += 1;
    const paymentId = String(event?.paymentId || '').trim();
    if (paymentId) {
      if (seenPaymentIds.has(paymentId)) duplicates.push(paymentId);
      seenPaymentIds.add(paymentId);
    }
  }

  return {
    totalEvents: events.length,
    invalidType,
    withoutUid,
    withoutAmount,
    duplicatePaymentIds: [...new Set(duplicates)].slice(0, 100),
    duplicatePaymentIdsCount: [...new Set(duplicates)].length,
  };
}

export const adminDashboardResumo = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'dashboard');

  const now = Date.now();
  const period = ensurePeriod(request.data || {}, now);
  const compareInput =
    request.data && typeof request.data === 'object'
      ? { startAt: request.data.compareStartAt, endAt: request.data.compareEndAt }
      : {};
  const comparePeriod = compareInput.startAt && compareInput.endAt
    ? ensurePeriod(compareInput, now)
    : defaultComparePeriod(period);

  const db = getDatabase();
  const [eventsSnap, usuariosSnap, marketingSnap] = await Promise.all([
    db.ref('financas/eventos').get(),
    db.ref('usuarios').get(),
    db.ref('marketing/eventos').get(),
  ]);

  const rawEvents = eventsSnap.exists()
    ? Object.values(eventsSnap.val() || {}).filter((event) => {
        const tipo = String(event?.tipo || '');
        return tipo === 'premium_aprovado' || tipo === 'apoio_aprovado';
      })
    : [];
  const rawMarketingEvents = marketingSnap.exists() ? Object.values(marketingSnap.val() || {}) : [];
  const usuarios = usuariosSnap.exists() ? usuariosSnap.val() || {} : {};
  const pub = buildPublicProfilesMapFromUsuarios(usuarios);
  const usuariosPublicos = pubSnap.exists() ? pubSnap.val() || {} : {};

  const current = aggregatePeriod(rawEvents, usuarios, usuariosPublicos, period);
  const compare = aggregatePeriod(rawEvents, usuarios, usuariosPublicos, comparePeriod);
  const crescimentoPremium = buildCrescimentoPremium(rawEvents, period);
  const crescimentoPremiumCompare = buildCrescimentoPremium(rawEvents, comparePeriod);
  const integrity = buildIntegrityReport(rawEvents);
  const analyticsBase = buildAdvancedAnalytics(rawEvents, usuarios, usuariosPublicos, period, now);
  const acquisition = buildAcquisitionAnalytics(rawEvents, rawMarketingEvents, period);
  const deltaAmount = current.totals.totalAmount - compare.totals.totalAmount;
  const deltaPct = compare.totals.totalAmount > 0 ? (deltaAmount / compare.totals.totalAmount) * 100 : null;

  return {
    ok: true,
    period,
    comparePeriod,
    current,
    compare,
    crescimentoPremium,
    crescimentoPremiumCompare,
    comparativo: {
      deltaAmount: Math.round(deltaAmount * 100) / 100,
      deltaPercent: deltaPct == null ? null : Math.round(deltaPct * 10) / 10,
    },
    analytics: { ...analyticsBase, acquisition },
    integrity,
    generatedAt: now,
  };
});

export const adminDashboardIntegridade = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'dashboard');
  const eventsSnap = await getDatabase().ref('financas/eventos').get();
  const rawEvents = eventsSnap.exists() ? Object.values(eventsSnap.val() || {}) : [];
  return {
    ok: true,
    integrity: buildIntegrityReport(rawEvents),
    generatedAt: Date.now(),
  };
});

export const adminBackfillEventosLegados = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'dashboard');

  const db = getDatabase();
  const [processedSnap, eventsSnap] = await Promise.all([
    db.ref('financas/mp_webhook_payments').get(),
    db.ref('financas/eventos').get(),
  ]);

  const processed = processedSnap.exists() ? processedSnap.val() || {} : {};
  const events = eventsSnap.exists() ? eventsSnap.val() || {} : {};
  const existingPaymentIds = new Set();
  for (const event of Object.values(events)) {
    const paymentId = String(event?.paymentId || '').trim();
    if (paymentId) existingPaymentIds.add(paymentId);
  }

  let created = 0;
  let createdPremium = 0;
  let createdApoio = 0;
  let createdWithZeroAmount = 0;
  const updates = {};

  for (const [paymentId, row] of Object.entries(processed)) {
    const pid = String(paymentId || '').trim();
    if (!pid || existingPaymentIds.has(pid)) continue;
    const uid = String(row?.uid || '').trim();
    if (!uid) continue;

    const at = toNum(row?.at, 0) || Date.now();
    const rawTipo = String(row?.tipo || '').toLowerCase();
    const tipo = rawTipo === 'apoio_aprovado' || rawTipo === 'apoio' ? 'apoio_aprovado' : 'premium_aprovado';
    let amount = toNum(row?.amount, Number.NaN);
    if (!Number.isFinite(amount) || amount < 0) {
      amount = 0;
      createdWithZeroAmount += 1;
    }

    const eventKey = db.ref('financas/eventos').push().key;
    if (!eventKey) continue;
    updates[`financas/eventos/${eventKey}`] = {
      tipo,
      uid,
      paymentId: pid,
      amount,
      currency: String(row?.currency || 'BRL'),
      origem: String(row?.origem || (tipo === 'premium_aprovado' ? PREMIUM_PLAN_ID : 'doacao_legado')),
      at,
      backfill: true,
    };
    created += 1;
    if (tipo === 'premium_aprovado') createdPremium += 1;
    else createdApoio += 1;
  }

  if (created > 0) {
    await db.ref().update(updates);
  }

  return {
    ok: true,
    created,
    createdPremium,
    createdApoio,
    createdWithZeroAmount,
    totalProcessedRows: Object.keys(processed).length,
  };
});

export const adminDashboardRebuildRollup = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'dashboard');
  const months = await gerarRollupMensalFinancas();
  return { ok: true, months };
});
