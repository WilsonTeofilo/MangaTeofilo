import { getAuth } from 'firebase-admin/auth';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import nodemailer from 'nodemailer';
import { pushUserNotification } from '../notificationPush.js';

export const SMTP_HOST = defineSecret('SMTP_HOST');
export const SMTP_PORT = defineSecret('SMTP_PORT');
export const SMTP_USER = defineSecret('SMTP_USER');
export const SMTP_PASS = defineSecret('SMTP_PASS');
export const SMTP_FROM = defineSecret('SMTP_FROM');

let transporterCache = null;

export function getTransporter() {
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

export function getSmtpFrom() {
  try {
    return SMTP_FROM.value();
  } catch {
    return 'MangaTeofilo <drakenteofilo@gmail.com>';
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
    chapterReleasesInApp: true,
    chapterReleasesEmail: false,
    promotionsInApp: true,
    promotionsEmail: prefs?.promotionsEmail === true || profile?.notifyPromotions === true,
    creatorLifecycleInApp: true,
    creatorLifecycleEmail: false,
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

export async function notifyUserByPreference(db, uid, profile, config) {
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
      logger.error('pushUserNotification falhou (in-app)', {
        uid,
        kind,
        err: err?.message || String(err),
      });
    }
  }

  if (canEmail && config.email) {
    await sendEmailToUser(uid, config.email);
  }
}
