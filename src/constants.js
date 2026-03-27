// src/constants.js
// ============================================================
// CONSTANTES GLOBAIS DO PROJETO SHITO
// Altere aqui e reflete em todo o app automaticamente
// ============================================================

export const ADMIN_UID = "n5JTPLsxpyQPeC5qQtraSrBa4rG3";
export const ADMIN_EMAILS = ["wilsonteofilosouza@live.com"];

export const isAdminUser = (user) => {
  if (!user) return false;
  const email = (user.email || "").toLowerCase();
  return user.uid === ADMIN_UID || ADMIN_EMAILS.includes(email);
};

export const LISTA_AVATARES = Array.from(
  { length: 17 },
  (_, i) => `/assets/avatares/ava${i + 1}.webp`
);

export const AVATAR_FALLBACK = "/assets/avatares/ava1.webp";

