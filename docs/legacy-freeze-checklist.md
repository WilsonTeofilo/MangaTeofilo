# Legacy Freeze Checklist

## Runtime ativo

- `functions/index.js` exporta apenas módulos ativos.
- `functions/deprecated/index.js` não reexporta monólito legado.
- o runtime não deve depender de `legacyIndex.js`.

## Fontes canônicas

- roles efetivos: `src/auth/appRoles.js`
- creator stats: `creators/{uid}/stats`
- monetização do creator: `usuarios/{uid}/creator/monetization/*`
- trilha MP: `financas/mp_webhook_payments`
- obra pública: `/work/:slug`
- landing institucional Kokuin: `/kokuin`

## Espelhos permitidos

- `usuarios/{uid}/creatorProfile/*`: apenas espelho/UI
- `usuarios_publicos/{uid}/*`: apenas projeção pública
- seller de pedido da loja: nunca recebe endereço completo do comprador

## Legado proibido no fluxo vivo

- `pending_review`
- `creatorMonetizationApprovedOnce`
- `mp_processed`
- fallback automático para `shito`
- perfil público duplicado em JSX

## Regra para manutenção/backfill

- se não houver inferência segura, pular e diagnosticar
- nunca inventar creator/work legado para “tampar buraco”
- nunca usar espelho público como fonte de verdade
- qualquer limpeza deve convergir para o canônico e apagar campo legado
- qualquer retomada de checkout deve passar pelo backend vivo
