import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { onValueCreated } from 'firebase-functions/v2/database';
import {
  USUARIOS_DEPRECATED_KEYS,
  USUARIOS_PUBLICOS_DEPRECATED_KEYS,
} from './deprecatedUserFields.js';
import {
  APOIO_PLANOS_MP,
  parseApoioExternalRef,
  criarPreferenciaApoio,
  criarPreferenciaApoioValorLivre,
} from './mercadoPagoApoio.js';
import {
  PREMIUM_PRICE_BRL,
  PREMIUM_D_MS,
  PREMIUM_PLAN_ID,
  parsePremiumExternalRef,
  criarPreferenciaPremium,
} from './mercadoPagoPremium.js';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import nodemailer from 'nodemailer';
import cors from 'cors';

// ── Init ───────────────────────────────────────────────────────────────────
if (!getApps().length) {
  initializeApp({
    databaseURL: 'https://shitoproject-ed649-default-rtdb.firebaseio.com',
  });
}

// ── Constantes de tempo ────────────────────────────────────────────────────
const PENDING_TTL_MS  = 40 * 60 * 1000;
const INATIVO_TTL_MS  = 60 * 60 * 1000;
const INACTIVE_TTL_MS = 8 * 30 * 24 * 60 * 60 * 1000;

// ── Params / Secrets ───────────────────────────────────────────────────────
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
/** Base pública das HTTPS functions (webhook MP). Ajuste se o projeto usar outro host. */
const FUNCTIONS_PUBLIC_URL = defineString('FUNCTIONS_PUBLIC_URL', {
  default: 'https://us-central1-shitoproject-ed649.cloudfunctions.net',
});

// ── CORS ───────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5000',
  'https://shitoproject-ed649.web.app',
  'https://shitoproject-ed649.firebaseapp.com',
];

// Usa o pacote cors oficial — mais robusto que setar headers manualmente
const corsMiddleware = cors({ origin: ALLOWED_ORIGINS });

function handleCors(req, res) {
  return new Promise((resolve, reject) =>
    corsMiddleware(req, res, (err) => (err ? reject(err) : resolve()))
  );
}

// ── SMTP ───────────────────────────────────────────────────────────────────
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
  try { return SMTP_FROM.value(); } catch { return 'Shito <drakenteofilo@gmail.com>'; }
}

const PREMIUM_PROMO_PATH = 'financas/promocoes/premiumAtual';
const PREMIUM_PROMO_HISTORY_PATH = 'financas/promocoes/premiumHistorico';

function validPromoPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function parsePromoConfig(raw) {
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

function normalizePromoHistoryItem(raw) {
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

async function getPremiumOfferAt(db, now = Date.now()) {
  const snap = await db.ref(PREMIUM_PROMO_PATH).get();
  const promo = parsePromoConfig(snap.val());
  if (!promo) {
    return {
      currentPriceBRL: PREMIUM_PRICE_BRL,
      basePriceBRL: PREMIUM_PRICE_BRL,
      isPromoActive: false,
      promo: null,
    };
  }
  const active = now >= promo.startsAt && now <= promo.endsAt;
  return {
    currentPriceBRL: active ? promo.priceBRL : PREMIUM_PRICE_BRL,
    basePriceBRL: PREMIUM_PRICE_BRL,
    isPromoActive: active,
    promo,
  };
}

async function enviarEmailPromocaoPremium(db, promo) {
  const usersSnap = await db.ref('usuarios').get();
  if (!usersSnap.exists()) return { sent: 0, skipped: 0, failed: 0 };
  const users = usersSnap.val() || {};
  const transporter = getTransporter();
  const from = getSmtpFrom();
  const base = APP_BASE_URL.value().replace(/\/$/, '');
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const [uid, profile] of Object.entries(users)) {
    const appStatus = profile?.status;
    const optIn = profile?.notifyPromotions === true;
    if (appStatus !== 'ativo' || !optIn) {
      skipped += 1;
      continue;
    }
    try {
      const authUser = await getAuth().getUser(uid);
      const to = authUser?.email;
      if (!to || authUser.disabled) {
        skipped += 1;
        continue;
      }
      const clickId = buildTrackingClickId('promo', uid);
      const trackedUrl = `${base}/apoie?src=promo_email&camp=${encodeURIComponent(
        String(promo?.promoId || '')
      )}&cid=${encodeURIComponent(clickId)}`;
      await transporter.sendMail({
        from,
        to,
        subject: `Shito — promocao Premium ativa por tempo limitado`,
        text: `${promo.name}\n\nValor promocional: R$ ${promo.priceBRL.toFixed(2)}\nValida ate: ${formatarDataBr(promo.endsAt)}\n\nAssine em: ${trackedUrl}`,
        html: `
          <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#f2f2f2;padding:28px;border-radius:10px;">
            <h2 style="margin:0 0 10px;color:#ffcc00;">${promo.name}</h2>
            <p style="margin:0 0 12px;color:#d0d0d0;">${promo.message || 'A promoção Premium está ativa por tempo limitado.'}</p>
            <p style="margin:0 0 8px;">Valor promocional: <strong style="color:#ffcc00;">R$ ${promo.priceBRL.toFixed(2)}</strong></p>
            <p style="margin:0 0 18px;">Validade: <strong>${formatarDataBr(promo.endsAt)}</strong></p>
            <a href="${trackedUrl}" style="display:inline-block;background:#ffcc00;color:#000;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">
              Quero virar Membro Shito
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
    } catch (err) {
      failed += 1;
      logger.error('Promo premium: erro ao enviar email', { uid, error: err?.message });
    }
  }
  return { sent, skipped, failed };
}

// ── Utils ──────────────────────────────────────────────────────────────────
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

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

function sanitizeTrackingValue(v, maxLen = 120) {
  const s = String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-:]/g, '');
  if (!s) return null;
  return s.slice(0, maxLen);
}

function normalizeTrackingSource(v) {
  const s = sanitizeTrackingValue(v, 40);
  if (!s) return null;
  const allowed = new Set([
    'promo_email',
    'chapter_email',
    'normal',
    'direct',
    'unknown',
  ]);
  return allowed.has(s) ? s : 'unknown';
}

function normalizeTrackingEventType(v) {
  const s = sanitizeTrackingValue(v, 60);
  if (!s) return null;
  const allowed = new Set([
    'promo_email_sent',
    'promo_landing',
    'chapter_email_sent',
    'chapter_landing',
    'chapter_read',
    'premium_checkout_started',
  ]);
  return allowed.has(s) ? s : null;
}

function trackingDedupKey(eventType, clickId) {
  const evt = sanitizeTrackingValue(eventType, 60);
  const cid = sanitizeTrackingValue(clickId, 100);
  if (!evt || !cid) return null;
  return `${evt}|${cid}`;
}

function buildTrackingClickId(prefix, uid, at = Date.now()) {
  const p = sanitizeTrackingValue(prefix, 24) || 'track';
  const u = sanitizeTrackingValue(uid, 48) || 'anon';
  const rand = Math.random().toString(36).slice(2, 8);
  return `${p}_${u}_${at}_${rand}`;
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

function isShitoAdminAuth(auth) {
  if (!auth?.uid) return false;
  const uid = auth.uid;
  const email = String(auth.token?.email || '').toLowerCase();
  return (
    uid === 'n5JTPLsxpyQPeC5qQtraSrBa4rG3' ||
    uid === 'QayqN0MpBTQK6je44JwAXWapoQU2' ||
    uid === '20kR47W8PfTGIvGxGOGRsB2JiFA3' ||
    email === 'wilsonteofilosouza@live.com' ||
    email === 'drakenteofilo@gmail.com'
  );
}

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

// ── EMAIL HTML ─────────────────────────────────────────────────────────────
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
                <h1 style="margin:0;color:#000;font-size:28px;font-weight:900;letter-spacing:4px;">SHITO</h1>
                <p style="margin:4px 0 0;color:#000;font-size:12px;letter-spacing:2px;">FRAGMENTOS DA TEMPESTADE</p>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 40px;text-align:center;">
                <p style="color:#aaa;font-size:14px;margin:0 0 24px;">
                  ${isNewUser ? 'Uma nova alma esta prestes a despertar.' : 'Bem-vindo de volta a Tempestade.'}
                </p>
                <p style="color:#fff;font-size:14px;margin:0 0 16px;">Seu codigo de acesso:</p>
                <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:20px;margin:0 auto 24px;">
                  <span style="font-size:36px;font-weight:900;letter-spacing:10px;color:#ffcc00;">${code}</span>
                </div>
                <p style="color:#666;font-size:13px;margin:0 0 8px;">Expira em <strong style="color:#aaa">10 minutos</strong></p>
                <p style="color:#666;font-size:12px;margin:0;">Nao compartilhe este codigo com ninguem.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 40px 24px;text-align:center;border-top:1px solid #1a1a1a;">
                <p style="color:#444;font-size:11px;margin:0;">Se voce nao solicitou este codigo, ignore este e-mail.</p>
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
              <h1 style="margin:0;color:#000;font-size:22px;">Membro Premium — Shito</h1>
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

const AVATAR_FALLBACK_FUNCTIONS = '/assets/avatares/ava1.webp';

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
  trafficClickId
) {
  const procRef = db.ref(`financas/mp_processed/${paymentId}`);
  const procSnap = await procRef.get();
  if (procSnap.exists()) {
    logger.info('Premium: pagamento ja processado', { paymentId });
    return { applied: false, duplicate: true };
  }

  const now = Date.now();
  const snap = await db.ref(`usuarios/${uid}`).get();
  if (!snap.exists()) {
    logger.error('Premium: usuario nao existe', { uid, paymentId });
    return { applied: false, duplicate: false };
  }
  const profile = snap.val() || {};
  const currentUntil = typeof profile.memberUntil === 'number' ? profile.memberUntil : 0;
  const base = Math.max(now, currentUntil);
  const newUntil = base + PREMIUM_D_MS;

  const pubSnap = await db.ref(`usuarios_publicos/${uid}`).get();
  const pub = pubSnap.val() || {};
  const userNamePub = pub.userName || profile.userName || 'Guerreiro';
  let avatarPub = String(pub.userAvatar || profile.userAvatar || '').trim();
  if (!avatarPub) avatarPub = AVATAR_FALLBACK_FUNCTIONS;

  const patch = {};
  patch[`usuarios/${uid}/accountType`] = 'premium';
  patch[`usuarios/${uid}/membershipStatus`] = 'ativo';
  patch[`usuarios/${uid}/memberUntil`] = newUntil;
  patch[`usuarios/${uid}/lastPaymentAt`] = now;
  patch[`usuarios/${uid}/currentPlanId`] = PREMIUM_PLAN_ID;
  patch[`usuarios/${uid}/premium5dNotifiedForUntil`] = null;
  patch[`usuarios_publicos/${uid}/uid`] = uid;
  patch[`usuarios_publicos/${uid}/userName`] = userNamePub;
  patch[`usuarios_publicos/${uid}/userAvatar`] = avatarPub;
  patch[`usuarios_publicos/${uid}/accountType`] = 'premium';
  patch[`usuarios_publicos/${uid}/updatedAt`] = now;
  patch[`financas/mp_processed/${paymentId}`] = { uid, at: now };

  await db.ref().update(patch);

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
        subject: 'Shito — Assinatura Premium ativa',
        text: `Sua assinatura Premium (30 dias) foi confirmada. Valida ate ${formatarDataBr(newUntil)}.\n\n${APP_BASE_URL.value()}/apoie`,
        html: buildPremiumConfirmedHtml(newUntil),
      });
    }
  } catch (err) {
    logger.error('Premium: falha e-mail confirmacao', { uid, error: err?.message });
  }

  logger.info('Premium aplicado', { uid, paymentId, newUntil });
  return { applied: true, newUntil };
}

async function tratarNotificacaoPagamentoPremium(accessToken, paymentId) {
  const pay = await fetchMercadoPagoPayment(accessToken, paymentId);
  const status = String(pay?.status || '');
  if (status !== 'approved') {
    logger.info('MP: pagamento nao aprovado', { paymentId, status });
    return;
  }

  const db = getDatabase();
  const premiumUid = parsePremiumExternalRef(pay.external_reference);
  if (premiumUid) {
    const amount = Number(pay.transaction_amount);
    const metadata = pay.metadata && typeof pay.metadata === 'object' ? pay.metadata : {};
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
      metadata.trafficClickId ? String(metadata.trafficClickId) : null
    );
    return;
  }

  const metadata = pay.metadata && typeof pay.metadata === 'object' ? pay.metadata : {};
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

  const procRef = db.ref(`financas/mp_processed/${paymentId}`);
  const procSnap = await procRef.get();
  if (procSnap.exists()) {
    logger.info('Apoio: pagamento ja processado', { paymentId });
    return;
  }

  const now = Date.now();
  const amount = Number(pay.transaction_amount);
  const currency = String(pay.currency_id || 'BRL');
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

  await db.ref().update({
    [`financas/mp_processed/${paymentId}`]: {
      uid: apoioUid,
      at: now,
      tipo: 'apoio_aprovado',
    },
  });

  await db.ref('financas/eventos').push({
    tipo: 'apoio_aprovado',
    uid: apoioUid,
    paymentId: String(paymentId),
    amount: Number.isFinite(amount) ? amount : null,
    currency,
    origem,
    at: now,
  });

  logger.info('Apoio registrado', { uid: apoioUid, paymentId, amount, origem });
}

// ── CLEANUP AGENDADO ───────────────────────────────────────────────────────
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

// ── SEND LOGIN CODE ────────────────────────────────────────────────────────
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
      const { email } = parseBody(req);
      const normEmail = normalizeEmail(email);

      if (!normEmail || !normEmail.includes('@') || !normEmail.includes('.')) {
        res.status(400).json({ ok: false, error: 'E-mail invalido.' });
        return;
      }

      const db   = getDatabase();
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
        ? 'Seu codigo para invocar uma nova alma em Shito'
        : 'Seu codigo de acesso para retornar a Tempestade';

      await getTransporter().sendMail({
        from:    getSmtpFrom(),
        to:      normEmail,
        subject: assunto,
        text:    `Seu codigo de acesso e: ${code}\n\nEle vale por 10 minutos. Nao compartilhe.\n\nSe nao pediu, ignore.`,
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

// ── VERIFY LOGIN CODE ──────────────────────────────────────────────────────
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

// ── NOTIFY NEW CHAPTER ─────────────────────────────────────────────────────
export const notifyNewChapter = onValueCreated(
  {
    ref:            '/capitulos/{capId}',
    region:         'us-central1',
    memory:         '256MiB',
    timeoutSeconds: 120,
    secrets:        [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async (event) => {
    const capId    = event.params.capId;
    const capitulo = event.data?.val() || {};
    const titulo   = capitulo?.titulo || `Capitulo ${capitulo?.numero || ''}`.trim();
    const url      = `${APP_BASE_URL.value()}/ler/${capId}`;
    const chapterCampaignId = `chapter_${capId}`;

    const db           = getDatabase();
    const usuariosSnap = await db.ref('usuarios').get();

    if (!usuariosSnap.exists()) {
      logger.info('Sem usuarios para notificar.', { capId });
      return;
    }

    const usuarios   = usuariosSnap.val() || {};
    const candidatos = Object.entries(usuarios)
      .filter(([, p]) => p?.notifyNewChapter === true && p?.status === 'ativo')
      .map(([uid]) => uid);

    if (candidatos.length === 0) {
      logger.info('Nenhum usuario opt-in.', { capId });
      return;
    }

    const transporter = getTransporter();
    const from        = getSmtpFrom();
    let enviados = 0, ignorados = 0, falhas = 0;

    for (const uid of candidatos) {
      try {
        const authUser  = await getAuth().getUser(uid);
        const userEmail = authUser?.email;

        if (!userEmail || !authUser.emailVerified || authUser.disabled) {
          ignorados += 1;
          continue;
        }
        const clickId = buildTrackingClickId('chapter', uid);
        const trackedUrl = `${url}?src=chapter_email&camp=${encodeURIComponent(
          chapterCampaignId
        )}&cid=${encodeURIComponent(clickId)}`;

        await transporter.sendMail({
          from,
          to:      userEmail,
          subject: `Novo capitulo em Shito: ${titulo}`,
          text:    `Novo capitulo lancado!\n\nTitulo: ${titulo}\nLink: ${trackedUrl}\n\nPara parar, desative em Perfil > Notificacoes.`,
          html:    `
            <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px;border-radius:8px;">
              <h2 style="color:#ffcc00;margin:0 0 16px;">Novo capitulo em Shito</h2>
              <p style="color:#ccc;margin:0 0 24px;"><strong style="color:#fff">${titulo}</strong></p>
              <a href="${trackedUrl}" style="background:#ffcc00;color:#000;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
                Ler agora
              </a>
              <p style="font-size:11px;color:#444;margin-top:32px;">Para parar de receber, desative em Perfil &gt; Notificacoes.</p>
            </div>
          `,
        });
        await pushMarketingEvent(db, {
          eventType: 'chapter_email_sent',
          source: 'chapter_email',
          campaignId: chapterCampaignId,
          chapterId: capId,
          clickId,
          uid,
        });
        enviados += 1;

      } catch (err) {
        falhas += 1;
        logger.error('Falha ao notificar usuario.', { capId, uid, error: err?.message });
      }
    }

    logger.info('Notificacao concluida.', {
      capId,
      candidatos: candidatos.length,
      enviados,
      ignorados,
      falhas,
    });
  }
);

// ── Migração: remove campos obsoletos de todos os usuários (admin) ─────────
export const adminMigrateDeprecatedUserFields = onCall(
  { region: 'us-central1' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Faca login.');
    }
    if (!isShitoAdminAuth(request.auth)) {
      throw new HttpsError('permission-denied', 'Apenas administradores.');
    }

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

// ── Mercado Pago: preferência de checkout (apoio) ─────────────────────────
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
    });

    if (hasValidPlan && hasValidCustom) {
      throw new HttpsError('invalid-argument', 'Use planId OU customAmount, nao os dois.');
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
      if (hasValidCustom) {
        url = await criarPreferenciaApoioValorLivre(
          token,
          customTry.value,
          APP_BASE_URL.value(),
          request.auth.uid,
          notificationUrl
        );
      } else {
        url = await criarPreferenciaApoio(
          token,
          planNorm,
          APP_BASE_URL.value(),
          request.auth.uid,
          notificationUrl
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
    const offer = await getPremiumOfferAt(db, Date.now());
    const payload =
      request.data && typeof request.data === 'object' ? request.data : {};
    const attributionRaw =
      payload.attribution && typeof payload.attribution === 'object'
        ? payload.attribution
        : {};
    const attribution = {
      source: normalizeTrackingSource(attributionRaw.source) || 'direct',
      campaignId: sanitizeTrackingValue(attributionRaw.campaignId, 100),
      clickId: sanitizeTrackingValue(attributionRaw.clickId, 120),
    };

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
        attribution
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
    const offer = await getPremiumOfferAt(db, now);
    return {
      ok: true,
      now,
      currentPriceBRL: offer.currentPriceBRL,
      basePriceBRL: offer.basePriceBRL,
      isPromoActive: offer.isPromoActive,
      promo: offer.isPromoActive
        ? {
            promoId: offer.promo?.promoId || null,
            name: offer.promo?.name || null,
            message: offer.promo?.message || '',
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
    if (!isShitoAdminAuth(request.auth) && request.auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Apenas administradores.');
    }
    const db = getDatabase();
    const [snap, historySnap, financeSnap, marketingSnap] = await Promise.all([
      db.ref(PREMIUM_PROMO_PATH).get(),
      db.ref(PREMIUM_PROMO_HISTORY_PATH).get(),
      db.ref('financas/eventos').get(),
      db.ref('marketing/eventos').get(),
    ]);
    const raw = snap.val() || null;
    const parsed = parsePromoConfig(raw);
    const historyRaw = historySnap.exists() ? historySnap.val() || {} : {};
    const history = Object.values(historyRaw)
      .map((row) => normalizePromoHistoryItem(row))
      .filter(Boolean)
      .sort((a, b) => Number(b.startsAt || 0) - Number(a.startsAt || 0))
      .slice(0, 60);

    const financeEvents = financeSnap.exists() ? Object.values(financeSnap.val() || {}) : [];
    const marketingEvents = marketingSnap.exists() ? Object.values(marketingSnap.val() || {}) : [];
    const campaignIds = new Set(history.map((h) => h.promoId));
    if (parsed?.promoId) campaignIds.add(parsed.promoId);
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
    };
  }
);

export const adminSalvarPromocaoPremium = onCall(
  {
    region: 'us-central1',
    secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Faca login.');
    if (!isShitoAdminAuth(request.auth) && request.auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Apenas administradores.');
    }
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
      name: String(body.name || 'Promocao Membro Shito').trim() || 'Promocao Membro Shito',
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

    let emailStats = { sent: 0, skipped: 0, failed: 0 };
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

    return {
      ok: true,
      promo,
      notifyUsers: body.notifyUsers === true,
      emailStats,
    };
  }
);

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
          });
          await db.ref(`usuarios_publicos/${uid}`).update({
            uid,
            userName: pub.userName || profile.userName || 'Guerreiro',
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
            subject: 'Shito — sua assinatura Premium acaba em breve',
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
    userName: pub.userName || priv.userName || 'Guerreiro',
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
        userName: pub.userName || priv.userName || 'Guerreiro',
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
    if (!isShitoAdminAuth(request.auth) && request.auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Apenas administradores.');
    }

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
      ? Object.values(eventsSnap.val() || {})
      : [];
    const rawMarketingEvents = marketingSnap.exists()
      ? Object.values(marketingSnap.val() || {})
      : [];
    const usuarios = usuariosSnap.exists() ? usuariosSnap.val() || {} : {};
    const usuariosPublicos = pubSnap.exists() ? pubSnap.val() || {} : {};

    const current = aggregatePeriod(rawEvents, usuarios, usuariosPublicos, period);
    const compare = aggregatePeriod(rawEvents, usuarios, usuariosPublicos, comparePeriod);
    const crescimentoPremium = buildCrescimentoPremium(rawEvents, period);
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
    if (!isShitoAdminAuth(request.auth) && request.auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Apenas administradores.');
    }
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
    if (!isShitoAdminAuth(request.auth) && request.auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Apenas administradores.');
    }

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
    if (!isShitoAdminAuth(request.auth) && request.auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Apenas administradores.');
    }
    const months = await gerarRollupMensalFinancas();
    return { ok: true, months };
  }
);

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

