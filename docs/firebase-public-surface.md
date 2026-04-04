# Superfície pública Firebase (Storage + RTDB)

## Storage: `capas/`, `manga/`, `obras/`

- **Leitura**: `capas/{ownerUid}/{fileName}` é **pública** (`allow read: if true`). `manga/` e `obras/` permitem leitura a quem conhece o path (não listagem de bucket).
- **Enumerabilidade**: segmentos `ownerUid` e `obra` são validados (`isSafeSegment`), mas **não são secretos**. Um agente pode iterar UIDs curtos ou slugs conhecidos.
- **Mitigação**: use **nomes de ficheiro longos e imprevisíveis** quando o conteúdo não deva ser adivinhado; não coloque dados sensíveis só atrás do path.
- **Escrita**: apenas dono do segmento (`request.auth.uid == ownerUid`) ou staff (`isShitoAdmin` / painel admin).

## Realtime Database: `usuarios_publicos/{uid}`

- **`.read`**: `true` — perfil público intencional (vitrine criador / leitor).
- **Campos expostos** (validados nas rules; não incluir PII sensível no futuro):
  - Identidade leve: `userName`, `userHandle`, `userAvatar`, `uid`
  - Criador: `creatorDisplayName`, `creatorBio`, redes (`instagramUrl`, `youtubeUrl`), `creatorBannerUrl`, preferências de monetização / vitrine (`creatorMonetization*`, `creatorStatus`, `signupIntent`)
  - Contadores: `followers`, `followersCount`, `stats/*` (escrita só servidor)
  - Engagement espelhado: `engagementBoostMul`, `engagementBoostUntil`, `engagementBadgeTier` (escrita servidor)
  - Leitor público: `readerProfilePublic`, `readerProfileAvatarUrl`, `readerSince`, `readerFavorites` (metadados de obras favoritas — título, capa, slug)
- **Não colocar aqui**: e-mail, telefone, CPF, endereço, documentos, tokens, dados de compra.

## Chefes (UIDs / e-mails) nas rules

- Lista canónica: **`shared/platformStaffAllowlist.json`**
- Após alterar: `npm run security:sync-staff-rules` (regenera expressões em `database.rules.json` e `storage.rules`).
- O mesmo ficheiro alimenta `src/constants.js` e `functions/adminRbac.js` — evitar drift manual.
