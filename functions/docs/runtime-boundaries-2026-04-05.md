# Runtime Boundaries - 2026-04-05

## 1. Origem publica da plataforma

Fonte de verdade atual:

- `APP_BASE_URL` em [`functions/payments/config.js`](/D:/ShitoMangá/functions/payments/config.js)

Valor padrao atual:

- `https://shitoproject-ed649.web.app`

Regra operacional:

- nao hardcodar `mangateofilo.com` enquanto o dominio nao existir e nao estiver configurado no Firebase Hosting
- `index.html`, sitemap, robots e `chapterReaderShell` devem apontar para a mesma origem publica

Arquivos que obedecem essa fronteira:

- [`index.html`](/D:/ShitoMangá/index.html)
- [`scripts/generate-sitemap.mjs`](/D:/ShitoMangá/scripts/generate-sitemap.mjs)
- [`functions/chapterReaderShell.js`](/D:/ShitoMangá/functions/chapterReaderShell.js)
- [`functions/payments/config.js`](/D:/ShitoMangá/functions/payments/config.js)

## 2. Adapters locais x regra compartilhada

Os arquivos abaixo em `functions/` existem apenas como adapters de import para manter compatibilidade entre modulos antigos e a regra compartilhada:

- [`functions/storeShipping.js`](/D:/ShitoMangá/functions/storeShipping.js)
- [`functions/printOnDemandPricing.js`](/D:/ShitoMangá/functions/printOnDemandPricing.js)
- [`functions/fixedZoneShipping.js`](/D:/ShitoMangá/functions/fixedZoneShipping.js)

Fonte de verdade real da regra:

- [`shared/storeShipping.js`](/D:/ShitoMangá/shared/storeShipping.js)
- [`shared/printOnDemandPricing.js`](/D:/ShitoMangá/shared/printOnDemandPricing.js)
- [`shared/fixedZoneShipping.js`](/D:/ShitoMangá/shared/fixedZoneShipping.js)

Regra de manutencao:

- alterar calculo de frete e precificacao apenas em `shared/`
- manter os adapters em `functions/` finos, sem logica de negocio
- se um modulo novo precisar do calculo, importar preferencialmente de `shared/`
- usar os adapters locais apenas quando for necessario preservar contratos de import legados

## 3. Status do legado

Arquivo:

- [`functions/deprecated/legacyIndex.js`](/D:/ShitoMangá/functions/deprecated/legacyIndex.js)

Status atual:

- arquivado para consulta manual
- fora do runtime ativo
- nao reexportado pelo backend principal

Regra de manutencao:

- nao adicionar codigo novo
- nao religar esse arquivo via barrels
- quando uma logica antiga ainda for util, copiar para o dominio correto e apagar o trecho legado em seguida

## 4. Regras RTDB

Enxugamento aplicado nesta rodada:

- leitura de `financas`, `creators/stats`, `creatorStatsDaily`, `workRetention` e `workRetentionRaw` agora aceita o mesmo contexto de admin por:
  - `admins/registry`
  - `usuarios/{uid}.role == admin`
  - custom claims `admin`
  - `panelRole` admin/super_admin
- escrita e leitura administrativa em `capitulos`, `obras`, `creatorData`, `avatares` e `loja/*` deixaram de depender de UIDs/e-mails hardcoded e passaram a usar o mesmo contexto de admin
- `usuarios_publicos/$uid/accountType` deixou de carregar excecao hardcoded de staff

Objetivo:

- reduzir dependencia de hardcodes isolados
- deixar a leitura administrativa mais previsivel
- alinhar RTDB com o RBAC que ja foi modularizado no backend
