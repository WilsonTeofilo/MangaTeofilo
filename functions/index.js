import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { onValueCreated } from 'firebase-functions/v2/database';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import nodemailer from 'nodemailer';

initializeApp();

const PENDING_TTL_MS = 40 * 60 * 1000;
const INACTIVE_TTL_MS = 8 * 30 * 24 * 60 * 60 * 1000;
const APP_BASE_URL = defineString('APP_BASE_URL', {
  default: 'https://shitoproject-ed649.web.app',
});
const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_PORT = defineSecret('SMTP_PORT');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const SMTP_FROM = defineSecret('SMTP_FROM');

let transporterCache = null;

function getTransporter() {
  if (transporterCache) return transporterCache;
  const host = SMTP_HOST.value();
  const port = Number(SMTP_PORT.value() || 587);
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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function loginCodeKey(email) {
  return encodeURIComponent(normalizeEmail(email));
}

async function deleteUserEverywhere(uid) {
  const db = getDatabase();
  try {
    await getAuth().deleteUser(uid);
  } catch (err) {
    // If user is already gone in Auth, we still clean RTDB.
    if (err?.code !== 'auth/user-not-found') {
      throw err;
    }
  }

  await db.ref(`usuarios/${uid}`).remove();
  await db.ref(`usuarios_publicos/${uid}`).remove();
  logger.info(`Usuario removido: ${uid}`);
}

export const cleanupUsers = onSchedule(
  {
    schedule: 'every 15 minutes',
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

    let removedPending = 0;
    let removedInactive = 0;
    let scanned = 0;

    for (const [uid, profile] of Object.entries(users)) {
      scanned += 1;

      const status = profile?.status || 'ativo';
      const createdAt = Number(profile?.createdAt || 0);
      const lastLogin = Number(profile?.lastLogin || createdAt || 0);

      // Regra 1: conta pendente some após 40 min.
      if (status === 'pendente' && createdAt > 0 && now - createdAt > PENDING_TTL_MS) {
        await deleteUserEverywhere(uid);
        removedPending += 1;
        continue;
      }

      // Regra 2: conta ativa só some após 8 meses sem login.
      if (status === 'ativo' && lastLogin > 0 && now - lastLogin > INACTIVE_TTL_MS) {
        await deleteUserEverywhere(uid);
        removedInactive += 1;
      }
    }

    logger.info('Limpeza concluida', {
      scanned,
      removedPending,
      removedInactive,
    });
  }
);

/**
 * Envia código de 6 dígitos para login/cadastro (fluxo tipo Kling).
 * Endpoint: /__/functions/sendLoginCode (Firebase Hosting proxy).
 */
export const sendLoginCode = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido' });
      return;
    }

    try {
      const { email } = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const normEmail = normalizeEmail(email);
      if (!normEmail || !normEmail.includes('@')) {
        res.status(400).json({ error: 'E-mail inválido.' });
        return;
      }

      const db = getDatabase();
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const now = Date.now();
      const expiresAt = now + 10 * 60 * 1000; // 10 minutos

      await db.ref(`loginCodes/${loginCodeKey(normEmail)}`).set({
        email: normEmail,
        code,
        createdAt: now,
        expiresAt,
        attempts: 0,
      });

      const auth = getAuth();
      let isNewUser = false;
      try {
        await auth.getUserByEmail(normEmail);
      } catch (err) {
        if (err?.code === 'auth/user-not-found') {
          isNewUser = true;
        } else {
          throw err;
        }
      }

      const transporter = getTransporter();
      const from = SMTP_FROM.value();
      const assunto = isNewUser
        ? 'Seu código para invocar uma nova alma em Shito'
        : 'Seu código de acesso para retornar à Tempestade';

      const texto = `
Seu código de acesso é: ${code}

Ele vale por 10 minutos. Não compartilhe este código com ninguém.

Se você não solicitou este acesso, ignore este e-mail.
`;

      const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
          <h2>Shito: Fragmentos da Tempestade</h2>
          <p>Use o código abaixo para continuar o login:</p>
          <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">${code}</p>
          <p>Ele expira em <strong>10 minutos</strong>. Não compartilhe este código com ninguém.</p>
          <hr />
          <p style="font-size: 12px; color: #666;">
            Se você não pediu este acesso, apenas ignore este e-mail.
          </p>
        </div>
      `;

      await transporter.sendMail({
        from,
        to: normEmail,
        subject: assunto,
        text: texto,
        html,
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error('Erro em sendLoginCode', { error: err?.message || String(err) });
      res.status(500).json({ error: 'Falha ao enviar código. Tente novamente.' });
    }
  }
);

/**
 * Valida código de 6 dígitos para login/cadastro.
 * Responde se o e-mail é de usuário novo ou existente.
 */
export const verifyLoginCode = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método não permitido' });
      return;
    }

    try {
      const { email, code } = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const normEmail = normalizeEmail(email);
      const codeStr = String(code || '').trim();
      if (!normEmail || !normEmail.includes('@') || codeStr.length !== 6) {
        res.status(400).json({ error: 'Dados inválidos.' });
        return;
      }

      const db = getDatabase();
      const ref = db.ref(`loginCodes/${loginCodeKey(normEmail)}`);
      const snap = await ref.get();
      if (!snap.exists()) {
        res.status(400).json({ error: 'Código inválido ou expirado.' });
        return;
      }

      const dados = snap.val() || {};
      const now = Date.now();
      if (!dados.expiresAt || now > Number(dados.expiresAt)) {
        await ref.remove();
        res.status(400).json({ error: 'Código expirado. Peça um novo.' });
        return;
      }

      const attempts = Number(dados.attempts || 0);
      if (attempts >= 5) {
        await ref.remove();
        res.status(429).json({ error: 'Muitos erros. Peça um novo código.' });
        return;
      }

      if (dados.code !== codeStr) {
        await ref.update({ attempts: attempts + 1 });
        res.status(400).json({ error: 'Código incorreto.' });
        return;
      }

      // Código OK — apaga imediatamente
      await ref.remove();

      const auth = getAuth();
      let isNewUser = false;
      try {
        await auth.getUserByEmail(normEmail);
      } catch (err) {
        if (err?.code === 'auth/user-not-found') {
          isNewUser = true;
        } else {
          throw err;
        }
      }

      res.status(200).json({ ok: true, isNewUser });
    } catch (err) {
      logger.error('Erro em verifyLoginCode', { error: err?.message || String(err) });
      res.status(500).json({ error: 'Falha ao validar código. Tente novamente.' });
    }
  }
);

export const notifyNewChapter = onValueCreated(
  {
    ref: '/capitulos/{capId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
    secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM],
  },
  async (event) => {
    const capId = event.params.capId;
    const capitulo = event.data?.val() || {};
    const titulo = capitulo?.titulo || `Capitulo ${capitulo?.numero || ''}`.trim();
    const capituloUrl = `${APP_BASE_URL.value()}/ler/${capId}`;

    const db = getDatabase();
    const usuariosSnap = await db.ref('usuarios').get();
    if (!usuariosSnap.exists()) {
      logger.info('Sem usuarios para notificar.', { capId });
      return;
    }

    const usuarios = usuariosSnap.val() || {};
    const candidatos = Object.entries(usuarios)
      .filter(([, perfil]) => perfil?.notifyNewChapter === true && perfil?.status === 'ativo')
      .map(([uid]) => uid);

    if (candidatos.length === 0) {
      logger.info('Nenhum usuario opt-in para notificacao.', { capId });
      return;
    }

    const auth = getAuth();
    const transporter = getTransporter();
    const from = SMTP_FROM.value();

    let enviados = 0;
    let ignorados = 0;
    let falhas = 0;

    for (const uid of candidatos) {
      try {
        const authUser = await auth.getUser(uid);
        const email = authUser?.email;
        const verified = authUser?.emailVerified === true;
        const disabled = authUser?.disabled === true;

        if (!email || !verified || disabled) {
          ignorados += 1;
          continue;
        }

        await transporter.sendMail({
          from,
          to: email,
          subject: `Novo capitulo no Shito: ${titulo}`,
          text: `Um novo capitulo foi lancado!\n\nTitulo: ${titulo}\nLink: ${capituloUrl}\n\nSe voce nao quiser mais receber esse aviso, desative em Perfil > Notificacoes.`,
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
              <h2>Novo capitulo no Shito</h2>
              <p>Um novo capitulo foi lancado.</p>
              <p><strong>${titulo}</strong></p>
              <p>
                <a href="${capituloUrl}" target="_blank" rel="noopener noreferrer">Ler agora</a>
              </p>
              <hr />
              <p style="font-size: 12px; color: #666;">
                Para parar de receber, desative em Perfil &gt; Notificacoes.
              </p>
            </div>
          `,
        });
        enviados += 1;
      } catch (err) {
        falhas += 1;
        logger.error('Falha ao enviar e-mail de novo capitulo.', {
          capId,
          uid,
          error: err?.message || String(err),
        });
      }
    }

    logger.info('Notificacao de novo capitulo concluida.', {
      capId,
      titulo,
      candidatos: candidatos.length,
      enviados,
      ignorados,
      falhas,
    });
  }
);
