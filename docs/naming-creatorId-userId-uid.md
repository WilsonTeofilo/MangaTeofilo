# Nomenclatura: `creatorId`, `userId`, `uid`

## `uid`

- **Firebase Auth**: identificador estável da conta (`auth.uid`).
- Em paths RTDB do tipo `usuarios/{uid}` ou `usuarios_publicos/{uid}`, **`$uid` é sempre o Auth UID**.

## `userId` (domínio comentários / conteúdo gerado)

- Em **comentários** (`capitulos/.../comentarios`), `userId` no nó gravado é o **mesmo valor que `auth.uid`** do autor no momento da escrita.
- Não confundir com “id interno” separado: aqui é o UID Auth.

## `creatorId`

- Identifica **quem é o autor monetário / dono editorial** de uma obra, produto, linha de pedido, etc.
- Em regra deve coincidir com o Auth UID do criador; em dados legados pode faltar — o backend usa **`sanitizeCreatorId`** (ex.: `functions` a partir de helpers partilhados) para normalizar e filtrar valores inválidos.
- **Obra**: `obras/{workId}/creatorId` é a fonte de verdade para “dono da obra”.
- **Loja**: itens de pedido carregam `creatorId` do produto para repasse / visibilidade ao vendedor.
- **Distinção**: `userId` em comentários = quem escreveu; `creatorId` em obra = dono do título (podem ser diferentes se staff publicar por alguém — regras específicas aplicam).

## Legado

- Constante **`PLATFORM_LEGACY_CREATOR_UID`**: primeiro UID da allowlist de chefes, usado quando registos antigos não têm `creatorId` na obra/capítulo.
