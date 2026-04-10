# Legacy Freeze Checklist

## Runtime ativo

- `functions/index.js` exporta apenas módulos ativos.
- `functions/deprecated/index.js` foi removido; o runtime não depende mais desse ponteiro.
- O runtime não deve depender de `legacyIndex.js`.

## Fontes canônicas

- roles efetivos: `src/auth/appRoles.js`
- creator stats: `creators/{uid}/stats`
- monetização do creator: `usuarios/{uid}/creator/monetization/*`
- trilha Mercado Pago: `financas/mp_webhook_payments`
- obra pública: `/work/:slug`
- landing institucional Kokuin: `/kokuin`

## Espelhos permitidos

- `usuarios/{uid}/creatorProfile/*`: apenas espelho de UI
- `usuarios/{uid}/publicProfile/*`: apenas projeção pública
- seller de pedido da loja: nunca recebe endereço completo do comprador

## Legado proibido no fluxo vivo

- `pending_review`
- `creatorMonetizationApprovedOnce`
- `mp_processed`
- fallback automático para `shito`
- perfil público duplicado em JSX

## Regra para manutenção e backfill

- Se não houver inferência segura, pular e diagnosticar.
- Nunca inventar creator/work legado para tampar buraco.
- Nunca usar espelho público como fonte de verdade.
- Qualquer limpeza deve convergir para o canônico e apagar campo legado.
- Qualquer retomada de checkout deve passar pelo backend vivo.
