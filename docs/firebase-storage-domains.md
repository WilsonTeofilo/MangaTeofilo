# Storage Domains - MangaTeofilo

## Objetivo

Documentar por que o `storage.rules` ainda parece mais "hardcoded" do que o RTDB e qual a fronteira correta de manutencao.

## Limitacao estrutural

O Firebase Storage Rules nao consegue consultar livremente o RTDB para decidir papel administrativo.

Por isso, o Storage usa duas camadas:

- allowlist sincronizada em regra (`isShitoAdmin`)
- claims/token (`panelRole`, `admin`)

Arquivo de verdade da allowlist:

- [`shared/platformStaffAllowlist.json`](/D:/ShitoMangá/shared/platformStaffAllowlist.json)

Script de sincronizacao:

- [`scripts/syncStaffAllowlistToFirebaseRules.mjs`](/D:/ShitoMangá/scripts/syncStaffAllowlistToFirebaseRules.mjs)

Arquivos afetados:

- [`database.rules.json`](/D:/ShitoMangá/database.rules.json)
- [`storage.rules`](/D:/ShitoMangá/storage.rules)

## Dominios do Storage

### 1. Capas e imagens de obra

Paths:

- `capas/{uid}/*`
- `manga/{uid}/{obra}/*`
- `obras/{uid}/{obra}/*`

Regra:

- leitura publica
- escrita do dono do segmento ou staff
- somente imagem segura, sem SVG, com limite de tamanho

### 2. Avatares da loja

Path:

- `avatares/*`

Regra:

- leitura publica
- escrita apenas staff/admin sincronizado

### 3. Perfil de creator

Path:

- `creator_profile/{uid}/*`

Regra:

- leitura publica
- escrita apenas do proprio dono

### 4. Loja

Path:

- `loja_produtos/{uid}/*`

Regra:

- imagens publicas
- PDF autenticado
- escrita do dono do segmento ou staff

### 5. Print on demand

Path:

- `print_on_demand/{uid}/*`

Regra:

- leitura admin/staff ou dono
- escrita do proprio dono

## Regra de manutencao

- nao editar a allowlist direto dentro de `storage.rules`
- mudar `shared/platformStaffAllowlist.json` e sincronizar
- manter Storage como camada de arquivo/binario, sem empurrar logica de negocio desnecessaria para as rules
