// src/constants.js
// ============================================================
// CONSTANTES GLOBAIS DO PROJETO SHITO
// Altere aqui e reflete em todo o app automaticamente
// ============================================================

/** UIDs com acesso administrativo (Firebase Auth). */
export const ADMIN_UIDS = [
  "n5JTPLsxpyQPeC5qQtraSrBa4rG3",
  "QayqN0MpBTQK6je44JwAXWapoQU2",
  "20kR47W8PfTGIvGxGOGRsB2JiFA3",
];

export const ADMIN_EMAILS = [
  "wilsonteofilosouza@live.com",
  "drakenteofilo@gmail.com",
];

export const isAdminUser = (user) => {
  if (!user) return false;
  const email = (user.email || "").toLowerCase();
  return ADMIN_UIDS.includes(user.uid) || ADMIN_EMAILS.includes(email);
};

export const LISTA_AVATARES = Array.from(
  { length: 17 },
  (_, i) => `/assets/avatares/ava${i + 1}.webp`
);

export const AVATAR_FALLBACK = "/assets/avatares/ava1.webp";

