# Nomenclatura: `creatorId`, `userId`, `uid`

## `uid`

- **Firebase Auth**: identificador estÃ¡vel da conta (`auth.uid`).
- Em paths RTDB do tipo `usuarios/{uid}` ou `usuarios/{uid}/publicProfile`, **`$uid` Ã© sempre o Auth UID**.

## `userId` (domÃ­nio comentÃ¡rios / conteÃºdo gerado)

- Em **comentÃ¡rios** (`capitulos/.../comentarios`), `userId` no nÃ³ gravado Ã© o **mesmo valor que `auth.uid`** do autor no momento da escrita.
- NÃ£o confundir com â€œid internoâ€ separado: aqui Ã© o UID Auth.

## `creatorId`

- Identifica **quem Ã© o autor monetÃ¡rio / dono editorial** de uma obra, produto, linha de pedido, etc.
- Em regra deve coincidir com o Auth UID do criador; em dados legados pode faltar â€” o backend usa **`sanitizeCreatorId`** (ex.: `functions` a partir de helpers partilhados) para normalizar e filtrar valores invÃ¡lidos.
- **Obra**: `obras/{workId}/creatorId` Ã© a fonte de verdade para â€œdono da obraâ€.
- **Loja**: itens de pedido carregam `creatorId` do produto para repasse / visibilidade ao vendedor.
- **DistinÃ§Ã£o**: `userId` em comentÃ¡rios = quem escreveu; `creatorId` em obra = dono do tÃ­tulo (podem ser diferentes se staff publicar por alguÃ©m â€” regras especÃ­ficas aplicam).

## Legado

- Constante **`PLATFORM_LEGACY_CREATOR_UID`**: primeiro UID da allowlist de chefes, usado quando registos antigos nÃ£o tÃªm `creatorId` na obra/capÃ­tulo.
