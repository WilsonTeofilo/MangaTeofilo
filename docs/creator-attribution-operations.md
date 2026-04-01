# Creator Attribution Operations

## Legacy creator

- `PLATFORM_LEGACY_CREATOR_UID` representa o criador legado da plataforma.
- Use esse UID apenas para:
- obras antigas sem dono explícito
- capítulos antigos herdados dessas obras
- produtos antigos que não tenham `creatorId` resolvido

## Important rule

- O criador legado não deve entrar em repasse automático para terceiros.
- Quando um item cair no legado, trate como receita da plataforma até haver decisão manual.

## Backfill order

1. Obras
2. Capítulos
3. Produtos da loja
4. Auditoria de pedidos antigos sem `creatorId`

## Mercado Pago / ledger expectations

- Apoio com `attributionCreatorId` grava em `creatorData/{creatorId}/payments`
- Premium atribuído grava em `creatorData/{creatorId}/subscriptions` e também em `payments`
- Loja grava por item com `creatorId` consolidado por pedido
- Reembolso, chargeback, cancelamento e rejeição geram ajuste negativo no ledger
- `paymentId` deve ser tratado como chave idempotente do fluxo financeiro

## Manual checklist

- Login normal funciona
- Leitor bloqueado leva para apoio com criador correto
- Página de obra leva para apoio com criador correto
- `/apoie/criador/:uid` preserva query params e cai em `/apoie?creatorId=...`
- Apoio simples abre checkout com atribuição quando houver `creatorId`
- Premium abre checkout com atribuição quando houver `creatorId`
- Loja grava `creatorId` por item no pedido quando o produto tiver dono
- Webhook aprovado registra evento e ledger uma única vez
- Webhook de refund/chargeback registra ajuste negativo
- Mangaká só lê `creatorData/{seuUid}`
- Mangaká não acessa dados de outro criador nem pedidos globais da loja

## Operational notes

- Pedidos antigos sem `creatorId` continuam válidos como histórico
- Não faça retroatribuição automática de pedidos legados sem critério manual
- Antes de habilitar repasse real, definir:
- fórmula de cálculo
- janela de fechamento
- mínimo para saque
- exportação/CSV oficial
- conciliação com extrato do Mercado Pago
