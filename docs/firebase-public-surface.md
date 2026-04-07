# SuperfÃ­cie pÃºblica Firebase (Storage + RTDB)

## Storage: `capas/`, `manga/`, `obras/`

- **Leitura**: `capas/{ownerUid}/{fileName}` Ã© **pÃºblica** (`allow read: if true`). `manga/` e `obras/` permitem leitura a quem conhece o path (nÃ£o listagem de bucket).
- **Enumerabilidade**: segmentos `ownerUid` e `obra` sÃ£o validados (`isSafeSegment`), mas **nÃ£o sÃ£o secretos**. Um agente pode iterar UIDs curtos ou slugs conhecidos.
- **MitigaÃ§Ã£o**: use **nomes de ficheiro longos e imprevisÃ­veis** quando o conteÃºdo nÃ£o deva ser adivinhado; nÃ£o coloque dados sensÃ­veis sÃ³ atrÃ¡s do path.
- **Escrita**: apenas dono do segmento (`request.auth.uid == ownerUid`) ou staff (`isShitoAdmin` / painel admin).

## Realtime Database: `usuarios/{uid}/publicProfile`

- **`.read`**: `true` â€” perfil pÃºblico intencional (vitrine criador / leitor).
- **Campos expostos** (validados nas rules; nÃ£o incluir PII sensÃ­vel no futuro):
  - Identidade leve: `userName`, `userHandle`, `userAvatar`, `uid`
  - Criador: `creatorDisplayName`, `creatorBio`, redes (`instagramUrl`, `youtubeUrl`), `creatorBannerUrl`, preferÃªncias de monetizaÃ§Ã£o / vitrine (`creatorMonetization*`, `creatorStatus`, `signupIntent`)
  - Contadores: `followers`, `followersCount`, `stats/*` (escrita sÃ³ servidor)
  - Engagement espelhado: `engagementBoostMul`, `engagementBoostUntil`, `engagementBadgeTier` (escrita servidor)
  - Leitor pÃºblico: `readerProfilePublic`, `readerProfileAvatarUrl`, `readerSince`, `readerFavorites` (metadados de obras favoritas â€” tÃ­tulo, capa, slug)
- **NÃ£o colocar aqui**: e-mail, telefone, CPF, endereÃ§o, documentos, tokens, dados de compra.

## Chefes (UIDs / e-mails) nas rules

- Lista canÃ³nica: **`shared/platformStaffAllowlist.json`**
- ApÃ³s alterar: `npm run security:sync-staff-rules` (regenera expressÃµes em `database.rules.json` e `storage.rules`).
- O mesmo ficheiro alimenta `src/constants.js` e `functions/adminRbac.js` â€” evitar drift manual.
