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

