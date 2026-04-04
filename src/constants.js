// src/constants.js
// ============================================================
// Constantes globais — MangaTeofilo
// ============================================================
//
// Chefes da plataforma: fonte única em shared/platformStaffAllowlist.json
// (sincroniza RTDB + Storage rules com `npm run security:sync-staff-rules`).

import platformStaffAllowlist from '../shared/platformStaffAllowlist.json';

/** UIDs com acesso administrativo (Firebase Auth). */
export const ADMIN_UIDS = platformStaffAllowlist.uids;

/** E-mails tratados como chefes no cliente (alinhados ao allowlist). */
export const ADMIN_EMAILS = platformStaffAllowlist.emails;

export const isAdminUser = (user) => {
  if (!user) return false;
  const email = (user.email || "").toLowerCase();
  return ADMIN_UIDS.includes(user.uid) || ADMIN_EMAILS.includes(email);
};

/** Dono legado de obras/capítulos sem `creatorId` no RTDB (primeiro super-admin). */
export const PLATFORM_LEGACY_CREATOR_UID = ADMIN_UIDS[0];

/** Nome público quando a obra usa o UID legado e não há perfil em `usuarios_publicos`. */
export const PLATFORM_LEGACY_CREATOR_DISPLAY_NAME = 'MangaTeofilo';

export const LISTA_AVATARES = Array.from(
  { length: 17 },
  (_, i) => `/assets/avatares/ava${i + 1}.webp`
);

export const AVATAR_FALLBACK = "/assets/avatares/ava1.webp";

/** Apelido exibido quando o usuário ainda não definiu nome (substitui o legado «Guerreiro»). */
export const DEFAULT_USER_DISPLAY_NAME = 'Leitor';

/** Nome de exibição (cadastro / perfil). */
export const DISPLAY_NAME_MAX_LENGTH = 60;

/** Bio pública do criador (perfil + candidatura). */
/** Bio mínima quando o criador opta por monetização (revisão / compliance). */
export const CREATOR_BIO_MIN_LENGTH = 24;
/** Bio mínima para publicar sem monetização (entrada leve como autor). */
export const CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY = 24;
export const CREATOR_BIO_MAX_LENGTH = 450;

/** Membership do autor (acesso antecipado às obras dele): faixa em R$ que só o criador define no perfil. */
export const CREATOR_MEMBERSHIP_PRICE_MIN_BRL = 7;
export const CREATOR_MEMBERSHIP_PRICE_MAX_BRL = 18;

