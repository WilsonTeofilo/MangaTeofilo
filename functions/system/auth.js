import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import nodemailer from 'nodemailer';
import cors from 'cors';
import { creatorAccessIsApprovedFromDb } from '../creatorRecord.js';

const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_PORT = defineSecret('SMTP_PORT');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const SMTP_FROM = defineSecret('SMTP_FROM');

const PENDING_TTL_MS = 30 * 60 * 1000;
const INATIVO_TTL_MS = 45 * 60 * 1000;
const INACTIVE_TTL_MS = 120 * 24 * 60 * 60 * 1000;

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5000',
  'https://shitoproject-ed649.web.app',
  'https://shitoproject-ed649.firebaseapp.com',
];

const corsMiddleware = cors({ origin: ALLOWED_ORIGINS });

function handleCors(req, res) {
  return new Promise((resolve, reject) =>
    corsMiddleware(req, res, (err) => (err ? reject(err) : resolve()))
  );
}

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
  try {
    return SMTP_FROM.value();
  } catch {
    return 'MangaTeofilo <drakenteofilo@gmail.com>';
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getUserAuthMethods(userRecord) {
  const providerIds = new Set(
    Array.isArray(userRecord?.providerData)
      ? userRecord.providerData.map((item) => String(item?.providerId || '').trim()).filter(Boolean)
      : []
  );
  return {
    userExists: Boolean(userRecord),
    hasPassword: Boolean(userRecord?.passwordHash) || providerIds.has('password') || providerIds.has('email'),
    hasGoogle: providerIds.has('google.com'),
  };
}

function profileHasRetainedHistory(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const globalEnt = profile?.userEntitlements?.global;
  const creatorEnts = profile?.userEntitlements?.creators;
  const hasCreatorEnts =
    creatorEnts && typeof creatorEnts === 'object' && Object.keys(creatorEnts).length > 0;
  return Boolean(
    creatorAccessIsApprovedFromDb(profile) ||
      profile?.creator ||
      profile?.creatorApplication ||
      globalEnt?.memberUntil ||
      globalEnt?.isPremium === true ||
      hasCreatorEnts ||
      profile?.ultimoPedidoId ||
      profile?.lastOrderId ||
      profile?.totalSpentBRL ||
      profile?.pedidos ||
      profile?.notifications
  );
}

function loginCodeKey(email) {
  return normalizeEmail(email)
    .replace(/\./g, '_DOT_')
    .replace(/@/g, '_AT_')
    .replace(/#/g, '_HASH_')
    .replace(/\$/g, '_DOLLAR_')
    .replace(/\[/g, '_LB_')
    .replace(/\]/g, '_RB_');
}

const LOGIN_CODE_EMAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_CODE_EMAIL_MAX = 6;
const LOGIN_CODE_IP_WINDOW_MS = 60 * 60 * 1000;
const LOGIN_CODE_IP_MAX = 30;
const LOGIN_VERIFY_EMAIL_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_VERIFY_EMAIL_MAX = 12;
const LOGIN_VERIFY_IP_WINDOW_MS = 60 * 60 * 1000;
const LOGIN_VERIFY_IP_MAX = 60;

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

async function assertVerifyLoginCodeRateLimits(db, emailKey, req) {
  const ipKey = loginRateLimitIpKey(req);
  const okIp = await consumeLoginCodeRateSlot(
    db.ref(`rateLimits/loginCodeVerifyIp/${ipKey}`),
    LOGIN_VERIFY_IP_WINDOW_MS,
    LOGIN_VERIFY_IP_MAX
  );
  if (!okIp) {
    const err = new Error('RATE_LIMIT');
    err.code = 'RATE_LIMIT';
    throw err;
  }
  const okEmail = await consumeLoginCodeRateSlot(
    db.ref(`rateLimits/loginCodeVerifyEmail/${emailKey}`),
    LOGIN_VERIFY_EMAIL_WINDOW_MS,
    LOGIN_VERIFY_EMAIL_MAX
  );
  if (!okEmail) {
    const err = new Error('RATE_LIMIT');
    err.code = 'RATE_LIMIT';
    throw err;
  }
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body || {};
}

function extractStoragePathFromDownloadUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/o\/([^?]+)/i);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

function resolveStoragePathFromPathOrUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    return extractStoragePathFromDownloadUrl(raw);
  }
  return raw.replace(/^\/+/, '');
}

function collectOwnedCreatorProfileStoragePaths(uid, profile = {}, publicProfile = {}) {
  const candidates = [
    profile?.userAvatar,
    profile?.readerProfileAvatarUrl,
    profile?.creatorProfile?.avatarUrl,
    publicProfile?.userAvatar,
    publicProfile?.readerProfileAvatarUrl,
    publicProfile?.creatorProfile?.avatarUrl,
  ];

  return [...new Set(
    candidates
      .map(resolveStoragePathFromPathOrUrl)
      .filter((path) => path.startsWith(`creator_profile/${uid}/`))
  )];
}

async function deleteCreatorProfileStorageArtifacts(uid, profile = {}, publicProfile = {}) {
  const bucket = getStorage().bucket();
  const explicitPaths = collectOwnedCreatorProfileStoragePaths(uid, profile, publicProfile);
  await Promise.allSettled(explicitPaths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
  await bucket.deleteFiles({ prefix: `creator_profile/${uid}/`, force: true });
}

async function deleteUserEverywhere(uid, profile = null, publicProfile = null) {
  const db = getDatabase();
  await deleteCreatorProfileStorageArtifacts(uid, profile || {}, publicProfile || {});
  try {
    await getAuth().deleteUser(uid);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
  }
  await db.ref(`usuarios/${uid}`).remove();
  await db.ref(`usuarios/${uid}/publicProfile`).remove();
  logger.info(`Usuario removido: ${uid}`);
}

const EMAIL_BRAND_TITLE = 'MangaTeofilo';
const EMAIL_BRAND_TAGLINE = 'Sua plataforma de mangás favorita';

function buildLoginEmailHtml(code, isNewUser) {
  return `<!DOCTYPE html>
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
  </html>`;
}

export const cleanupUsers = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'America/Sao_Paulo',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const db = getDatabase();
    const snapshot = await db.ref('usuarios').get();
    if (!snapshot.exists()) {
      logger.info('Nenhum usuario para analisar.');
      return;
    }

    const now = Date.now();
    const users = snapshot.val() || {};
    let scanned = 0;
    let markedInactive = 0;
    let removedExpired = 0;
    let removedInactive = 0;

  for (const [uid, profile] of Object.entries(users)) {
    scanned += 1;
    const status = profile?.status || 'ativo';
    const createdAt = Number(profile?.createdAt || 0);
    const lastLogin = Number(profile?.lastLogin || createdAt || 0);

      if (status === 'pendente' && createdAt > 0 && now - createdAt > PENDING_TTL_MS) {
        await db.ref(`usuarios/${uid}/status`).set('inativo');
        markedInactive += 1;
        continue;
      }
      if (status === 'inativo' && createdAt > 0 && now - createdAt > PENDING_TTL_MS + INATIVO_TTL_MS) {
        const publicProfileSnap = await db.ref(`usuarios/${uid}/publicProfile`).get();
        await deleteUserEverywhere(uid, profile, publicProfileSnap.val() || {});
        removedExpired += 1;
        continue;
      }
      if (status === 'ativo' && lastLogin > 0 && now - lastLogin > INACTIVE_TTL_MS) {
        if (profileHasRetainedHistory(profile)) {
          await db.ref(`usuarios/${uid}`).update({
            status: 'inativo',
            inactiveMarkedAt: now,
            cleanupSkipReason: 'retained_history',
          });
          markedInactive += 1;
          continue;
        }
        const publicProfileSnap = await db.ref(`usuarios/${uid}/publicProfile`).get();
        await deleteUserEverywhere(uid, profile, publicProfileSnap.val() || {});
        removedInactive += 1;
      }
    }

    logger.info('Limpeza concluida', { scanned, markedInactive, removedExpired, removedInactive });
  }
);

export const sendLoginCode = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async (req, res) => {
    await handleCors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Método não permitido.' }); return; }

    try {
      const body = parseBody(req);
      const { email } = body;
      const signupExplicit = body.signup === true || body.signup === 'true';
      const normEmail = normalizeEmail(email);
      if (!normEmail || !normEmail.includes('@') || !normEmail.includes('.')) {
        res.status(400).json({ ok: false, error: 'E-mail inválido.' });
        return;
      }

      let userRecord = null;
      try {
        userRecord = await getAuth().getUserByEmail(normEmail);
      } catch (authErr) {
        if (authErr?.code !== 'auth/user-not-found') throw authErr;
      }
      const { userExists, hasPassword, hasGoogle } = getUserAuthMethods(userRecord);
      if (!userExists && !signupExplicit) {
        res.status(400).json({
          ok: false,
          code: 'NO_AUTH_USER',
          error: 'Nenhuma conta com este e-mail. Use login com Google se foi assim que entrou, ou toque em criar conta para receber o código.',
        });
        return;
      }
      if (userExists && signupExplicit) {
        const code = hasGoogle && !hasPassword ? 'GOOGLE_ONLY_AUTH' : 'ACCOUNT_ALREADY_EXISTS';
        const error =
          hasGoogle && !hasPassword
            ? 'Este e-mail já está vinculado a login com Google. Use "Conectar com Google" para entrar.'
            : 'Este e-mail já possui conta. Entre com sua senha ou use o método já vinculado.';
        res.status(409).json({
          ok: false,
          code,
          error,
          userExists,
          hasPassword,
          hasGoogle,
        });
        return;
      }
      if (userExists && !signupExplicit && hasGoogle && !hasPassword) {
        res.status(409).json({
          ok: false,
          code: 'GOOGLE_ONLY_AUTH',
          error: 'Este e-mail já está vinculado a login com Google. Use "Conectar com Google" para entrar.',
        });
        return;
      }

      const db = getDatabase();
      try {
        await assertLoginCodeRateLimits(db, loginCodeKey(normEmail), req);
      } catch (rlErr) {
        if (rlErr?.code === 'RATE_LIMIT') {
          res.status(429).json({ ok: false, error: 'Muitas solicitações. Aguarde antes de pedir outro código.' });
          return;
        }
        throw rlErr;
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const now = Date.now();
      await db.ref(`loginCodes/${loginCodeKey(normEmail)}`).set({
        email: normEmail,
        code,
        createdAt: now,
        expiresAt: now + 10 * 60 * 1000,
        attempts: 0,
      });

      const isNewUser = !userExists;

      await getTransporter().sendMail({
        from: getSmtpFrom(),
        to: normEmail,
        subject: isNewUser ? 'Seu código para cadastrar no MangaTeofilo' : 'Seu código de acesso ao MangaTeofilo',
        text: `Seu código de acesso é: ${code}\n\nEle vale por 10 minutos. Não compartilhe.\n\nSe não pediu, ignore.`,
        html: buildLoginEmailHtml(code, isNewUser),
      });

      logger.info(`Código enviado para ${normEmail} | novo: ${isNewUser}`);
      res.status(200).json({ ok: true, isNewUser, userExists, hasPassword, hasGoogle });
    } catch (err) {
      logger.error('Erro em sendLoginCode:', err?.message || String(err));
      res.status(500).json({ ok: false, error: 'Falha ao enviar código. Tente novamente.' });
    }
  }
);

export const verifyLoginCode = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    await handleCors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Método não permitido.' }); return; }

    try {
      const { email, code } = parseBody(req);
      const normEmail = normalizeEmail(email);
      const codeStr = String(code || '').trim();

      if (!normEmail || !normEmail.includes('@') || codeStr.length !== 6) {
        res.status(400).json({ ok: false, error: 'Dados inválidos.' });
        return;
      }

      const db = getDatabase();
      try {
        await assertVerifyLoginCodeRateLimits(db, loginCodeKey(normEmail), req);
      } catch (rlErr) {
        if (rlErr?.code === 'RATE_LIMIT') {
          res.status(429).json({ ok: false, error: 'Muitas tentativas de validação. Aguarde antes de tentar novamente.' });
          return;
        }
        throw rlErr;
      }
      const cRef = db.ref(`loginCodes/${loginCodeKey(normEmail)}`);
      const snap = await cRef.get();

      if (!snap.exists()) {
        res.status(400).json({ ok: false, error: 'Código inválido ou expirado.' });
        return;
      }

      const dados = snap.val() || {};
      const now = Date.now();
      const attempts = Number(dados.attempts || 0);

      if (!dados.expiresAt || now > Number(dados.expiresAt)) {
        await cRef.remove();
        res.status(400).json({ ok: false, error: 'Código expirado. Peça um novo.' });
        return;
      }
      if (attempts >= 5) {
        await cRef.remove();
        res.status(429).json({ ok: false, error: 'Muitos erros. Peça um novo código.' });
        return;
      }
      if (dados.code !== codeStr) {
        await cRef.update({ attempts: attempts + 1 });
        res.status(400).json({ ok: false, error: `Código incorreto. ${4 - attempts} tentativa(s) restante(s).` });
        return;
      }

      await cRef.remove();
      let userRecord = null;
      try {
        userRecord = await getAuth().getUserByEmail(normEmail);
      } catch (err) {
        if (err?.code !== 'auth/user-not-found') throw err;
      }
      const { userExists, hasPassword, hasGoogle } = getUserAuthMethods(userRecord);
      const isNewUser = !userExists;

      if (!isNewUser && hasGoogle && !hasPassword) {
        res.status(409).json({
          ok: false,
          code: 'GOOGLE_ONLY_AUTH',
          error: 'Este e-mail já está cadastrado com login pelo Google. Use "Conectar com Google".',
        });
        return;
      }

      logger.info(`Código verificado para ${normEmail} | novo: ${isNewUser}`);
      res.status(200).json({ ok: true, isNewUser, userExists, hasPassword, hasGoogle });
    } catch (err) {
      logger.error('Erro em verifyLoginCode:', err?.message || String(err));
      res.status(500).json({ ok: false, error: 'Falha ao validar código. Tente novamente.' });
    }
  }
);

