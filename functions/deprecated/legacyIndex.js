/**
 * Arquivo arquivado apenas como referencia de migracao.
 *
 * Nao faz parte do runtime ativo da MangaTeofilo.
 * Novas functions nao devem ser adicionadas aqui.
 * Qualquer extracao futura deve copiar a logica necessaria para um modulo de dominio
 * e depois remover o trecho correspondente deste arquivo.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { onValueWritten } from 'firebase-functions/v2/database';
import {
  USUARIOS_DEPRECATED_KEYS,
  USUARIOS_PUBLICOS_DEPRECATED_KEYS,
} from '../deprecatedUserFields.js';
import {
  APOIO_PLANOS_MP,
  parseApoioExternalRef,
  criarPreferenciaApoio,
  criarPreferenciaApoioValorLivre,
} from '../mercadoPagoApoio.js';
import {
  PREMIUM_PRICE_BRL,
  PREMIUM_D_MS,
  PREMIUM_PLAN_ID,
  parsePremiumExternalRef,
  criarPreferenciaPremium,
} from '../mercadoPagoPremium.js';
import {
  parseStoreExternalRef,
  criarPreferenciaLoja,
  parsePodExternalRef,
  criarPreferenciaPrintOnDemand,
} from '../mercadoPagoStore.js';
import { persistPrintOnDemandOrder, notifyPrintOnDemandPaid } from '../printOnDemandOrders.js';
import { panelRoleFromAdminContext } from '../claimsConsistency.js';
import { buildStoreShippingQuote } from '../storeShipping.js';
import {
  sanitizeTrackingValue,
  normalizeTrackingSource,
  normalizeTrackingEventType,
  trackingDedupKey,
  buildTrackingClickId,
} from '../trackingUtils.js';
import {
  validPromoPrice,
  parsePromoConfig,
  normalizePromoHistoryItem,
  getPremiumOfferAt,
} from '../promoUtils.js';
import {
  ADMIN_REGISTRY_PATH,
  defaultPermissionsAllTrue,
  getAdminAuthContext,
  isCreatorAccountAuth,
  requireAdminAuth,
  requirePermission,
  requireSuperAdmin,
  isTargetSuperAdmin,
  normalizePermissionsForRegistry,
  resolveTargetUidByEmail,
  SUPER_ADMIN_UIDS,
} from '../adminRbac.js';
import { evaluateCreatorApplicationApprovalGate } from '../creatorApplicationGate.js';
import {
  sanitizeCreatorId,
  recordCreatorPayment,
  recordCreatorAttributedPremium,
  recordCreatorMembershipSubscription,
  recordCreatorManualPixPayout,
} from '../creatorDataLedger.js';
import {
  tryCommitUnifiedApprovedSettlement,
  normalizeUnifiedSource,
} from '../platformPaymentSettlement.js';
import { verifyMercadoPagoWebhookSignature } from '../mercadoPagoWebhookVerify.js';
import { pushUserNotification } from '../notificationPush.js';
import {
  commitUnifiedStorePhysicalMirror,
  commitUnifiedPodPaidMirror,
  commitUnifiedRefundAdjustmentMirror,
} from '../unifiedFinanceMirror.js';
import {
  auditCreatorLedgerVsPayments,
  repairCreatorLifetimeNetFromPaymentsSum,
} from '../ledgerReconciliation.js';
import { buildPublicEngagementFromCycle } from '../creatorEngagementPublicMirror.js';
import {
  processEngagementCycleTick as processEngagementCycleTickServer,
  metricsFromUsuarioRow as metricsFromUsuarioRowServer,
  toRecordList as toRecordListServer,
} from '../creatorEngagementCycleServer.js';
import {
  ageFromBirthDateIso,
  resolveCreatorAgeYears,
  normalizeAndValidateCpf,
  parseBirthDateStrict,
} from '../creatorCompliance.js';
import {
  assembleCreatorRecordForRtdb,
  legalFullNameHasMinThreeWords,
  legalFullNameHasNoDigits,
  resolveCreatorMonetizationStatusFromDb,
} from '../creatorRecord.js';
import {
  CREATOR_MEMBERSHIP_PRICE_MAX_BRL,
  CREATOR_MEMBERSHIP_PRICE_MIN_BRL,
  hasPublicCreatorMembershipOffer,
  isValidCreatorMembershipPriceBRL,
} from '../creatorMembershipPricing.js';
import {
  coercePayoutPixType,
  normalizePixPayoutKey,
  validatePixPayout,
} from '../pixKey.js';
import { requireMonetizationComplianceOrThrow } from '../monetizationComplianceAdmin.js';
import { buildUserEntitlements, buildUserEntitlementsPatch } from '../userEntitlements.js';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import nodemailer from 'nodemailer';
import cors from 'cors';

// --- Init ───────────────────────────────────────────────────────────────────
if (!getApps().length) {
  initializeApp({
    databaseURL: 'https://shitoproject-ed649-default-rtdb.firebaseio.com',
  });
}

// --- Constantes de tempo ────────────────────────────────────────────────────
/** Conta pendente (ex.: e-mail não confirmado): marca inativo após este prazo. */
const PENDING_TTL_MS = 30 * 60 * 1000;
/** Após `inativo`, remove dados se a conta continuar abandonada neste intervalo. */
const INATIVO_TTL_MS = 45 * 60 * 1000;
/** Conta `ativo` sem login: remoção (uso agressivo — ajuste com cuidado). */
const INACTIVE_TTL_MS = 120 * 24 * 60 * 60 * 1000;
const CREATOR_MEMBERSHIP_D_MS = 30 * 24 * 60 * 60 * 1000;

/** Espelha `obraSegmentoUrlPublica` em `src/config/obras.js` (links em notificações). */
const OBRA_PADRAO_ID_SEO = 'shito';
function slugifyObraSlugForWorkUrl(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
function obraSegmentoUrlPublicaFn(obra) {
  if (!obra || typeof obra !== 'object') return OBRA_PADRAO_ID_SEO;
  const id = String(obra.id || '').trim().toLowerCase();
  const slugS = slugifyObraSlugForWorkUrl(String(obra.slug || '').trim());
  const titleS = slugifyObraSlugForWorkUrl(
    String(obra.titulo || obra.title || '').trim()
  );
  if (id === OBRA_PADRAO_ID_SEO) return titleS || slugS || id;
  if (slugS && slugS !== id) return slugS;
  return titleS || slugS || id || OBRA_PADRAO_ID_SEO;
}

function isReaderPublicProfileEffectiveServer(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.readerProfilePublic === true) return true;
  const cs = String(row.creatorStatus || '').trim().toLowerCase();
  return cs === 'active' || cs === 'onboarding';
}

function mergeReaderWorkMapsServer(...maps) {
  return maps.reduce((acc, current) => {
    if (!current || typeof current !== 'object') return acc;
    return { ...acc, ...current };
  }, {});
}

function buildReaderPublicWorksMapServer(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const [workId, row] of Object.entries(source)) {
    if (!workId || !row || typeof row !== 'object') continue;
    const title = String(row.titulo || row.title || workId).trim().slice(0, 120) || workId;
    const coverUrl = String(row.coverUrl || row.capaUrl || '').trim().slice(0, 2048);
    const slug = String(row.slug || '').trim().slice(0, 80);
    const addedAt = Number(row.savedAt || row.addedAt || row.likedAt || row.lastLikedAt || Date.now());
    out[workId] = {
      workId,
      title,
      coverUrl,
      ...(slug ? { slug } : {}),
      addedAt: Number.isFinite(addedAt) ? addedAt : Date.now(),
    };
  }
  return out;
}

async function buildReaderLikedWorkPayload(db, workIdRaw) {
  const workId = String(workIdRaw || '').trim();
  if (!workId) return null;
  const obraSnap = await db.ref(`obras/${workId}`).get();
  const obra = obraSnap.exists() ? obraSnap.val() || {} : {};
  return {
    workId,
    title: String(obra?.titulo || obra?.title || workId).trim().slice(0, 120) || workId,
    coverUrl: String(obra?.capaUrl || obra?.bannerUrl || '').trim().slice(0, 2048),
    slug: String(obra?.slug || '').trim().slice(0, 80),
    likedAt: Date.now(),
  };
}

async function syncReaderPublicProfileMirrorServer(db, uidRaw) {
  const uid = String(uidRaw || '').trim();
  if (!uid) return;
  const privSnap = await db.ref(`usuarios/${uid}`).get();
  const priv = privSnap.exists() ? privSnap.val() || {} : {};
  const pubRef = db.ref(`usuarios_publicos/${uid}`);
  if (!isReaderPublicProfileEffectiveServer(priv)) {
    await pubRef.child('readerFavorites').remove().catch(() => {});
    await pubRef.update({
      readerProfilePublic: false,
      readerProfileAvatarUrl: null,
      updatedAt: Date.now(),
    });
    return;
  }
  const merged = mergeReaderWorkMapsServer(
    priv.likedWorks,
    priv.favorites,
    priv.favoritosObras
  );
  const readerProfileAvatarUrl = String(priv.readerProfileAvatarUrl || '').trim().slice(0, 2048);
  await pubRef.update({
    readerProfilePublic: true,
    readerFavorites: buildReaderPublicWorksMapServer(merged),
    readerSince:
      typeof priv.createdAt === 'number' && Number.isFinite(priv.createdAt) ? priv.createdAt : Date.now(),
    readerProfileAvatarUrl: readerProfileAvatarUrl || null,
    updatedAt: Date.now(),
  });
}

async function syncReaderLikedWorkStateForUser(db, uidRaw, workIdRaw) {
  const uid = String(uidRaw || '').trim();
  const workId = String(workIdRaw || '').trim();
  if (!uid || !workId) return;

  const capsSnap = await db.ref('capitulos').get();
  const caps = capsSnap.exists() ? capsSnap.val() || {} : {};
  let stillLiked = false;

  for (const cap of Object.values(caps)) {
    if (!cap || typeof cap !== 'object') continue;
    const capWorkId = String(cap.obraId || cap.mangaId || '').trim();
    if (capWorkId !== workId) continue;
    if (cap.usuariosQueCurtiram && cap.usuariosQueCurtiram[uid]) {
      stillLiked = true;
      break;
    }
  }

  if (!stillLiked) {
    await db.ref(`usuarios/${uid}/likedWorks/${workId}`).remove().catch(() => {});
    return;
  }

  const payload = await buildReaderLikedWorkPayload(db, workId);
  if (!payload) return;
  await db.ref(`usuarios/${uid}/likedWorks/${workId}`).set(payload);
}

// --- Params / Secrets ───────────────────────────────────────────────────────
const APP_BASE_URL = defineString('APP_BASE_URL', {
  default: 'https://shitoproject-ed649.web.app',
});
const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_PORT = defineSecret('SMTP_PORT');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const SMTP_FROM = defineSecret('SMTP_FROM');
/** Opcional: Access Token Mercado Pago (produção ou teste) para Checkout via API */
const MP_ACCESS_TOKEN = defineSecret('MP_ACCESS_TOKEN');
/** Opcional: segredo do Webhook (painel MP). Se não vazio, valida x-signature nas notificações POST. */
const MP_WEBHOOK_SECRET = defineString('MP_WEBHOOK_SECRET', { default: '' });
/** Base pública das HTTPS functions (webhook MP). Ajuste se o projeto usar outro host. */
const FUNCTIONS_PUBLIC_URL = defineString('FUNCTIONS_PUBLIC_URL', {
  default: 'https://us-central1-shitoproject-ed649.cloudfunctions.net',
});

// --- CORS ───────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5000',
  'https://shitoproject-ed649.web.app',
  'https://shitoproject-ed649.firebaseapp.com',
  'https://mangateofilo.com',
  'https://www.mangateofilo.com',
];

// Usa o pacote cors oficial — mais robusto que setar headers manualmente
const corsMiddleware = cors({ origin: ALLOWED_ORIGINS });

function handleCors(req, res) {
  return new Promise((resolve, reject) =>
    corsMiddleware(req, res, (err) => (err ? reject(err) : resolve()))
  );
}

// --- SMTP ───────────────────────────────────────────────────────────────────
let transporterCache = null;

function getTransporter() {
  if (transporterCache) return transporterCache;
  const host = SMTP_HOST.value();
  const port = Number(SMTP_PORT.value() || 465);
  const user = SMTP_USER.value();
  const pass = SMTP_PASS.value();
  transporterCache = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return transporterCache;
}

function getSmtpFrom() {
  try { return SMTP_FROM.value(); } catch { return 'MangaTeofilo <drakenteofilo@gmail.com>'; }
}

const PREMIUM_PROMO_PATH = 'financas/promocoes/premiumAtual';
const PREMIUM_PROMO_HISTORY_PATH = 'financas/promocoes/premiumHistorico';
const PREMIUM_PROMO_LOG_PATH = 'financas/promocoes/premiumLog';

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
        subject: `MangaTeofilo — promocao Premium ativa por tempo limitado`,
        text: `${promo.name}\n\nValor promocional: R$ ${promo.priceBRL.toFixed(2)}\nValida ate: ${formatarDataBr(promo.endsAt)}\n\nAssine em: ${trackedUrl}`,
        html: `
          <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#f2f2f2;padding:28px;border-radius:10px;">
            <h2 style="margin:0 0 10px;color:#ffcc00;">${promo.name}</h2>
            <p style="margin:0 0 12px;color:#d0d0d0;">${promo.message || 'A promoção Premium está ativa por tempo limitado.'}</p>
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
    /** @deprecated compat: quem não entra no envio (sem opt-in ou sem e-mail) */
    skipped: skippedNoOptIn + skippedOptInNoEmail,
  };
}

// --- Utils ──────────────────────────────────────────────────────────────────
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Firebase nao aceita '.', '#', '$', '[', ']' em keys — substituimos por tokens seguros
function loginCodeKey(email) {
  return normalizeEmail(email)
    .replace(/\./g, '_DOT_')
    .replace(/@/g,  '_AT_')
    .replace(/#/g,  '_HASH_')
    .replace(/\$/g, '_DOLLAR_')
    .replace(/\[/g, '_LB_')
    .replace(/\]/g, '_RB_');
}

/** Limita abuso de envio de codigo (enumeracao / spam). Apenas Admin SDK escreve em rateLimits/. */
const LOGIN_CODE_EMAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_CODE_EMAIL_MAX = 6;
const LOGIN_CODE_IP_WINDOW_MS = 60 * 60 * 1000;
const LOGIN_CODE_IP_MAX = 30;

function loginRateLimitIpKey(req) {
  const raw = String(
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      'unknown'
  ).slice(0, 80);
  return raw.replace(/[.#$[\]/]/g, '_') || 'unknown';
}

async function consumeLoginCodeRateSlot(ref, windowMs, max) {
  const trx = await ref.transaction((curr) => {
    const now = Date.now();
    if (curr == null || typeof curr !== 'object') {
      return { count: 1, windowStart: now };
    }
    const windowStart = Number(curr.windowStart) || 0;
    const count = Number(curr.count) || 0;
    if (now - windowStart > windowMs) {
      return { count: 1, windowStart: now };
    }
    if (count >= max) {
      return undefined;
    }
    return { count: count + 1, windowStart };
  });
  return trx.committed === true;
}

async function assertLoginCodeRateLimits(db, emailKey, req) {
  const ipKey = loginRateLimitIpKey(req);
  const okIp = await consumeLoginCodeRateSlot(
    db.ref(`rateLimits/loginCodeIp/${ipKey}`),
    LOGIN_CODE_IP_WINDOW_MS,
    LOGIN_CODE_IP_MAX
  );
  if (!okIp) {
    const err = new Error('RATE_LIMIT');
    err.code = 'RATE_LIMIT';
    throw err;
  }
  const okEmail = await consumeLoginCodeRateSlot(
    db.ref(`rateLimits/loginCodeEmail/${emailKey}`),
    LOGIN_CODE_EMAIL_WINDOW_MS,
    LOGIN_CODE_EMAIL_MAX
  );
  if (!okEmail) {
    const err = new Error('RATE_LIMIT');
    err.code = 'RATE_LIMIT';
    throw err;
  }
}

const USER_AVATAR_FALLBACK = '/assets/avatares/ava1.webp';
const STORE_ORDER_STATUS_CANON = new Set(['pending', 'paid', 'in_production', 'shipped', 'delivered', 'cancelled']);

function normalizeStoreOrderStatusInput(raw, fallback = 'pending') {
  const value = String(raw || fallback).trim().toLowerCase().replace(/\s+/g, '_');
  if (!value) return fallback;
  if (value === 'pending_payment') return 'pending';
  if (value === 'order_received') return 'paid';
  if (value === 'processing') return 'in_production';
  if (value === 'ready_to_ship') return 'in_production';
  if (value === 'canceled') return 'cancelled';
  if (STORE_ORDER_STATUS_CANON.has(value)) return value;
  return fallback;
}

function sameJsonShape(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function buildAdminUserSchemaPatch(uid, row = {}, authUser = null) {
  const now = Date.now();
  const patch = {};
  const current = row && typeof row === 'object' ? row : {};
  const authEmail = normalizeEmail(authUser?.email || '');
  const authName = String(authUser?.displayName || '').trim();
  const authAvatar = String(authUser?.photoURL || '').trim();

  if (!current.uid) patch.uid = uid;
  if (!String(current.email || '').trim() && authEmail) patch.email = authEmail;
  if (!String(current.userName || '').trim()) patch.userName = authName || 'Leitor';
  if (!String(current.userAvatar || '').trim()) patch.userAvatar = authAvatar || USER_AVATAR_FALLBACK;
  if (!String(current.role || '').trim()) patch.role = 'user';
  if (!String(current.accountType || '').trim()) patch.accountType = 'comum';
  if (!String(current.gender || '').trim()) patch.gender = 'nao_informado';
  if (!String(current.status || '').trim()) patch.status = 'pendente';
  if (!String(current.membershipStatus || '').trim()) patch.membershipStatus = 'inativo';
  if (!String(current.sourceAcquisition || '').trim()) patch.sourceAcquisition = 'organico';
  if (!String(current.signupIntent || '').trim()) patch.signupIntent = 'reader';
  if (!Object.prototype.hasOwnProperty.call(current, 'creatorApplicationStatus')) patch.creatorApplicationStatus = null;
  if (!Object.prototype.hasOwnProperty.call(current, 'creatorRequestedAt')) patch.creatorRequestedAt = null;
  if (typeof current.birthYear !== 'number' && current.birthYear !== null) patch.birthYear = null;
  if (typeof current.notifyNewChapter !== 'boolean') patch.notifyNewChapter = false;
  if (typeof current.notifyPromotions !== 'boolean') patch.notifyPromotions = false;
  if (typeof current.marketingOptIn !== 'boolean') patch.marketingOptIn = false;
  if (typeof current.marketingOptInAt !== 'number' && current.marketingOptInAt !== null) patch.marketingOptInAt = null;
  if (typeof current.memberUntil !== 'number' && current.memberUntil !== null) patch.memberUntil = null;
  if (typeof current.currentPlanId !== 'string' && current.currentPlanId !== null) patch.currentPlanId = null;
  if (typeof current.lastPaymentAt !== 'number' && current.lastPaymentAt !== null) patch.lastPaymentAt = null;
  if (
    typeof current.premium5dNotifiedForUntil !== 'number' &&
    current.premium5dNotifiedForUntil !== null
  ) {
    patch.premium5dNotifiedForUntil = null;
  }
  if (typeof current.createdAt !== 'number') patch.createdAt = now;
  if (typeof current.lastLogin !== 'number') patch.lastLogin = now;
  if (!current.userEntitlements || typeof current.userEntitlements !== 'object') {
    patch.userEntitlements = buildUserEntitlementsPatch(current).userEntitlements;
  } else {
    const global = current.userEntitlements.global || {};
    const creators =
      current.userEntitlements.creators && typeof current.userEntitlements.creators === 'object'
        ? current.userEntitlements.creators
        : null;
    if (
      typeof global.isPremium !== 'boolean' ||
      !String(global.status || '').trim() ||
      (typeof global.memberUntil !== 'number' && global.memberUntil !== null) ||
      !creators ||
      typeof current.userEntitlements.updatedAt !== 'number'
    ) {
      patch.userEntitlements = buildUserEntitlementsPatch(current).userEntitlements;
    }
  }

  return patch;
}

function buildAdminPublicUserSchemaPatch(uid, row = {}, privateRow = {}, authUser = null) {
  const now = Date.now();
  const patch = {
    updatedAt: now,
  };
  const current = row && typeof row === 'object' ? row : {};
  const source = privateRow && typeof privateRow === 'object' ? privateRow : {};
  const authName = String(authUser?.displayName || '').trim();
  const authAvatar = String(authUser?.photoURL || '').trim();

  if (!current.uid) patch.uid = uid;
  if (!String(current.userName || '').trim()) {
    patch.userName = String(source.userName || authName || 'Leitor').trim() || 'Leitor';
  }
  if (!String(current.userAvatar || '').trim()) {
    patch.userAvatar =
      String(source.userAvatar || authAvatar || USER_AVATAR_FALLBACK).trim() || USER_AVATAR_FALLBACK;
  }
  if (!String(current.accountType || '').trim()) {
    patch.accountType = String(source.accountType || 'comum').trim() || 'comum';
  }
  if (!String(current.signupIntent || '').trim()) {
    patch.signupIntent = String(source.signupIntent || 'reader').trim() || 'reader';
  }

  return patch;
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

async function pushMarketingEvent(db, event) {
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

/**
 * Remove só Auth + perfis de usuário.
 * Nunca apaga `obras/`, `capitulos/`, `creators/` — obras do autor permanecem na plataforma se a conta sumir.
 * Para retirar conteúdo do site, use exclusão explícita da obra (admin ou dono no painel).
 */
async function deleteUserEverywhere(uid) {
  const db = getDatabase();
  try {
    await getAuth().deleteUser(uid);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
  }
  await db.ref(`usuarios/${uid}`).remove();
  await db.ref(`usuarios_publicos/${uid}`).remove();
  logger.info(`Usuario removido: ${uid}`);
}

// --- EMAIL HTML ─────────────────────────────────────────────────────────────
const EMAIL_BRAND_TITLE = 'MangaTeofilo';
const EMAIL_BRAND_TAGLINE = 'Sua plataforma de mangás favorito';

function buildLoginEmailHtml(code, isNewUser) {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
        <tr><td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="background:#111;border-radius:12px;overflow:hidden;border:1px solid #222;">
            <tr>
              <td style="background:#ffcc00;padding:24px;text-align:center;">
                <h1 style="margin:0;color:#000;font-size:24px;font-weight:900;letter-spacing:2px;">${EMAIL_BRAND_TITLE}</h1>
                <p style="margin:6px 0 0;color:#000;font-size:12px;letter-spacing:0.5px;line-height:1.35;">${EMAIL_BRAND_TAGLINE}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 40px;text-align:center;">
                <p style="color:#aaa;font-size:14px;margin:0 0 24px;">
                  ${isNewUser ? 'Uma nova alma está prestes a despertar.' : 'Bem-vindo de volta ao MangaTeofilo.'}
                </p>
                <p style="color:#fff;font-size:14px;margin:0 0 16px;">Seu código de acesso:</p>
                <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:20px;margin:0 auto 24px;">
                  <span style="font-size:36px;font-weight:900;letter-spacing:10px;color:#ffcc00;">${code}</span>
                </div>
                <p style="color:#666;font-size:13px;margin:0 0 8px;">Expira em <strong style="color:#aaa">10 minutos</strong></p>
                <p style="color:#666;font-size:12px;margin:0;">Não compartilhe este código com ninguém.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px 24px;text-align:center;border-top:1px solid #1a1a1a;">
                <p style="color:#444;font-size:11px;margin:0;">Se você não solicitou este código, ignore este e-mail.</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;
}

function formatarDataBr(ms) {
  try {
    return new Date(ms).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return String(ms);
  }
}

function buildPremiumConfirmedHtml(memberUntilMs) {
  const fim = formatarDataBr(memberUntilMs);
  return `
    <!DOCTYPE html>
    <html lang="pt-BR"><head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
        <tr><td align="center">
          <table width="520" cellpadding="0" cellspacing="0" style="background:#111;border-radius:12px;border:1px solid #222;overflow:hidden;">
            <tr><td style="background:linear-gradient(90deg,#b8860b,#ffcc00);padding:20px;text-align:center;">
              <h1 style="margin:0;color:#000;font-size:22px;">Membro Premium — MangaTeofilo</h1>
            </td></tr>
            <tr><td style="padding:32px;color:#ddd;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 16px;">Pagamento confirmado. Sua assinatura de <strong>30 dias</strong> está ativa.</p>
              <p style="margin:0 0 8px;color:#aaa;">Válida até:</p>
              <p style="margin:0 0 24px;color:#ffcc00;font-size:18px;font-weight:bold;">${fim}</p>
              <p style="margin:0;color:#888;font-size:13px;">Regalias: acesso antecipado a capítulos (quando marcado no lançamento), leitura sem anúncios, distintivo nos comentários e mais melhorias no perfil.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
  `;
}

function buildPremiumExpiryWarningHtml(memberUntilMs) {
  const fim = formatarDataBr(memberUntilMs);
  const base = APP_BASE_URL.value().replace(/\/$/, '');
  return `
    <!DOCTYPE html>
    <html lang="pt-BR"><head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
        <tr><td align="center">
          <table width="520" cellpadding="0" cellspacing="0" style="background:#111;border-radius:12px;border:1px solid #333;">
            <tr><td style="padding:28px;color:#ddd;font-size:15px;line-height:1.6;">
              <h2 style="margin:0 0 16px;color:#ffcc00;">Sua assinatura Premium termina em breve</h2>
              <p style="margin:0 0 16px;">Faltam cerca de <strong>5 dias</strong> para o fim do período atual.</p>
              <p style="margin:0 0 8px;color:#aaa;">Encerra em:</p>
              <p style="margin:0 0 24px;color:#fff;">${fim}</p>
              <a href="${base}/apoie" style="display:inline-block;background:#ffcc00;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Renovar em Apoie a Obra</a>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
  `;
}

async function aplicarMembershipCriadorAprovada(
  db,
  uid,
  creatorId,
  paymentId,
  paymentAmount,
  paymentCurrency
) {
  const cid = sanitizeCreatorId(creatorId);
  if (!uid || !cid) return { applied: false, duplicate: false };

  const now = Date.now();
  const creatorPublicSnap = await db.ref(`usuarios_publicos/${cid}`).get();
  const creatorPublic = creatorPublicSnap.val() || {};
  const creatorName = String(creatorPublic.creatorDisplayName || creatorPublic.userName || '').trim();
  const currentEntitlementSnap = await db.ref(`usuarios/${uid}/userEntitlements/creators/${cid}`).get();
  const atual = currentEntitlementSnap.exists() ? currentEntitlementSnap.val() || {} : {};
  const currentUntil = Number(atual.memberUntil || 0);
  const newUntil = Math.max(now, currentUntil) + CREATOR_MEMBERSHIP_D_MS;
  await db.ref(`usuarios/${uid}/userEntitlements/creators/${cid}`).update({
    isMember: true,
    status: 'ativo',
    memberUntil: newUntil,
    creatorName: creatorName || atual.creatorName || null,
    lastPaymentAt: now,
    lastPaymentId: String(paymentId || ''),
    lastPaymentAmount: Number.isFinite(Number(paymentAmount)) ? round2(paymentAmount) : null,
    lastPaymentCurrency: String(paymentCurrency || 'BRL'),
    updatedAt: now,
  });
  await db.ref(`usuarios/${uid}/userEntitlements/updatedAt`).set(now);
  await db.ref(`usuarios/${uid}/creatorMemberships/${cid}`).remove().catch(() => {});

  await recordCreatorMembershipSubscription(db, {
    creatorId: cid,
    subscriberUid: uid,
    paymentId,
    amount: paymentAmount,
    memberUntil: newUntil,
  });

  try {
    await tryCommitUnifiedApprovedSettlement(db, {
      mpPaymentId: String(paymentId),
      userId: uid,
      unifiedType: 'CREATOR_MEMBERSHIP',
      creatorId: cid,
      source: 'creator_link',
      grossBRL: Number.isFinite(Number(paymentAmount)) ? round2(paymentAmount) : 0,
      currency: String(paymentCurrency || 'BRL'),
      creatorDataPaymentType: 'creator_membership',
      extra: { durationDays: 30 },
    });
  } catch (e) {
    logger.error('Membership criador: falha unified settlement', {
      uid,
      paymentId,
      error: e?.message,
    });
  }

  return { applied: true, newUntil };
}

async function reverterMembershipCriadorSeNecessario(db, uid, creatorId, paymentId, status) {
  const cid = sanitizeCreatorId(creatorId);
  if (!uid || !cid || !paymentId) return;
  const membershipRef = db.ref(`usuarios/${uid}/userEntitlements/creators/${cid}`);
  const snap = await membershipRef.get();
  if (!snap.exists()) return;
  const row = snap.val() || {};
  if (String(row.lastPaymentId || '') !== String(paymentId)) return;
  await membershipRef.update({
    status: 'cancelado',
    memberUntil: Date.now(),
    isMember: false,
    refundStatus: String(status || 'refunded'),
    updatedAt: Date.now(),
  });
  await db.ref(`usuarios/${uid}/userEntitlements/creators/${cid}`).update({
    isMember: false,
    status: 'cancelado',
    memberUntil: Date.now(),
    updatedAt: Date.now(),
  });
  await db.ref(`usuarios/${uid}/userEntitlements/updatedAt`).set(Date.now());
  await db.ref(`usuarios/${uid}/creatorMemberships/${cid}`).remove().catch(() => {});
}

/** Extrai ID de pagamento de notificação Mercado Pago (POST JSON ou GET IPN). */
function extractMercadoPagoPaymentId(req) {
  if (req.method === 'GET') {
    const topic = req.query?.topic;
    const id = req.query?.id ?? req.query?.['data.id'];
    if (topic === 'payment' && id != null && String(id).length > 0) return String(id);
    return null;
  }
  if (req.method !== 'POST') return null;
  let b = req.body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      return null;
    }
  }
  if (!b || typeof b !== 'object') return null;
  if (b.type === 'payment' && b.data?.id != null) return String(b.data.id);
  if (b.topic === 'payment' && b.resource) {
    const m = String(b.resource).match(/(\d+)\s*$/);
    if (m) return m[1];
  }
  return null;
}

async function fetchMercadoPagoPayment(accessToken, paymentId) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText || 'MP payment fetch error';
    throw new Error(msg);
  }
  return data;
}

function isRefundLikeStatus(status) {
  return REFUND_PAYMENT_STATUSES.has(String(status || '').toLowerCase());
}

async function appendUniqueFinanceEvent(db, key, payload) {
  const safeKey = String(key || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
  if (!safeKey) return false;
  const lockRef = db.ref(`financas/event_locks/${safeKey}`);
  const trx = await lockRef.transaction((curr) => (curr ? undefined : { at: Date.now() }));
  if (!trx.committed) return false;
  await db.ref('financas/eventos').push(payload);
  return true;
}

const MP_WEBHOOK_PAYMENTS_PATH = 'financas/mp_webhook_payments';
const MP_PROCESSED_COMPAT_PATH = 'financas/mp_processed';
const MP_WEBHOOK_LAST_PATH = 'financas/mp_webhook_last';

/** Telemetria do último status visto no webhook — fora do lock transacional principal. */
async function markProcessedPaymentStatus(db, paymentId, status) {
  const pid = String(paymentId || '').trim();
  if (!pid) return;
  const now = Date.now();
  try {
    await Promise.all([
      db.ref(`${MP_WEBHOOK_LAST_PATH}/${pid}`).update({
        lastStatus: String(status || 'unknown'),
        lastStatusAt: now,
      }),
      db.ref(`${MP_WEBHOOK_PAYMENTS_PATH}/${pid}`).update({
        lastStatus: String(status || 'unknown'),
        lastStatusAt: now,
        updatedAt: now,
      }),
    ]);
  } catch (err) {
    logger.warn('MP: falha ao atualizar lastStatus', { paymentId: pid, error: err?.message });
  }
}

const MP_PROCESSED_STALE_MS = 10 * 60 * 1000;

function buildMpPaymentPatch(paymentId, payload = {}, now = Date.now()) {
  return {
    paymentId,
    uid: payload.uid == null ? '' : String(payload.uid || '').trim(),
    orderId: payload.orderId == null ? null : String(payload.orderId || '').trim() || null,
    tipo: payload.tipo == null ? '' : String(payload.tipo || '').trim(),
    amount: payload.amount === undefined
      ? null
      : Number.isFinite(Number(payload.amount))
        ? round2(Number(payload.amount))
        : null,
    currency: payload.currency == null ? 'BRL' : String(payload.currency || 'BRL'),
    source: payload.source == null ? null : String(payload.source || '').trim() || null,
    status: String(payload.status || 'processing'),
    updatedAt: now,
  };
}

async function writeMpProcessedCompat(db, paymentId, payload = {}) {
  const pid = String(paymentId || '').trim();
  if (!pid) return;
  const now = Date.now();
  const patch = buildMpPaymentPatch(pid, payload, now);
  if (payload.processingAt !== undefined) patch.processingAt = payload.processingAt;
  if (payload.finalizedAt !== undefined) patch.finalizedAt = payload.finalizedAt;
  if (payload.at !== undefined) patch.at = payload.at;
  await db.ref(`${MP_PROCESSED_COMPAT_PATH}/${pid}`).update(patch);
}

async function reserveMpProcessedPayment(db, paymentId, payload) {
  const pid = String(paymentId || '').trim();
  if (!pid) throw new Error('paymentId obrigatorio.');
  const now = Date.now();
  const ref = db.ref(`${MP_WEBHOOK_PAYMENTS_PATH}/${pid}`);
  const tx = await ref.transaction((curr) => {
    const row = curr && typeof curr === 'object' ? curr : null;
    const finalizedAt = Number(row?.finalizedAt || 0);
    if (finalizedAt > 0) return;
    const processingAt = Number(row?.processingAt || 0);
    if (processingAt > 0 && now - processingAt < MP_PROCESSED_STALE_MS) return;
    return {
      ...(row || {}),
      ...buildMpPaymentPatch(pid, {
        uid: payload?.uid || row?.uid || '',
        orderId: payload?.orderId == null ? (row?.orderId ?? null) : payload.orderId,
        tipo: payload?.tipo || row?.tipo || '',
        amount: Number.isFinite(Number(payload?.amount)) ? payload.amount : (row?.amount ?? null),
        currency: payload?.currency || row?.currency || 'BRL',
        source: payload?.source == null ? (row?.source ?? null) : payload.source,
        status: 'processing',
      }, now),
      processingAt: now,
      at: Number(row?.at || 0) > 0 ? Number(row.at) : now,
      finalizedAt: null,
    };
  });
  if (tx.committed) {
    const snapshot = tx.snapshot?.val() || null;
    await writeMpProcessedCompat(db, pid, {
      ...snapshot,
      processingAt: Number(snapshot?.processingAt || now),
      finalizedAt: snapshot?.finalizedAt ?? null,
      at: Number(snapshot?.at || now),
      status: 'processing',
    });
    return { acquired: true, duplicate: false, snapshot };
  }
  const existing = tx.snapshot?.val() || null;
  if (existing && Number(existing.finalizedAt || 0) > 0) {
    return { acquired: false, duplicate: true, snapshot: existing };
  }
  return { acquired: false, duplicate: false, snapshot: existing };
}

async function finalizeMpProcessedPayment(db, paymentId, payload = {}) {
  const pid = String(paymentId || '').trim();
  if (!pid) return;
  const now = Date.now();
  const patch = {
    ...buildMpPaymentPatch(pid, payload, now),
    finalizedAt: now,
    processingAt: null,
  };
  await Promise.all([
    db.ref(`${MP_WEBHOOK_PAYMENTS_PATH}/${pid}`).update(patch),
    writeMpProcessedCompat(db, pid, patch),
  ]);
}

async function recordCreatorRefundAdjustment(db, entries) {
  const rows = Array.isArray(entries) ? entries : [];
  for (const row of rows) {
    const amount = round2(Math.abs(Number(row?.amount || 0)));
    if (!amount) continue;
    await recordCreatorPayment(db, {
      creatorId: row?.creatorId,
      amount: -amount,
      currency: row?.currency || 'BRL',
      type: row?.type || 'refund_adjustment',
      buyerUid: row?.buyerUid || null,
      paymentId: row?.paymentId || '',
      orderId: row?.orderId || null,
      status: row?.status || 'refunded',
      entryKey: row?.entryKey || '',
      extra: {
        adjustment: 'debit',
        note: 'Ajuste financeiro por reembolso/chargeback/cancelamento confirmado no Mercado Pago.',
        ...(row?.extra && typeof row.extra === 'object' ? row.extra : {}),
      },
    });
  }
}

const AVATAR_FALLBACK_FUNCTIONS = '/assets/avatares/ava1.webp';
const PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS = Array.from(SUPER_ADMIN_UIDS)[0] || null;
const REFUND_PAYMENT_STATUSES = new Set([
  'refunded',
  'charged_back',
  'cancelled',
  'rejected',
]);

function appendNestedPatch(target, basePath, value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${basePath}/${key}`;
    if (
      nested &&
      typeof nested === 'object' &&
      !Array.isArray(nested) &&
      !(nested instanceof Date)
    ) {
      appendNestedPatch(target, nextPath, nested);
    } else {
      target[nextPath] = nested;
    }
  }
}

/**
 * Ativa/renova 30 dias de Premium após pagamento aprovado (idempotente por paymentId).
 * @returns {{ applied: boolean, duplicate?: boolean, newUntil?: number }}
 */
async function aplicarPremiumAprovado(
  db,
  uid,
  paymentId,
  paymentAmount,
  paymentCurrency,
  promoId,
  promoName,
  trafficSource,
  trafficCampaign,
  trafficClickId,
  attributionCreatorId = null,
  unifiedSource = null
) {
  const now = Date.now();
  const snap = await db.ref(`usuarios/${uid}`).get();
  if (!snap.exists()) {
    logger.error('Premium: usuario nao existe', { uid, paymentId });
    return { applied: false, duplicate: false };
  }
  const buildPremiumUnifiedPayload = () => {
    const attrC = sanitizeCreatorId(attributionCreatorId);
    const storeSrc = normalizeUnifiedSource(unifiedSource, attributionCreatorId);
    return {
      mpPaymentId: String(paymentId),
      userId: uid,
      unifiedType: 'STORE_MEMBERSHIP',
      creatorId: attrC,
      source: storeSrc,
      grossBRL: Number.isFinite(Number(paymentAmount)) ? round2(paymentAmount) : PREMIUM_PRICE_BRL,
      currency: String(paymentCurrency || 'BRL'),
      creatorDataPaymentType: attrC ? 'premium_attribution' : 'store_membership',
      extra: {
        planId: PREMIUM_PLAN_ID,
        promoId: promoId || null,
        promoName: promoName || null,
        trafficSource: normalizeTrackingSource(trafficSource),
        trafficCampaign: sanitizeTrackingValue(trafficCampaign, 100),
        trafficClickId: sanitizeTrackingValue(trafficClickId, 120),
      },
    };
  };
  const procLock = await reserveMpProcessedPayment(db, paymentId, {
    uid,
    tipo: 'premium_aprovado',
    amount: Number.isFinite(Number(paymentAmount)) ? paymentAmount : PREMIUM_PRICE_BRL,
    currency: String(paymentCurrency || 'BRL'),
    source: 'premium',
  });
  if (!procLock.acquired) {
    logger.info('Premium: pagamento ja processado', { paymentId });
    try {
      await tryCommitUnifiedApprovedSettlement(db, buildPremiumUnifiedPayload());
    } catch (e) {
      logger.warn('Premium: unified settlement na reentrancia', { paymentId, error: e?.message });
    }
    return { applied: false, duplicate: true };
  }
  const profile = snap.val() || {};
  const currentUntil = typeof profile.memberUntil === 'number' ? profile.memberUntil : 0;
  const base = Math.max(now, currentUntil);
  const newUntil = base + PREMIUM_D_MS;

  const pubSnap = await db.ref(`usuarios_publicos/${uid}`).get();
  const pub = pubSnap.val() || {};
  const userNamePub = pub.userName || profile.userName || 'Leitor';
  let avatarPub = String(pub.userAvatar || profile.userAvatar || '').trim();
  if (!avatarPub) avatarPub = AVATAR_FALLBACK_FUNCTIONS;

  const patch = {};
  patch[`usuarios/${uid}/accountType`] = 'premium';
  patch[`usuarios/${uid}/membershipStatus`] = 'ativo';
  patch[`usuarios/${uid}/memberUntil`] = newUntil;
  patch[`usuarios/${uid}/lastPaymentAt`] = now;
  patch[`usuarios/${uid}/currentPlanId`] = PREMIUM_PLAN_ID;
  patch[`usuarios/${uid}/premium5dNotifiedForUntil`] = null;
  patch[`usuarios/${uid}/userEntitlements/global/isPremium`] = true;
  patch[`usuarios/${uid}/userEntitlements/global/status`] = 'ativo';
  patch[`usuarios/${uid}/userEntitlements/global/memberUntil`] = newUntil;
  patch[`usuarios/${uid}/userEntitlements/updatedAt`] = now;
  patch[`usuarios_publicos/${uid}/uid`] = uid;
  patch[`usuarios_publicos/${uid}/userName`] = userNamePub;
  patch[`usuarios_publicos/${uid}/userAvatar`] = avatarPub;
  patch[`usuarios_publicos/${uid}/accountType`] = 'premium';
  patch[`usuarios_publicos/${uid}/updatedAt`] = now;

  await db.ref().update(patch);
  await finalizeMpProcessedPayment(db, paymentId, {
    uid,
    tipo: 'premium_aprovado',
    amount: Number.isFinite(Number(paymentAmount)) ? paymentAmount : PREMIUM_PRICE_BRL,
    currency: String(paymentCurrency || 'BRL'),
    source: 'premium',
    status: 'approved',
  });

  try {
    await db.ref('financas/eventos').push({
      tipo: 'premium_aprovado',
      uid,
      paymentId: String(paymentId),
      amount: Number.isFinite(paymentAmount) ? paymentAmount : PREMIUM_PRICE_BRL,
      currency: String(paymentCurrency || 'BRL'),
      origem: PREMIUM_PLAN_ID,
      promoId: promoId || null,
      promoName: promoName || null,
      trafficSource: normalizeTrackingSource(trafficSource),
      trafficCampaign: sanitizeTrackingValue(trafficCampaign, 100),
      trafficClickId: sanitizeTrackingValue(trafficClickId, 120),
      at: now,
      memberUntil: newUntil,
    });
  } catch (err) {
    logger.error('Premium: falha ao registrar evento', { uid, error: err?.message });
  }

  try {
    const authUser = await getAuth().getUser(uid);
    const to = authUser?.email;
    if (to && !authUser.disabled) {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: getSmtpFrom(),
        to,
        subject: 'MangaTeofilo — Assinatura Premium ativa',
        text: `Sua assinatura Premium (30 dias) foi confirmada. Valida ate ${formatarDataBr(newUntil)}.\n\n${APP_BASE_URL.value()}/apoie`,
        html: buildPremiumConfirmedHtml(newUntil),
      });
    }
  } catch (err) {
    logger.error('Premium: falha e-mail confirmacao', { uid, error: err?.message });
  }

  logger.info('Premium aplicado', { uid, paymentId, newUntil });

  const attrC = sanitizeCreatorId(attributionCreatorId);
  if (attrC) {
    await recordCreatorAttributedPremium(db, {
      creatorId: attrC,
      subscriberUid: uid,
      paymentId,
      amount: paymentAmount,
      memberUntil: newUntil,
    });
  }

  try {
    await tryCommitUnifiedApprovedSettlement(db, buildPremiumUnifiedPayload());
  } catch (e) {
    logger.error('Premium: falha unified settlement', { uid, paymentId, error: e?.message });
  }

  return { applied: true, newUntil };
}

async function tratarNotificacaoPagamentoPremium(accessToken, paymentId) {
  const pay = await fetchMercadoPagoPayment(accessToken, paymentId);
  const status = String(pay?.status || '');
  const db = getDatabase();
  await markProcessedPaymentStatus(db, paymentId, status);
  const premiumUid = parsePremiumExternalRef(pay.external_reference);
  const metadata = pay.metadata && typeof pay.metadata === 'object' ? pay.metadata : {};

  if (status !== 'approved' && !isRefundLikeStatus(status)) {
    logger.info('MP: pagamento nao aprovado', { paymentId, status });
    return;
  }

  if (premiumUid) {
    const amount = Number(pay.transaction_amount);
    if (isRefundLikeStatus(status)) {
      const attrCid = metadata.attributionCreatorId ? String(metadata.attributionCreatorId).trim() : null;
      const wrote = await appendUniqueFinanceEvent(db, `premium_refund_${paymentId}_${status}`, {
        tipo: 'premium_estornado',
        uid: premiumUid,
        paymentId: String(paymentId),
        amount: Number.isFinite(amount) ? amount : null,
        currency: String(pay.currency_id || 'BRL'),
        origem: PREMIUM_PLAN_ID,
        status,
        at: Date.now(),
      });
      if (wrote && attrCid) {
        await recordCreatorRefundAdjustment(db, [{
          creatorId: attrCid,
          amount,
          currency: String(pay.currency_id || 'BRL'),
          type: 'premium_refund_adjustment',
          buyerUid: premiumUid,
          paymentId,
          status,
          entryKey: `premium_refund_adjustment_${paymentId}_${status}`,
          extra: { planId: PREMIUM_PLAN_ID },
        }]);
        try {
          await commitUnifiedRefundAdjustmentMirror(db, {
            mpPaymentId: String(paymentId),
            creatorId: attrCid,
            amount,
            currency: String(pay.currency_id || 'BRL'),
            kind: 'PREMIUM_ATTRIBUTION_REFUND',
            status: String(status),
            buyerUid: premiumUid,
            extra: { flow: 'premium_attribution_refund', planId: PREMIUM_PLAN_ID },
          });
        } catch (e) {
          logger.warn('unified refund mirror premium', { paymentId, error: e?.message });
        }
      }
      logger.info('Premium: pagamento revertido/negado', { paymentId, status, uid: premiumUid });
      return;
    }
    const expectedAmount = validPromoPrice(metadata.expectedAmount) || PREMIUM_PRICE_BRL;
    if (!Number.isFinite(amount) || Math.abs(amount - expectedAmount) > 0.02) {
      logger.error('MP: valor inesperado para premium', { paymentId, amount, uid: premiumUid });
      return;
    }
    await aplicarPremiumAprovado(
      db,
      premiumUid,
      paymentId,
      amount,
      String(pay.currency_id || 'BRL'),
      metadata.promoId ? String(metadata.promoId) : null,
      metadata.promoName ? String(metadata.promoName) : null,
      metadata.trafficSource ? String(metadata.trafficSource) : null,
      metadata.trafficCampaign ? String(metadata.trafficCampaign) : null,
      metadata.trafficClickId ? String(metadata.trafficClickId) : null,
      metadata.attributionCreatorId ? String(metadata.attributionCreatorId).trim() : null,
      metadata.source != null ? String(metadata.source) : null
    );
    return;
  }

  const storeRef = parseStoreExternalRef(pay.external_reference);
  if (storeRef) {
    const orderSnapPre = await db.ref(`loja/pedidos/${storeRef.orderId}`).get();
    if (!orderSnapPre.exists()) {
      logger.error('Loja: pedido nao encontrado para pagamento aprovado', {
        paymentId,
        orderId: storeRef.orderId,
      });
      return;
    }
    const orderPre = orderSnapPre.val() || {};
    const amount = Number(pay.transaction_amount);
    const orderUid = String(orderPre.uid || '').trim();
    const refUid = String(storeRef.uid || '').trim();
    if (orderUid && refUid && orderUid !== refUid) {
      logger.error('Loja: uid do pedido diverge do external_reference', {
        paymentId,
        orderId: storeRef.orderId,
        orderUid,
        refUid,
      });
      return;
    }
    if (isRefundLikeStatus(status)) {
      const orderItemsRefund = Array.isArray(orderPre.items) ? orderPre.items : [];
      await db.ref(`loja/pedidos/${storeRef.orderId}`).update({
        paymentStatus: status,
        refundStatus: status,
        refundedAt: Date.now(),
        updatedAt: Date.now(),
        status: orderPre.status === 'delivered' ? orderPre.status : 'cancelled',
      });
      const wrote = await appendUniqueFinanceEvent(db, `store_refund_${paymentId}_${status}`, {
        tipo: 'loja_pedido_estornado',
        uid: storeRef.uid,
        orderId: storeRef.orderId,
        paymentId: String(paymentId),
        amount: Number.isFinite(amount) ? amount : Number(orderPre.total || 0),
        currency: String(pay?.currency_id || 'BRL'),
        origem: 'loja_fisica',
        status,
        at: Date.now(),
      });
      if (wrote) {
        const byCreatorRefund = new Map();
        for (const item of orderItemsRefund) {
          const cid = sanitizeCreatorId(item?.creatorId);
          if (!cid) continue;
          const lt = round2(item?.lineTotal);
          if (!lt) continue;
          byCreatorRefund.set(cid, (byCreatorRefund.get(cid) || 0) + lt);
        }
        await recordCreatorRefundAdjustment(
          db,
          [...byCreatorRefund.entries()].map(([cid, amt]) => ({
            creatorId: cid,
            amount: amt,
            currency: String(pay?.currency_id || 'BRL'),
            type: 'loja_refund_adjustment',
            buyerUid: storeRef.uid,
            paymentId,
            orderId: storeRef.orderId,
            status,
            entryKey: `loja_refund_adjustment_${paymentId}_${cid}`,
            extra: { source: 'checkout_store' },
          }))
        );
        for (const [cid, amt] of byCreatorRefund) {
          try {
            await commitUnifiedRefundAdjustmentMirror(db, {
              mpPaymentId: String(paymentId),
              creatorId: cid,
              amount: amt,
              currency: String(pay?.currency_id || 'BRL'),
              kind: 'STORE_PHYSICAL_REFUND',
              status: String(status),
              orderId: storeRef.orderId,
              buyerUid: storeRef.uid,
              extra: { source: 'checkout_store' },
            });
          } catch (e) {
            logger.warn('unified refund mirror loja', { paymentId, creatorId: cid, error: e?.message });
          }
        }
      }
      logger.info('Loja: pagamento revertido/negado', { paymentId, status, orderId: storeRef.orderId });
      return;
    }
    const expected = Number(orderPre.total || 0);
    if (!Number.isFinite(amount) || !Number.isFinite(expected) || Math.abs(amount - expected) > 0.05) {
      logger.error('Loja: valor MP divergente do pedido', {
        paymentId,
        orderId: storeRef.orderId,
        amount,
        expected,
      });
      return;
    }
    const stPre = normalizeStoreOrderStatusInput(String(orderPre.status || '').toLowerCase(), '');
    if (stPre !== 'pending') {
      logger.warn('Loja: webhook ignorado — pedido nao esta aguardando pagamento', {
        paymentId,
        orderId: storeRef.orderId,
        status: orderPre.status,
      });
      return;
    }

    const procLock = await reserveMpProcessedPayment(db, paymentId, {
      uid: storeRef.uid,
      orderId: storeRef.orderId,
      tipo: 'loja_pedido_pago',
      amount,
      currency: String(pay?.currency_id || 'BRL'),
      source: 'checkout_store',
    });
    if (!procLock.acquired) {
      logger.info('Loja: pagamento ja processado', { paymentId, orderId: storeRef.orderId });
      return;
    }

    const orderRef = db.ref(`loja/pedidos/${storeRef.orderId}`);
    const now = Date.now();
    const payIdStr = String(paymentId);
    const payStatusStr = String(pay?.status || 'approved');
    const payAmt = Number(pay?.transaction_amount || 0);
    const txOrder = await orderRef.transaction((cur) => {
      if (!cur || typeof cur !== 'object') return;
      if (normalizeStoreOrderStatusInput(String(cur.status || '').toLowerCase(), '') !== 'pending') return;
      return {
        ...cur,
        status: 'paid',
        paidAt: now,
        paymentId: payIdStr,
        paymentStatus: payStatusStr,
        paymentAmount: payAmt,
        payoutStatus: 'held',
        updatedAt: now,
      };
    });
    if (!txOrder.committed) {
      logger.warn('Loja: pagamento aprovado mas pedido ja nao estava pendente (evita estoque duplicado)', {
        paymentId,
        orderId: storeRef.orderId,
      });
      return;
    }
    const order = txOrder.snapshot.exists() ? txOrder.snapshot.val() || {} : {};
    await finalizeMpProcessedPayment(db, paymentId, {
      uid: storeRef.uid,
      orderId: storeRef.orderId,
      tipo: 'loja_pedido_pago',
      amount,
      currency: String(pay?.currency_id || 'BRL'),
      source: 'checkout_store',
      status: 'approved',
    });

    const orderItems = Array.isArray(order.items) ? order.items : [];
    for (const item of orderItems) {
      const productId = String(item?.productId || '').trim();
      const quantity = Math.max(1, Math.floor(Number(item?.quantity || 1)));
      if (!productId) continue;
      if (String(item?.inventoryMode || '').toLowerCase() === 'on_demand') continue;
      const prodSnap = await db.ref(`loja/produtos/${productId}`).get();
      const prod = prodSnap.exists() ? prodSnap.val() || {} : {};
      if (storeProductIsOnDemand(prod)) continue;
      await db.ref(`loja/produtos/${productId}/stock`).transaction((curr) => {
        const stock = Math.max(0, Number(curr || 0));
        return Math.max(0, stock - quantity);
      });
    }

    await db.ref('financas/eventos').push({
      tipo: 'loja_pedido_pago',
      uid: storeRef.uid,
      orderId: storeRef.orderId,
      paymentId: String(paymentId),
      amount: Number.isFinite(Number(pay?.transaction_amount))
        ? Number(pay.transaction_amount)
        : Number(order.total || 0),
      currency: String(pay?.currency_id || 'BRL'),
      origem: 'loja_fisica',
      at: now,
    });
    logger.info('Loja: pedido marcado como pago', {
      paymentId,
      orderId: storeRef.orderId,
      uid: storeRef.uid,
    });

    try {
      await db.ref(`usuarios/${storeRef.uid}/ultimaCompraLoja`).set({
        orderId: storeRef.orderId,
        at: now,
        total: expected,
      });
    } catch (e) {
      logger.warn('Loja: falha ao registrar ultimaCompraLoja', { uid: storeRef.uid, error: e?.message });
    }

    try {
      const byCreator = new Map();
      for (const item of orderItems) {
        const cid = sanitizeCreatorId(item?.creatorId);
        if (!cid) continue;
        const lt = round2(item?.lineTotal);
        if (!Number.isFinite(lt) || lt <= 0) continue;
        byCreator.set(cid, (byCreator.get(cid) || 0) + lt);
      }
      for (const [cid, amt] of byCreator) {
        await recordCreatorPayment(db, {
          creatorId: cid,
          amount: round2(amt),
          currency: String(pay?.currency_id || 'BRL'),
          type: 'loja',
          buyerUid: storeRef.uid,
          paymentId,
          orderId: storeRef.orderId,
          extra: { source: 'checkout_store' },
        });
      }
      const lines = [...byCreator.entries()].map(([creatorId, amount]) => ({
        creatorId,
        amount: round2(amount),
      }));
      try {
        await commitUnifiedStorePhysicalMirror(db, {
          mpPaymentId: String(paymentId),
          buyerUid: storeRef.uid,
          orderId: storeRef.orderId,
          currency: String(pay?.currency_id || 'BRL'),
          totalBRL: expected,
          lines,
        });
      } catch (e) {
        logger.warn('Loja: falha unified mirror', { orderId: storeRef.orderId, error: e?.message });
      }
    } catch (e) {
      logger.warn('Loja: falha ao registrar creatorData', { orderId: storeRef.orderId, error: e?.message });
    }
    return;
  }

  const podRef = parsePodExternalRef(pay.external_reference);
  if (podRef) {
    const orderSnapPre = await db.ref(`loja/printOnDemandOrders/${podRef.orderId}`).get();
    if (!orderSnapPre.exists()) {
      logger.error('POD: pedido nao encontrado para pagamento', { paymentId, orderId: podRef.orderId });
      return;
    }
    const orderPre = orderSnapPre.val() || {};
    if (String(orderPre.status || '').toLowerCase() === 'cancelled') {
      logger.warn('POD: pagamento recebido para pedido ja cancelado (analise manual / estorno)', {
        paymentId,
        orderId: podRef.orderId,
      });
      return;
    }
    if (String(orderPre.creatorUid || '') !== podRef.uid) {
      logger.error('POD: uid divergente', { paymentId, orderId: podRef.orderId });
      return;
    }
    if (normalizeStoreOrderStatusInput(String(orderPre.status || '').toLowerCase(), '') !== 'pending') {
      logger.warn('POD: webhook ignorado — pedido nao esta aguardando pagamento', {
        orderId: podRef.orderId,
        status: orderPre.status,
        paymentId,
      });
      return;
    }
    const expAt = Number(orderPre.expiresAt || 0);
    if (expAt && Date.now() > expAt) {
      logger.warn('POD: pagamento recebido apos expiracao da reserva (3h) — analise manual / estorno', {
        orderId: podRef.orderId,
        paymentId,
      });
      return;
    }
    const amount = Number(pay.transaction_amount);
    const snap = orderPre.snapshot && typeof orderPre.snapshot === 'object' ? orderPre.snapshot : {};
    const expected = round2(Number(snap.amountDueBRL ?? orderPre.expectedPayBRL ?? 0));
    if (isRefundLikeStatus(status)) {
      await db.ref(`loja/printOnDemandOrders/${podRef.orderId}`).update({
        paymentStatus: status,
        updatedAt: Date.now(),
      });
      logger.info('POD: pagamento revertido/negado', { paymentId, status, orderId: podRef.orderId });
      return;
    }
    if (!Number.isFinite(amount) || !Number.isFinite(expected) || Math.abs(amount - expected) > 0.05) {
      logger.error('POD: valor MP divergente', { paymentId, orderId: podRef.orderId, amount, expected });
      return;
    }
    const procLock = await reserveMpProcessedPayment(db, paymentId, {
      uid: podRef.uid,
      orderId: podRef.orderId,
      tipo: 'pod_pago',
      amount,
      currency: String(pay?.currency_id || 'BRL'),
      source: 'print_on_demand',
    });
    if (!procLock.acquired) {
      logger.info('POD: pagamento ja processado', { paymentId, orderId: podRef.orderId });
      return;
    }
    const now = Date.now();
    const podOrderRef = db.ref(`loja/printOnDemandOrders/${podRef.orderId}`);
    await podOrderRef.update({
      status: 'paid',
      paidAt: now,
      paymentId: String(paymentId),
      paymentStatus: String(pay?.status || 'approved'),
      paymentAmount: amount,
      updatedAt: now,
    });
    await finalizeMpProcessedPayment(db, paymentId, {
      uid: podRef.uid,
      orderId: podRef.orderId,
      tipo: 'pod_pago',
      amount,
      currency: String(pay?.currency_id || 'BRL'),
      source: 'print_on_demand',
      status: 'approved',
    });
    await podOrderRef.child('orderEvents').push({
      at: now,
      type: 'payment_approved',
      message: 'Pagamento confirmado via Mercado Pago (webhook).',
      actor: 'webhook',
      paymentId: String(paymentId),
    });
    await db.ref('financas/eventos').push({
      tipo: 'pod_pedido_pago',
      uid: podRef.uid,
      orderId: podRef.orderId,
      paymentId: String(paymentId),
      amount,
      currency: String(pay?.currency_id || 'BRL'),
      origem: 'print_on_demand',
      at: now,
    });
    try {
      await notifyPrintOnDemandPaid(db, podRef.uid, podRef.orderId);
    } catch (e) {
      logger.warn('POD: falha notificacao', { orderId: podRef.orderId, error: e?.message });
    }
    try {
      await commitUnifiedPodPaidMirror(db, {
        mpPaymentId: String(paymentId),
        userId: podRef.uid,
        orderId: podRef.orderId,
        amountBRL: amount,
        currency: String(pay?.currency_id || 'BRL'),
      });
    } catch (e) {
      logger.warn('POD: falha unified mirror', { orderId: podRef.orderId, error: e?.message });
    }
    logger.info('POD: pedido marcado como pago', { paymentId, orderId: podRef.orderId });
    return;
  }

  const metadataUidRaw = metadata.uid;
  const metadataUid =
    metadataUidRaw == null ? '' : String(metadataUidRaw).trim();
  const apoioUid = parseApoioExternalRef(pay.external_reference) || metadataUid;
  if (!apoioUid) {
    logger.info('MP: pagamento sem external_reference de premium/apoio', {
      paymentId,
      ref: pay.external_reference,
    });
    return;
  }

  const amount = Number(pay.transaction_amount);
  const currency = String(pay.currency_id || 'BRL');
  const apoioAttr = sanitizeCreatorId(metadata.attributionCreatorId);
  const creatorMembershipMode = metadata.creatorMembership === true || String(metadata.tipo || '') === 'creator_membership';
  if (isRefundLikeStatus(status)) {
    const origemRefund = String(metadata.planId || metadata.tipo || 'doacao_livre');
    const wrote = await appendUniqueFinanceEvent(db, `apoio_refund_${paymentId}_${status}`, {
      tipo: 'apoio_estornado',
      uid: apoioUid,
      paymentId: String(paymentId),
      amount: Number.isFinite(amount) ? amount : null,
      currency,
      origem: origemRefund,
      status,
      at: Date.now(),
    });
    if (wrote && apoioAttr && Number.isFinite(amount) && amount > 0) {
      await recordCreatorRefundAdjustment(db, [{
        creatorId: apoioAttr,
        amount,
        currency,
        type: creatorMembershipMode ? 'creator_membership_refund_adjustment' : 'apoio_refund_adjustment',
        buyerUid: apoioUid,
        paymentId,
        status,
        entryKey: `${creatorMembershipMode ? 'creator_membership' : 'apoio'}_refund_adjustment_${paymentId}_${status}`,
        extra: { origem: origemRefund },
      }]);
      try {
        await commitUnifiedRefundAdjustmentMirror(db, {
          mpPaymentId: String(paymentId),
          creatorId: apoioAttr,
          amount,
          currency,
          kind: creatorMembershipMode ? 'CREATOR_MEMBERSHIP_REFUND' : 'DONATION_REFUND',
          status: String(status),
          buyerUid: apoioUid,
          extra: { origem: origemRefund },
        });
      } catch (e) {
        logger.warn('unified refund mirror apoio', { paymentId, error: e?.message });
      }
    }
    if (creatorMembershipMode && apoioAttr) {
      await reverterMembershipCriadorSeNecessario(db, apoioUid, apoioAttr, paymentId, status);
    }
    logger.info('Apoio: pagamento revertido/negado', { paymentId, status, uid: apoioUid });
    return;
  }

  const description = String(pay.description || '').toLowerCase();
  let origem = 'doacao_livre';
  if (String(metadata.planId || '').trim()) {
    origem = String(metadata.planId).trim();
  } else if (description.includes('cafe')) {
    origem = 'cafe';
  } else if (description.includes('marmita')) {
    origem = 'marmita';
  } else if (description.includes('lendario')) {
    origem = 'lendario';
  }

  const procLock = await reserveMpProcessedPayment(db, paymentId, {
    uid: apoioUid,
    tipo: 'apoio_aprovado',
    amount,
    currency,
    source: creatorMembershipMode ? 'creator_membership' : 'donation',
  });
  if (!procLock.acquired) {
    logger.info('Apoio: pagamento ja processado', { paymentId });
    if (!creatorMembershipMode && Number.isFinite(amount) && amount > 0) {
      try {
        await tryCommitUnifiedApprovedSettlement(db, {
          mpPaymentId: String(paymentId),
          userId: apoioUid,
          unifiedType: 'DONATION',
          creatorId: apoioAttr || null,
          source: normalizeUnifiedSource(metadata.source, apoioAttr),
          grossBRL: amount,
          currency,
          creatorDataPaymentType: 'apoio',
          extra: { origem },
        });
      } catch (e) {
        logger.warn('Apoio: unified settlement na reentrancia', { paymentId, error: e?.message });
      }
    } else if (creatorMembershipMode && apoioAttr && Number.isFinite(amount) && amount > 0) {
      try {
        await tryCommitUnifiedApprovedSettlement(db, {
          mpPaymentId: String(paymentId),
          userId: apoioUid,
          unifiedType: 'CREATOR_MEMBERSHIP',
          creatorId: apoioAttr,
          source: 'creator_link',
          grossBRL: amount,
          currency,
          creatorDataPaymentType: 'creator_membership',
          extra: { origem, repair: true },
        });
      } catch (e) {
        logger.warn('Apoio: unified membership settlement na reentrancia', {
          paymentId,
          error: e?.message,
        });
      }
    }
    return;
  }

  const now = Date.now();
  await finalizeMpProcessedPayment(db, paymentId, {
    uid: apoioUid,
    tipo: 'apoio_aprovado',
    amount,
    currency,
    source: creatorMembershipMode ? 'creator_membership' : 'donation',
    status: 'approved',
  });

  await db.ref('financas/eventos').push({
    tipo: creatorMembershipMode ? 'creator_membership_aprovada' : 'apoio_aprovado',
    uid: apoioUid,
    paymentId: String(paymentId),
    amount: Number.isFinite(amount) ? amount : null,
    currency,
    origem,
    at: now,
  });

  if (Number.isFinite(amount) && amount > 0) {
    if (creatorMembershipMode) {
      if (apoioAttr) {
        await aplicarMembershipCriadorAprovada(
          db,
          apoioUid,
          apoioAttr,
          paymentId,
          amount,
          currency
        );
      }
    } else {
      try {
        await tryCommitUnifiedApprovedSettlement(db, {
          mpPaymentId: String(paymentId),
          userId: apoioUid,
          unifiedType: 'DONATION',
          creatorId: apoioAttr || null,
          source: normalizeUnifiedSource(metadata.source, apoioAttr),
          grossBRL: amount,
          currency,
          creatorDataPaymentType: 'apoio',
          extra: { origem },
        });
      } catch (e) {
        logger.error('Apoio: falha unified settlement', { paymentId, error: e?.message });
      }
    }
  }

  logger.info('Apoio registrado', {
    uid: apoioUid,
    paymentId,
    amount,
    origem,
    creatorMembershipMode,
    creatorId: apoioAttr || null,
  });
}

// --- CLEANUP AGENDADO ───────────────────────────────────────────────────────
export const cleanupUsers = onSchedule(
  {
    schedule:       'every 15 minutes',
    timeZone:       'America/Sao_Paulo',
    memory:         '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const db       = getDatabase();
    const snapshot = await db.ref('usuarios').get();

    if (!snapshot.exists()) {
      logger.info('Nenhum usuario para analisar.');
      return;
    }

    const now   = Date.now();
    const users = snapshot.val() || {};
    let scanned = 0, markedInactive = 0, removedExpired = 0, removedInactive = 0;

    for (const [uid, profile] of Object.entries(users)) {
      scanned += 1;
      const status    = profile?.status || 'ativo';
      const createdAt = Number(profile?.createdAt || 0);
      const lastLogin = Number(profile?.lastLogin  || createdAt || 0);

      if (status === 'pendente' && createdAt > 0 && now - createdAt > PENDING_TTL_MS) {
        await db.ref(`usuarios/${uid}/status`).set('inativo');
        markedInactive += 1;
        continue;
      }
      if (status === 'inativo' && createdAt > 0 && now - createdAt > PENDING_TTL_MS + INATIVO_TTL_MS) {
        await deleteUserEverywhere(uid);
        removedExpired += 1;
        continue;
      }
      if (status === 'ativo' && lastLogin > 0 && now - lastLogin > INACTIVE_TTL_MS) {
        await deleteUserEverywhere(uid);
        removedInactive += 1;
      }
    }

    logger.info('Limpeza concluida', { scanned, markedInactive, removedExpired, removedInactive });
  }
);

// --- SEND LOGIN CODE ────────────────────────────────────────────────────────
export const sendLoginCode = onRequest(
  {
    region:         'us-central1',
    timeoutSeconds: 30,
    memory:         '256MiB',
    secrets:        [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async (req, res) => {
    // CORS via pacote oficial — trata OPTIONS automaticamente
    await handleCors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST')   { res.status(405).json({ ok: false, error: 'Metodo nao permitido' }); return; }

    try {
      const body = parseBody(req);
      const { email } = body;
      const signupExplicit = body.signup === true || body.signup === 'true';
      const normEmail = normalizeEmail(email);

      if (!normEmail || !normEmail.includes('@') || !normEmail.includes('.')) {
        res.status(400).json({ ok: false, error: 'E-mail invalido.' });
        return;
      }

      let userExists = false;
      try {
        await getAuth().getUserByEmail(normEmail);
        userExists = true;
      } catch (authErr) {
        if (authErr?.code !== 'auth/user-not-found') throw authErr;
      }
      if (!userExists && !signupExplicit) {
        res.status(400).json({
          ok: false,
          code: 'NO_AUTH_USER',
          error:
            'Nenhuma conta com este e-mail. Use login com Google se foi assim que entrou, ou toque em criar conta para receber o código.',
        });
        return;
      }

      const db = getDatabase();
      try {
        await assertLoginCodeRateLimits(db, loginCodeKey(normEmail), req);
      } catch (rlErr) {
        if (rlErr?.code === 'RATE_LIMIT') {
          res.status(429).json({ ok: false, error: 'Muitas solicitacoes. Aguarde antes de pedir outro codigo.' });
          return;
        }
        throw rlErr;
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const now  = Date.now();

      // Salva o codigo no Database
      await db.ref(`loginCodes/${loginCodeKey(normEmail)}`).set({
        email:     normEmail,
        code,
        createdAt: now,
        expiresAt: now + 10 * 60 * 1000, // 10 minutos
        attempts:  0,
      });

      // Verifica se usuario ja existe no Auth
      let isNewUser = false;
      try {
        await getAuth().getUserByEmail(normEmail);
      } catch (err) {
        if (err?.code === 'auth/user-not-found') isNewUser = true;
        else throw err;
      }

      // Envia o email
      const assunto = isNewUser
        ? 'Seu código para cadastrar no MangaTeofilo'
        : 'Seu código de acesso ao MangaTeofilo';

      await getTransporter().sendMail({
        from:    getSmtpFrom(),
        to:      normEmail,
        subject: assunto,
        text:    `Seu código de acesso é: ${code}\n\nEle vale por 10 minutos. Não compartilhe.\n\nSe não pediu, ignore.`,
        html:    buildLoginEmailHtml(code, isNewUser),
      });

      logger.info(`Codigo enviado para ${normEmail} | novo: ${isNewUser}`);
      res.status(200).json({ ok: true, isNewUser });

    } catch (err) {
      logger.error('Erro em sendLoginCode:', err?.message || String(err));
      res.status(500).json({ ok: false, error: 'Falha ao enviar codigo. Tente novamente.' });
    }
  }
);

// --- VERIFY LOGIN CODE ──────────────────────────────────────────────────────
export const verifyLoginCode = onRequest(
  {
    region:         'us-central1',
    timeoutSeconds: 30,
    memory:         '256MiB',
  },
  async (req, res) => {
    await handleCors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST')   { res.status(405).json({ ok: false, error: 'Metodo nao permitido' }); return; }

    try {
      const { email, code } = parseBody(req);
      const normEmail       = normalizeEmail(email);
      const codeStr         = String(code || '').trim();

      if (!normEmail || !normEmail.includes('@') || codeStr.length !== 6) {
        res.status(400).json({ ok: false, error: 'Dados invalidos.' });
        return;
      }

      const db   = getDatabase();
      const cRef = db.ref(`loginCodes/${loginCodeKey(normEmail)}`);
      const snap = await cRef.get();

      if (!snap.exists()) {
        res.status(400).json({ ok: false, error: 'Codigo invalido ou expirado.' });
        return;
      }

      const dados    = snap.val() || {};
      const now      = Date.now();
      const attempts = Number(dados.attempts || 0);

      if (!dados.expiresAt || now > Number(dados.expiresAt)) {
        await cRef.remove();
        res.status(400).json({ ok: false, error: 'Codigo expirado. Peca um novo.' });
        return;
      }

      if (attempts >= 5) {
        await cRef.remove();
        res.status(429).json({ ok: false, error: 'Muitos erros. Peca um novo codigo.' });
        return;
      }

      if (dados.code !== codeStr) {
        await cRef.update({ attempts: attempts + 1 });
        const restantes = 4 - attempts;
        res.status(400).json({ ok: false, error: `Codigo incorreto. ${restantes} tentativa(s) restante(s).` });
        return;
      }

      // Codigo correto — apaga para nao reutilizar
      await cRef.remove();

      let isNewUser = false;
      try {
        await getAuth().getUserByEmail(normEmail);
      } catch (err) {
        if (err?.code === 'auth/user-not-found') isNewUser = true;
        else throw err;
      }

      logger.info(`Codigo verificado para ${normEmail} | novo: ${isNewUser}`);
      res.status(200).json({ ok: true, isNewUser });

    } catch (err) {
      logger.error('Erro em verifyLoginCode:', err?.message || String(err));
      res.status(500).json({ ok: false, error: 'Falha ao validar codigo. Tente novamente.' });
    }
  }
);

/**
 * userEntitlements nao pode ser escrito pelo cliente (RTDB rules).
 * Ao criar usuarios/{uid}, preenche estrutura padrao via Admin SDK.
 */
export const seedUserEntitlementsOnUsuarioCreate = onValueWritten(
  {
    ref: '/usuarios/{uid}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!before || !after) return;
    if (before.exists()) return;
    if (!after.exists()) return;

    const uid = String(event.params?.uid || '').trim();
    if (!uid) return;

    const val = after.val();
    if (!val || typeof val !== 'object') return;
    if (val.userEntitlements?.global && typeof val.userEntitlements.global === 'object') return;

    const db = getDatabase();
    const patch = buildUserEntitlementsPatch(val);
    try {
      await db.ref(`usuarios/${uid}/userEntitlements`).set(patch.userEntitlements);
      logger.info('userEntitlements semeado (novo usuario)', { uid });
    } catch (e) {
      logger.error('seedUserEntitlements falhou', { uid, error: e?.message });
    }
  }
);

export const syncCanonicalUserEntitlementsOnUsuarioWrite = onValueWritten(
  {
    ref: '/usuarios/{uid}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists()) return;
    const uid = String(event.params?.uid || '').trim();
    if (!uid) return;
    const row = after.val() || {};
    if (!row || typeof row !== 'object') return;

    const nextEntitlements = buildUserEntitlementsPatch(row).userEntitlements;
    const patch = {};
    if (!sameJsonShape(row.userEntitlements || null, nextEntitlements)) {
      patch.userEntitlements = nextEntitlements;
    }

    const currentAccountType = String(row.accountType || 'comum').trim().toLowerCase();
    const nextAccountType =
      currentAccountType === 'admin'
        ? 'admin'
        : (nextEntitlements.global.isPremium === true ? 'premium' : 'comum');
    const nextMembershipStatus = String(nextEntitlements.global.status || 'inativo').trim() || 'inativo';
    const nextMemberUntil = Number.isFinite(Number(nextEntitlements.global.memberUntil))
      ? Number(nextEntitlements.global.memberUntil)
      : null;

    if (currentAccountType !== nextAccountType) {
      patch.accountType = nextAccountType;
    }
    if (String(row.membershipStatus || 'inativo').trim().toLowerCase() !== nextMembershipStatus) {
      patch.membershipStatus = nextMembershipStatus;
    }
    if ((row.memberUntil ?? null) !== nextMemberUntil) {
      patch.memberUntil = nextMemberUntil;
    }
    if (nextAccountType !== 'premium' && nextAccountType !== 'admin' && row.currentPlanId != null) {
      patch.currentPlanId = null;
    }

    if (!Object.keys(patch).length) return;
    try {
      await getDatabase().ref(`usuarios/${uid}`).update(patch);
    } catch (error) {
      logger.error('syncCanonicalUserEntitlementsOnUsuarioWrite falhou', { uid, error: error?.message });
    }
  }
);

/** engagement* em usuarios_publicos só via servidor (rules .write false no cliente). */
export const mirrorEngagementCycleToPublicProfile = onValueWritten(
  {
    ref: '/usuarios/{uid}/engagementCycle',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const uid = String(event.params?.uid || '').trim();
    if (!uid) return;
    const after = event.data?.after?.exists() ? event.data.after.val() : null;
    const patch = buildPublicEngagementFromCycle(after, Date.now());
    const db = getDatabase();
    try {
      await db.ref(`usuarios_publicos/${uid}`).update(patch);
    } catch (e) {
      logger.error('mirrorEngagementCycleToPublicProfile falhou', { uid, error: e?.message });
    }
  }
);

async function queueCommitCreatorEngagementForUid(uidRaw) {
  const uid = String(uidRaw || '').trim();
  if (!uid) return;
  try {
    await runCommitCreatorEngagementTickForUid(getDatabase(), uid);
  } catch (error) {
    logger.warn('engagementCycle recalc falhou', { uid, error: error?.message || String(error) });
  }
}

/** Métricas do creator mudaram: o ciclo é recalculado no servidor sem depender do cliente. */
export const onCreatorStatsForEngagementChanged = onValueWritten(
  {
    ref: '/usuarios/{uid}/creatorProfile/stats',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    await queueCommitCreatorEngagementForUid(event.params?.uid);
  }
);

/** Compatibilidade com perfis antigos que ainda espelham stats fora de creatorProfile. */
export const onLegacyCreatorStatsForEngagementChanged = onValueWritten(
  {
    ref: '/usuarios/{uid}/stats',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    await queueCommitCreatorEngagementForUid(event.params?.uid);
  }
);

/** Capítulo novo/alterado conta como evento canônico do ciclo e não deve depender do cliente. */
export const onChapterEngagementSourceChanged = onValueWritten(
  {
    ref: '/capitulos/{chapterId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const after = event.data?.after?.exists() ? event.data.after.val() : null;
    const before = event.data?.before?.exists() ? event.data.before.val() : null;
    const db = getDatabase();
    const creatorId =
      String(after?.creatorId || before?.creatorId || '').trim();
    if (creatorId) {
      await queueCommitCreatorEngagementForUid(creatorId);
    }

    const beforeLikes =
      before?.usuariosQueCurtiram && typeof before.usuariosQueCurtiram === 'object'
        ? before.usuariosQueCurtiram
        : {};
    const afterLikes =
      after?.usuariosQueCurtiram && typeof after.usuariosQueCurtiram === 'object'
        ? after.usuariosQueCurtiram
        : {};
    const changedUids = new Set([
      ...Object.keys(beforeLikes),
      ...Object.keys(afterLikes),
    ]);
    if (!changedUids.size) return;

    const workId = String(after?.obraId || after?.mangaId || before?.obraId || before?.mangaId || '').trim();
    if (!workId) return;

    for (const uid of changedUids) {
      if (Boolean(beforeLikes[uid]) === Boolean(afterLikes[uid])) continue;
      try {
        await syncReaderLikedWorkStateForUser(db, uid, workId);
        await syncReaderPublicProfileMirrorServer(db, uid);
      } catch (error) {
        logger.warn('reader likedWorks sync falhou', {
          chapterId: String(event.params?.chapterId || '').trim(),
          uid,
          workId,
          error: error?.message || String(error),
        });
      }
    }
  }
);

export const onReaderFavoriteCanonChanged = onValueWritten(
  {
    ref: '/usuarios/{uid}/favorites/{workId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    await syncReaderPublicProfileMirrorServer(getDatabase(), event.params?.uid);
  }
);

export const onReaderFavoriteLegacyChanged = onValueWritten(
  {
    ref: '/usuarios/{uid}/favoritosObras/{workId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    await syncReaderPublicProfileMirrorServer(getDatabase(), event.params?.uid);
  }
);

export const onReaderLikedWorkChanged = onValueWritten(
  {
    ref: '/usuarios/{uid}/likedWorks/{workId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    await syncReaderPublicProfileMirrorServer(getDatabase(), event.params?.uid);
  }
);

export const onReaderPublicProfileSettingsChanged = onValueWritten(
  {
    ref: '/usuarios/{uid}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const before = event.data?.before?.exists() ? event.data.before.val() : null;
    const after = event.data?.after?.exists() ? event.data.after.val() : null;
    const beforePublic = Boolean(before?.readerProfilePublic);
    const afterPublic = Boolean(after?.readerProfilePublic);
    const beforeAvatar = String(before?.readerProfileAvatarUrl || '').trim();
    const afterAvatar = String(after?.readerProfileAvatarUrl || '').trim();
    if (beforePublic === afterPublic && beforeAvatar === afterAvatar) return;
    await syncReaderPublicProfileMirrorServer(getDatabase(), event.params?.uid);
  }
);

async function runCommitCreatorEngagementTickForUid(db, uidRaw) {
  const uid = String(uidRaw || '').trim();
  if (!uid) return { ok: false, error: 'uid_invalido' };
  const now = Date.now();
  const [userSnap, obrasSnap, capsSnap] = await Promise.all([
    db.ref(`usuarios/${uid}`).get(),
    db.ref('obras').get(),
    db.ref('capitulos').get(),
  ]);
  const usuario = userSnap.val() || {};
  const obras = toRecordListServer(obrasSnap.val() || {}).filter((o) => String(o?.creatorId || '').trim() === uid);
  const obraIds = new Set(obras.map((o) => String(o.id || '').trim().toLowerCase()));
  const caps = toRecordListServer(capsSnap.val() || {}).filter((cap) => {
    if (String(cap?.creatorId || '').trim() === uid) return true;
    const oid = String(cap?.obraId || cap?.mangaId || '').trim().toLowerCase();
    return obraIds.has(oid);
  });
  const tick = processEngagementCycleTickServer({
    engagementCycle: usuario.engagementCycle,
    metrics: metricsFromUsuarioRowServer(usuario),
    caps,
    uid,
    now,
  });
  if (!tick.changed) {
    return { ok: true, applied: false, leveled: false };
  }
  await db.ref(`usuarios/${uid}/engagementCycle`).set(tick.state);
  return { ok: true, applied: true, leveled: tick.leveled };
}

/** Criador: grava engagementCycle (boost/badge) só após cálculo no servidor; mirror atualiza o público. */
export const commitCreatorEngagementCycleTick = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Faca login.');
  const db = getDatabase();
  const res = await runCommitCreatorEngagementTickForUid(db, request.auth.uid);
  if (!res.ok) throw new HttpsError('invalid-argument', res.error || 'Erro.');
  return res;
});

/** Staff: reespelha engagement* em usuarios_publicos a partir de usuarios/.../engagementCycle (migração / stale). */
export const adminBackfillEngagementPublicProfiles = onCall(
  { region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'financeiro');
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const maxUpdates = Math.min(2000, Math.max(1, Number(body.maxUpdates) || 500));
    const db = getDatabase();
    const usuariosSnap = await db.ref('usuarios').get();
    if (!usuariosSnap.exists()) {
      return { ok: true, updated: 0, scannedWithCycle: 0, maxUpdates };
    }
    const all = usuariosSnap.val() || {};
    let updated = 0;
    let scannedWithCycle = 0;
    for (const [uid, row] of Object.entries(all)) {
      if (!row?.engagementCycle || typeof row.engagementCycle !== 'object') continue;
      scannedWithCycle += 1;
      if (updated >= maxUpdates) continue;
      const pubSnap = await db.ref(`usuarios_publicos/${uid}`).get();
      if (!pubSnap.exists()) continue;
      const patch = buildPublicEngagementFromCycle(row.engagementCycle, Date.now());
      try {
        await db.ref(`usuarios_publicos/${uid}`).update(patch);
        updated += 1;
      } catch (e) {
        logger.warn('adminBackfillEngagementPublicProfiles falhou', { uid, error: e?.message });
      }
    }
    return { ok: true, updated, scannedWithCycle, maxUpdates };
  }
);

// --- NOTIFY NEW CHAPTER ─────────────────────────────────────────────────────
function chapterPublicReleaseAt(chapter) {
  const releaseAt = Number(chapter?.publicReleaseAt || 0);
  return Number.isFinite(releaseAt) && releaseAt > 0 ? releaseAt : 0;
}

function chapterIsPubliclyReleased(chapter, now = Date.now()) {
  if (!chapter || typeof chapter !== 'object') return false;
  const releaseAt = chapterPublicReleaseAt(chapter);
  return releaseAt <= 0 || releaseAt <= now;
}

async function notifyChapterReleaseAudience(db, capId, capitulo) {
  if (!capId || !capitulo || typeof capitulo !== 'object') return;
  const obraId = String(capitulo?.obraId || 'shito').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'shito';
  const obraNome = String(capitulo?.obraTitulo || capitulo?.obraName || 'MangaTeofilo');
  const titulo = capitulo?.titulo || `Capitulo ${capitulo?.numero || ''}`.trim();
  const chapterCampaignId = `chapter_${obraId}_${capId}`;
  const chapterCreatorId = sanitizeCreatorId(capitulo?.creatorId) || PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS;
  const usuariosSnap = await db.ref('usuarios').get();

  if (!usuariosSnap.exists()) {
    logger.info('Sem usuarios para notificar.', { capId });
    return;
  }

  const usuarios = usuariosSnap.val() || {};
  const candidatos = Object.entries(usuarios)
    .filter(([, p]) => p?.status === 'ativo')
    .map(([uid, profile]) => ({ uid, profile: profile || {} }));

  if (candidatos.length === 0) {
    logger.info('Nenhum usuario elegivel para capitulo.', { capId });
    return;
  }

  let enviados = 0;
  let ignorados = 0;
  let falhas = 0;

  for (const candidate of candidatos) {
    const uid = candidate.uid;
    const profile = candidate.profile || {};
    try {
      const creatorSub =
        profile?.followingCreators?.[chapterCreatorId] ||
        profile?.notificationSubscriptions?.creators?.[chapterCreatorId] ||
        null;
      const workSub =
        profile?.subscribedWorks?.[obraId] ||
        profile?.notificationSubscriptions?.works?.[obraId] ||
        null;
      if (!creatorSub && !workSub) {
        ignorados += 1;
        continue;
      }
      await notifyUserByPreference(db, uid, profile || {}, {
        kind: 'chapter',
        notification: {
          type: 'chapter_release',
          title: `Novo capitulo em ${obraNome}`,
          message: `${titulo} acabou de entrar no ar.`,
          creatorId: chapterCreatorId,
          workId: obraId,
          chapterId: String(capId),
          targetPath: `/ler/${encodeURIComponent(String(capId))}`,
          groupKey: `chapter_release:${chapterCreatorId || 'none'}:${obraId}`,
          dedupeKey: `chapter_release:${obraId}:${capId}`,
          aggregateWindowMs: 12 * 60 * 60 * 1000,
          data: {
            chapterId: String(capId),
            workId: obraId,
            creatorId: chapterCreatorId,
            workTitle: obraNome,
            campaignId: chapterCampaignId,
            readPath: `/ler/${encodeURIComponent(String(capId))}`,
            creatorPath: `/criador/${encodeURIComponent(chapterCreatorId)}`,
          },
        },
      });
      enviados += 1;
    } catch (err) {
      falhas += 1;
      logger.error('Falha ao notificar usuario.', { capId, uid, error: err?.message });
    }
  }

  await db.ref(`capitulos/${capId}/releaseNotificationSentAt`).set(Date.now());
  logger.info('Notificacao de capitulo concluida.', {
    capId,
    candidatos: candidatos.length,
    enviados,
    ignorados,
    falhas,
  });
}

export const notifyNewChapter = onValueWritten(
  {
    ref: '/capitulos/{capId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
    secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async (event) => {
    const capId = String(event.params.capId || '').trim();
    const before = event.data?.before?.exists() ? event.data.before.val() || {} : null;
    const after = event.data?.after?.exists() ? event.data.after.val() || {} : null;
    if (!capId || !after) return;
    if (Number(after?.releaseNotificationSentAt || 0) > 0) return;
    const now = Date.now();
    const becamePublic =
      chapterIsPubliclyReleased(after, now) && !chapterIsPubliclyReleased(before, now);
    const createdAlreadyPublic = !before && chapterIsPubliclyReleased(after, now);
    if (!becamePublic && !createdAlreadyPublic) return;
    await notifyChapterReleaseAudience(getDatabase(), capId, after);
  }
);

export const notifyScheduledChapterReleases = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'America/Sao_Paulo',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const db = getDatabase();
    const snapshot = await db.ref('capitulos').get();
    if (!snapshot.exists()) return;
    const now = Date.now();
    const chapters = snapshot.val() || {};
    let processed = 0;
    for (const [capId, chapter] of Object.entries(chapters)) {
      if (!chapterIsPubliclyReleased(chapter, now)) continue;
      if (Number(chapter?.releaseNotificationSentAt || 0) > 0) continue;
      await notifyChapterReleaseAudience(db, capId, chapter || {});
      processed += 1;
    }
    logger.info('Varredura de capitulos agendados concluida.', { processed });
  }
);

export const notifyNewWorkPublished = onValueWritten(
  {
    ref: '/obras/{obraId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    const obraId = String(event.params.obraId || '').trim().toLowerCase();
    const before = event.data?.before?.exists() ? event.data.before.val() || {} : null;
    const obra = event.data?.after?.exists() ? event.data.after.val() || {} : null;
    if (!obraId || !obra || obra?.isPublished !== true) {
      return;
    }
    if (before?.isPublished === true || Number(obra?.publishNotificationSentAt || 0) > 0) {
      return;
    }
    const creatorId = sanitizeCreatorId(obra?.creatorId || obra?.userId || obra?.authorId);
    if (!creatorId) {
      logger.info('Obra criada sem creatorId valido para notificacao.', { obraId });
      return;
    }
    const db = getDatabase();
    const title = String(obra?.titulo || obra?.title || 'Nova obra').trim() || 'Nova obra';
    const workSeg = obraSegmentoUrlPublicaFn({ id: obraId, ...obra });
    const usersSnap = await db.ref('usuarios').get();
    if (!usersSnap.exists()) return;
    const usuarios = usersSnap.val() || {};
    let enviados = 0;
    let ignorados = 0;
    let falhas = 0;
    for (const [uid, profile] of Object.entries(usuarios)) {
      if (profile?.status !== 'ativo') {
        ignorados += 1;
        continue;
      }
      const isFollowing = Boolean(
        profile?.followingCreators?.[creatorId] || profile?.notificationSubscriptions?.creators?.[creatorId]
      );
      if (!isFollowing) {
        ignorados += 1;
        continue;
      }
      try {
        await notifyUserByPreference(db, uid, profile || {}, {
          kind: 'system',
          notification: {
            type: 'new_work',
            title: 'Nova obra publicada',
            message: `${title} acabou de entrar no catalogo.`,
            creatorId,
            workId: obraId,
            targetPath: `/work/${encodeURIComponent(workSeg)}`,
            groupKey: `new_work:${creatorId}`,
            dedupeKey: `new_work:${obraId}`,
            aggregateWindowMs: 12 * 60 * 60 * 1000,
            data: {
              creatorId,
              workId: obraId,
              workTitle: title,
              readPath: `/work/${encodeURIComponent(workSeg)}`,
              creatorPath: `/criador/${encodeURIComponent(creatorId)}`,
            },
          },
        });
        enviados += 1;
      } catch (error) {
        falhas += 1;
        logger.error('Falha ao notificar nova obra.', { obraId, uid, error: error?.message });
      }
    }
    await db.ref(`obras/${obraId}/publishNotificationSentAt`).set(Date.now());
    logger.info('Notificacao de nova obra concluida.', { obraId, enviados, ignorados, falhas });
  }
);

// --- Migração: remove campos obsoletos de todos os usuários (admin) ─────────
export const adminMigrateDeprecatedUserFields = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Faca login.');
    }
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'migrateUsers');

    const hasPriv = USUARIOS_DEPRECATED_KEYS.length > 0;
    const hasPub = USUARIOS_PUBLICOS_DEPRECATED_KEYS.length > 0;
    if (!hasPriv && !hasPub) {
      return {
        ok: true,
        message: 'Nenhuma chave obsoleta configurada em functions/deprecatedUserFields.js',
        usuariosComPatch: 0,
        publicosComPatch: 0,
      };
    }

    const db = getDatabase();
    let usuariosComPatch = 0;
    let publicosComPatch = 0;

    if (hasPriv) {
      const snap = await db.ref('usuarios').get();
      if (snap.exists()) {
        const data = snap.val();
        for (const uid of Object.keys(data)) {
          const row = data[uid] || {};
          const patch = {};
          for (const key of USUARIOS_DEPRECATED_KEYS) {
            if (Object.prototype.hasOwnProperty.call(row, key)) patch[key] = null;
          }
          if (Object.keys(patch).length) {
            await db.ref(`usuarios/${uid}`).update(patch);
            usuariosComPatch += 1;
          }
        }
      }
    }

    if (hasPub) {
      const pubSnap = await db.ref('usuarios_publicos').get();
      if (pubSnap.exists()) {
        const pubData = pubSnap.val();
        for (const uid of Object.keys(pubData)) {
          const row = pubData[uid] || {};
          const patch = {};
          for (const key of USUARIOS_PUBLICOS_DEPRECATED_KEYS) {
            if (Object.prototype.hasOwnProperty.call(row, key)) patch[key] = null;
          }
          if (Object.keys(patch).length) {
            await db.ref(`usuarios_publicos/${uid}`).update(patch);
            publicosComPatch += 1;
          }
        }
      }
    }

    logger.info('Migracao campos obsoletos.', { usuariosComPatch, publicosComPatch });

    return {
      ok: true,
      usuariosComPatch,
      publicosComPatch,
    };
  }
);

export const adminBackfillUserProfileSchema = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Faca login.');
    }
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'migrateUsers');

    const db = getDatabase();
    const [usuariosSnap, publicosSnap] = await Promise.all([
      db.ref('usuarios').get(),
      db.ref('usuarios_publicos').get(),
    ]);
    const usuarios = usuariosSnap.val() || {};
    const publicos = publicosSnap.val() || {};
    const allUids = new Set([...Object.keys(usuarios), ...Object.keys(publicos)]);
    let usuariosComPatch = 0;
    let publicosComPatch = 0;

    for (const uid of allUids) {
      let authUser = null;
      try {
        authUser = await getAuth().getUser(uid);
      } catch (err) {
        if (err?.code !== 'auth/user-not-found') throw err;
      }

      const userPatch = buildAdminUserSchemaPatch(uid, usuarios[uid] || {}, authUser);
      if (Object.keys(userPatch).length) {
        await db.ref(`usuarios/${uid}`).update(userPatch);
        usuariosComPatch += 1;
      }

      const publicPatch = buildAdminPublicUserSchemaPatch(
        uid,
        publicos[uid] || {},
        { ...(usuarios[uid] || {}), ...userPatch },
        authUser
      );
      if (Object.keys(publicPatch).length) {
        await db.ref(`usuarios_publicos/${uid}`).update(publicPatch);
        publicosComPatch += 1;
      }
    }

    logger.info('adminBackfillUserProfileSchema', {
      usuariosComPatch,
      publicosComPatch,
      total: allUids.size,
    });

    return {
      ok: true,
      total: allUids.size,
      usuariosComPatch,
      publicosComPatch,
    };
  }
);

export const adminCleanupOrphanUserProfiles = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Faca login.');
    }
    const ctx = await requireAdminAuth(request.auth);
    requirePermission(ctx, 'migrateUsers');

    const dryRun = request.data?.dryRun !== false;
    const db = getDatabase();
    const [usuariosSnap, publicosSnap] = await Promise.all([
      db.ref('usuarios').get(),
      db.ref('usuarios_publicos').get(),
    ]);
    const usuarios = usuariosSnap.val() || {};
    const publicos = publicosSnap.val() || {};
    const allUids = new Set([...Object.keys(usuarios), ...Object.keys(publicos)]);
    const orphanUids = [];

    for (const uid of allUids) {
      try {
        await getAuth().getUser(uid);
      } catch (err) {
        if (err?.code === 'auth/user-not-found') {
          orphanUids.push(uid);
          continue;
        }
        throw err;
      }
    }

    if (!dryRun) {
      for (const uid of orphanUids) {
        /** Mesma política que deleteUserEverywhere: não tocar em obras/capítulos. */
        await db.ref(`usuarios/${uid}`).remove();
        await db.ref(`usuarios_publicos/${uid}`).remove();
      }
    }

    logger.info('adminCleanupOrphanUserProfiles', {
      dryRun,
      orphanCount: orphanUids.length,
    });

    return {
      ok: true,
      dryRun,
      orphanCount: orphanUids.length,
      orphanUids: orphanUids.slice(0, 100),
    };
  }
);

// --- Mercado Pago: preferência de checkout (apoio) ─────────────────────────
const APOIO_CUSTOM_MIN = 1;
const APOIO_CUSTOM_MAX = 5000;

/** @returns {{ present: false } | { present: true, value: number } | { present: true, error: 'nan' | 'range' }} */
function tryParseApoioCustomAmount(v) {
  if (v === undefined || v === null || v === '') return { present: false };
  const n =
    typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return { present: true, error: 'nan' };
  const rounded = Math.round(n * 100) / 100;
  if (rounded < APOIO_CUSTOM_MIN || rounded > APOIO_CUSTOM_MAX) {
    return { present: true, error: 'range' };
  }
  return { present: true, value: rounded };
}

/** @returns {string | null} chave válida em APOIO_PLANOS_MP ou null */
function normalizeApoioPlanId(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (!s) return null;
  return APOIO_PLANOS_MP[s] ? s : null;
}

export const criarCheckoutApoio = onCall(
  {
    region: 'us-central1',
    secrets: [MP_ACCESS_TOKEN],
    // Callable precisa aceitar o origin do site (evita falha silenciosa com lista fixa)
    cors: true,
    invoker: 'public',
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para apoiar a obra.');
    }

    const payload =
      request.data && typeof request.data === 'object' ? request.data : {};
    const attributionCreatorId = sanitizeCreatorId(payload.attributionCreatorId);
    const creatorMembership = payload.creatorMembership === true;
    const creatorMembershipCreatorId =
      sanitizeCreatorId(payload.creatorMembershipCreatorId) || attributionCreatorId;
    const planRaw = payload.planId;
    const customTry = tryParseApoioCustomAmount(payload.customAmount);
    const planNorm = normalizeApoioPlanId(planRaw);

    const hasValidCustom = customTry.present && 'value' in customTry;
    const hasValidPlan = Boolean(planNorm);

    logger.info('criarCheckoutApoio entrada', {
      planId: planRaw,
      customAmount: payload.customAmount,
      hasValidPlan,
      hasValidCustom,
      creatorMembership,
    });

    let creatorMembershipPrice = null;
    if (creatorMembership) {
      if (!creatorMembershipCreatorId) {
        throw new HttpsError('invalid-argument', 'Membership do criador exige um creatorId valido.');
      }
      if (creatorMembershipCreatorId === request.auth.uid) {
        throw new HttpsError('failed-precondition', 'Voce nao pode assinar a propria membership de criador.');
      }
      const creatorPublic = await getMonetizableCreatorPublicProfile(getDatabase(), creatorMembershipCreatorId, {
        requireMembershipEnabled: true,
      });
      const creatorName = String(creatorPublic.creatorDisplayName || creatorPublic.userName || '').trim();
      if (!creatorName) {
        throw new HttpsError('failed-precondition', 'Este criador ainda nao concluiu a identidade publica minima.');
      }
      creatorMembershipPrice = Number(creatorPublic.creatorMembershipPriceBRL);
      if (!isValidCreatorMembershipPriceBRL(creatorMembershipPrice)) {
        throw new HttpsError(
          'failed-precondition',
          `Este criador ainda nao configurou um valor valido de membership (R$ ${CREATOR_MEMBERSHIP_PRICE_MIN_BRL} a R$ ${CREATOR_MEMBERSHIP_PRICE_MAX_BRL}).`
        );
      }
    }

    if (hasValidPlan && hasValidCustom) {
      throw new HttpsError('invalid-argument', 'Use planId OU customAmount, nao os dois.');
    }

    if (creatorMembership && (hasValidPlan || hasValidCustom)) {
      throw new HttpsError('invalid-argument', 'Membership do criador usa o valor configurado pelo criador e nao aceita planId/customAmount.');
    }

    if (!hasValidCustom && !hasValidPlan) {
      if (customTry.present && customTry.error === 'nan') {
        throw new HttpsError(
          'invalid-argument',
          'customAmount invalido. Informe um numero entre 1 e 5000.'
        );
      }
      if (customTry.present && customTry.error === 'range') {
        throw new HttpsError(
          'invalid-argument',
          `customAmount deve estar entre ${APOIO_CUSTOM_MIN} e ${APOIO_CUSTOM_MAX}.`
        );
      }
      const planStr =
        planRaw === undefined || planRaw === null || planRaw === ''
          ? ''
          : String(planRaw).trim();
      if (planStr && !planNorm) {
        throw new HttpsError(
          'invalid-argument',
          'Plano invalido. Use cafe, marmita ou lendario.'
        );
      }
      throw new HttpsError(
        'invalid-argument',
        'Envie planId (cafe|marmita|lendario) ou customAmount (1 a 5000).'
      );
    }

    if (!creatorMembership && attributionCreatorId) {
      await getMonetizableCreatorPublicProfile(getDatabase(), attributionCreatorId);
    }

    let token;
    try {
      token = MP_ACCESS_TOKEN.value();
    } catch {
      throw new HttpsError(
        'failed-precondition',
        'Mercado Pago nao configurado (secret MP_ACCESS_TOKEN).'
      );
    }
    token = String(token).trim();
    if (!token) {
      throw new HttpsError('failed-precondition', 'Token Mercado Pago vazio.');
    }

    const baseFn = FUNCTIONS_PUBLIC_URL.value().replace(/\/$/, '');
    const notificationUrl = `${baseFn}/mercadopagowebhook`;

    try {
      let url;
      const creatorBackUrlQuery = attributionCreatorId
        ? `creatorId=${encodeURIComponent(attributionCreatorId)}`
        : '';
      if (creatorMembership) {
        url = await criarPreferenciaApoioValorLivre(
          token,
          creatorMembershipPrice,
          APP_BASE_URL.value(),
          request.auth.uid,
          notificationUrl,
          creatorMembershipCreatorId,
          {
            metadata: {
              tipo: 'creator_membership',
              creatorMembership: true,
              transactionType: 'CREATOR_MEMBERSHIP',
              source: 'creator_link',
            },
            backUrlQuery: `tipo=creator_membership&creatorId=${encodeURIComponent(creatorMembershipCreatorId)}`,
          }
        );
      } else if (hasValidCustom) {
        url = await criarPreferenciaApoioValorLivre(
          token,
          customTry.value,
          APP_BASE_URL.value(),
          request.auth.uid,
          notificationUrl,
          attributionCreatorId,
          creatorBackUrlQuery ? { backUrlQuery: creatorBackUrlQuery } : {}
        );
      } else {
        url = await criarPreferenciaApoio(
          token,
          planNorm,
          APP_BASE_URL.value(),
          request.auth.uid,
          notificationUrl,
          attributionCreatorId,
          creatorBackUrlQuery ? { backUrlQuery: creatorBackUrlQuery } : {}
        );
      }
      return { ok: true, url };
    } catch (err) {
      const errMsg = err?.message || String(err);
      logger.error('Mercado Pago preference', {
        planId: planNorm,
        customAmount: hasValidCustom ? customTry.value : payload.customAmount,
        error: errMsg,
      });
      const lower = errMsg.toLowerCase();
      if (lower.includes('invalid') && lower.includes('token')) {
        throw new HttpsError(
          'failed-precondition',
          'Mercado Pago recusou o Access Token (invalido, expirado ou ambiente errado). Gere um novo em Credenciais e rode: firebase functions:secrets:set MP_ACCESS_TOKEN'
        );
      }
      if (lower.includes('unauthorized') || errMsg.includes('401')) {
        throw new HttpsError(
          'failed-precondition',
          'Token rejeitado pelo Mercado Pago (401). Confira se colou o Access Token e nao a Public Key.'
        );
      }
      throw new HttpsError(
        'internal',
        errMsg.length > 220 ? `${errMsg.slice(0, 220)}…` : errMsg
      );
    }
  }
);

function normalizeStoreBuyerProfile(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const digits = (value, max) => String(value || '').replace(/\D+/g, '').slice(0, max);
  return {
    fullName: String(src.fullName || '').trim(),
    cpf: normalizeAndValidateCpf(src.cpf || '') || '',
    phone: digits(src.phone, 11),
    postalCode: digits(src.postalCode, 8),
    state: String(src.state || '').trim().toUpperCase().slice(0, 2),
    city: String(src.city || '').trim(),
    neighborhood: String(src.neighborhood || '').trim(),
    addressLine1: String(src.addressLine1 || '').trim(),
    addressLine2: String(src.addressLine2 || '').trim(),
  };
}

function storeBuyerProfileMissingFields(raw) {
  const profile = normalizeStoreBuyerProfile(raw);
  const missing = [];
  if (profile.fullName.length < 6) missing.push('nome completo');
  if (!profile.cpf) missing.push('CPF');
  if (profile.phone.length < 10) missing.push('telefone');
  if (profile.postalCode.length !== 8) missing.push('CEP');
  if (profile.state.length !== 2) missing.push('estado');
  if (profile.city.length < 2) missing.push('cidade');
  if (profile.neighborhood.length < 2) missing.push('bairro');
  if (profile.addressLine1.length < 6) missing.push('endereco');
  return missing;
}

function maskCpf(cpf) {
  const digits = String(cpf || '').replace(/\D+/g, '');
  if (digits.length !== 11) return '';
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function storeProductIsOnDemand(product) {
  return String(product?.inventoryMode || '').toLowerCase() === 'on_demand';
}

/**
 * Valida uma linha do carrinho (checkout e cotação de frete).
 * @returns {object} orderLine com inventoryMode para o webhook não debitar estoque infinito.
 */
function parseStoreCartLineItem(item, products, { vip, vipDiscountPct, enforceStock }) {
  const productId = String(item?.productId || '').trim();
  const quantity = Math.max(1, Math.floor(Number(item?.quantity || 1)));
  if (!productId) {
    throw new HttpsError('invalid-argument', 'Item invalido (productId ausente).');
  }
  const product = products[productId];
  if (!product) {
    throw new HttpsError('not-found', `Produto ${productId} nao encontrado.`);
  }
  if (product.isActive === false) {
    throw new HttpsError('failed-precondition', `Produto ${productId} indisponivel.`);
  }
  if (product.isStoreDemo === true) {
    throw new HttpsError('failed-precondition', `Produto ${productId} nao esta disponivel para venda.`);
  }
  const onDemand = storeProductIsOnDemand(product);
  if (enforceStock && !onDemand) {
    const stock = Math.max(0, Number(product.stock || 0));
    if (quantity > stock) {
      throw new HttpsError(
        'failed-precondition',
        `Estoque insuficiente para ${product.title || productId}.`
      );
    }
  }

  const type = String(product.type || 'manga').toLowerCase();
  const sizes = Array.isArray(product.sizes) ? product.sizes.map((s) => String(s || '').trim()).filter(Boolean) : [];
  let size = String(item?.size || '').trim();
  if (type === 'roupa' && sizes.length) {
    if (!size || !sizes.includes(size)) {
      throw new HttpsError(
        'invalid-argument',
        `Informe um tamanho valido para ${product.title || productId}.`
      );
    }
  } else {
    size = '';
  }

  const basePrice = Number(
    product.isOnSale === true && Number(product.promoPrice) > 0
      ? product.promoPrice
      : product.price
  );
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    throw new HttpsError('failed-precondition', `Preco invalido para ${product.title || productId}.`);
  }
  let unitPrice = round2(basePrice);
  if (vip && product.isVIPDiscountEnabled === true) {
    unitPrice = round2(basePrice * (1 - vipDiscountPct / 100));
  }
  const lineTotal = round2(unitPrice * quantity);
  const baseTitle = String(product.title || productId);
  const productCreatorId = sanitizeCreatorId(product?.creatorId) || null;
  return {
    productId,
    title: size ? `${baseTitle} (${size})` : baseTitle,
    description: String(product.description || ''),
    quantity,
    unitPrice,
    lineTotal,
    size: size || null,
    type: type || 'manga',
    creatorId: productCreatorId,
    inventoryMode: onDemand ? 'on_demand' : 'fixed',
  };
}

export const criarCheckoutLoja = onCall(
  {
    region: 'us-central1',
    secrets: [MP_ACCESS_TOKEN],
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para finalizar a compra.');
    }
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const requestedShippingService = String(body.shippingService != null ? body.shippingService : 'PAC')
      .trim()
      .toUpperCase();
    if (!rawItems.length) throw new HttpsError('invalid-argument', 'Carrinho vazio.');
    if (rawItems.length > 20) throw new HttpsError('invalid-argument', 'Limite de 20 itens por checkout.');

    let token;
    try {
      token = String(MP_ACCESS_TOKEN.value()).trim();
    } catch {
      throw new HttpsError(
        'failed-precondition',
        'Mercado Pago nao configurado (secret MP_ACCESS_TOKEN).'
      );
    }
    if (!token) throw new HttpsError('failed-precondition', 'Token Mercado Pago vazio.');

    const db = getDatabase();
    const [cfgSnap, productsSnap, userSnap] = await Promise.all([
      db.ref('loja/config').get(),
      db.ref('loja/produtos').get(),
      db.ref(`usuarios/${request.auth.uid}`).get(),
    ]);
    const config = cfgSnap.exists() ? cfgSnap.val() || {} : {};
    if (config.storeEnabled !== true || config.acceptingOrders !== true) {
      throw new HttpsError('failed-precondition', 'Loja nao esta aceitando pedidos agora.');
    }

    const profile = userSnap.exists() ? userSnap.val() || {} : {};
    const buyerProfile = normalizeStoreBuyerProfile(profile.buyerProfile);
    const missingBuyerFields = storeBuyerProfileMissingFields(buyerProfile);
    if (missingBuyerFields.length) {
      throw new HttpsError(
        'failed-precondition',
        `Complete seu perfil de compra antes de pagar: ${missingBuyerFields.join(', ')}.`
      );
    }
    if (String(profile.status || '').trim().toLowerCase() !== 'ativo') {
      throw new HttpsError('failed-precondition', 'Sua conta precisa estar ativa para comprar.');
    }
    const vip = buildUserEntitlements(profile).global.isPremium === true;
    const vipDiscountPct = Math.max(0, Math.min(60, Number(config.vipDiscountPct || 10)));

    const products = productsSnap.exists() ? productsSnap.val() || {} : {};
    const orderItems = [];
    let subtotal = 0;
    for (const item of rawItems) {
      const line = parseStoreCartLineItem(item, products, {
        vip,
        vipDiscountPct,
        enforceStock: true,
      });
      subtotal += line.lineTotal;
      orderItems.push(line);
    }

    subtotal = round2(subtotal);
    if (subtotal <= 0) throw new HttpsError('failed-precondition', 'Subtotal invalido para checkout.');

    const shippingQuote = buildStoreShippingQuote({
      items: orderItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      productsById: products,
      config,
      buyerProfile,
      subtotal,
    });
    const allowedCodes = (shippingQuote.options || []).map((o) => String(o.serviceCode || '').trim().toUpperCase());
    const shippingOption = shippingQuote.options.find(
      (option) => String(option.serviceCode || '').trim().toUpperCase() === requestedShippingService
    );
    if (!shippingOption) {
      throw new HttpsError(
        'invalid-argument',
        allowedCodes.length
          ? `Servico de frete invalido (${requestedShippingService}). Opcoes: ${allowedCodes.join(', ')}.`
          : 'Nao foi possivel calcular o frete para este carrinho.'
      );
    }
    const shippingDiscountBrl = round2(shippingOption.discountBrl);
    const shippingBrl = round2(shippingOption.priceBrl);
    const total = round2(subtotal + shippingBrl);
    if (total <= 0) throw new HttpsError('failed-precondition', 'Total invalido para checkout.');

    const now = Date.now();
    const orderRef = db.ref('loja/pedidos').push();
    const orderId = String(orderRef.key || '').trim();
    if (!orderId) throw new HttpsError('internal', 'Falha ao gerar pedido.');

    const sellers = {};
    for (const line of orderItems) {
      const cid = sanitizeCreatorId(line?.creatorId);
      if (cid) sellers[cid] = true;
    }

    const order = {
      uid: request.auth.uid,
      status: 'pending',
      buyer: {
        fullName: buyerProfile.fullName,
        phone: buyerProfile.phone,
        cpfMasked: maskCpf(buyerProfile.cpf),
      },
      shippingAddress: {
        postalCode: buyerProfile.postalCode,
        state: buyerProfile.state,
        city: buyerProfile.city,
        neighborhood: buyerProfile.neighborhood,
        addressLine1: buyerProfile.addressLine1,
        addressLine2: buyerProfile.addressLine2 || null,
      },
      items: orderItems,
      sellers,
      subtotal,
      shippingBrl,
      shippingOriginalBrl: round2(shippingOption.originalPriceBrl),
      shippingDiscountBrl,
      shippingFreeApplied: shippingDiscountBrl > 0,
      shippingMethod: shippingOption.serviceCode,
      shippingRegion: shippingOption.regionKey,
      shippingRegionLabel: shippingOption.regionLabel,
      shippingTransitDays: shippingOption.transitDays ?? shippingOption.deliveryDays,
      shippingDeliveryDays: shippingOption.deliveryDays,
      shippingDeliveryDaysLow: shippingOption.deliveryDaysLow ?? null,
      shippingDeliveryDaysHigh: shippingOption.deliveryDaysHigh ?? null,
      shippingWeightGrams: shippingOption.totalWeightGrams,
      shippingCostInternal: round2(shippingOption.internalCostBrl),
      total,
      currency: 'BRL',
      vipApplied: vip,
      vipDiscountPct: vip ? vipDiscountPct : 0,
      payoutStatus: 'held',
      payoutReleasedAt: null,
      createdAt: now,
      updatedAt: now,
      source: 'checkout_store',
    };
    await orderRef.set(order);

    const baseFn = FUNCTIONS_PUBLIC_URL.value().replace(/\/$/, '');
    const notificationUrl = `${baseFn}/mercadopagowebhook`;
    const mpOrder = {
      ...order,
      orderId,
      uid: request.auth.uid,
      items: [
        ...orderItems.map((i) => ({
          title: i.title,
          description: i.description || '',
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        ...(shippingBrl > 0
          ? [
              {
                title: 'Frete',
                description: 'Envio',
                quantity: 1,
                unitPrice: shippingBrl,
              },
            ]
          : []),
      ],
      total,
    };
    const url = await criarPreferenciaLoja(
      token,
      mpOrder,
      APP_BASE_URL.value(),
      notificationUrl
    );
    await orderRef.update({
      checkoutUrl: url,
      checkoutStartedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { ok: true, orderId, url };
  }
);

/** Cria pedido POD (pending_payment) e retorna URL do checkout Mercado Pago. */
export const createPrintOnDemandCheckout = onCall(
  {
    region: 'us-central1',
    secrets: [MP_ACCESS_TOKEN],
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para pagar.');
    }
    const uid = request.auth.uid;
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    let token;
    try {
      token = String(MP_ACCESS_TOKEN.value()).trim();
    } catch {
      throw new HttpsError('failed-precondition', 'Mercado Pago nao configurado (secret MP_ACCESS_TOKEN).');
    }
    if (!token) throw new HttpsError('failed-precondition', 'Token Mercado Pago vazio.');
    const db = getDatabase();
    let orderId;
    try {
      const created = await persistPrintOnDemandOrder(db, uid, body);
      orderId = created.orderId;
      const order = created.order;
      const snap = order.snapshot && typeof order.snapshot === 'object' ? order.snapshot : {};
      const amount = round2(Number(snap.amountDueBRL ?? 0));
      if (!Number.isFinite(amount) || amount <= 0) {
        await db.ref(`loja/printOnDemandOrders/${orderId}`).remove();
        throw new HttpsError('failed-precondition', 'Valor do pedido invalido.');
      }
      const saleModel = String(snap.saleModel || '');
      const format = String(snap.format || '');
      const qty = Number(snap.quantity || 0);
      const baseFn = FUNCTIONS_PUBLIC_URL.value().replace(/\/$/, '');
      const notificationUrl = `${baseFn}/mercadopagowebhook`;
      const title = `Manga fisico — ${format === 'tankobon' ? 'Tankobon' : 'Meio-tanko'} x${qty}`;
      const desc =
        saleModel === 'store_promo'
          ? 'Divulgacao na loja'
          : saleModel === 'platform'
            ? 'Venda pela plataforma'
            : 'Compra pessoal';
      const url = await criarPreferenciaPrintOnDemand(token, {
        orderId,
        uid,
        title,
        description: desc,
        amountBRL: amount,
        appBaseUrl: APP_BASE_URL.value(),
        notificationUrl,
      });
      const t = Date.now();
      await db.ref(`loja/printOnDemandOrders/${orderId}`).update({
        checkoutUrl: url,
        checkoutStartedAt: t,
        expectedPayBRL: amount,
        updatedAt: t,
      });
      await db.ref(`loja/printOnDemandOrders/${orderId}/orderEvents`).push({
        at: t,
        type: 'checkout_mp_created',
        message: 'Preferencia de pagamento criada no Mercado Pago.',
        actor: 'system',
      });
      return { ok: true, orderId, url };
    } catch (e) {
      if (orderId) {
        try {
          await db.ref(`loja/printOnDemandOrders/${orderId}`).remove();
        } catch {
          /* ignore */
        }
      }
      throw e;
    }
  }
);

/** Gera nova preferência MP para pedido POD já existente em pending_payment (ex.: sem checkoutUrl). */
export const resumePrintOnDemandCheckout = onCall(
  {
    region: 'us-central1',
    secrets: [MP_ACCESS_TOKEN],
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para pagar.');
    }
    const uid = request.auth.uid;
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const orderId = String(body.orderId || '').trim();
    if (!orderId) {
      throw new HttpsError('invalid-argument', 'orderId obrigatorio.');
    }
    let token;
    try {
      token = String(MP_ACCESS_TOKEN.value()).trim();
    } catch {
      throw new HttpsError('failed-precondition', 'Mercado Pago nao configurado (secret MP_ACCESS_TOKEN).');
    }
    if (!token) throw new HttpsError('failed-precondition', 'Token Mercado Pago vazio.');
    const db = getDatabase();
    const orderRef = db.ref(`loja/printOnDemandOrders/${orderId}`);
    const snap = await orderRef.get();
    if (!snap.exists()) {
      throw new HttpsError('not-found', 'Pedido nao encontrado.');
    }
    const row = snap.val() || {};
    if (String(row.creatorUid || '') !== uid) {
      throw new HttpsError('permission-denied', 'Sem permissao.');
    }
    const status = normalizeStoreOrderStatusInput(String(row.status || '').trim().toLowerCase(), '');
    if (status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        'So e possivel gerar pagamento para pedidos aguardando pagamento.'
      );
    }
    const exp = Number(row.expiresAt || 0);
    if (exp && Date.now() > exp) {
      throw new HttpsError(
        'failed-precondition',
        'Este pedido expirou (3 horas sem pagamento). Monte um novo lote no carrinho.'
      );
    }
    const snapOrder = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {};
    const amount = round2(Number(snapOrder.amountDueBRL ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpsError('failed-precondition', 'Valor do pedido invalido.');
    }
    const saleModel = String(snapOrder.saleModel || '');
    const format = String(snapOrder.format || '');
    const qty = Number(snapOrder.quantity || 0);
    const baseFn = FUNCTIONS_PUBLIC_URL.value().replace(/\/$/, '');
    const notificationUrl = `${baseFn}/mercadopagowebhook`;
    const title = `Manga fisico — ${format === 'tankobon' ? 'Tankobon' : 'Meio-tanko'} x${qty}`;
    const desc =
      saleModel === 'store_promo'
        ? 'Divulgacao na loja'
        : saleModel === 'platform'
          ? 'Venda pela plataforma'
          : 'Compra pessoal';
    const url = await criarPreferenciaPrintOnDemand(token, {
      orderId,
      uid,
      title,
      description: desc,
      amountBRL: amount,
      appBaseUrl: APP_BASE_URL.value(),
      notificationUrl,
    });
    await orderRef.update({
      checkoutUrl: url,
      checkoutStartedAt: Date.now(),
      expectedPayBRL: amount,
      updatedAt: Date.now(),
    });
    return { ok: true, url };
  }
);

export const quoteStoreShipping = onCall(
  {
    region: 'us-central1',
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para calcular o frete.');
    }
    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw new HttpsError('invalid-argument', 'Carrinho vazio.');
    const db = getDatabase();
    const [cfgSnap, productsSnap, userSnap] = await Promise.all([
      db.ref('loja/config').get(),
      db.ref('loja/produtos').get(),
      db.ref(`usuarios/${request.auth.uid}`).get(),
    ]);
    const config = cfgSnap.exists() ? cfgSnap.val() || {} : {};
    if (config.storeEnabled !== true || config.acceptingOrders !== true) {
      throw new HttpsError('failed-precondition', 'Loja nao esta aceitando pedidos agora.');
    }
    const profile = userSnap.exists() ? userSnap.val() || {} : {};
    const buyerProfile = normalizeStoreBuyerProfile(profile.buyerProfile);
    const missingBuyerFields = storeBuyerProfileMissingFields(buyerProfile);
    if (missingBuyerFields.length) {
      throw new HttpsError(
        'failed-precondition',
        `Complete seu perfil de compra antes de calcular o frete: ${missingBuyerFields.join(', ')}.`
      );
    }
    const products = productsSnap.exists() ? productsSnap.val() || {} : {};
    const vipQuote = buildUserEntitlements(profile).global.isPremium === true;
    const vipDiscountPctQuote = Math.max(0, Math.min(60, Number(config.vipDiscountPct || 10)));
    let subtotal = 0;
    const items = [];
    const pricedLines = [];
    for (const item of rawItems) {
      const line = parseStoreCartLineItem(item, products, {
        vip: vipQuote,
        vipDiscountPct: vipDiscountPctQuote,
        enforceStock: true,
      });
      subtotal += line.lineTotal;
      items.push({ productId: line.productId, quantity: line.quantity });
      pricedLines.push({
        productId: line.productId,
        quantity: line.quantity,
        title: line.title,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        size: line.size ?? null,
      });
    }
    subtotal = round2(subtotal);
    const quote = buildStoreShippingQuote({
      items,
      productsById: products,
      config,
      buyerProfile,
      subtotal,
    });
    return { ok: true, quote, subtotal, pricedLines, currency: 'BRL' };
  }
);

const MS_DAY = 86400000;

/** Webhook Mercado Pago — confirma pagamento Premium (nome em minúsculas = URL estável). */
export const mercadopagowebhook = onRequest(
  {
    region: 'us-central1',
    secrets: [
      MP_ACCESS_TOKEN,
      SMTP_HOST,
      SMTP_PORT,
      SMTP_USER,
      SMTP_PASS,
      SMTP_FROM,
    ],
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    let paymentId;
    try {
      paymentId = extractMercadoPagoPaymentId(req);
    } catch (e) {
      logger.error('mercadopagowebhook parse', { error: e?.message });
      res.status(200).send('OK');
      return;
    }
    if (!paymentId) {
      res.status(200).send('OK');
      return;
    }

    const mpWebhookSecret = String(MP_WEBHOOK_SECRET.value() || '').trim();
    if (mpWebhookSecret) {
      if (req.method === 'POST') {
        const sigCheck = verifyMercadoPagoWebhookSignature(req, paymentId, mpWebhookSecret);
        if (!sigCheck.ok && !sigCheck.skipped) {
          logger.warn('mercadopagowebhook assinatura invalida', {
            paymentId,
            reason: sigCheck.reason,
          });
          res.status(401).send('Unauthorized');
          return;
        }
      } else {
        logger.warn(
          'mercadopagowebhook: GET rejeitado — MP_WEBHOOK_SECRET exige POST com x-signature (configure o webhook no painel MP como POST).'
        );
        res.status(401).send('Unauthorized');
        return;
      }
    }

    let token;
    try {
      token = String(MP_ACCESS_TOKEN.value()).trim();
    } catch {
      logger.error('mercadopagowebhook: MP_ACCESS_TOKEN ausente');
      res.status(500).send('Config');
      return;
    }
    if (!token) {
      res.status(500).send('Config');
      return;
    }

    try {
      await tratarNotificacaoPagamentoPremium(token, paymentId);
    } catch (err) {
      logger.error('mercadopagowebhook', { paymentId, error: err?.message });
      res.status(500).send('Error');
      return;
    }
    res.status(200).send('OK');
  }
);

export const criarCheckoutPremium = onCall(
  {
    region: 'us-central1',
    secrets: [MP_ACCESS_TOKEN],
    cors: true,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Faca login para assinar o Premium.');
    }

    let token;
    try {
      token = String(MP_ACCESS_TOKEN.value()).trim();
    } catch {
      throw new HttpsError(
        'failed-precondition',
        'Mercado Pago nao configurado (secret MP_ACCESS_TOKEN).'
      );
    }
    if (!token) {
      throw new HttpsError('failed-precondition', 'Token Mercado Pago vazio.');
    }

    const baseFn = FUNCTIONS_PUBLIC_URL.value().replace(/\/$/, '');
    const notificationUrl = `${baseFn}/mercadopagowebhook`;
    const db = getDatabase();
    const offer = await getPremiumOfferAt(db, Date.now(), PREMIUM_PRICE_BRL);
    const payload =
      request.data && typeof request.data === 'object' ? request.data : {};
    const attributionRaw =
      payload.attribution && typeof payload.attribution === 'object'
        ? payload.attribution
        : {};
    const attributionCreatorId = sanitizeCreatorId(payload.attributionCreatorId);
    const attribution = {
      source: normalizeTrackingSource(attributionRaw.source) || 'direct',
      campaignId: sanitizeTrackingValue(attributionRaw.campaignId, 100),
      clickId: sanitizeTrackingValue(attributionRaw.clickId, 120),
      creatorId: attributionCreatorId || null,
    };
    if (attributionCreatorId) {
      await getMonetizableCreatorPublicProfile(db, attributionCreatorId);
    }

    try {
      const url = await criarPreferenciaPremium(
        token,
        request.auth.uid,
        APP_BASE_URL.value(),
        notificationUrl,
        offer.currentPriceBRL,
        offer.isPromoActive
          ? { promoId: offer.promo?.promoId, promoName: offer.promo?.name }
          : null,
        attribution,
        attributionCreatorId
          ? { backUrlQuery: `creatorId=${encodeURIComponent(attributionCreatorId)}` }
          : {}
      );
      await pushMarketingEvent(db, {
        eventType: 'premium_checkout_started',
        source: attribution.source,
        campaignId: attribution.campaignId,
        clickId: attribution.clickId,
        uid: request.auth.uid,
      });
      return { ok: true, url };
    } catch (err) {
      const errMsg = err?.message || String(err);
      logger.error('criarCheckoutPremium', { uid: request.auth.uid, error: errMsg });
      throw new HttpsError(
        'internal',
        errMsg.length > 200 ? `${errMsg.slice(0, 200)}…` : errMsg
      );
    }
  }
);

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

export const adminObterPromocaoPremium = onCall(
  { region: 'us-central1' },
  async (request) => {
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
    const campaignIds = new Set(history.map((h) => h.promoId));
    if (parsed?.promoId) campaignIds.add(parsed.promoId);
    const campaigns = history.slice(0, 60);
    if (parsed?.promoId && parsed?.startsAt && parsed?.endsAt) {
      campaigns.push({
        promoId: parsed.promoId,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
      });
    }
    const starts = campaigns
      .map((c) => toNum(c?.startsAt, 0))
      .filter((v) => Number.isFinite(v) && v > 0);
    const ends = campaigns
      .map((c) => toNum(c?.endsAt, 0))
      .filter((v) => Number.isFinite(v) && v > 0);
    const minAt = starts.length ? Math.min(...starts) - 24 * 60 * 60 * 1000 : 0;
    const maxAt = ends.length ? Math.max(...ends) + 24 * 60 * 60 * 1000 : Date.now() + 24 * 60 * 60 * 1000;
    const financeEvents = financeEventsRaw.filter((ev) => {
      const at = toNum(ev?.at, 0);
      if (!at) return false;
      if (at < minAt || at > maxAt) return false;
      return String(ev?.tipo || '') === 'premium_aprovado';
    });
    const marketingEvents = marketingEventsRaw.filter((ev) => {
      const at = toNum(ev?.at, 0);
      if (!at) return false;
      return at >= minAt && at <= maxAt;
    });
    const performanceByCampaign = buildPromoPerformanceByCampaign(
      financeEvents,
      marketingEvents,
      [...campaignIds]
    );
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
      logSnap.forEach((c) => {
        promoActivityLog.push({ id: c.key, ...(c.val() || {}) });
      });
    }
    promoActivityLog.reverse();

    return {
      ok: true,
      promo: raw,
      parsedPromo: parsed,
      promoHistory: historyWithPerformance,
      currentPerformance:
        parsed?.promoId && performanceByCampaign[parsed.promoId]
          ? performanceByCampaign[parsed.promoId]
          : null,
      lastCampaign,
      promoActivityLog,
    };
  }
);

/** Auditoria somente leitura: soma creatorData/.../payments vs lifetimeNetBRL (admin financeiro). */
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

/** Alinha lifetimeNetBRL à soma de payments (requireAdminAuth já exclui mangaka). */
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
  {
    region: 'us-central1',
    secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctxPromo = await requireAdminAuth(request.auth);
    requirePermission(ctxPromo, 'financeiro');
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
      await db.ref(PREMIUM_PROMO_PATH).set({
        enabled: false,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
      return { ok: true, disabled: true };
    }

    const priceBRL = validPromoPrice(body.priceBRL);
    const startsAt = Number(body.startsAt || now);
    const endsAt = Number(body.endsAt || 0);
    if (priceBRL == null) {
      throw new HttpsError('invalid-argument', 'Preco promocional invalido.');
    }
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
    const createdAt = historicoSnap.exists()
      ? Number(historicoSnap.val()?.createdAt || startsAt || now)
      : now;
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
      status: startsAt > now ? 'agendada' : (endsAt >= now ? 'ativa' : 'encerrada'),
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

    return {
      ok: true,
      promo,
      notifyUsers: body.notifyUsers === true,
      emailStats,
    };
  }
);

export const adminIncrementarDuracaoPromocaoPremium = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    const ctxInc = await requireAdminAuth(request.auth);
    requirePermission(ctxInc, 'financeiro');

    const body = request.data && typeof request.data === 'object' ? request.data : {};
    const days = Math.max(0, Math.floor(Number(body.days || 0)));
    const hours = Math.max(0, Math.floor(Number(body.hours || 0)));
    const minutes = Math.max(0, Math.floor(Number(body.minutes || 0)));
    const extraMs =
      days * 24 * 60 * 60 * 1000 +
      hours * 60 * 60 * 1000 +
      minutes * 60 * 1000;
    if (extraMs <= 0) {
      throw new HttpsError('invalid-argument', 'Informe um incremento maior que zero.');
    }

    const db = getDatabase();
    const now = Date.now();
    const snap = await db.ref(PREMIUM_PROMO_PATH).get();
    const promo = parsePromoConfig(snap.val());
    if (!promo) {
      throw new HttpsError('failed-precondition', 'Nao existe promocao premium ativa/configurada.');
    }
    const isActive = now >= Number(promo.startsAt || 0) && now <= Number(promo.endsAt || 0);
    if (!isActive) {
      throw new HttpsError('failed-precondition', 'So e possivel incrementar a duracao de uma promocao ativa.');
    }

    const currentEnd = Number(promo.endsAt);
    if (!Number.isFinite(currentEnd) || currentEnd <= now) {
      throw new HttpsError('failed-precondition', 'Data de termino da promocao invalida ou ja expirada.');
    }
    // Sempre soma ao termino atual — nunca substitui pela duracao do incremento.
    const newEndsAt = currentEnd + extraMs;
    if (!Number.isFinite(newEndsAt) || newEndsAt <= currentEnd) {
      throw new HttpsError('internal', 'Falha ao calcular novo termino da promocao.');
    }
    await db.ref(PREMIUM_PROMO_PATH).update({
      endsAt: newEndsAt,
      updatedAt: now,
      updatedBy: request.auth.uid,
    });
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
      detail: {
        added: { days, hours, minutes },
        endsAtBefore: currentEnd,
        endsAtAfter: newEndsAt,
      },
    });

    return {
      ok: true,
      promoId: promo.promoId,
      added: { days, hours, minutes, ms: extraMs },
      endsAt: newEndsAt,
    };
  }
);

export const adminDefinirMetaPromocaoPremium = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
  const ctxMeta = await requireAdminAuth(request.auth);
  requirePermission(ctxMeta, 'financeiro');
  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const rawGoal = body.goalPayments;
  let goalPayments = null;
  if (rawGoal !== undefined && rawGoal !== null && rawGoal !== '') {
    const g = Math.floor(Number(rawGoal));
    if (!Number.isFinite(g) || g < 0) {
      throw new HttpsError('invalid-argument', 'Meta invalida: use um inteiro >= 0 ou vazio para limpar.');
    }
    if (g > 0) goalPayments = g;
  }
  const db = getDatabase();
  const now = Date.now();
  const snap = await db.ref(PREMIUM_PROMO_PATH).get();
  const promo = parsePromoConfig(snap.val());
  if (!promo) {
    throw new HttpsError('failed-precondition', 'Nao ha promocao premium ativa para associar a meta.');
  }
  const aoVivo =
    now >= Number(promo.startsAt || 0) && now <= Number(promo.endsAt || 0);
  if (!aoVivo) {
    throw new HttpsError(
      'failed-precondition',
      'Meta so pode ser definida com a promocao ao vivo (nao em campanha apenas agendada).'
    );
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

/** Lembrete e-mail ~5 dias antes do fim + downgrade automático ao vencer. */
export const assinaturasPremiumDiario = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'America/Sao_Paulo',
    memory: '256MiB',
    timeoutSeconds: 300,
    secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async () => {
    const db = getDatabase();
    const snap = await db.ref('usuarios').get();
    if (!snap.exists()) {
      logger.info('assinaturasPremiumDiario: sem usuarios');
      return;
    }

    const now = Date.now();
    const users = snap.val() || {};
    let lembretes = 0;
    let expirados = 0;

    const transporter = getTransporter();
    const fromAddr = getSmtpFrom();

    for (const [uid, profile] of Object.entries(users)) {
      const needsEntitlementsRepair =
        !profile?.userEntitlements ||
        typeof profile.userEntitlements !== 'object' ||
        typeof profile.userEntitlements.global !== 'object' ||
        typeof profile.userEntitlements.creators !== 'object';
      if (needsEntitlementsRepair) {
        try {
          const repairPatch = {};
          appendNestedPatch(repairPatch, `usuarios/${uid}`, buildUserEntitlementsPatch(profile));
          await db.ref().update(repairPatch);
        } catch (err) {
          logger.error('userEntitlements repair falhou', { uid, error: err?.message });
        }
      }

      const statusMembro = profile?.membershipStatus;
      const mu = profile?.memberUntil;
      const tipoConta = String(profile?.accountType || 'comum').toLowerCase();
      const appStatus = profile?.status;

      if (appStatus !== 'ativo') continue;

      if (
        statusMembro === 'ativo' &&
        typeof mu === 'number' &&
        mu < now &&
        tipoConta === 'premium'
      ) {
        try {
          const pubSnap = await db.ref(`usuarios_publicos/${uid}`).get();
          const pub = pubSnap.val() || {};
          let avatarPub = String(pub.userAvatar || profile.userAvatar || '').trim();
          if (!avatarPub) avatarPub = AVATAR_FALLBACK_FUNCTIONS;
          await db.ref(`usuarios/${uid}`).update({
            membershipStatus: 'vencido',
            accountType: 'comum',
            userEntitlements: {
              ...(profile?.userEntitlements && typeof profile.userEntitlements === 'object'
                ? profile.userEntitlements
                : {}),
              global: {
                isPremium: false,
                status: 'vencido',
                memberUntil: typeof mu === 'number' ? mu : null,
              },
              updatedAt: now,
            },
          });
          await db.ref(`usuarios_publicos/${uid}`).update({
            uid,
            userName: pub.userName || profile.userName || 'Leitor',
            userAvatar: avatarPub,
            accountType: 'comum',
            updatedAt: now,
          });
          expirados += 1;
        } catch (err) {
          logger.error('Premium expirar falhou', { uid, error: err?.message });
        }
        continue;
      }

      if (statusMembro !== 'ativo' || typeof mu !== 'number' || mu <= now) continue;
      const remaining = mu - now;
      if (remaining > 5 * MS_DAY || remaining <= 0) continue;
      const notified = profile?.premium5dNotifiedForUntil;
      if (notified === mu) continue;

      try {
        const authUser = await getAuth().getUser(uid);
        const to = authUser?.email;
        if (to && !authUser.disabled) {
          await transporter.sendMail({
            from: fromAddr,
            to,
            subject: 'MangaTeofilo — sua assinatura Premium acaba em breve',
            text: `Faltam cerca de 5 dias para o fim do seu Premium (ate ${formatarDataBr(mu)}). Renove em ${APP_BASE_URL.value().replace(/\/$/, '')}/apoie`,
            html: buildPremiumExpiryWarningHtml(mu),
          });
          await db.ref(`usuarios/${uid}/premium5dNotifiedForUntil`).set(mu);
          lembretes += 1;
        }
      } catch (err) {
        logger.error('Premium lembrete falhou', { uid, error: err?.message });
      }
    }

    logger.info('assinaturasPremiumDiario ok', {
      lembretes,
      expirados,
      totalUsuarios: Object.keys(users).length,
    });
  }
);

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeGender(g) {
  const s = String(g || '').toLowerCase().trim();
  if (s === 'masculino' || s === 'feminino' || s === 'outro') return s;
  return 'nao_informado';
}

function monthKeyFromMs(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function ensurePeriod(input, now) {
  const endAt = toNum(input?.endAt, now);
  const startAt = toNum(input?.startAt, endAt - 30 * MS_DAY);
  if (endAt <= startAt) {
    return {
      startAt: endAt - 30 * MS_DAY,
      endAt,
    };
  }
  const maxSpan = 5 * 365 * MS_DAY;
  const span = endAt - startAt;
  if (span > maxSpan) {
    return {
      startAt: endAt - maxSpan,
      endAt,
    };
  }
  return { startAt, endAt };
}

function defaultComparePeriod(period) {
  const span = period.endAt - period.startAt;
  return {
    startAt: period.startAt - span,
    endAt: period.startAt,
  };
}

function round2(v) {
  return Math.round(toNum(v, 0) * 100) / 100;
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
  const filtered = events.filter((e) => {
    const at = toNum(e?.at, 0);
    if (at < period.startAt || at >= period.endAt) return false;
    const tipo = String(e?.tipo || '');
    return tipo === 'premium_aprovado' || tipo === 'apoio_aprovado';
  });

  const subByUid = new Map();
  const doaByUid = new Map();
  const historyByUid = {};
  const daysPerSubscription = Math.round(PREMIUM_D_MS / MS_DAY);

  const ensureHistory = (uid) => {
    if (!historyByUid[uid]) {
      historyByUid[uid] = {
        subscriptions: [],
        donations: [],
      };
    }
    return historyByUid[uid];
  };

  for (const ev of filtered) {
    const uid = String(ev?.uid || '').trim();
    if (!uid) continue;

    const at = toNum(ev?.at, 0);
    const amount = toNum(ev?.amount, 0);
    const tipo = String(ev?.tipo || '');
    const userBase = buildUserLabel(uid, usuarios, usuariosPublicos);
    const profile = usuarios[uid] || {};
    const memberUntil = toNum(profile?.memberUntil, 0);
    const isActive = memberUntil > nowMs;

    if (tipo === 'premium_aprovado') {
      const curr = subByUid.get(uid) || {
        ...userBase,
        totalSpent: 0,
        count: 0,
        totalDays: 0,
        lastAt: 0,
        memberUntil: memberUntil || null,
        status: isActive ? 'ativo' : 'expirado',
      };
      curr.totalSpent += amount;
      curr.count += 1;
      // KPI do filtro do dashboard: N * 30d — não é saldo restante (isso vem de usuarios/*/memberUntil).
      curr.totalDays += daysPerSubscription;
      curr.lastAt = Math.max(curr.lastAt, at);
      curr.memberUntil = memberUntil || null;
      curr.status = isActive ? 'ativo' : 'expirado';
      subByUid.set(uid, curr);

      const h = ensureHistory(uid);
      h.subscriptions.push({
        at,
        amount: round2(amount),
        promoId: ev?.promoId ? String(ev.promoId) : null,
        promoName: ev?.promoName ? String(ev.promoName) : null,
        isPromotion: Boolean(ev?.promoId || ev?.promoName),
      });
      continue;
    }

    const curr = doaByUid.get(uid) || {
      ...userBase,
      totalSpent: 0,
      count: 0,
      lastAt: 0,
    };
    curr.totalSpent += amount;
    curr.count += 1;
    curr.lastAt = Math.max(curr.lastAt, at);
    doaByUid.set(uid, curr);

    const h = ensureHistory(uid);
    h.donations.push({
      at,
      amount: round2(amount),
      origem: ev?.origem ? String(ev.origem) : null,
    });
  }

  for (const uid of Object.keys(historyByUid)) {
    historyByUid[uid].subscriptions.sort((a, b) => b.at - a.at);
    historyByUid[uid].donations.sort((a, b) => b.at - a.at);
  }

  const subscriptionStats = [...subByUid.values()]
    .map((u) => ({
      ...u,
      totalSpent: round2(u.totalSpent),
      averagePrice: u.count > 0 ? round2(u.totalSpent / u.count) : 0,
      totalMonths: Math.round((u.totalDays / 30) * 10) / 10,
    }))
    .sort((a, b) => {
      if (b.totalSpent !== a.totalSpent) return b.totalSpent - a.totalSpent;
      if (b.count !== a.count) return b.count - a.count;
      return b.lastAt - a.lastAt;
    })
    .map((u, idx) => ({ ...u, rank: idx + 1 }));

  const donationStats = [...doaByUid.values()]
    .map((u) => ({
      ...u,
      totalSpent: round2(u.totalSpent),
      averageDonation: u.count > 0 ? round2(u.totalSpent / u.count) : 0,
    }))
    .sort((a, b) => {
      if (b.totalSpent !== a.totalSpent) return b.totalSpent - a.totalSpent;
      if (b.count !== a.count) return b.count - a.count;
      return b.lastAt - a.lastAt;
    })
    .map((u, idx) => ({ ...u, rank: idx + 1 }));

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
  const inPeriodFinance = financeEvents.filter((ev) => {
    const at = toNum(ev?.at, 0);
    return at >= period.startAt && at < period.endAt;
  });
  const inPeriodMarketing = marketingEvents.filter((ev) => {
    const at = toNum(ev?.at, 0);
    return at >= period.startAt && at < period.endAt;
  });

  const countBy = (pred) => inPeriodMarketing.filter(pred).length;
  const uniqueClickSet = new Set();
  for (const ev of inPeriodMarketing) {
    if (ev?.eventType === 'promo_landing' && ev?.source === 'promo_email' && ev?.clickId) {
      uniqueClickSet.add(String(ev.clickId));
    }
  }

  const premiumFinance = inPeriodFinance.filter((ev) => String(ev?.tipo || '') === 'premium_aprovado');
  const premiumBySource = {
    promoEmailCount: 0,
    promoEmailAmount: 0,
    chapterEmailCount: 0,
    chapterEmailAmount: 0,
  };
  const promoCampaignMap = new Map();

  for (const ev of premiumFinance) {
    const amount = toNum(ev?.amount, 0);
    const source = normalizeTrackingSource(ev?.trafficSource) || 'unknown';
    const promoId = sanitizeTrackingValue(ev?.promoId, 100);
    const promoName = ev?.promoName ? String(ev.promoName) : null;
    const campaignId = sanitizeTrackingValue(ev?.trafficCampaign, 100);

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

  const chapterReadsEmail = countBy(
    (ev) => ev?.eventType === 'chapter_read' && ev?.source === 'chapter_email'
  );
  const chapterReadsNormal = countBy(
    (ev) => ev?.eventType === 'chapter_read' && ev?.source !== 'chapter_email'
  );
  const chapterReadsTotal = chapterReadsEmail + chapterReadsNormal;

  return {
    promo: {
      sentEmails: countBy((ev) => ev?.eventType === 'promo_email_sent'),
      promoLandingClicks: countBy(
        (ev) => ev?.eventType === 'promo_landing' && ev?.source === 'promo_email'
      ),
      promoLandingUniqueClicks: uniqueClickSet.size,
      premiumCheckoutsFromPromoEmail: countBy(
        (ev) => ev?.eventType === 'premium_checkout_started' && ev?.source === 'promo_email'
      ),
      premiumPaymentsFromPromoEmail: premiumBySource.promoEmailCount,
      premiumRevenueFromPromoEmail: round2(premiumBySource.promoEmailAmount),
      campaigns: [...promoCampaignMap.values()]
        .map((row) => ({ ...row, revenue: round2(row.revenue) }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 20),
    },
    chapter: {
      sentEmails: countBy((ev) => ev?.eventType === 'chapter_email_sent'),
      chapterLandingClicks: countBy(
        (ev) => ev?.eventType === 'chapter_landing' && ev?.source === 'chapter_email'
      ),
      chapterReadsFromEmail: chapterReadsEmail,
      chapterReadsNormal: chapterReadsNormal,
      chapterReadsTotal,
      chapterReadsFromEmailPct:
        chapterReadsTotal > 0
          ? Math.round((chapterReadsEmail / chapterReadsTotal) * 1000) / 10
          : 0,
      premiumPaymentsFromChapterEmail: premiumBySource.chapterEmailCount,
      premiumRevenueFromChapterEmail: round2(premiumBySource.chapterEmailAmount),
    },
  };
}

function buildPromoPerformanceByCampaign(financeEvents, marketingEvents, campaignIds = []) {
  const idSet = new Set(
    (campaignIds || [])
      .map((v) => sanitizeTrackingValue(v, 100))
      .filter(Boolean)
  );
  if (idSet.size === 0) return {};

  const base = {};
  for (const id of idSet) {
    base[id] = {
      sentEmails: 0,
      clicks: 0,
      checkouts: 0,
      payments: 0,
      revenue: 0,
    };
  }

  for (const ev of marketingEvents) {
    const cid = sanitizeTrackingValue(ev?.campaignId, 100);
    if (!cid || !idSet.has(cid)) continue;
    const eventType = String(ev?.eventType || '');
    if (eventType === 'promo_email_sent') base[cid].sentEmails += 1;
    if (eventType === 'promo_landing') base[cid].clicks += 1;
    if (eventType === 'premium_checkout_started' && normalizeTrackingSource(ev?.source) === 'promo_email') {
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
      revenue: round2(row.revenue),
      ctrPct: sent > 0 ? Math.round((clicks / sent) * 1000) / 10 : 0,
      clickToCheckoutPct: clicks > 0 ? Math.round((checkouts / clicks) * 1000) / 10 : 0,
      checkoutToPaidPct: checkouts > 0 ? Math.round((payments / checkouts) * 1000) / 10 : 0,
      paidFromSentPct: sent > 0 ? Math.round((payments / sent) * 1000) / 10 : 0,
    };
  }
  return out;
}

function aggregatePeriod(events, usuarios, usuariosPublicos, period) {
  const filtered = events.filter((e) => {
    const at = toNum(e?.at, 0);
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

  for (const ev of filtered) {
    const tipo = String(ev?.tipo || '');
    const uid = String(ev?.uid || '').trim();
    const at = toNum(ev?.at, 0);
    const amount = toNum(ev?.amount, 0);

    const mk = monthKeyFromMs(at);
    if (!monthlyMap.has(mk)) {
      monthlyMap.set(mk, {
        key: mk,
        totalAmount: 0,
        premiumAmount: 0,
        apoioAmount: 0,
        premiumCount: 0,
        apoioCount: 0,
      });
    }
    const monthRow = monthlyMap.get(mk);
    monthRow.totalAmount += amount;
    totals.totalAmount += amount;

    const perfil = uid ? usuarios[uid] || null : null;
    const sexo = normalizeGender(perfil?.gender);
    const birthYear = toNum(perfil?.birthYear, 0);
    const age =
      birthYear >= 1900 && birthYear <= new Date().getUTCFullYear()
        ? new Date().getUTCFullYear() - birthYear
        : null;

    if (tipo === 'premium_aprovado') {
      totals.premiumAmount += amount;
      totals.premiumCount += 1;
      monthRow.premiumAmount += amount;
      monthRow.premiumCount += 1;
      assinaturaSexo[sexo].amount += amount;
      assinaturaSexo[sexo].count += 1;
      if (uid && !assinantesNoPeriodo.has(uid) && age != null) {
        assinaturaIdades.push(age);
      }
      if (uid) assinantesNoPeriodo.add(uid);
    } else if (tipo === 'apoio_aprovado') {
      totals.apoioAmount += amount;
      totals.apoioCount += 1;
      monthRow.apoioAmount += amount;
      monthRow.apoioCount += 1;
      doacaoSexo[sexo].amount += amount;
      doacaoSexo[sexo].count += 1;
      if (uid && !doadoresNoPeriodo.has(uid) && age != null) {
        doacaoIdades.push(age);
      }
      if (uid) doadoresNoPeriodo.add(uid);
      if (uid) {
        const curr = doadoresMap.get(uid) || 0;
        doadoresMap.set(uid, curr + amount);
      }
    }
  }

  const monthlySeries = [...monthlyMap.values()].sort((a, b) =>
    a.key.localeCompare(b.key)
  );

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

  const avg = (arr) =>
    arr.length === 0
      ? null
      : Math.round((arr.reduce((s, n) => s + n, 0) / arr.length) * 10) / 10;

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
  for (const ev of events) {
    if (String(ev?.tipo || '') !== 'premium_aprovado') continue;
    const uid = String(ev?.uid || '').trim();
    const at = toNum(ev?.at, 0);
    if (!uid || !at) continue;
    const prev = firstPremiumAtByUid.get(uid);
    if (!prev || at < prev) firstPremiumAtByUid.set(uid, at);
  }

  const monthMap = new Map();
  for (const [, at] of firstPremiumAtByUid.entries()) {
    if (at < period.startAt || at >= period.endAt) continue;
    const mk = monthKeyFromMs(at);
    monthMap.set(mk, (monthMap.get(mk) || 0) + 1);
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

  for (const ev of events) {
    const tipo = String(ev?.tipo || '');
    if (tipo !== 'premium_aprovado' && tipo !== 'apoio_aprovado') {
      invalidType += 1;
    }
    const uid = String(ev?.uid || '').trim();
    if (!uid) withoutUid += 1;
    const amount = toNum(ev?.amount, NaN);
    if (!Number.isFinite(amount) || amount <= 0) withoutAmount += 1;
    const pid = String(ev?.paymentId || '').trim();
    if (pid) {
      if (seenPaymentIds.has(pid)) duplicates.push(pid);
      seenPaymentIds.add(pid);
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

export const adminDashboardResumo = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Faca login.');
    }
    const ctxDash = await requireAdminAuth(request.auth);
    requirePermission(ctxDash, 'dashboard');

    const now = Date.now();
    const period = ensurePeriod(request.data || {}, now);
    const compareInput =
      request.data && typeof request.data === 'object'
        ? {
            startAt: request.data.compareStartAt,
            endAt: request.data.compareEndAt,
          }
        : {};
    const comparePeriod =
      compareInput.startAt && compareInput.endAt
        ? ensurePeriod(compareInput, now)
        : defaultComparePeriod(period);

    const db = getDatabase();
    const [eventsSnap, usuariosSnap, pubSnap, marketingSnap] = await Promise.all([
      db.ref('financas/eventos').get(),
      db.ref('usuarios').get(),
      db.ref('usuarios_publicos').get(),
      db.ref('marketing/eventos').get(),
    ]);

    const rawEvents = eventsSnap.exists()
      ? Object.values(eventsSnap.val() || {}).filter((ev) => {
          const tipo = String(ev?.tipo || '');
          return tipo === 'premium_aprovado' || tipo === 'apoio_aprovado';
        })
      : [];
    const rawMarketingEvents = marketingSnap.exists()
      ? Object.values(marketingSnap.val() || {})
      : [];
    const usuarios = usuariosSnap.exists() ? usuariosSnap.val() || {} : {};
    const usuariosPublicos = pubSnap.exists() ? pubSnap.val() || {} : {};

    const current = aggregatePeriod(rawEvents, usuarios, usuariosPublicos, period);
    const compare = aggregatePeriod(rawEvents, usuarios, usuariosPublicos, comparePeriod);
    const crescimentoPremium = buildCrescimentoPremium(rawEvents, period);
    const crescimentoPremiumCompare = buildCrescimentoPremium(rawEvents, comparePeriod);
    const integrity = buildIntegrityReport(rawEvents);
    const analyticsBase = buildAdvancedAnalytics(rawEvents, usuarios, usuariosPublicos, period, now);
    const acquisition = buildAcquisitionAnalytics(rawEvents, rawMarketingEvents, period);
    const analytics = {
      ...analyticsBase,
      acquisition,
    };

    const deltaAmount =
      current.totals.totalAmount - compare.totals.totalAmount;
    const deltaPct =
      compare.totals.totalAmount > 0
        ? (deltaAmount / compare.totals.totalAmount) * 100
        : null;

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
        deltaPercent:
          deltaPct == null ? null : Math.round(deltaPct * 10) / 10,
      },
      analytics,
      integrity,
      generatedAt: now,
    };
  }
);

export const adminDashboardIntegridade = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Faca login.');
    }
    const ctxInt = await requireAdminAuth(request.auth);
    requirePermission(ctxInt, 'dashboard');
    const db = getDatabase();
    const eventsSnap = await db.ref('financas/eventos').get();
    const rawEvents = eventsSnap.exists()
      ? Object.values(eventsSnap.val() || {})
      : [];
    return {
      ok: true,
      integrity: buildIntegrityReport(rawEvents),
      generatedAt: Date.now(),
    };
  }
);

export const adminBackfillEventosLegados = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Faca login.');
    }
    const ctxBf = await requireAdminAuth(request.auth);
    requirePermission(ctxBf, 'dashboard');

    const db = getDatabase();
    const [processedSnap, eventsSnap] = await Promise.all([
      db.ref('financas/mp_processed').get(),
      db.ref('financas/eventos').get(),
    ]);

    const processed = processedSnap.exists() ? processedSnap.val() || {} : {};
    const events = eventsSnap.exists() ? eventsSnap.val() || {} : {};
    const existingPaymentIds = new Set();

    for (const ev of Object.values(events)) {
      const pid = String(ev?.paymentId || '').trim();
      if (pid) existingPaymentIds.add(pid);
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
      const tipo =
        rawTipo === 'apoio_aprovado' || rawTipo === 'apoio'
          ? 'apoio_aprovado'
          : 'premium_aprovado';

      let amount = toNum(row?.amount, NaN);
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
  }
);

async function gerarRollupMensalFinancas() {
  const db = getDatabase();
  const eventsSnap = await db.ref('financas/eventos').get();
  const rawEvents = eventsSnap.exists()
    ? Object.values(eventsSnap.val() || {})
    : [];
  const monthly = new Map();
  for (const ev of rawEvents) {
    const tipo = String(ev?.tipo || '');
    if (tipo !== 'premium_aprovado' && tipo !== 'apoio_aprovado') continue;
    const at = toNum(ev?.at, 0);
    if (!at) continue;
    const mk = monthKeyFromMs(at);
    if (!monthly.has(mk)) {
      monthly.set(mk, {
        totalAmount: 0,
        premiumAmount: 0,
        apoioAmount: 0,
        premiumCount: 0,
        apoioCount: 0,
      });
    }
    const row = monthly.get(mk);
    const amount = toNum(ev?.amount, 0);
    row.totalAmount += amount;
    if (tipo === 'premium_aprovado') {
      row.premiumAmount += amount;
      row.premiumCount += 1;
    } else {
      row.apoioAmount += amount;
      row.apoioCount += 1;
    }
  }

  const updates = {};
  for (const [month, row] of monthly.entries()) {
    updates[`financas/aggregates/monthly/${month}`] = {
      ...row,
      totalAmount: Math.round(row.totalAmount * 100) / 100,
      premiumAmount: Math.round(row.premiumAmount * 100) / 100,
      apoioAmount: Math.round(row.apoioAmount * 100) / 100,
      updatedAt: Date.now(),
    };
  }
  if (Object.keys(updates).length) {
    await db.ref().update(updates);
  }
  return Object.keys(updates).length;
}

export const adminDashboardRebuildRollup = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Faca login.');
    }
    const ctxRoll = await requireAdminAuth(request.auth);
    requirePermission(ctxRoll, 'dashboard');
    const months = await gerarRollupMensalFinancas();
    return { ok: true, months };
  }
);

async function reconcileStaffRtdbRoleFromMangaka(uid, ctx) {
  const db = getDatabase();
  let staff = ctx.super === true;
  if (!staff) {
    const reg = (await db.ref(`${ADMIN_REGISTRY_PATH}/${uid}`).get()).val();
    staff = reg && reg.role === 'admin';
  }
  if (!staff) return false;
  const uSnap = await db.ref(`usuarios/${uid}`).get();
  if (!uSnap.exists()) return false;
  const role = String(uSnap.val()?.role || '').toLowerCase();
  if (role !== 'mangaka') return false;
  const now = Date.now();
  await db.ref().update({
    [`usuarios/${uid}/role`]: 'user',
    [`usuarios/${uid}/signupIntent`]: 'reader',
    [`usuarios_publicos/${uid}/updatedAt`]: now,
  });
  return true;
}

export const adminGetMyAdminProfile = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    return { ok: true, admin: false };
  }
  const ctx = await getAdminAuthContext(request.auth);
  const creatorOnly = !ctx && (await isCreatorAccountAuth(request.auth));
  if (!ctx && !creatorOnly) {
    return { ok: true, admin: false };
  }
  if (ctx) {
    try {
      await reconcileStaffRtdbRoleFromMangaka(request.auth.uid, ctx);
    } catch (e) {
      logger.warn('reconcileStaffRtdbRoleFromMangaka failed', {
        uid: request.auth.uid,
        err: String(e?.message || e),
      });
    }
  }
  const panelRole = creatorOnly ? 'mangaka' : panelRoleFromAdminContext(ctx);

  /** Storage/RTDB rules leem `auth.token.panelRole`; sem isso o criador ve o painel mas falha no upload. */
  let claimsSynced = false;
  try {
    const authUser = await getAuth().getUser(request.auth.uid);
    const prevClaims = { ...(authUser.customClaims || {}) };
    if (prevClaims.panelRole !== panelRole) {
      await getAuth().setCustomUserClaims(request.auth.uid, {
        ...prevClaims,
        panelRole,
      });
      claimsSynced = true;
    }
  } catch (e) {
    logger.warn('adminGetMyAdminProfile panelRole sync failed', {
      uid: request.auth.uid,
      err: String(e?.message || e),
    });
  }

  return {
    ok: true,
    admin: Boolean(ctx),
    creator: creatorOnly,
    super: ctx?.super === true,
    legacy: ctx?.legacy === true,
    mangaka: creatorOnly,
    panelRole,
    permissions: ctx?.permissions || {},
    claimsSynced,
  };
});

function resolveCreatorRequestedAtMs(row, app) {
  const top = Number(row?.creatorRequestedAt || 0);
  if (Number.isFinite(top) && top > 0) return top;
  const c1 = Number(app?.createdAt || 0);
  if (Number.isFinite(c1) && c1 > 0) return c1;
  const c2 = Number(app?.updatedAt || 0);
  if (Number.isFinite(c2) && c2 > 0) return c2;
  return 0;
}

async function buildCreatorApplicationRow(uid, row, creatorDataRow = null) {
  let email = null;
  try {
    const user = await getAuth().getUser(uid);
    email = user.email || null;
  } catch {
    email = null;
  }
  const app = row?.creatorApplication && typeof row.creatorApplication === 'object'
    ? row.creatorApplication
    : {};
  const approvalGate = evaluateCreatorApplicationApprovalGate(row);
  const creatorData = creatorDataRow && typeof creatorDataRow === 'object' ? creatorDataRow : {};
  const balance = creatorData?.balance && typeof creatorData.balance === 'object' ? creatorData.balance : null;
  const payoutsRaw = creatorData?.payouts && typeof creatorData.payouts === 'object' ? creatorData.payouts : null;
  const recentPayouts = payoutsRaw
    ? Object.entries(payoutsRaw)
      .map(([payoutId, payoutRow]) => ({ payoutId, ...(payoutRow || {}) }))
      .sort((a, b) => Number(b.paidAt || b.createdAt || 0) - Number(a.paidAt || a.createdAt || 0))
      .slice(0, 3)
    : [];
  return {
    uid,
    email,
    userName: String(row?.userName || ''),
    userAvatar: String(row?.userAvatar || ''),
    creatorDisplayName: String(row?.creatorDisplayName || app.displayName || ''),
    creatorBio: String(row?.creatorBio || ''),
    creatorBioShort: String(app.bioShort || ''),
    creatorInstagramUrl: String(row?.instagramUrl || app?.socialLinks?.instagramUrl || ''),
    creatorYoutubeUrl: String(row?.youtubeUrl || app?.socialLinks?.youtubeUrl || ''),
    creatorApplication: app,
    creatorStatus: String(row?.creatorStatus || ''),
    creatorOnboardingCompleted: row?.creatorOnboardingCompleted === true,
    creatorMonetizationPreference: String(row?.creatorMonetizationPreference || app?.monetizationPreference || ''),
    creatorMonetizationStatus: resolveCreatorMonetizationStatusFromDb(row),
    birthYear: Number(row?.birthYear || 0) || null,
    birthDate: String(row?.birthDate || '').trim() || null,
    creatorComplianceSummary: (() => {
      const c = row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null;
      if (!c) return null;
      const tax = String(c.taxId || '');
      const last4 = tax.length >= 4 ? tax.slice(-4) : '';
      return {
        legalFullName: String(c.legalFullName || '').trim() || null,
        taxIdLast4: last4 || null,
        hasPayoutInstructions: String(c.payoutInstructions || '').trim().length >= 1,
      };
    })(),
    /** Dados completos só para super-admin (lista de aprovação). */
    creatorComplianceAdmin: (() => {
      const c = row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null;
      if (!c) return null;
      const taxDigits = String(c.taxId || '').replace(/\D/g, '');
      return {
        legalFullName: String(c.legalFullName || '').trim() || null,
        taxIdDigits: taxDigits.length === 11 ? taxDigits : taxDigits || null,
        payoutPixType: String(c.payoutPixType || '').trim().toLowerCase() || null,
        payoutKey: String(c.payoutInstructions || '').trim() || null,
      };
    })(),
    creatorBannerUrl: String(row?.creatorBannerUrl || '').trim() || null,
    creatorMonetizationV2: (() => {
      const m = row?.creator?.monetization;
      if (m && typeof m === 'object') {
        return {
          requested: m.requested === true,
          enabled: m.enabled === true,
          approved: m.approved === true,
          hasLegal: Boolean(m.legal?.fullName && m.legal?.cpf),
          hasPixKey: Boolean(m.payout?.type === 'pix' && String(m.payout?.key || '').trim()),
        };
      }
      return null;
    })(),
    signupIntent: String(row?.signupIntent || ''),
    creatorApplicationStatus: String(row?.creatorApplicationStatus || ''),
    creatorRequestedAt: resolveCreatorRequestedAtMs(row, app),
    creatorApprovalMetrics: approvalGate.metrics,
    creatorApprovalThresholds: approvalGate.thresholds,
    creatorApprovalMetricsOk: approvalGate.ok,
    creatorApprovalShortfalls: approvalGate.shortfalls,
    creatorApprovalSurplus: approvalGate.surplus,
    creatorApprovedAt: Number(row?.creatorApprovedAt || 0),
    creatorRejectedAt: Number(row?.creatorRejectedAt || 0),
    creatorReviewedBy: String(row?.creatorReviewedBy || ''),
    creatorReviewReason: String(row?.creatorReviewReason || app?.reviewReason || ''),
    creatorModerationAction: String(row?.creatorModerationAction || ''),
    creatorModerationBy: String(row?.creatorModerationBy || ''),
    creatorModeratedAt: Number(row?.creatorModeratedAt || 0),
    creatorMonetizationReviewReason: String(row?.creatorMonetizationReviewReason || ''),
    creatorBalanceAdmin: balance
      ? {
          availableBRL: round2(Number(balance.availableBRL || 0)),
          pendingPayoutBRL: round2(Number(balance.pendingPayoutBRL || 0)),
          lifetimeNetBRL: round2(Number(balance.lifetimeNetBRL || 0)),
          paidOutBRL: round2(Number(balance.paidOutBRL || 0)),
          updatedAt: Number(balance.updatedAt || 0) || null,
          lastPayoutAt: Number(balance.lastPayoutAt || 0) || null,
        }
      : null,
    creatorRecentPayoutsAdmin: recentPayouts.map((p) => ({
      payoutId: String(p.payoutId || ''),
      amount: round2(Number(p.amount || 0)),
      status: String(p.status || ''),
      paidAt: Number(p.paidAt || 0) || null,
      pixType: String(p.pixType || ''),
      pixKeyMasked: String(p.pixKeyMasked || ''),
      paidByUid: String(p.paidByUid || ''),
      notes: String(p.notes || ''),
    })),
    role: String(row?.role || 'user'),
    accountStatus: String(row?.status || ''),
  };
}

function slugifyCreatorUsername(input, uid) {
  const base = String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = String(uid || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  return `${base || 'criador'}${suffix ? `-${suffix}` : ''}`;
}

async function notifyCreatorRequestAdmins(db, { applicantUid, displayName, monetizationPreference, monetizationOnly = false }) {
  const registrySnap = await db.ref(ADMIN_REGISTRY_PATH).get();
  const superAdminIds = (() => {
    if (SUPER_ADMIN_UIDS instanceof Set) return [...SUPER_ADMIN_UIDS];
    if (Array.isArray(SUPER_ADMIN_UIDS)) return SUPER_ADMIN_UIDS;
    if (SUPER_ADMIN_UIDS && typeof SUPER_ADMIN_UIDS[Symbol.iterator] === 'function') {
      return [...SUPER_ADMIN_UIDS];
    }
    return [];
  })();
  const adminIds = new Set(superAdminIds);
  if (registrySnap.exists()) {
    for (const [uid, row] of Object.entries(registrySnap.val() || {})) {
      const role = String(row?.role || '').trim().toLowerCase();
      if (role && role !== 'mangaka') adminIds.add(uid);
    }
  }

  const applicantName = String(displayName || 'Novo creator').trim() || 'Novo creator';
  const wantsMonetize = String(monetizationPreference || '').trim().toLowerCase() === 'monetize';
  const title = monetizationOnly
    ? 'Criador pediu revisao de monetizacao'
    : wantsMonetize
      ? 'Nova solicitacao com monetizacao'
      : 'Nova solicitacao de creator';
  const message = monetizationOnly
    ? `${applicantName} ja publica na plataforma e enviou dados para ativar monetizacao. Revise em Criadores.`
    : wantsMonetize
      ? `${applicantName} pediu acesso de creator e revisao de monetizacao.`
      : `${applicantName} pediu acesso ao programa de creators.`;

  await Promise.all(
    [...adminIds]
      .filter((uid) => uid && uid !== applicantUid)
      .map((uid) =>
        pushUserNotification(db, uid, {
          type: 'admin_creator_queue',
          title,
          message,
          targetPath: '/admin/criadores',
          priority: 2,
          groupKey: 'admin_creator_queue',
          dedupeKey: `admin_creator_queue:${applicantUid}`,
          data: {
            applicantUid,
            readPath: '/admin/criadores',
            monetizationPreference,
            monetizationOnly,
          },
        })
      )
  );
}

function notificationPrefsFromProfile(profile) {
  const prefs = profile?.notificationPrefs && typeof profile.notificationPrefs === 'object'
    ? profile.notificationPrefs
    : {};
  return {
    inAppEnabled: true,
    emailEnabled: prefs?.promotionsEmail === true || profile?.notifyPromotions === true,
    chapterReleasesInApp: true,
    chapterReleasesEmail: false,
    promotionsInApp: true,
    promotionsEmail: prefs?.promotionsEmail === true || profile?.notifyPromotions === true,
    creatorLifecycleInApp: true,
    creatorLifecycleEmail: false,
    /** Respostas e marcos de curtida em comentários de capítulo. */
    commentSocialInApp: prefs?.commentSocialInApp !== false,
  };
}

async function sendEmailToUser(uid, { subject, text, html }) {
  if (!uid || !subject || (!text && !html)) return false;
  try {
    const authUser = await getAuth().getUser(uid);
    const to = authUser?.email;
    if (!to || !authUser.emailVerified || authUser.disabled) return false;
    await getTransporter().sendMail({
      from: getSmtpFrom(),
      to,
      subject,
      text: text || '',
      html: html || undefined,
    });
    return true;
  } catch (err) {
    logger.error('Falha ao enviar email ao usuario', { uid, error: err?.message });
    return false;
  }
}

async function notifyUserByPreference(db, uid, profile, config) {
  if (!uid || !config || typeof config !== 'object') return;
  const prefs = notificationPrefsFromProfile(profile || {});
  const kind = String(config.kind || 'system').trim().toLowerCase();
  const canInApp =
    kind === 'chapter'
      ? prefs.inAppEnabled && prefs.chapterReleasesInApp
      : kind === 'promotion'
        ? prefs.inAppEnabled && prefs.promotionsInApp
        : kind === 'comment_social'
          ? prefs.inAppEnabled && prefs.commentSocialInApp
          : prefs.inAppEnabled && prefs.creatorLifecycleInApp;
  const canEmail =
    kind === 'chapter'
      ? prefs.emailEnabled && prefs.chapterReleasesEmail
      : kind === 'promotion'
        ? prefs.emailEnabled && prefs.promotionsEmail
        : prefs.emailEnabled && prefs.creatorLifecycleEmail;

  if (canInApp && config.notification) {
    try {
      await pushUserNotification(db, uid, config.notification);
    } catch (err) {
      logger.error('pushUserNotification falhou (in-app)', { uid, kind, err: err?.message || String(err) });
    }
  }

  if (canEmail && config.email) {
    await sendEmailToUser(uid, config.email);
  }
}

function buildCreatorLifecycleEmail(base, payload) {
  const profilePath = `${base}/perfil`;
  return {
    subject: String(payload?.subject || 'Atualizacao da sua conta').trim() || 'Atualizacao da sua conta',
    text: `${String(payload?.message || '').trim()}\n\nAbra seu perfil: ${profilePath}`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#f2f2f2;padding:28px;border-radius:10px;">
        <h2 style="margin:0 0 12px;color:#ffcc00;">${String(payload?.title || 'Atualizacao')}</h2>
        <p style="margin:0 0 18px;color:#d0d0d0;">${String(payload?.message || '').trim()}</p>
        <a href="${profilePath}" style="display:inline-block;background:#ffcc00;color:#000;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">
          Abrir meu perfil
        </a>
      </div>
    `,
  };
}

function normalizeReviewReason(raw, fallback = '') {
  return String(raw || fallback || '').trim().slice(0, 500);
}

function creatorAudienceDateKey(timestamp = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(timestamp));
}

async function incrementCreatorAudienceDaily(db, creatorId, field, amount, timestamp = Date.now()) {
  if (!creatorId || !field || !Number.isFinite(Number(amount)) || Number(amount) === 0) return;
  const key = creatorAudienceDateKey(timestamp);
  await db.ref(`creatorStatsDaily/${creatorId}/${key}/${field}`).transaction((current) => {
    const next = Number(current || 0) + Number(amount);
    return next < 0 ? 0 : next;
  });
  await db.ref(`creatorStatsDaily/${creatorId}/${key}/updatedAt`).set(Date.now());
}

async function rebuildCreatorAudienceBackfill(db, creatorId) {
  const cid = sanitizeCreatorId(creatorId);
  if (!cid) {
    throw new HttpsError('invalid-argument', 'creatorId invalido.');
  }

  const [
    creatorUserSnap,
    creatorPublicSnap,
    worksSnap,
    chaptersSnap,
    paymentsSnap,
    subscriptionsSnap,
    existingRetentionSnap,
  ] = await Promise.all([
    db.ref(`usuarios/${cid}`).get(),
    db.ref(`usuarios_publicos/${cid}`).get(),
    db.ref('obras').get(),
    db.ref('capitulos').get(),
    db.ref(`creatorData/${cid}/payments`).get(),
    db.ref(`creatorData/${cid}/subscriptions`).get(),
    db.ref('workRetention').get(),
  ]);

  if (!creatorUserSnap.exists()) {
    throw new HttpsError('not-found', 'Criador nao encontrado.');
  }

  const creatorUser = creatorUserSnap.val() || {};
  const creatorPublic = creatorPublicSnap.exists() ? creatorPublicSnap.val() || {} : {};
  const worksMap = worksSnap.exists() ? worksSnap.val() || {} : {};
  const chaptersMap = chaptersSnap.exists() ? chaptersSnap.val() || {} : {};
  const paymentsMap = paymentsSnap.exists() ? paymentsSnap.val() || {} : {};
  const subscriptionsMap = subscriptionsSnap.exists() ? subscriptionsSnap.val() || {} : {};
  const existingRetention = existingRetentionSnap.exists() ? existingRetentionSnap.val() || {} : {};
  const followersMap = creatorPublic?.followers && typeof creatorPublic.followers === 'object'
    ? creatorPublic.followers
    : {};

  const creatorWorks = Object.entries(worksMap)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .filter((work) => sanitizeCreatorId(work?.creatorId) === cid);
  const creatorWorkIds = new Set(creatorWorks.map((work) => String(work.id || '').trim().toLowerCase()));
  const creatorChapters = Object.entries(chaptersMap)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .filter((chapter) => {
      if (sanitizeCreatorId(chapter?.creatorId) === cid) return true;
      const workId = String(chapter?.obraId || chapter?.mangaId || '').trim().toLowerCase();
      return creatorWorkIds.has(workId);
    });

  const likesTotal = creatorWorks.reduce(
    (sum, work) => sum + Number(work?.likesCount || work?.favoritesCount || work?.curtidas || 0),
    0
  );
  const commentsTotal = creatorWorks.reduce(
    (sum, work) => sum + Number(work?.commentsCount || 0),
    0
  ) + creatorChapters.reduce((sum, chapter) => sum + Number(chapter?.commentsCount || 0), 0);
  const totalViews = creatorWorks.reduce(
    (sum, work) => sum + Number(work?.viewsCount || work?.visualizacoes || 0),
    0
  ) + creatorChapters.reduce((sum, chapter) => sum + Number(chapter?.viewsCount || chapter?.visualizacoes || 0), 0);
  const followersCount = Object.keys(followersMap).length;
  const revenueTotal = Object.values(paymentsMap).reduce((sum, row) => sum + Number(row?.amount || 0), 0);

  const memberIndex = {};
  let membersCount = 0;
  for (const row of Object.values(subscriptionsMap)) {
    const userId = String(row?.userId || '').trim();
    if (!userId) continue;
    const memberUntil = Number(row?.memberUntil || 0);
    const current = memberIndex[userId] || {
      userId,
      memberUntil: 0,
      lifetimeValue: 0,
      updatedAt: 0,
    };
    current.memberUntil = Math.max(current.memberUntil, memberUntil);
    current.lifetimeValue = Number(current.lifetimeValue || 0) + Number(row?.amount || 0);
    current.updatedAt = Math.max(current.updatedAt, Number(row?.createdAt || 0));
    memberIndex[userId] = current;
  }
  for (const row of Object.values(memberIndex)) {
    if (Number(row?.memberUntil || 0) > Date.now()) membersCount += 1;
  }

  const daily = {};
  const pushDaily = (timestamp, field, amount) => {
    const ts = Number(timestamp || 0);
    const delta = Number(amount || 0);
    if (!ts || !delta) return;
    const key = creatorAudienceDateKey(ts);
    daily[key] = daily[key] || {};
    daily[key][field] = Number(daily[key][field] || 0) + delta;
    daily[key].updatedAt = Date.now();
  };

  for (const row of Object.values(followersMap)) {
    pushDaily(row?.followedAt, 'followersAdded', 1);
  }
  for (const row of Object.values(paymentsMap)) {
    pushDaily(row?.createdAt, 'revenueTotal', Number(row?.amount || 0));
  }
  for (const row of Object.values(subscriptionsMap)) {
    pushDaily(row?.createdAt, 'membersAdded', 1);
  }

  const retentionPatch = {};
  for (const work of creatorWorks) {
    const workId = String(work.id || '').trim().toLowerCase();
    const existing = existingRetention?.[workId] && typeof existingRetention[workId] === 'object'
      ? existingRetention[workId]
      : {};
    const chaptersForWork = creatorChapters
      .filter((chapter) => String(chapter?.obraId || chapter?.mangaId || '').trim().toLowerCase() === workId)
      .sort((a, b) => Number(a?.numero || 0) - Number(b?.numero || 0));
    const chapterEntries = {};
    for (const chapter of chaptersForWork) {
      chapterEntries[chapter.id] = {
        ...(existing?.chapters?.[chapter.id] && typeof existing.chapters[chapter.id] === 'object'
          ? existing.chapters[chapter.id]
          : {}),
        chapterId: chapter.id,
        chapterNumber: Number(chapter?.numero || 0),
        chapterTitle: String(chapter?.titulo || `Capitulo ${chapter?.numero || ''}`).trim(),
        readersCount: Number(
          existing?.chapters?.[chapter.id]?.readersCount ||
            chapter?.viewsCount ||
            chapter?.visualizacoes ||
            0
        ),
      };
    }
    retentionPatch[workId] = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      chapters: chapterEntries,
      updatedAt: Date.now(),
    };
  }

  const updatePatch = {
    [`creators/${cid}/stats`]: {
      followersCount,
      totalViews,
      uniqueReaders: Number(creatorUser?.creatorProfile?.stats?.uniqueReaders || 0),
      likesTotal,
      commentsTotal,
      membersCount,
      revenueTotal: Math.round(revenueTotal * 100) / 100,
      updatedAt: Date.now(),
      backfilledAt: Date.now(),
    },
    [`creatorStatsDaily/${cid}`]: daily,
    [`creators/${cid}/membersIndex`]: memberIndex,
    [`usuarios_publicos/${cid}/stats/followersCount`]: followersCount,
    [`usuarios_publicos/${cid}/stats/totalViews`]: totalViews,
    [`usuarios_publicos/${cid}/stats/totalLikes`]: likesTotal,
    [`usuarios_publicos/${cid}/stats/totalComments`]: commentsTotal,
    [`usuarios/${cid}/creatorProfile/stats/followersCount`]: followersCount,
    [`usuarios/${cid}/creatorProfile/stats/totalViews`]: totalViews,
    [`usuarios/${cid}/creatorProfile/stats/totalLikes`]: likesTotal,
    [`usuarios/${cid}/creatorProfile/stats/totalComments`]: commentsTotal,
    [`usuarios/${cid}/creatorProfile/stats/membersCount`]: membersCount,
    [`usuarios/${cid}/creatorProfile/stats/revenueTotal`]: Math.round(revenueTotal * 100) / 100,
  };

  const freshRetentionSnap = await db.ref('workRetention').get();
  const freshRetention = freshRetentionSnap.exists() ? freshRetentionSnap.val() || {} : {};
  for (const [workId, payload] of Object.entries(retentionPatch)) {
    const freshW =
      freshRetention[workId] && typeof freshRetention[workId] === 'object' ? freshRetention[workId] : {};
    const freshChapters =
      freshW.chapters && typeof freshW.chapters === 'object' ? freshW.chapters : {};
    for (const [chapterId, centry] of Object.entries(payload.chapters || {})) {
      if (!chapterId) continue;
      const base = `workRetention/${workId}/chapters/${chapterId}`;
      const live =
        freshChapters[chapterId] && typeof freshChapters[chapterId] === 'object'
          ? freshChapters[chapterId]
          : {};
      const liveRc = Number(live.readersCount || 0);
      const proposed = Number(centry.readersCount || 0);
      updatePatch[`${base}/chapterId`] = centry.chapterId;
      updatePatch[`${base}/chapterNumber`] = centry.chapterNumber;
      updatePatch[`${base}/chapterTitle`] = centry.chapterTitle;
      updatePatch[`${base}/readersCount`] = Math.max(liveRc, proposed);
    }
    updatePatch[`workRetention/${workId}/updatedAt`] = Date.now();
  }

  await db.ref().update(updatePatch);

  return {
    ok: true,
    creatorId: cid,
    worksCount: creatorWorks.length,
    chaptersCount: creatorChapters.length,
    followersCount,
    totalViews,
    likesTotal,
    commentsTotal,
    membersCount,
    revenueTotal: Math.round(revenueTotal * 100) / 100,
    dailyRows: Object.keys(daily).length,
  };
}

async function getMonetizableCreatorPublicProfile(db, creatorId, { requireMembershipEnabled = false } = {}) {
  const cid = sanitizeCreatorId(creatorId);
  if (!cid) {
    throw new HttpsError('invalid-argument', 'creatorId invalido.');
  }
  const snap = await db.ref(`usuarios_publicos/${cid}`).get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Perfil publico do criador nao encontrado.');
  }
  const creatorPublic = snap.val() || {};
  const creatorMonetizationPreference =
    String(creatorPublic.creatorMonetizationPreference || 'publish_only').trim().toLowerCase();
  const creatorMonetizationStatus =
    creatorMonetizationPreference === 'monetize'
      ? String(creatorPublic.creatorMonetizationStatus || '').trim().toLowerCase()
      : 'disabled';
  if (creatorMonetizationStatus !== 'active') {
    throw new HttpsError('failed-precondition', 'Este criador esta em modo apenas publicar e nao pode receber agora.');
  }
  if (requireMembershipEnabled && creatorPublic.creatorMembershipEnabled !== true) {
    throw new HttpsError('failed-precondition', 'Este criador ainda nao ativou a membership publica.');
  }
  return creatorPublic;
}

export const adminListCreatorApplications = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const [snap, creatorDataSnap] = await Promise.all([
    db.ref('usuarios').get(),
    db.ref('creatorData').get(),
  ]);
  const users = snap.val() || {};
  const creatorDataByUid = creatorDataSnap.exists() ? creatorDataSnap.val() || {} : {};
  const rows = await Promise.all(
    Object.entries(users)
      .filter(([, row]) => String(row?.signupIntent || '') === 'creator')
      .map(([uid, row]) => buildCreatorApplicationRow(uid, row, creatorDataByUid?.[uid] || null))
  );
  rows.sort((a, b) => {
    const queueScore = (r) => {
      const s = String(r?.creatorApplicationStatus || '').trim().toLowerCase();
      const mon = String(r?.creatorMonetizationStatus || '').trim().toLowerCase();
      const role = String(r?.role || '').trim().toLowerCase();
      if (s === 'requested') return 2;
      if (s === 'approved' && mon === 'pending_review' && role === 'mangaka') return 1;
      return 0;
    };
    const diff = queueScore(b) - queueScore(a);
    if (diff !== 0) return diff;
    return Number(b.creatorRequestedAt || 0) - Number(a.creatorRequestedAt || 0);
  });
  return { ok: true, applications: rows };
});

/**
 * Aprova candidatura de criador (registry, claims, RTDB, notificacao).
 * `isAutoPublishOnly`: fluxo "so publicar" sem fila de admin (marca moderacao como __auto_publish_only__).
 */
async function finalizeCreatorApplicationApproval(db, uid, row, reviewedByUid, options = {}) {
  const isAutoPublishOnly = options?.isAutoPublishOnly === true;
  const effectiveBy = isAutoPublishOnly ? '__auto_publish_only__' : String(reviewedByUid || '').trim() || 'unknown';
  const now = Date.now();
  const application = row?.creatorApplication && typeof row.creatorApplication === 'object'
    ? row.creatorApplication
    : {};
  const displayName = String(row?.creatorDisplayName || application.displayName || row?.userName || '').trim() || 'Criador';
  const currentUserAvatar = String(row?.userAvatar || '').trim();
  const approvedCreatorAvatar = String(
    application.profileImageUrl || row?.creatorPendingProfileImageUrl || row?.userAvatar || ''
  ).trim();
  const bioShort = String(row?.creatorBio || application.bioShort || '').trim();
  const bannerUrl = '';
  const instagramUrl = String(row?.instagramUrl || application?.socialLinks?.instagramUrl || '').trim();
  const youtubeUrl = String(row?.youtubeUrl || application?.socialLinks?.youtubeUrl || '').trim();
  const monetizationPreference = String(
    row?.creatorMonetizationPreference || application?.monetizationPreference || 'publish_only'
  ).trim().toLowerCase() === 'monetize'
    ? 'monetize'
    : 'publish_only';
  const age = resolveCreatorAgeYears(row);
  const isUnderage = age != null && age < 18;
  const monetizationStatus =
    monetizationPreference === 'monetize'
      ? (isUnderage ? 'blocked_underage' : 'pending_review')
      : 'disabled';
  const creatorUsername = slugifyCreatorUsername(displayName, uid);
  const creatorProfile = {
    creatorId: uid,
    displayName,
    username: creatorUsername,
    bioShort,
    bioFull: String(row?.creatorBio || '').trim(),
    avatarUrl: approvedCreatorAvatar || '',
    bannerUrl,
    socialLinks: {
      instagramUrl: instagramUrl || null,
      youtubeUrl: youtubeUrl || null,
    },
    monetizationEnabled: monetizationStatus === 'active',
    monetizationPreference,
    monetizationStatus,
    ageVerified: age != null,
    status: row?.creatorOnboardingCompleted === true ? 'active' : 'onboarding',
    createdAt: row?.creatorProfile?.createdAt || now,
    updatedAt: now,
  };

  await db.ref(`${ADMIN_REGISTRY_PATH}/${uid}`).remove();

  const authUser = await getAuth().getUser(uid);
  const prevClaims = { ...(authUser.customClaims || {}) };
  delete prevClaims.admin;
  prevClaims.panelRole = 'mangaka';
  await getAuth().setCustomUserClaims(uid, prevClaims);
  if (approvedCreatorAvatar && approvedCreatorAvatar !== authUser.photoURL) {
    await getAuth().updateUser(uid, { photoURL: approvedCreatorAvatar });
  }

  const creatorDocApproved = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: String(row?.birthDate || '').trim(),
    displayName,
    bio: bioShort,
    instagramUrl,
    youtubeUrl,
    monetizationPreference,
    creatorMonetizationStatus: monetizationStatus,
    compliance: row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null,
    now,
  });

  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocApproved,
    [`usuarios/${uid}/role`]: 'mangaka',
    [`usuarios/${uid}/signupIntent`]: 'creator',
    [`usuarios/${uid}/creatorApplicationStatus`]: 'approved',
    [`usuarios/${uid}/creatorApplication/status`]: 'approved',
    [`usuarios/${uid}/creatorApplication/updatedAt`]: now,
    [`usuarios/${uid}/creatorApprovedAt`]: now,
    [`usuarios/${uid}/creatorRejectedAt`]: null,
    [`usuarios/${uid}/creatorReviewedBy`]: effectiveBy,
    [`usuarios/${uid}/creatorReviewReason`]: null,
    [`usuarios/${uid}/creatorModerationAction`]: 'approved',
    [`usuarios/${uid}/creatorModerationBy`]: effectiveBy,
    [`usuarios/${uid}/creatorModeratedAt`]: now,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios/${uid}/creatorOnboardingStartedAt`]: row?.creatorOnboardingStartedAt || now,
    [`usuarios/${uid}/creatorOnboardingCompleted`]: row?.creatorOnboardingCompleted === true,
    [`usuarios/${uid}/userAvatar`]: approvedCreatorAvatar || currentUserAvatar || null,
    [`usuarios/${uid}/creatorProfile`]: creatorProfile,
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: null,
    [`usuarios/${uid}/creatorBannerUrl`]: null,
    [`usuarios/${uid}/creatorStatus`]: row?.creatorOnboardingCompleted === true ? 'active' : 'onboarding',
    [`usuarios/${uid}/creatorMonetizationPreference`]: monetizationPreference,
    [`usuarios/${uid}/creatorMonetizationStatus`]: monetizationStatus,
    [`usuarios/${uid}/creatorMembershipEnabled`]:
      false,
    [`usuarios/${uid}/creatorMembershipPriceBRL`]:
      null,
    [`usuarios/${uid}/creatorDonationSuggestedBRL`]:
      null,
    [`usuarios_publicos/${uid}/signupIntent`]: 'creator',
    [`usuarios_publicos/${uid}/userAvatar`]: approvedCreatorAvatar || currentUserAvatar || null,
    [`usuarios_publicos/${uid}/creatorDisplayName`]: displayName,
    [`usuarios_publicos/${uid}/creatorUsername`]: creatorUsername,
    [`usuarios_publicos/${uid}/creatorBio`]: bioShort,
    [`usuarios_publicos/${uid}/creatorBannerUrl`]: null,
    [`usuarios_publicos/${uid}/instagramUrl`]: instagramUrl || null,
    [`usuarios_publicos/${uid}/youtubeUrl`]: youtubeUrl || null,
    [`usuarios_publicos/${uid}/creatorStatus`]: row?.creatorOnboardingCompleted === true ? 'active' : 'onboarding',
    [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: monetizationStatus,
    [`usuarios_publicos/${uid}/creatorMembershipEnabled`]:
      false,
    [`usuarios_publicos/${uid}/creatorMembershipPriceBRL`]:
      null,
    [`usuarios_publicos/${uid}/creatorDonationSuggestedBRL`]:
      null,
    [`usuarios_publicos/${uid}/creatorProfile`]: {
      creatorId: uid,
      userId: uid,
      displayName,
      username: creatorUsername,
      bioShort,
      bioFull: String(row?.creatorBio || '').trim(),
      avatarUrl: approvedCreatorAvatar || currentUserAvatar || '',
      bannerUrl: '',
      socialLinks: {
        instagramUrl: instagramUrl || null,
        youtubeUrl: youtubeUrl || null,
      },
      stats: {
        followersCount: Number(row?.creatorProfile?.stats?.followersCount || 0),
        totalLikes: Number(row?.creatorProfile?.stats?.totalLikes || 0),
        totalViews: Number(row?.creatorProfile?.stats?.totalViews || 0),
        totalComments: Number(row?.creatorProfile?.stats?.totalComments || 0),
      },
      createdAt: row?.creatorProfile?.createdAt || now,
      updatedAt: now,
    },
    [`usuarios_publicos/${uid}/stats`]: {
      followersCount: Number(row?.creatorProfile?.stats?.followersCount || 0),
      totalLikes: Number(row?.creatorProfile?.stats?.totalLikes || 0),
      totalViews: Number(row?.creatorProfile?.stats?.totalViews || 0),
      totalComments: Number(row?.creatorProfile?.stats?.totalComments || 0),
    },
    [`usuarios_publicos/${uid}/followersCount`]: Number(row?.creatorProfile?.stats?.followersCount || 0),
    [`usuarios_publicos/${uid}/userName`]: displayName,
    [`usuarios_publicos/${uid}/accountType`]: String(row?.accountType || 'comum'),
    [`usuarios_publicos/${uid}/updatedAt`]: now,
    [`creators/${uid}/stats/followersCount`]: Number(row?.creatorProfile?.stats?.followersCount || 0),
    [`creators/${uid}/stats/likesTotal`]: Number(row?.creatorProfile?.stats?.totalLikes || 0),
    [`creators/${uid}/stats/totalViews`]: Number(row?.creatorProfile?.stats?.totalViews || 0),
    [`creators/${uid}/stats/commentsTotal`]: Number(row?.creatorProfile?.stats?.totalComments || 0),
    [`creators/${uid}/stats/membersCount`]: Number(row?.creatorProfile?.stats?.membersCount || 0),
    [`creators/${uid}/stats/revenueTotal`]: Number(row?.creatorProfile?.stats?.revenueTotal || 0),
    [`creators/${uid}/stats/uniqueReaders`]: Number(row?.creatorProfile?.stats?.uniqueReaders || 0),
    [`creators/${uid}/stats/updatedAt`]: now,
  });

  const approvalMessage = isAutoPublishOnly
    ? 'Voce ja pode publicar como criador. Se o painel nao aparecer, recarregue a pagina ou faca login de novo.'
    : monetizationStatus === 'blocked_underage'
      ? 'Voce foi aprovado para publicar, mas a monetizacao ficou bloqueada por idade. Sua conta esta liberada apenas para publicacao.'
      : monetizationStatus === 'active'
        ? 'Voce foi aprovado como criador e sua monetizacao foi ativada.'
        : monetizationPreference === 'monetize'
          ? 'Voce foi aprovado como criador. Agora finalize sua configuracao de membership para concluir a monetizacao.'
          : 'Voce foi aprovado como criador para publicar na plataforma.';
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: 'creator_application',
      title: isAutoPublishOnly ? 'Acesso de criador liberado' : 'Solicitacao aprovada',
      message: approvalMessage,
      dedupeKey: `creator_lifecycle:application_approved:${uid}:${now}`,
      dedupeWindowMs: 0,
      allowGrouping: false,
      data: {
        status: 'approved',
        creatorStatus: row?.creatorOnboardingCompleted === true ? 'active' : 'onboarding',
        monetizationStatus,
        monetizationPreference,
        readPath: '/perfil',
        autoApproved: isAutoPublishOnly,
      },
    },
    email: buildCreatorLifecycleEmail(APP_BASE_URL.value().replace(/\/$/, ''), {
      title: isAutoPublishOnly ? 'Acesso de criador liberado' : 'Solicitacao aprovada',
      subject: isAutoPublishOnly
        ? 'Voce ja pode publicar na plataforma'
        : 'Sua solicitacao de criador foi aprovada',
      message: approvalMessage,
    }),
  });

  return { ok: true, uid, status: 'approved', monetizationStatus, monetizationPreference };
}

export const creatorSubmitApplication = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const db = getDatabase();
  const ctx = await getAdminAuthContext(request.auth);
  if (ctx) {
    throw new HttpsError(
      'failed-precondition',
      'Contas da equipe administrativa nao podem solicitar acesso de creator.'
    );
  }
  const userRef = db.ref(`usuarios/${uid}`);
  const snap = await userRef.get();
  if (!snap.exists()) {
    throw new HttpsError('failed-precondition', 'Perfil do usuario nao encontrado.');
  }
  const row = snap.val() || {};
  const now = Date.now();
  const statusAtual = String(row?.creatorApplicationStatus || '').trim().toLowerCase();
  if (statusAtual === 'requested') {
    return { ok: true, status: 'requested', alreadyPending: true };
  }
  const payload = request.data && typeof request.data === 'object' ? request.data : {};
  const displayName = String(payload.displayName || row?.creatorDisplayName || row?.userName || '').trim();
  const bioShort = String(payload.bioShort || row?.creatorBio || '').trim();
  const normalizeCreatorSocialUrl = (raw, allowedHosts = []) => {
    const value = String(raw || '').trim();
    if (!value) return '';
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(candidate);
      const host = String(url.hostname || '').trim().toLowerCase();
      const hostOk = allowedHosts.some((item) => host === item || host.endsWith(`.${item}`));
      if (!hostOk) return '';
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return url.toString();
    } catch {
      return '';
    }
  };
  const instagramRaw = String(payload.instagramUrl || row?.instagramUrl || '').trim();
  const youtubeRaw = String(payload.youtubeUrl || row?.youtubeUrl || '').trim();
  const instagramUrl = normalizeCreatorSocialUrl(instagramRaw, ['instagram.com']);
  const youtubeUrl = normalizeCreatorSocialUrl(youtubeRaw, ['youtube.com', 'youtu.be']);
  let profileImageUrl = String(payload.profileImageUrl || row?.creatorApplication?.profileImageUrl || '').trim();
  if (
    !profileImageUrl ||
    profileImageUrl.length < 12 ||
    !/^https:\/\//i.test(profileImageUrl) ||
    profileImageUrl.length > 2048
  ) {
    const av = String(row?.userAvatar || '').trim();
    if (/^https:\/\//i.test(av) && av.length >= 12 && av.length <= 2048) {
      profileImageUrl = av;
    }
  }
  const profileImageCrop =
    payload.profileImageCrop && typeof payload.profileImageCrop === 'object'
      ? {
          zoom: Number(payload.profileImageCrop.zoom || 1),
          x: Number(payload.profileImageCrop.x || 0),
          y: Number(payload.profileImageCrop.y || 0),
          mode: 'responsive-fit',
        }
      : null;
  const acceptTerms = payload.acceptTerms === true;
  const birthFromPayload = String(payload.birthDate || '').trim();
  const birthFromProfile = String(row?.birthDate || '').trim();
  const birthDateRaw = birthFromPayload || birthFromProfile;
  if (!parseBirthDateStrict(birthDateRaw)) {
    throw new HttpsError('invalid-argument', 'Informe uma data de nascimento valida (AAAA-MM-DD).');
  }
  const age = ageFromBirthDateIso(birthDateRaw);
  if (age == null || age < 0) {
    throw new HttpsError('invalid-argument', 'Data de nascimento invalida.');
  }
  const isAdult = age >= 18;
  const monetizationRequested =
    String(payload.monetizationPreference || '').trim().toLowerCase() === 'monetize';
  let monetizationPreference = monetizationRequested && isAdult ? 'monetize' : 'publish_only';

  const legalFullNameIn = String(payload.legalFullName || '').trim();
  const taxIdIn = String(payload.taxId || '').trim();
  const payoutInstructionsIn = String(payload.payoutInstructions || '').trim();
  const payoutPixTypeDeclared = String(payload.payoutPixType || '').trim().toLowerCase();
  const acceptFinancialTerms = payload.acceptFinancialTerms === true;

  let monetizationPixType = '';
  let monetizationPixKey = '';

  if (monetizationPreference === 'monetize') {
    if (!legalFullNameHasNoDigits(legalFullNameIn)) {
      throw new HttpsError(
        'invalid-argument',
        'O nome completo (documento) nao pode conter numeros.'
      );
    }
    if (!legalFullNameHasMinThreeWords(legalFullNameIn)) {
      throw new HttpsError(
        'invalid-argument',
        'Para monetizar, informe seu nome completo legal com pelo menos tres partes (ex.: Nome Sobrenome Filho).'
      );
    }
    const cpfOk = normalizeAndValidateCpf(taxIdIn);
    if (!cpfOk) {
      throw new HttpsError('invalid-argument', 'Para monetizar, informe um CPF valido (11 digitos).');
    }
    monetizationPixType = coercePayoutPixType(payoutPixTypeDeclared, payoutInstructionsIn);
    monetizationPixKey = normalizePixPayoutKey(monetizationPixType, payoutInstructionsIn);
    const pixVal = validatePixPayout(monetizationPixType, monetizationPixKey);
    if (!pixVal.ok) {
      throw new HttpsError('invalid-argument', pixVal.message);
    }
    if (!acceptFinancialTerms) {
      throw new HttpsError(
        'invalid-argument',
        'Para monetizar, aceite os termos financeiros e de repasse.'
      );
    }
  }

  if (displayName.length < 3) {
    throw new HttpsError('invalid-argument', 'Informe um nome artistico com pelo menos 3 caracteres.');
  }
  const bioMinPublishOnly = 24;
  const bioMinMonetize = 24;
  const bioMin = monetizationPreference === 'publish_only' ? bioMinPublishOnly : bioMinMonetize;
  if (bioShort.length < bioMin) {
    throw new HttpsError(
      'invalid-argument',
      monetizationPreference === 'publish_only'
        ? `Escreva uma bio curta com pelo menos ${bioMinPublishOnly} caracteres.`
        : `Escreva uma bio com pelo menos ${bioMinMonetize} caracteres.`
    );
  }
  if (bioShort.length > 450) {
    throw new HttpsError('invalid-argument', 'A bio pode ter no maximo 450 caracteres.');
  }
  if (
    profileImageUrl.length < 12 ||
    !/^https:\/\//i.test(profileImageUrl) ||
    profileImageUrl.length > 2048
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Envie a foto de perfil do creator antes de solicitar acesso de criador.'
    );
  }
  if (!acceptTerms) {
    throw new HttpsError('invalid-argument', 'Voce precisa aceitar os termos para solicitar acesso de criador.');
  }
  if (instagramRaw && !instagramUrl) {
    throw new HttpsError('invalid-argument', 'Instagram invalido. Use um link real de perfil do Instagram.');
  }
  if (youtubeRaw && !youtubeUrl) {
    throw new HttpsError('invalid-argument', 'YouTube invalido. Use um link real de canal/video do YouTube.');
  }
  if (!instagramUrl && !youtubeUrl) {
    throw new HttpsError(
      'invalid-argument',
      monetizationPreference === 'monetize'
        ? 'Para monetizar, informe pelo menos um link valido de Instagram ou YouTube.'
        : 'Informe pelo menos um link valido de Instagram ou YouTube no seu perfil publico.'
    );
  }

  const birthYearFromDate = Number(birthDateRaw.slice(0, 4));
  const compliance =
    monetizationPreference === 'monetize'
      ? {
          legalFullName: legalFullNameIn.trim(),
          taxId: normalizeAndValidateCpf(taxIdIn),
          payoutInstructions: monetizationPixKey.slice(0, 2000),
          payoutPixType: monetizationPixType,
          financialTermsAcceptedAt: now,
          updatedAt: now,
        }
      : null;

  if (ctx?.mangaka) {
    if (monetizationPreference !== 'monetize') {
      return { ok: true, status: 'approved', alreadyMangaka: true };
    }
    const monStatus = String(row?.creatorMonetizationStatus || '').trim().toLowerCase();
    if (monStatus === 'active') {
      return { ok: true, status: 'approved', alreadyMangaka: true, monetizationAlreadyActive: true };
    }
    if (monStatus === 'pending_review') {
      return { ok: true, status: 'approved', alreadyMangaka: true, monetizationPendingReview: true };
    }
    const creatorApplicationMangaka = {
      ...(row?.creatorApplication && typeof row.creatorApplication === 'object' ? row.creatorApplication : {}),
      userId: uid,
      displayName,
      bioShort,
      profileImageUrl,
      profileImageCrop,
      bannerUrl: null,
      monetizationPreference: 'monetize',
      monetizationRequested: true,
      birthDate: birthDateRaw,
      isAdult,
      socialLinks: {
        instagramUrl: instagramUrl || null,
        youtubeUrl: youtubeUrl || null,
      },
      status: 'approved',
      acceptTerms: true,
      createdAt: row?.creatorApplication?.createdAt || now,
      updatedAt: now,
    };
    const creatorDocM = assembleCreatorRecordForRtdb({
      row,
      birthDateIso: birthDateRaw,
      displayName,
      bio: bioShort,
      instagramUrl,
      youtubeUrl,
      monetizationPreference: 'monetize',
      creatorMonetizationStatus: 'pending_review',
      compliance,
      now,
    });
    const monetReviewPatch = {
      [`usuarios/${uid}/creator`]: creatorDocM,
      [`usuarios/${uid}/creatorApplication`]: creatorApplicationMangaka,
      [`usuarios/${uid}/creatorDisplayName`]: displayName,
      [`usuarios/${uid}/creatorBio`]: bioShort,
      [`usuarios/${uid}/creatorMonetizationPreference`]: 'monetize',
      [`usuarios/${uid}/creatorMonetizationStatus`]: 'pending_review',
      [`usuarios/${uid}/creatorCompliance`]: compliance,
      [`usuarios/${uid}/instagramUrl`]: instagramUrl || null,
      [`usuarios/${uid}/youtubeUrl`]: youtubeUrl || null,
      [`usuarios/${uid}/creatorPendingProfileImageUrl`]: profileImageUrl,
      [`usuarios/${uid}/creatorPendingProfileImageCrop`]: profileImageCrop,
      [`usuarios/${uid}/creatorProfile/monetizationPreference`]: 'monetize',
      [`usuarios/${uid}/creatorProfile/monetizationStatus`]: 'pending_review',
      [`usuarios/${uid}/creatorProfile/monetizationEnabled`]: false,
      [`usuarios/${uid}/creatorProfile/updatedAt`]: now,
      [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: 'pending_review',
      [`usuarios_publicos/${uid}/updatedAt`]: now,
    };
    if (!Number(row?.creatorRequestedAt || 0)) {
      monetReviewPatch[`usuarios/${uid}/creatorRequestedAt`] = now;
    }
    await db.ref().update(monetReviewPatch);
    await pushUserNotification(db, uid, {
      type: 'creator_monetization',
      title: 'Monetizacao em analise',
      message:
        'Seus dados para monetizacao foram enviados. Voce continua publicando normalmente; a equipe revisara antes de ativar repasses.',
      data: { monetizationStatus: 'pending_review', readPath: '/perfil' },
    });
    await notifyCreatorRequestAdmins(db, {
      applicantUid: uid,
      displayName,
      monetizationPreference: 'monetize',
      monetizationOnly: true,
    });
    return {
      ok: true,
      status: 'approved',
      alreadyMangaka: true,
      monetizationPendingReviewSubmitted: true,
    };
  }

  const creatorMonetizationStatusForRecord =
    monetizationPreference === 'monetize' ? 'pending_review' : 'disabled';

  const creatorApplication = {
    userId: uid,
    displayName,
    bioShort,
    profileImageUrl,
    profileImageCrop,
    bannerUrl: null,
    monetizationPreference,
    monetizationRequested,
    birthDate: birthDateRaw,
    isAdult,
    socialLinks: {
      instagramUrl: instagramUrl || null,
      youtubeUrl: youtubeUrl || null,
    },
    status: 'pending',
    acceptTerms: true,
    createdAt: row?.creatorApplication?.createdAt || now,
    updatedAt: now,
  };

  const creatorDocSubmit = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: birthDateRaw,
    displayName,
    bio: bioShort,
    instagramUrl,
    youtubeUrl,
    monetizationPreference,
    creatorMonetizationStatus: creatorMonetizationStatusForRecord,
    compliance,
    now,
  });

  if (monetizationPreference === 'monetize') {
    const approvalGate = evaluateCreatorApplicationApprovalGate(row);
    if (!approvalGate.ok) {
      throw new HttpsError(
        'failed-precondition',
        `Para enviar candidatura com monetizacao, atinja as metas do Nivel 1: ` +
          `${approvalGate.metrics.followers}/${approvalGate.thresholds.followers} seguidores, ` +
          `${approvalGate.metrics.views}/${approvalGate.thresholds.views} views, ` +
          `${approvalGate.metrics.likes}/${approvalGate.thresholds.likes} likes.`
      );
    }
  }

  if (monetizationPreference === 'publish_only') {
    const prePatch = {
      [`usuarios/${uid}/creator`]: creatorDocSubmit,
      [`usuarios/${uid}/signupIntent`]: 'creator',
      [`usuarios/${uid}/creatorApplication`]: creatorApplication,
      [`usuarios/${uid}/creatorDisplayName`]: displayName,
      [`usuarios/${uid}/creatorBio`]: bioShort,
      [`usuarios/${uid}/creatorMonetizationPreference`]: monetizationPreference,
      [`usuarios/${uid}/creatorMonetizationStatus`]: 'disabled',
      [`usuarios/${uid}/instagramUrl`]: instagramUrl || null,
      [`usuarios/${uid}/youtubeUrl`]: youtubeUrl || null,
      [`usuarios/${uid}/creatorPendingProfileImageUrl`]: profileImageUrl,
      [`usuarios/${uid}/creatorPendingProfileImageCrop`]: profileImageCrop,
      [`usuarios/${uid}/creatorBannerUrl`]: null,
      [`usuarios_publicos/${uid}/creatorBannerUrl`]: null,
      [`usuarios/${uid}/birthDate`]: birthDateRaw,
      [`usuarios/${uid}/birthYear`]: Number.isInteger(birthYearFromDate) ? birthYearFromDate : null,
      [`usuarios_publicos/${uid}/signupIntent`]: 'creator',
      [`usuarios_publicos/${uid}/updatedAt`]: now,
      [`usuarios/${uid}/creatorTermsAccepted`]: true,
      [`usuarios/${uid}/creatorCompliance`]: null,
    };
    await db.ref().update(prePatch);
    const snapAfter = await userRef.get();
    const rowAfter = snapAfter.val() || {};
    await finalizeCreatorApplicationApproval(db, uid, rowAfter, uid, { isAutoPublishOnly: true });
    return {
      ok: true,
      status: 'approved',
      autoApproved: true,
      application: creatorApplication,
      monetizationPreference,
      monetizationRequested,
      isAdult,
    };
  }

  const patch = {
    [`usuarios/${uid}/creator`]: creatorDocSubmit,
    [`usuarios/${uid}/signupIntent`]: 'creator',
    [`usuarios/${uid}/creatorApplicationStatus`]: 'requested',
    [`usuarios/${uid}/creatorApplication`]: creatorApplication,
    [`usuarios/${uid}/creatorDisplayName`]: displayName,
    [`usuarios/${uid}/creatorBio`]: bioShort,
    [`usuarios/${uid}/creatorMonetizationPreference`]: monetizationPreference,
    [`usuarios/${uid}/creatorMonetizationStatus`]: 'pending_review',
    [`usuarios/${uid}/instagramUrl`]: instagramUrl || null,
    [`usuarios/${uid}/youtubeUrl`]: youtubeUrl || null,
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: profileImageUrl,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: profileImageCrop,
    [`usuarios/${uid}/creatorBannerUrl`]: null,
    [`usuarios_publicos/${uid}/creatorBannerUrl`]: null,
    [`usuarios/${uid}/birthDate`]: birthDateRaw,
    [`usuarios/${uid}/birthYear`]: Number.isInteger(birthYearFromDate) ? birthYearFromDate : null,
    [`usuarios/${uid}/creatorRequestedAt`]: now,
    [`usuarios/${uid}/creatorRejectedAt`]: null,
    [`usuarios/${uid}/creatorApprovedAt`]: null,
    [`usuarios/${uid}/creatorReviewedBy`]: null,
    [`usuarios/${uid}/creatorReviewReason`]: null,
    [`usuarios/${uid}/creatorModerationAction`]: null,
    [`usuarios/${uid}/creatorModerationBy`]: null,
    [`usuarios/${uid}/creatorModeratedAt`]: null,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios_publicos/${uid}/signupIntent`]: 'creator',
    [`usuarios_publicos/${uid}/updatedAt`]: now,
    [`usuarios/${uid}/creatorTermsAccepted`]: true,
  };
  if (compliance) {
    patch[`usuarios/${uid}/creatorCompliance`] = compliance;
  } else {
    patch[`usuarios/${uid}/creatorCompliance`] = null;
  }
  await db.ref().update(patch);

  const notifMessage = 'Seu pedido de criador com monetizacao foi enviado para analise.';

  await pushUserNotification(db, uid, {
    type: 'creator_application',
    title: 'Solicitacao enviada',
    message: notifMessage,
    data: { status: 'requested', monetizationPreference, monetizationRequested, isAdult },
  });
  await notifyCreatorRequestAdmins(db, {
    applicantUid: uid,
    displayName,
    monetizationPreference,
  });
  return { ok: true, status: 'requested', application: creatorApplication };
});

export const adminApproveCreatorApplication = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid obrigatorio.');
  }
  const db = getDatabase();
  const userRef = db.ref(`usuarios/${uid}`);
  const snap = await userRef.get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Usuario nao encontrado.');
  }
  const row = snap.val() || {};
  const role = String(row?.role || '').trim().toLowerCase();
  const appStatus = String(row?.creatorApplicationStatus || '').trim().toLowerCase();

  let targetEmail = '';
  try {
    const tu = await getAuth().getUser(uid);
    targetEmail = tu.email || '';
  } catch {
    throw new HttpsError('not-found', 'Usuario alvo nao encontrado no Auth.');
  }
  if (isTargetSuperAdmin({ uid, email: targetEmail })) {
    throw new HttpsError(
      'failed-precondition',
      'Nao e possivel aprovar administradores chefes como creator.'
    );
  }
  const regSnap = await db.ref(`${ADMIN_REGISTRY_PATH}/${uid}`).get();
  const regRow = regSnap.val();
  if (regRow && regRow.role === 'admin') {
    throw new HttpsError(
      'failed-precondition',
      'Este usuario ja e da equipe (admin). Remova o acesso administrativo antes de aprovar como creator.'
    );
  }

  if (appStatus === 'approved' && role === 'mangaka') {
    return { ok: true, uid, status: 'approved', alreadyApproved: true };
  }
  if (appStatus === 'requested') {
    const gate = evaluateCreatorApplicationApprovalGate(row);
    if (!gate.ok) {
      throw new HttpsError(
        'failed-precondition',
        `Aprovacao bloqueada: metas do Nivel 1 nao atingidas (seguidores ${gate.metrics.followers}/${gate.thresholds.followers}, views ${gate.metrics.views}/${gate.thresholds.views}, likes ${gate.metrics.likes}/${gate.thresholds.likes}).`
      );
    }
  }
  await finalizeCreatorApplicationApproval(db, uid, row, request.auth.uid, { isAutoPublishOnly: false });
  return { ok: true, uid, status: 'approved' };
});

export const adminRejectCreatorApplication = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid obrigatorio.');
  }
  const reason = normalizeReviewReason(request.data?.reason);
  if (reason.length < 8) {
    throw new HttpsError('invalid-argument', 'Informe um motivo de reprovacao com pelo menos 8 caracteres.');
  }
  const banUser = request.data?.banUser === true;
  const db = getDatabase();
  const userSnap = await db.ref(`usuarios/${uid}`).get();
  const row = userSnap.exists() ? userSnap.val() || {} : {};
  const now = Date.now();
  await db.ref().update({
    [`usuarios/${uid}/creatorApplicationStatus`]: 'rejected',
    [`usuarios/${uid}/creatorApplication/status`]: 'rejected',
    [`usuarios/${uid}/creatorApplication/updatedAt`]: now,
    [`usuarios/${uid}/creatorApplication/reviewReason`]: reason,
    [`usuarios/${uid}/creatorRejectedAt`]: now,
    [`usuarios/${uid}/creatorReviewedBy`]: request.auth.uid,
    [`usuarios/${uid}/role`]: 'user',
    [`usuarios/${uid}/creatorStatus`]: banUser ? 'banned' : 'rejected',
    [`usuarios/${uid}/creatorReviewReason`]: reason,
    [`usuarios/${uid}/creatorModerationAction`]: banUser ? 'banned' : 'rejected',
    [`usuarios/${uid}/creatorModerationBy`]: request.auth.uid,
    [`usuarios/${uid}/creatorModeratedAt`]: now,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios/${uid}/creatorMonetizationStatus`]: 'disabled',
    [`usuarios/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageUrl`]: null,
    [`usuarios/${uid}/creatorPendingProfileImageCrop`]: null,
    [`usuarios/${uid}/status`]: banUser ? 'banido' : null,
    [`usuarios/${uid}/banReason`]: banUser ? reason : null,
    [`usuarios_publicos/${uid}/creatorStatus`]: banUser ? 'banned' : 'rejected',
    [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: 'disabled',
    [`usuarios_publicos/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios_publicos/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios_publicos/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios_publicos/${uid}/status`]: banUser ? 'banido' : null,
    [`usuarios_publicos/${uid}/updatedAt`]: now,
  });
  const rejectMessage = banUser
    ? `Sua conta foi bloqueada pela equipe. Motivo: ${reason}`
    : `Sua solicitacao de criador nao foi aprovada agora. Motivo: ${reason}`;
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: banUser ? 'account_moderation' : 'creator_application',
      title: banUser ? 'Conta bloqueada' : 'Solicitacao rejeitada',
      message: rejectMessage,
      dedupeKey: `creator_lifecycle:application_rejected:${uid}:${now}`,
      dedupeWindowMs: 0,
      allowGrouping: false,
      data: { status: 'rejected', reason, banUser, readPath: '/perfil' },
    },
    email: buildCreatorLifecycleEmail(APP_BASE_URL.value().replace(/\/$/, ''), {
      title: banUser ? 'Conta bloqueada' : 'Solicitacao rejeitada',
      subject: banUser ? 'Sua conta foi bloqueada' : 'Sua solicitacao de criador foi rejeitada',
      message: rejectMessage,
    }),
  });
  return { ok: true, uid, status: 'rejected', banUser };
});

export const adminApproveCreatorMonetization = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid obrigatorio.');
  }
  const db = getDatabase();
  const snap = await db.ref(`usuarios/${uid}`).get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Usuario nao encontrado.');
  }
  const row = snap.val() || {};
  if (String(row?.role || '').trim().toLowerCase() !== 'mangaka') {
    throw new HttpsError('failed-precondition', 'A monetizacao so pode ser aprovada para criadores.');
  }
  const complianceRow =
    row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null;
  requireMonetizationComplianceOrThrow(complianceRow);
  const age = resolveCreatorAgeYears(row);
  const isUnderage = age != null && age < 18;
  const now = Date.now();
  const monetizationStatus = isUnderage ? 'blocked_underage' : 'active';
  const canPublishMembership = monetizationStatus === 'active' && hasPublicCreatorMembershipOffer(row);
  const membershipPricePub = canPublishMembership ? Number(row.creatorMembershipPriceBRL) : null;
  const donationSuggestedPub = canPublishMembership ? Number(row.creatorDonationSuggestedBRL) : null;

  const creatorDocMonApprove = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: String(row?.birthDate || '').trim(),
    displayName: String(row?.creatorDisplayName || row?.userName || '').trim(),
    bio: String(row?.creatorBio || '').trim(),
    instagramUrl: row?.instagramUrl,
    youtubeUrl: row?.youtubeUrl,
    monetizationPreference: 'monetize',
    creatorMonetizationStatus: monetizationStatus,
    compliance: row?.creatorCompliance && typeof row.creatorCompliance === 'object' ? row.creatorCompliance : null,
    now,
  });

  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocMonApprove,
    [`usuarios/${uid}/creatorMonetizationPreference`]: 'monetize',
    [`usuarios/${uid}/creatorMonetizationStatus`]: monetizationStatus,
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: null,
    [`usuarios/${uid}/creatorProfile/monetizationPreference`]: 'monetize',
    [`usuarios/${uid}/creatorProfile/monetizationStatus`]: monetizationStatus,
    [`usuarios/${uid}/creatorProfile/monetizationEnabled`]: monetizationStatus === 'active',
    [`usuarios/${uid}/creatorProfile/ageVerified`]: age != null,
    [`usuarios/${uid}/creatorProfile/updatedAt`]: now,
    [`usuarios_publicos/${uid}/creatorMembershipEnabled`]: canPublishMembership,
    [`usuarios_publicos/${uid}/creatorMembershipPriceBRL`]: membershipPricePub,
    [`usuarios_publicos/${uid}/creatorDonationSuggestedBRL`]: donationSuggestedPub,
    [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: monetizationStatus,
    [`usuarios_publicos/${uid}/updatedAt`]: now,
  });

  const monetizationApprovalMessage =
    monetizationStatus === 'active'
      ? canPublishMembership
        ? 'Sua monetizacao foi aprovada. Assinaturas na sua pagina publica ja podem usar os valores que voce configurou.'
        : `Sua monetizacao foi aprovada. No perfil, ative a membership e defina valor da membership e doacao sugerida entre R$ ${CREATOR_MEMBERSHIP_PRICE_MIN_BRL} e R$ ${CREATOR_MEMBERSHIP_PRICE_MAX_BRL} para liberar assinatura com acesso antecipado as suas obras.`
      : 'Sua conta segue liberada para publicar, mas a monetizacao permanece bloqueada por idade.';
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: 'creator_monetization',
      title: monetizationStatus === 'active' ? 'Monetizacao aprovada' : 'Monetizacao bloqueada',
      message: monetizationApprovalMessage,
      dedupeKey: `creator_lifecycle:monetization_approved:${uid}:${now}`,
      dedupeWindowMs: 0,
      allowGrouping: false,
      data: { monetizationStatus, readPath: '/perfil' },
    },
    email: buildCreatorLifecycleEmail(APP_BASE_URL.value().replace(/\/$/, ''), {
      title: monetizationStatus === 'active' ? 'Monetizacao aprovada' : 'Monetizacao bloqueada',
      subject: monetizationStatus === 'active' ? 'Sua monetizacao foi aprovada' : 'Sua monetizacao segue bloqueada',
      message: monetizationApprovalMessage,
    }),
  });

  return { ok: true, uid, monetizationStatus };
});

export const adminRejectCreatorMonetization = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid obrigatorio.');
  }
  const db = getDatabase();
  const snap = await db.ref(`usuarios/${uid}`).get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Usuario nao encontrado.');
  }
  const row = snap.val() || {};
  if (String(row?.role || '').trim().toLowerCase() !== 'mangaka') {
    throw new HttpsError('failed-precondition', 'A monetizacao so pode ser ajustada para criadores.');
  }
  const reason = normalizeReviewReason(request.data?.reason);
  if (reason.length < 8) {
    throw new HttpsError('invalid-argument', 'Informe um motivo com pelo menos 8 caracteres para manter so publicacao.');
  }
  const now = Date.now();

  const creatorDocMonReject = assembleCreatorRecordForRtdb({
    row,
    birthDateIso: String(row?.birthDate || '').trim(),
    displayName: String(row?.creatorDisplayName || row?.userName || '').trim(),
    bio: String(row?.creatorBio || '').trim(),
    instagramUrl: row?.instagramUrl,
    youtubeUrl: row?.youtubeUrl,
    monetizationPreference: 'publish_only',
    creatorMonetizationStatus: 'disabled',
    compliance: null,
    now,
  });

  await db.ref().update({
    [`usuarios/${uid}/creator`]: creatorDocMonReject,
    [`usuarios/${uid}/creatorMonetizationPreference`]: 'publish_only',
    [`usuarios/${uid}/creatorMonetizationStatus`]: 'disabled',
    [`usuarios/${uid}/creatorMonetizationReviewReason`]: reason,
    [`usuarios/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios/${uid}/creatorProfile/monetizationPreference`]: 'publish_only',
    [`usuarios/${uid}/creatorProfile/monetizationStatus`]: 'disabled',
    [`usuarios/${uid}/creatorProfile/monetizationEnabled`]: false,
    [`usuarios/${uid}/creatorProfile/updatedAt`]: now,
    [`usuarios_publicos/${uid}/creatorMembershipEnabled`]: false,
    [`usuarios_publicos/${uid}/creatorMembershipPriceBRL`]: null,
    [`usuarios_publicos/${uid}/creatorDonationSuggestedBRL`]: null,
    [`usuarios_publicos/${uid}/creatorMonetizationStatus`]: 'disabled',
    [`usuarios_publicos/${uid}/updatedAt`]: now,
  });

  const monetizationRejectMessage = `Sua conta segue habilitada para publicar, mas a monetizacao nao foi liberada agora. Motivo: ${reason}`;
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: 'creator_monetization',
      title: 'Monetizacao nao aprovada',
      message: monetizationRejectMessage,
      dedupeKey: `creator_lifecycle:monetization_rejected:${uid}:${now}`,
      dedupeWindowMs: 0,
      allowGrouping: false,
      data: { monetizationStatus: 'disabled', reason, readPath: '/perfil' },
    },
    email: buildCreatorLifecycleEmail(APP_BASE_URL.value().replace(/\/$/, ''), {
      title: 'Monetizacao nao aprovada',
      subject: 'Sua monetizacao nao foi liberada',
      message: monetizationRejectMessage,
    }),
  });

  return { ok: true, uid, monetizationStatus: 'disabled' };
});

function maskPixKeyForAdminSnapshot(rawPixKey) {
  const value = String(rawPixKey || '').trim();
  if (!value) return null;
  if (value.length <= 6) return value;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export const adminRecordCreatorPixPayout = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid obrigatorio.');
  }
  const db = getDatabase();
  const [userSnap, balanceSnap] = await Promise.all([
    db.ref(`usuarios/${uid}`).get(),
    db.ref(`creatorData/${uid}/balance`).get(),
  ]);
  if (!userSnap.exists()) {
    throw new HttpsError('not-found', 'Criador nao encontrado.');
  }
  const row = userSnap.val() || {};
  if (String(row?.role || '').trim().toLowerCase() !== 'mangaka') {
    throw new HttpsError('failed-precondition', 'Este usuario ainda nao e um criador aprovado.');
  }
  const balance = balanceSnap.exists() ? balanceSnap.val() || {} : {};
  const available = round2(Number(balance?.availableBRL || 0));
  if (!available || available <= 0) {
    throw new HttpsError('failed-precondition', 'Este criador nao possui saldo disponivel para repasse.');
  }
  const requestedAmount = request.data?.amount == null ? available : round2(Number(request.data.amount));
  if (!requestedAmount || requestedAmount <= 0) {
    throw new HttpsError('invalid-argument', 'amount invalido.');
  }
  if (requestedAmount - available > 0.009) {
    throw new HttpsError('failed-precondition', 'O valor informado excede o saldo disponivel do criador.');
  }
  const compliance = row?.creatorCompliance && typeof row.creatorCompliance === 'object'
    ? row.creatorCompliance
    : null;
  requireMonetizationComplianceOrThrow(compliance);
  const payoutId = await recordCreatorManualPixPayout(db, {
    creatorId: uid,
    amount: requestedAmount,
    currency: 'BRL',
    pixType: String(compliance?.payoutPixType || '').trim().toLowerCase() || null,
    pixKeyMasked: maskPixKeyForAdminSnapshot(compliance?.payoutInstructions),
    paidByUid: request.auth.uid,
    externalTransferId: request.data?.externalTransferId ? String(request.data.externalTransferId) : null,
    notes: request.data?.notes ? String(request.data.notes) : null,
    paidAt: Date.now(),
  });
  if (!payoutId) {
    throw new HttpsError('internal', 'Nao foi possivel registrar o repasse manual.');
  }
  await notifyUserByPreference(db, uid, row || {}, {
    kind: 'creator_lifecycle',
    notification: {
      type: 'creator_payout',
      title: 'Repasse PIX registrado',
      message: `Um repasse manual de ${requestedAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} foi marcado pela equipe.`,
      data: {
        payoutId,
        amount: requestedAmount,
        readPath: '/perfil',
      },
    },
  });
  return {
    ok: true,
    uid,
    payoutId,
    amount: requestedAmount,
    remainingAvailableBRL: round2(Math.max(0, available - requestedAmount)),
  };
});

export const markUserNotificationRead = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const notificationId = String(request.data?.notificationId || '').trim();
  const markAll = request.data?.markAll === true;
  const db = getDatabase();

  if (markAll) {
    const snap = await db.ref(`usuarios/${uid}/notifications`).get();
    const notifications = snap.val() || {};
    const now = Date.now();
    const patch = {};
    for (const [id] of Object.entries(notifications)) {
      patch[`usuarios/${uid}/notifications/${id}/read`] = true;
      patch[`usuarios/${uid}/notifications/${id}/readAt`] = now;
    }
    if (Object.keys(patch).length) {
      await db.ref().update(patch);
    }
    return { ok: true, marked: Object.keys(notifications).length };
  }

  if (!notificationId) {
    throw new HttpsError('invalid-argument', 'notificationId obrigatorio.');
  }
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(notificationId)) {
    throw new HttpsError('invalid-argument', 'notificationId invalido.');
  }
  const notificationRef = db.ref(`usuarios/${uid}/notifications/${notificationId}`);
  const notificationSnap = await notificationRef.get();
  if (!notificationSnap.exists()) {
    throw new HttpsError('not-found', 'Notificacao nao encontrada.');
  }

  await notificationRef.update({
    read: true,
    readAt: Date.now(),
  });
  return { ok: true, notificationId };
});

export const deleteUserNotification = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const notificationId = String(request.data?.notificationId || '').trim();
  const deleteAll = request.data?.deleteAll === true;
  const db = getDatabase();

  if (deleteAll) {
    const notificationsRef = db.ref(`usuarios/${uid}/notifications`);
    const snap = await notificationsRef.get();
    const notifications = snap.val() || {};
    await notificationsRef.remove();
    return { ok: true, deleted: Object.keys(notifications).length };
  }

  if (!notificationId) {
    throw new HttpsError('invalid-argument', 'notificationId obrigatorio.');
  }
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(notificationId)) {
    throw new HttpsError('invalid-argument', 'notificationId invalido.');
  }
  const notificationRef = db.ref(`usuarios/${uid}/notifications/${notificationId}`);
  const notificationSnap = await notificationRef.get();
  if (!notificationSnap.exists()) {
    throw new HttpsError('not-found', 'Notificacao nao encontrada.');
  }

  await notificationRef.remove();
  return { ok: true, notificationId };
});

export const toggleCreatorFollow = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const followerUid = String(request.auth.uid || '').trim();
  const creatorId = sanitizeCreatorId(request.data?.creatorId);
  if (!creatorId) {
    throw new HttpsError('invalid-argument', 'creatorId obrigatorio.');
  }
  if (creatorId === followerUid) {
    throw new HttpsError('failed-precondition', 'Voce nao pode seguir o proprio perfil.');
  }

  const db = getDatabase();
  const [targetSnap, followerSnap] = await Promise.all([
    db.ref(`usuarios_publicos/${creatorId}`).get(),
    db.ref(`usuarios/${followerUid}`).get(),
  ]);

  if (!targetSnap.exists()) {
    throw new HttpsError('not-found', 'Criador nao encontrado.');
  }
  const target = targetSnap.val() || {};
  const creatorStatus = String(target?.creatorStatus || '').trim().toLowerCase();
  if (creatorStatus && creatorStatus !== 'active') {
    throw new HttpsError('failed-precondition', 'Este perfil de criador ainda nao esta publico.');
  }

  const followerRow = followerSnap.exists() ? followerSnap.val() || {} : {};
  const followerIsCreator = String(followerRow?.role || '').trim().toLowerCase() === 'mangaka';

  const followingRef = db.ref(`usuarios/${followerUid}/followingCreators/${creatorId}`);
  const followerRef = db.ref(`usuarios_publicos/${creatorId}/followers/${followerUid}`);
  const statsRef = db.ref(`usuarios_publicos/${creatorId}/stats/followersCount`);
  const publicCountRef = db.ref(`usuarios_publicos/${creatorId}/followersCount`);
  const creatorProfileCountRef = db.ref(`usuarios/${creatorId}/creatorProfile/stats/followersCount`);

  const currentSnap = await followingRef.get();
  const isFollowing = currentSnap.exists();
  const now = Date.now();

  if (isFollowing) {
    await Promise.all([
      followingRef.remove(),
      followerRef.remove(),
      statsRef.transaction((curr) => Math.max(0, Number(curr || 0) - 1)),
      publicCountRef.transaction((curr) => Math.max(0, Number(curr || 0) - 1)),
      creatorProfileCountRef.transaction((curr) => Math.max(0, Number(curr || 0) - 1)),
      db.ref(`creators/${creatorId}/stats/followersCount`).transaction((curr) => Math.max(0, Number(curr || 0) - 1)),
    ]);
    return { ok: true, isFollowing: false };
  }

  await Promise.all([
    followingRef.set({
      creatorId,
      followedAt: now,
    }),
    followerRef.set({
      followerUserId: followerUid,
      followerCreatorId: followerIsCreator ? followerUid : null,
      followedAt: now,
    }),
    statsRef.transaction((curr) => Number(curr || 0) + 1),
    publicCountRef.transaction((curr) => Number(curr || 0) + 1),
    creatorProfileCountRef.transaction((curr) => Number(curr || 0) + 1),
    db.ref(`creators/${creatorId}/stats/followersCount`).transaction((curr) => Number(curr || 0) + 1),
  ]);
  await incrementCreatorAudienceDaily(db, creatorId, 'followersAdded', 1, now);

  return { ok: true, isFollowing: true };
});

export const upsertNotificationSubscription = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = String(request.auth.uid || '').trim();
  const type = String(request.data?.type || '').trim().toLowerCase();
  const targetId = String(request.data?.targetId || '').trim();
  if (!['creator', 'work'].includes(type) || !targetId) {
    throw new HttpsError('invalid-argument', 'Envie type valido e targetId.');
  }
  const enabled = request.data?.enabled !== false;
  const db = getDatabase();
  const basePath =
    type === 'creator'
      ? `usuarios/${uid}/followingCreators/${sanitizeCreatorId(targetId)}`
      : `usuarios/${uid}/subscribedWorks/${targetId}`;
  if (!enabled) {
    await db.ref(basePath).remove();
    return { ok: true, enabled: false };
  }
  await db.ref(basePath).set({
    targetId: type === 'creator' ? sanitizeCreatorId(targetId) : targetId,
    type,
    subscribedAt: Date.now(),
    updatedAt: Date.now(),
  });
  return { ok: true, enabled: true };
});

export const creatorAudienceBackfill = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const ctx = await getAdminAuthContext(request.auth);
  const isCreator = ctx ? false : await isCreatorAccountAuth(request.auth);
  if (!ctx && !isCreator) {
    throw new HttpsError('permission-denied', 'Apenas admins ou o proprio creator podem reconstruir audiencia.');
  }
  const requestedCreatorId = sanitizeCreatorId(request.data?.creatorId || request.auth.uid);
  const creatorId = ctx ? requestedCreatorId : request.auth.uid;
  return rebuildCreatorAudienceBackfill(getDatabase(), creatorId);
});

export const adminListStaff = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const snap = await db.ref(ADMIN_REGISTRY_PATH).get();
  const raw = snap.val() || {};
  const registryRows = await Promise.all(
    Object.entries(raw)
      .filter(([, row]) => String(row?.role || '').toLowerCase() === 'admin')
      .map(async ([uid, row]) => {
        let email = null;
        let name = '';
        try {
          const u = await getAuth().getUser(uid);
          email = u.email || null;
          name = String(u.displayName || '').trim();
        } catch {
          email = null;
        }
        if (!name) {
          const userSnap = await db.ref(`usuarios/${uid}`).get();
          const userRow = userSnap.val() || {};
          name = String(userRow?.userName || userRow?.creatorDisplayName || '').trim();
        }
        return {
          uid,
          email,
          name: name || null,
          role: 'admin',
          permissions: normalizePermissionsForRegistry(row?.permissions),
          updatedAt: Number(row?.updatedAt || 0),
          updatedBy: String(row?.updatedBy || ''),
        };
      })
  );
  const superAdmins = await Promise.all(
    Array.from(SUPER_ADMIN_UIDS).map(async (uid) => {
      let email = null;
      let name = '';
      try {
        const u = await getAuth().getUser(uid);
        email = u.email || null;
        name = String(u.displayName || '').trim();
      } catch {
        email = null;
      }
      if (!name) {
        const userSnap = await db.ref(`usuarios/${uid}`).get();
        const userRow = userSnap.val() || {};
        name = String(userRow?.userName || userRow?.creatorDisplayName || '').trim();
      }
      return {
        uid,
        email,
        name: name || null,
        role: 'super_admin',
        permissions: defaultPermissionsAllTrue(),
        updatedAt: 0,
        updatedBy: '',
      };
    })
  );
  const seen = new Set();
  const staff = [...superAdmins, ...registryRows].filter((row) => {
    if (!row?.uid || seen.has(row.uid)) return false;
    seen.add(row.uid);
    return true;
  });
  staff.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'super_admin' ? -1 : 1;
    const labelA = String(a.name || a.email || a.uid || '').toLowerCase();
    const labelB = String(b.name || b.email || b.uid || '').toLowerCase();
    return labelA.localeCompare(labelB, 'pt-BR');
  });
  return { ok: true, staff };
});

export const adminUpsertStaff = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const data = request.data || {};
  const email = String(data.email || '').trim();
  if (!email) {
    throw new HttpsError('invalid-argument', 'Email obrigatorio.');
  }
  const targetUid = await resolveTargetUidByEmail(email);
  if (!targetUid) {
    throw new HttpsError('not-found', 'Usuario nao encontrado com este email.');
  }
  let targetEmailLower = email.toLowerCase();
  try {
    const tu = await getAuth().getUser(targetUid);
    if (tu.email) targetEmailLower = tu.email.toLowerCase();
  } catch {
    /* ignore */
  }
  if (isTargetSuperAdmin({ uid: targetUid, email: targetEmailLower })) {
    throw new HttpsError('permission-denied', 'Nao e permitido alterar admin chefe.');
  }
  const staffRole = 'admin';
  const permissions = normalizePermissionsForRegistry(data.permissions);
  const updatedAt = Date.now();
  const updatedBy = request.auth.uid;
  await getDatabase().ref(`${ADMIN_REGISTRY_PATH}/${targetUid}`).set({
    role: staffRole,
    permissions,
    updatedAt,
    updatedBy,
  });
  const userRecord = await getAuth().getUser(targetUid);
  const prevClaims = { ...(userRecord.customClaims || {}) };
  prevClaims.panelRole = 'admin';
  await getAuth().setCustomUserClaims(targetUid, prevClaims);
  await getDatabase().ref(`usuarios/${targetUid}/role`).set(staffRole);
  return { ok: true, uid: targetUid, role: staffRole };
});

export const adminRemoveStaff = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const data = request.data || {};
  let targetUid = String(data.uid || '').trim();
  if (!targetUid && data.email) {
    targetUid = (await resolveTargetUidByEmail(String(data.email).trim())) || '';
  }
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Informe uid ou email.');
  }
  let targetEmailLower = '';
  try {
    const tu = await getAuth().getUser(targetUid);
    if (tu.email) targetEmailLower = tu.email.toLowerCase();
  } catch (e) {
    if (e?.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'Usuario nao encontrado.');
    }
    throw e;
  }
  if (isTargetSuperAdmin({ uid: targetUid, email: targetEmailLower })) {
    throw new HttpsError('permission-denied', 'Nao e permitido remover admin chefe.');
  }
  const regSnap = await getDatabase().ref(`${ADMIN_REGISTRY_PATH}/${targetUid}`).get();
  const regRole = regSnap.val()?.role;
  if (!regSnap.exists() || regRole !== 'admin') {
    throw new HttpsError(
      'failed-precondition',
      'So admins do registro podem ser removidos aqui.'
    );
  }
  await getDatabase().ref(`${ADMIN_REGISTRY_PATH}/${targetUid}`).remove();
  const userRecord = await getAuth().getUser(targetUid);
  const prevClaims = { ...(userRecord.customClaims || {}) };
  delete prevClaims.admin;
  delete prevClaims.panelRole;
  await getAuth().setCustomUserClaims(
    targetUid,
    Object.keys(prevClaims).length ? prevClaims : null
  );
  await getDatabase().ref(`usuarios/${targetUid}/role`).set('user');
  return { ok: true };
});

/** Preenche `creatorId` em obras sem o campo (UID legado = primeiro super-admin). */
export const adminBackfillObraCreatorIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const legacy = Array.from(SUPER_ADMIN_UIDS)[0];
  const snap = await db.ref('obras').get();
  let updated = 0;
  for (const [id, row] of Object.entries(snap.val() || {})) {
    if (row && !row.creatorId && id) {
      await db.ref(`obras/${id}/creatorId`).set(legacy);
      updated += 1;
    }
  }
  logger.info('adminBackfillObraCreatorIds', { updated });
  return { ok: true, updated };
});

/** Preenche `creatorId` em capítulos sem o campo, a partir da obra. */
export const adminBackfillChapterCreatorIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const legacy = Array.from(SUPER_ADMIN_UIDS)[0];
  const [capsSnap, obrasSnap] = await Promise.all([db.ref('capitulos').get(), db.ref('obras').get()]);
  const obras = obrasSnap.val() || {};
  let updated = 0;
  for (const [id, cap] of Object.entries(capsSnap.val() || {})) {
    if (!cap || cap.creatorId || !id) continue;
    const raw = String(cap.workId || cap.obraId || 'shito')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40);
    const oid = raw || 'shito';
    const obra = obras[oid] || {};
    const cid = obra.creatorId || legacy;
    await db.ref(`capitulos/${id}/creatorId`).set(String(cid));
    updated += 1;
  }
  logger.info('adminBackfillChapterCreatorIds', { updated });
  return { ok: true, updated };
});

/** Garante `workId` em capítulos legados (espelha obraId / shito). Fase 1 multi-obra. */
export const adminBackfillChapterWorkIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const snap = await db.ref('capitulos').get();
  const caps = snap.val() || {};
  let updated = 0;
  const normalizeFromCap = (cap) => {
    const raw = String(cap?.obraId || cap?.workId || 'shito')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40);
    return raw || 'shito';
  };
  for (const [id, cap] of Object.entries(caps)) {
    if (!cap || !id) continue;
    const w = String(cap.workId || '').trim();
    if (w) continue;
    const wid = normalizeFromCap(cap);
    await db.ref(`capitulos/${id}/workId`).set(wid);
    updated += 1;
  }
  logger.info('adminBackfillChapterWorkIds', { updated });
  return { ok: true, updated };
});

/** Preenche `creatorId` em produtos da loja a partir da obra relacionada; fallback = criador legado. */
export const adminBackfillStoreProductCreatorIds = onCall({ region: 'us-central1', cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  requireSuperAdmin(request.auth);
  const db = getDatabase();
  const [productsSnap, obrasSnap] = await Promise.all([db.ref('loja/produtos').get(), db.ref('obras').get()]);
  const products = productsSnap.val() || {};
  const obras = obrasSnap.val() || {};
  let updated = 0;
  let legacyFallback = 0;
  let skippedWithoutHint = 0;
  for (const [id, row] of Object.entries(products)) {
    if (!row || row.creatorId || !id) continue;
    const obraHint = String(row.obra || row.workId || row.obraId || '').trim().toLowerCase();
    if (!obraHint) {
      skippedWithoutHint += 1;
      continue;
    }
    const obra = obras[obraHint] || null;
    const creatorId = sanitizeCreatorId(obra?.creatorId) || PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS;
    if (!creatorId) continue;
    if (!sanitizeCreatorId(obra?.creatorId)) legacyFallback += 1;
    await db.ref(`loja/produtos/${id}/creatorId`).set(creatorId);
    updated += 1;
  }
  logger.info('adminBackfillStoreProductCreatorIds', { updated, legacyFallback, skippedWithoutHint });
  return { ok: true, updated, legacyFallback, skippedWithoutHint, legacyCreatorUid: PLATFORM_LEGACY_CREATOR_UID_FUNCTIONS };
});

/** Auditoria de pedidos antigos sem creatorId nos itens; histórico segue válido, mas sem atribuição retroativa. */
export const adminAuditarPedidosLojaSemAtribuicao = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'loja');
  const snap = await getDatabase().ref('loja/pedidos').get();
  const orders = snap.val() || {};
  let total = 0;
  let withMissingCreatorItems = 0;
  let legacyOnly = 0;
  const sample = [];
  for (const [orderId, row] of Object.entries(orders)) {
    total += 1;
    const items = Array.isArray(row?.items) ? row.items : [];
    const missing = items.filter((item) => !sanitizeCreatorId(item?.creatorId));
    if (!missing.length) continue;
    withMissingCreatorItems += 1;
    if (items.every((item) => !sanitizeCreatorId(item?.creatorId))) legacyOnly += 1;
    if (sample.length < 20) {
      sample.push({
        orderId,
        createdAt: Number(row?.createdAt || 0),
        status: String(row?.status || ''),
        uid: String(row?.uid || ''),
        total: Number(row?.total || 0),
        missingItems: missing.length,
        totalItems: items.length,
      });
    }
  }
  return {
    ok: true,
    total,
    withMissingCreatorItems,
    legacyOnly,
    note: 'Pedidos antigos sem creatorId continuam como historico valido; sem regra forte de retroatribuicao automatica.',
    sample,
  };
});

function orderItemsForCreator(order, creatorUid) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.filter((item) => sanitizeCreatorId(item?.creatorId) === creatorUid);
}

function sanitizeStoreOrderForViewer(orderId, row, viewerUid) {
  const items = orderItemsForCreator(row, viewerUid);
  const containsForeignItems = (Array.isArray(row?.items) ? row.items : []).length > items.length;
  const creatorSubtotal = items.reduce((sum, item) => sum + Number(item?.lineTotal || 0), 0);
  return {
    id: orderId,
    uid: String(row?.uid || ''),
    status: normalizeStoreOrderStatusInput(row?.status, ''),
    createdAt: Number(row?.createdAt || 0),
    updatedAt: Number(row?.updatedAt || 0),
    paidAt: Number(row?.paidAt || 0) || null,
    refundedAt: Number(row?.refundedAt || 0) || null,
    paymentStatus: String(row?.paymentStatus || ''),
    paymentId: row?.paymentId ?? null,
    payoutStatus: String(row?.payoutStatus || ''),
    trackingCode: String(row?.trackingCode || row?.codigoRastreio || ''),
    shippingAddress: row?.shippingAddress && typeof row.shippingAddress === 'object' ? row.shippingAddress : null,
    productionChecklist:
      row?.productionChecklist && typeof row.productionChecklist === 'object' ? row.productionChecklist : null,
    vipApplied: row?.vipApplied === true,
    creatorSubtotal,
    total: creatorSubtotal,
    subtotal: creatorSubtotal,
    containsForeignItems,
    items,
  };
}

export const adminListVisibleStoreOrders = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const ctx = await getAdminAuthContext(request.auth);
  const isCreator = ctx ? false : await isCreatorAccountAuth(request.auth);
  if (!ctx && !isCreator) {
    throw new HttpsError('permission-denied', 'Sem acesso ao painel.');
  }
  const canUseGlobal =
    ctx.super === true ||
    ctx.legacy === true ||
    ctx.permissions?.canAccessLojaAdmin === true ||
    ctx.permissions?.canAccessPedidos === true;
  const snap = await getDatabase().ref('loja/pedidos').get();
  const orders = snap.val() || {};
  const list = Object.entries(orders)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

  if (isCreator) {
    const visible = list
      .filter((order) => orderItemsForCreator(order, request.auth.uid).length > 0)
      .map((order) => sanitizeStoreOrderForViewer(order.id, order, request.auth.uid));
    return { ok: true, orders: visible, scopedToCreator: true };
  }

  if (!canUseGlobal) {
    throw new HttpsError('permission-denied', 'Sem permissao para pedidos da loja.');
  }
  return { ok: true, orders: list, scopedToCreator: false };
});

export const listMyStoreOrders = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const uid = request.auth.uid;
  const snap = await getDatabase()
    .ref('loja/pedidos')
    .orderByChild('uid')
    .equalTo(uid)
    .get();
  const orders = snap.val() || {};
  const list = Object.entries(orders)
    .map(([id, row]) => ({ id, ...(row || {}) }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return { ok: true, orders: list };
});

export const getStoreOrderForViewer = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const orderId = String(request.data?.orderId || '').trim();
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId obrigatorio.');
  }
  const snap = await getDatabase().ref(`loja/pedidos/${orderId}`).get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Pedido nao encontrado.');
  }
  const row = snap.val() || {};
  const uid = request.auth.uid;
  if (String(row.uid || '') === uid) {
    return { ok: true, viewerRole: 'buyer', order: { id: orderId, ...row } };
  }
  const ctx = await getAdminAuthContext(request.auth);
  const isCreator = ctx ? false : await isCreatorAccountAuth(request.auth);
  if (!ctx && !isCreator) {
    throw new HttpsError('permission-denied', 'Sem permissao.');
  }
  if (isCreator && orderItemsForCreator({ id: orderId, ...row }, uid).length > 0) {
    return {
      ok: true,
      viewerRole: 'seller',
      order: sanitizeStoreOrderForViewer(orderId, { id: orderId, ...row }, uid),
    };
  }
  throw new HttpsError('permission-denied', 'Sem permissao para ver este pedido.');
});

export const adminUpdateVisibleStoreOrder = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const ctx = await getAdminAuthContext(request.auth);
  const isCreator = ctx ? false : await isCreatorAccountAuth(request.auth);
  if (!ctx && !isCreator) {
    throw new HttpsError('permission-denied', 'Sem acesso ao painel.');
  }
  const body = request.data && typeof request.data === 'object' ? request.data : {};
  const orderId = String(body.orderId || '').trim();
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId obrigatorio.');
  }
  const statusRaw = body.status == null ? '' : String(body.status).trim();
  const trackingCode = body.trackingCode == null ? null : String(body.trackingCode || '').trim();
  const productionChecklist =
    body.productionChecklist && typeof body.productionChecklist === 'object'
      ? body.productionChecklist
      : null;
  if (!statusRaw && trackingCode == null && !productionChecklist) {
    throw new HttpsError('invalid-argument', 'Envie status, trackingCode ou productionChecklist.');
  }

  const orderRef = getDatabase().ref(`loja/pedidos/${orderId}`);
  const snap = await orderRef.get();
  if (!snap.exists()) {
    throw new HttpsError('not-found', 'Pedido nao encontrado.');
  }
  const order = snap.val() || {};
  const patch = { updatedAt: Date.now() };

  const canUseGlobal =
    ctx.super === true ||
    ctx.legacy === true ||
    ctx.permissions?.canAccessLojaAdmin === true ||
    ctx.permissions?.canAccessPedidos === true;

  if (isCreator) {
    const ownItems = orderItemsForCreator(order, request.auth.uid);
    const hasForeignItems = (Array.isArray(order?.items) ? order.items : []).length > ownItems.length;
    if (!ownItems.length) {
      throw new HttpsError('permission-denied', 'Pedido fora do seu escopo.');
    }
    if (hasForeignItems) {
      throw new HttpsError('failed-precondition', 'Pedido misto deve ser atualizado pelo admin.');
    }
  } else if (!canUseGlobal) {
    throw new HttpsError('permission-denied', 'Sem permissao para atualizar pedido.');
  }

  if (statusRaw) {
    const normalizedStatus = normalizeStoreOrderStatusInput(statusRaw, '');
    if (!normalizedStatus || !STORE_ORDER_STATUS_CANON.has(normalizedStatus)) {
      throw new HttpsError('invalid-argument', 'Status invalido.');
    }
    patch.status = normalizedStatus;
    if (normalizedStatus === 'delivered') {
      patch.payoutStatus = 'released';
      patch.payoutReleasedAt = Date.now();
    } else if (normalizedStatus === 'paid' || normalizedStatus === 'in_production' || normalizedStatus === 'shipped') {
      patch.payoutStatus = 'held';
    }
  }
  if (trackingCode != null) {
    if (trackingCode.length > 80) {
      throw new HttpsError('invalid-argument', 'trackingCode muito longo.');
    }
    patch.trackingCode = trackingCode;
  }
  if (productionChecklist) {
    patch.productionChecklist = {
      printing: productionChecklist.printing === true,
      organizing: productionChecklist.organizing === true,
      gluing: productionChecklist.gluing === true,
      pressing: productionChecklist.pressing === true,
      cutting: productionChecklist.cutting === true,
      finishing: productionChecklist.finishing === true,
    };
  }

  await orderRef.update(patch);
  return { ok: true };
});

export const adminRevokeUserSessions = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Faca login.');
  }
  const ctx = await requireAdminAuth(request.auth);
  requirePermission(ctx, 'revokeSessions');
  const data = request.data || {};
  let targetUid = String(data.uid || '').trim();
  if (!targetUid && data.email) {
    targetUid = (await resolveTargetUidByEmail(String(data.email).trim())) || '';
  }
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'Informe uid ou email.');
  }
  let targetEmailLower = '';
  try {
    const tu = await getAuth().getUser(targetUid);
    if (tu.email) targetEmailLower = tu.email.toLowerCase();
  } catch (e) {
    if (e?.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'Usuario nao encontrado.');
    }
    throw e;
  }
  if (!ctx.super && !ctx.legacy && isTargetSuperAdmin({ uid: targetUid, email: targetEmailLower })) {
    throw new HttpsError('permission-denied', 'Sem permissao para revogar sessoes deste usuario.');
  }
  await getAuth().revokeRefreshTokens(targetUid);
  return { ok: true };
});

export const adminRevokeAllSessions = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Faca login.');
    }
    requireSuperAdmin(request.auth);
    let nextPageToken;
    let revoked = 0;
    do {
      const page = await getAuth().listUsers(1000, nextPageToken);
      for (const u of page.users) {
        await getAuth().revokeRefreshTokens(u.uid);
        revoked += 1;
      }
      nextPageToken = page.pageToken;
    } while (nextPageToken);
    logger.info('adminRevokeAllSessions ok', { revoked });
    return { ok: true, revoked };
  }
);

export {
  submitPrintOnDemandOrder,
  listMyPrintOnDemandOrders,
  getMyPrintOnDemandOrder,
  cancelMyPrintOnDemandOrder,
  adminListPrintOnDemandOrders,
  adminUpdatePrintOnDemandOrder,
  adminPatchPrintOnDemandOrderSuper,
  expirePrintOnDemandPendingPayments,
} from '../printOnDemandOrders.js';

export { chapterReaderShell } from '../chapterReaderShell.js';

export { recordDiscoveryCreatorMetrics } from '../recordDiscoveryCreatorMetrics.js';

export { onChapterCommentWrittenV2 } from '../chapterCommentSocial.js';

export const dashboardRollupMensal = onSchedule(
  {
    schedule: '15 3 * * *',
    timeZone: 'America/Sao_Paulo',
    memory: '256MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const months = await gerarRollupMensalFinancas();
    logger.info('dashboardRollupMensal ok', { months });
  }
);

