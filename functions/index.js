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
async function aplicarPremiumAprovado(db, uid, paymentId) {
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
      amount: PREMIUM_PRICE_BRL,
      currency: 'BRL',
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

  const uid = parsePremiumExternalRef(pay.external_reference);
  if (!uid) {
    logger.info('MP: nao e checkout premium', { paymentId, ref: pay.external_reference });
    return;
  }

  const amount = Number(pay.transaction_amount);
  if (!Number.isFinite(amount) || Math.abs(amount - PREMIUM_PRICE_BRL) > 0.02) {
    logger.error('MP: valor inesperado para premium', { paymentId, amount, uid });
    return;
  }

  const db = getDatabase();
  await aplicarPremiumAprovado(db, uid, paymentId);
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

        await transporter.sendMail({
          from,
          to:      userEmail,
          subject: `Novo capitulo em Shito: ${titulo}`,
          text:    `Novo capitulo lancado!\n\nTitulo: ${titulo}\nLink: ${url}\n\nPara parar, desative em Perfil > Notificacoes.`,
          html:    `
            <div style="font-family:Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px;border-radius:8px;">
              <h2 style="color:#ffcc00;margin:0 0 16px;">Novo capitulo em Shito</h2>
              <p style="color:#ccc;margin:0 0 24px;"><strong style="color:#fff">${titulo}</strong></p>
              <a href="${url}" style="background:#ffcc00;color:#000;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
                Ler agora
              </a>
              <p style="font-size:11px;color:#444;margin-top:32px;">Para parar de receber, desative em Perfil &gt; Notificacoes.</p>
            </div>
          `,
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

    try {
      let url;
      if (hasValidCustom) {
        url = await criarPreferenciaApoioValorLivre(
          token,
          customTry.value,
          APP_BASE_URL.value()
        );
      } else {
        url = await criarPreferenciaApoio(token, planNorm, APP_BASE_URL.value());
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

    try {
      const url = await criarPreferenciaPremium(
        token,
        request.auth.uid,
        APP_BASE_URL.value(),
        notificationUrl
      );
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

