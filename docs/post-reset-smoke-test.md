# Deploy / Smoke Test Pos-Reset

## Antes do deploy
- Confirmar `admins/registry/{uid}` do novo admin principal.
- Confirmar `loja/config` com `storeEnabled`, `storeVisibleToUsers` e frete base corretos.
- Confirmar que o Firebase Auth ja tem pelo menos 1 conta para entrar no painel.
- Publicar `database.rules.json`, `storage.rules`, `functions` e `hosting` juntos.

## Deploy sugerido
- `firebase deploy --only database,storage,functions,hosting`

## Smoke test minimo
1. Login admin
- Entrar com a conta admin nova.
- Verificar acesso ao painel admin e menu global de Obras / Capitulos / Editor global.

2. Perfil
- Abrir perfil.
- Salvar nome, avatar e `@username`.
- Salvar dados de leitor (`buyerProfile`).
- Verificar criacao de `usuarios/{uid}` e `usuarios/{uid}/publicProfile` sem erro de permissao.

3. Obra
- Criar 1 obra nova.
- Editar sinopse, SEO, generos, capa e banner.
- Verificar `obras/{obraId}` e arquivos em Storage.

4. Capitulo
- Criar 1 capitulo para a obra.
- Subir capa e paginas.
- Verificar `capitulos/{capId}` e arquivos em Storage.

5. Exclusao
- Apagar o capitulo.
- Confirmar remocao no RTDB e no Storage.
- Apagar a obra.
- Confirmar remocao da obra, dos capitulos vinculados e dos arquivos restantes no Storage.

6. Loja
- Abrir catalogo da loja.
- Verificar se `loja/config` renderiza sem erro.
- Criar 1 produto teste no admin, se o catalogo for ser usado agora.
- Fazer um quote basico de frete no front.

## Pos deploy imediato
- Se login/perfil falhar: revisar `admins/registry`, claims e `usuarios/$uid` rules.
- Se salvar perfil falhar: revisar writes permitidos em `usuarios` e `usuarios/{uid}/publicProfile`.
- Se criar obra/capitulo falhar: revisar `storage.rules` e segmentos de path.
- Se exclusao nao limpar arquivos: revisar paths persistidos (`capaStoragePath`, `paginasStoragePaths`, `bannerStoragePath`).

## Lixo residual para manter por enquanto
- helpers de compat / fallback de leitura que nao estao no fluxo mais podre.
- `functions/deprecated/index.js` como ponteiro de snapshot legado.
- `src/config/userDeprecatedFields.js` e limpeza de deprecated ate a base nova estabilizar.

## Lixo residual que vale podar na proxima passada
- strings sem acento ainda espalhadas em telas antigas.
- fallbacks de creator/work onde hoje ja da para exigir canonicidade.
- compat restante de favorites/likedWorks legados, depois que o novo fluxo estiver validado.
