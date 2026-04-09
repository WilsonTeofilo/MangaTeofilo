# Legacy Freeze Checklist

## Runtime ativo

- `functions/index.js` exporta apenas mÃ³dulos ativos.
- `functions/deprecated/index.js` foi removido; o runtime nÃ£o depende mais desse ponteiro.
- o runtime nÃ£o deve depender de `legacyIndex.js`.

## Fontes canÃ´nicas

- roles efetivos: `src/auth/appRoles.js`
- creator stats: `creators/{uid}/stats`
- monetizaÃ§Ã£o do creator: `usuarios/{uid}/creator/monetization/*`
- trilha MP: `financas/mp_webhook_payments`
- obra pÃºblica: `/work/:slug`
- landing institucional Kokuin: `/kokuin`

## Espelhos permitidos

- `usuarios/{uid}/creatorProfile/*`: apenas espelho/UI
- `usuarios/{uid}/publicProfile/*`: apenas projeÃ§Ã£o pÃºblica
- seller de pedido da loja: nunca recebe endereÃ§o completo do comprador

## Legado proibido no fluxo vivo

- `pending_review`
- `creatorMonetizationApprovedOnce`
- `mp_processed`
- fallback automÃ¡tico para `shito`
- perfil pÃºblico duplicado em JSX

## Regra para manutenÃ§Ã£o/backfill

- se nÃ£o houver inferÃªncia segura, pular e diagnosticar
- nunca inventar creator/work legado para â€œtampar buracoâ€
- nunca usar espelho pÃºblico como fonte de verdade
- qualquer limpeza deve convergir para o canÃ´nico e apagar campo legado
- qualquer retomada de checkout deve passar pelo backend vivo
