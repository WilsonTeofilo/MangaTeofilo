// src/constants.js
// ============================================================
// Constantes globais - MangaTeofilo
// ============================================================

export const LISTA_AVATARES = Array.from(
  { length: 17 },
  (_, i) => `/assets/avatares/ava${i + 1}.webp`
);

export const AVATAR_FALLBACK = "/assets/avatares/ava1.webp";

/** Apelido exibido quando o usuario ainda nao definiu nome. */
export const DEFAULT_USER_DISPLAY_NAME = 'Leitor';

/** Nome de exibicao (cadastro / perfil). */
export const DISPLAY_NAME_MAX_LENGTH = 60;

/** Bio publica do criador (perfil + candidatura). */
export const CREATOR_BIO_MIN_LENGTH = 24;
/** Bio minima para publicar sem monetizacao. */
export const CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY = 24;
export const CREATOR_BIO_MAX_LENGTH = 450;

/** Membership do autor (acesso antecipado as obras dele): faixa em R$ definida no perfil. */
export const CREATOR_MEMBERSHIP_PRICE_MIN_BRL = 7;
export const CREATOR_MEMBERSHIP_PRICE_MAX_BRL = 18;
