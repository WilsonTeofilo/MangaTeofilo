# Refactor Report - 2026-04-04

## Objetivo

Reduzir o risco de deploy e cold start do backend Firebase Functions, tirando o `index.js` da função de "Deus do sistema" e transformando-o em um registrador enxuto.

## O que foi feito

### Nova estrutura por domínio

- `functions/admin/index.js`
- `functions/payments/index.js`
- `functions/orders/index.js`
- `functions/creator/index.js`
- `functions/notifications/index.js`
- `functions/engagement/index.js`
- `functions/system/index.js`
- `functions/utils/index.js`
- `functions/deprecated/index.js`
- `functions/deprecated/legacyIndex.js`

### Novo papel do `functions/index.js`

O arquivo agora só reexporta registradores por domínio:

- `admin`
- `payments`
- `orders`
- `creator`
- `notifications`
- `engagement`
- `system`

Sem helpers locais, sem lógica de negócio, sem inicialização manual adicional.

### Preservação de contratos públicos

Os nomes de exports em produção foram mantidos.

Exemplos:

- `mercadopagowebhook`
- `criarCheckoutPremium`
- `createPrintOnDemandCheckout`
- `adminDashboardResumo`
- `creatorSubmitApplication`
- `notifyNewChapter`
- `markUserNotificationRead`

Nenhuma function foi renomeada nesta refatoração estrutural.

### Legado isolado

O monólito antigo foi preservado em:

- `functions/deprecated/legacyIndex.js`

Esse arquivo continua sendo a fonte de várias functions ainda não extraídas por domínio interno completo.

### Extrações reais já concluídas

Saíram do legado e foram para módulos próprios:

- `functions/system/auth.js`
  - `cleanupUsers`
  - `sendLoginCode`
  - `verifyLoginCode`

- `functions/notifications/userNotifications.js`
  - `markUserNotificationRead`
  - `deleteUserNotification`
  - `upsertNotificationSubscription`

- `functions/engagement/readerProfiles.js`
  - `onReaderFavoriteCanonChanged`
  - `onReaderFavoriteLegacyChanged`
  - `onReaderLikedWorkChanged`
  - `onReaderPublicProfileSettingsChanged`

- `functions/engagement/chapterLikes.js`
  - `toggleChapterLike`

- `functions/orders/maintenance.js`
  - `adminBackfillCanonicalOrderStatuses`

- `functions/orders/storeViewer.js`
  - `quoteStoreShipping`
  - `adminListVisibleStoreOrders`
  - `listMyStoreOrders`
  - `getStoreOrderForViewer`
  - `adminUpdateVisibleStoreOrder`

- `functions/orders/storeCommon.js`
  - helpers compartilhados de status, perfil de compra, quote e sanitização de pedido

### Regras e cliente endurecidos

- o cliente deixou de curtir capítulo direto no RTDB e passou a usar `toggleChapterLike`
- `database.rules.json` agora bloqueia escrita direta em:
  - `capitulos/*/likesCount`
  - `capitulos/*/usuariosQueCurtiram/*`
- o frontend deixou de ler `creatorMemberships` como fallback em `src/auth/userEntitlements.js`

### Scripts de backend

`functions/package.json` agora expõe:

- `serve`: `firebase emulators:start --only functions`
- `lint`: verificação sintática de `index.js` e `deprecated/legacyIndex.js`

## Validação executada

- `node --check functions/index.js`
- `node --check functions/deprecated/legacyIndex.js`
- `node --check` dos módulos novos em `functions/system`, `functions/notifications`, `functions/engagement` e `functions/orders`
- import real de `./functions/index.js`
- import real de `./functions/deprecated/legacyIndex.js`
- `npm run build` na raiz

## Problemas encontrados

### 1. Monólito legado ainda concentra lógica crítica

Arquivo:

- `functions/deprecated/legacyIndex.js`

Situação:

- Ainda contém a maior parte da lógica operacional do sistema.
- Continua inicializando helpers e definindo dezenas de handlers no mesmo arquivo.

Impacto:

- cold start ainda pode continuar pesado
- debugging continua difícil
- qualquer regressão interna nesse arquivo pode afetar múltiplos domínios ao mesmo tempo

### 2. Modularização atual é estrutural, não total

Situação:

- Os novos registradores por domínio já existem.
- Parte deles ainda reexporta functions do monólito legado.

Impacto:

- a arquitetura externa melhorou
- a arquitetura interna ainda precisa de extração progressiva

### 3. Legado funcional ainda depende de um único arquivo grande

Situação:

- Payments, admin, engagement, creator e parte de notifications ainda puxam exports do legado.

Impacto:

- o `index.js` deixou de ser o gargalo visual e estrutural
- o gargalo de implementação ainda existe no `legacyIndex.js`

### 4. Risco de load pesado continua onde houver imports desnecessários

Situação:

- O registrador novo é leve.
- O custo real continua nos módulos que reexportam o legado.

Impacto:

- melhora de organização: alta
- melhora imediata de cold start: parcial

## Riscos que continuam vivos

### 1. Cold start ainda não está totalmente resolvido

Motivo:

- `deprecated/legacyIndex.js` continua grande e altamente acoplado.

### 2. Qualquer erro de sintaxe/import no legado ainda derruba vários domínios

Motivo:

- múltiplos registradores dependem do mesmo arquivo legado.

### 3. Deploy continua sensível se alguém voltar a colocar lógica no `functions/index.js`

Motivo:

- a disciplina arquitetural agora precisa ser mantida.

## Próximas extrações recomendadas

### Fase 1

Já concluída:

- auth/login
- notificações do usuário
- espelho público de leitor/favoritos
- canonical entitlements
- like de capítulo no backend
- backfill de status
- pedidos visíveis/cotação da loja

### Fase 2

- payments
  - `criarCheckoutApoio`
  - `criarCheckoutPremium`
  - `criarCheckoutLoja`
  - `createPrintOnDemandCheckout`
  - `resumePrintOnDemandCheckout`
  - `mercadopagowebhook`
  - `obterOfertaPremiumPublica`
  - `registrarAttributionEvento`
  - `assinaturasPremiumDiario`

### Fase 3

- creator/admin
  - aplicações
  - aprovação monetização
  - payout manual
  - dashboards
  - backfills

### Fase 4

- notifications de lançamento
  - `notifyNewChapter`
  - `notifyScheduledChapterReleases`
  - `notifyNewWorkPublished`

- engagement cycle core
  - `mirrorEngagementCycleToPublicProfile`
  - `onCreatorStatsForEngagementChanged`
  - `onLegacyCreatorStatsForEngagementChanged`
  - `onChapterEngagementSourceChanged`
  - `commitCreatorEngagementCycleTick`
  - `adminBackfillEngagementPublicProfiles`

## Regras para próximas mudanças

- não adicionar lógica ao `functions/index.js`
- não executar chamadas ao banco no topo dos arquivos
- manter helpers puros fora dos handlers
- extrair por domínio sem alterar nomes públicos de functions
- mover restos obsoletos para `functions/deprecated`
