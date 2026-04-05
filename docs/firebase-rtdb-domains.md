# RTDB Domains - MangaTeofilo

## Objetivo

Dar um mapa de manutencao do Realtime Database para evitar que novas rules virem um amontoado de excecoes.

## Dominios principais

### 1. Auth e antispam

Paths:

- `loginCodes/*`
- `rateLimits/*`
- `usernames/*`
- `admins/registry/*`

Regra:

- nunca gravavel direto pelo cliente, exceto reserva de `usernames/*` pelo proprio dono
- qualquer fluxo novo de login, onboarding ou rate limit deve preferir Cloud Functions

### 2. Catalogo publico

Paths:

- `obras/*`
- `capitulos/*`
- `stats/contador`

Regra:

- leitura publica
- escrita de obra/capitulo so por creator dono ou admin global
- contadores agregados (`viewsCount`, `likesCount`, `commentsCount`) nao devem ser escritos direto pelo cliente

### 3. Perfil privado do usuario

Paths:

- `usuarios/{uid}/*`

Regra:

- usuario le e escreve o proprio perfil base
- campos sensiveis/derivados (`userEntitlements`, `notifications`, `engagementCycle`, `creatorApplication`, `creatorCompliance`) ficam somente com backend
- overrides administrativos usam o mesmo contexto:
  - `admins/registry`
  - `usuarios/{uid}.role == admin`
  - `auth.token.admin`
  - `panelRole` admin/super_admin

### 4. Perfil publico

Paths:

- `usuarios_publicos/{uid}/*`

Regra:

- leitura publica
- escrita do proprio usuario apenas nos campos publicos que nao quebram integridade
- espelhos de creator, stats publicas, favoritos publicos e boosts devem ser tratados como dados derivados pelo backend sempre que possivel

### 5. Creator financeiro e analytics

Paths:

- `creatorData/{creatorUid}/*`
- `creators/{creatorId}/*`
- `creatorStatsDaily/{creatorId}/*`
- `creatorAudienceSeen/{creatorId}/*`

Regra:

- creator acessa os proprios dados
- admin global acessa tudo
- escrita financeira e analytics consolidada deve ser backend-only
- se surgir novo path de analytics, seguir o mesmo padrao de leitura admin/creator e escrita bloqueada ao cliente

### 6. Loja e pedidos

Paths:

- `loja/config`
- `loja/produtos/*`
- `loja/carrinhos/{uid}/*`
- `loja/pedidos/*`
- `loja/printOnDemandOrders/*`

Regra:

- catalogo de produtos publico
- carrinho e perfil de compra gravaveis so pelo proprio usuario
- pedidos e configuracao da loja ficam em fluxo backend/admin
- creator so escreve produto proprio quando a regra do dominio permitir

### 7. Retencao e leitura

Paths:

- `workRetention/*`
- `workRetentionRaw/*`

Regra:

- leitura consolidada para creator dono da obra ou admin global
- escrita apenas backend
- dados crus por viewer nao devem voltar a ser escritos pelo cliente

## Regra de manutencao

- nao reintroduzir hardcode de UID/email nas rules
- qualquer override administrativo novo deve usar o mesmo contexto admin global
- quando uma regra ficar longa demais, priorizar mover o fluxo para Cloud Functions em vez de empilhar excecoes no cliente
- manter os paths derivados claramente separados dos campos editaveis pelo usuario
- legado de memberships por creator deve ser tratado apenas como compatibilidade temporaria; a fonte canônica é `usuarios/{uid}/userEntitlements/creators`
