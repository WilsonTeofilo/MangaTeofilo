# TASK-TRGM-SEARCH-001 — Índice Trigram PostgreSQL para Busca Textual

**Data:** 2026-11-18  
**Responsável:** OpenCode Backend  
**Tech Lead:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## 1. Contexto

`CatalogQueryService` usa predicados `LIKE %termo%` nos campos `title`, `synopsis` (tabela `works`), `handle` (tabela `creators`) e `name` (tabela `users`).

Com wildcard à esquerda (`LIKE %x%`), índices B-Tree padrão do PostgreSQL são completamente ignorados — resultando em full sequential scan em toda a tabela a cada busca. Em escala (10k+ obras), isso degrada a performance do catálogo de forma severa.

A solução é habilitar a extensão `pg_trgm` do PostgreSQL e criar índices `GIN` que suportam `LIKE %x%` via trigrama.

---

## 2. Arquivos a Ler (Contexto Mínimo)

Leia **apenas** estes arquivos antes de implementar:
1. `backend/src/main/resources/db/migration/V26__*.sql` → entender o padrão de migration usado no projeto
2. `backend/src/main/java/com/manganetworking/service/catalog/CatalogQueryService.java` → confirmar os campos de busca

---

## 3. Implementação

### 3.1 Criar Migration Flyway V27

**Arquivo:** `backend/src/main/resources/db/migration/V27__catalog_trgm_search_indexes.sql`

> ⚠️ Verificar qual é o número da última migration (`V26` ou superior) antes de criar. Se já existir `V27`, use `V28`.

**Conteúdo:**
```sql
-- Habilita extensão pg_trgm (suporte a índices GIN para LIKE %termo%)
-- Inclusão no postgresql-contrib, disponível na imagem postgres:16-alpine via shared_preload_libraries.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índice GIN em works.title (busca por título da obra)
CREATE INDEX IF NOT EXISTS idx_works_title_trgm
    ON works USING GIN (title gin_trgm_ops);

-- Índice GIN em works.synopsis (busca por sinopse)
CREATE INDEX IF NOT EXISTS idx_works_synopsis_trgm
    ON works USING GIN (synopsis gin_trgm_ops);

-- Índice GIN em creators.handle (busca por handle do criador)
CREATE INDEX IF NOT EXISTS idx_creators_handle_trgm
    ON creators USING GIN (handle gin_trgm_ops);

-- Índice GIN em users.name (busca por nome do usuário)
CREATE INDEX IF NOT EXISTS idx_users_name_trgm
    ON users USING GIN (name gin_trgm_ops);
```

### 3.2 Validação Pré-Migration (opcional, mas recomendada)

Verificar se pg_trgm está disponível no container PostgreSQL rodando:
```powershell
docker exec manganetworking-postgres psql -U manganetworking -d manganetworking -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

Se retornar `CREATE EXTENSION` ou `NOTICE: extension "pg_trgm" already exists`, está OK.

---

## 4. Testes

Rodar a suíte completa de testes (Testcontainers levanta Postgres fresh e aplica todas as migrations, incluindo a V27):

```powershell
cd D:\Projetos\MangaNetWorking
mvn -o test
```

**Critério de aceite:** `BUILD SUCCESS`, **0 falhas**, **0 erros**.

> Se os testes falharem com `extension "pg_trgm" does not exist`, significa que a imagem Testcontainers não inclui `postgresql-contrib`. Nesse caso, adicionar ao SQL:
> ```sql
> DO $$ BEGIN
>   CREATE EXTENSION IF NOT EXISTS pg_trgm;
> EXCEPTION WHEN OTHERS THEN
>   RAISE NOTICE 'pg_trgm não disponível neste ambiente: %', SQLERRM;
> END $$;
> ```
> E substituir `CREATE INDEX IF NOT EXISTS ... USING GIN (... gin_trgm_ops)` por uma versão condicional que verifique se a extensão existe antes de criar o índice. Adapte conforme necessário para manter os testes verdes.

---

## 5. Reconstrução do Container

Após testes verdes:

```powershell
docker compose -f D:\Projetos\MangaNetWorking\docker-compose.yml up -d --build backend
```

Aguardar 15s e verificar health:
```powershell
Start-Sleep -Seconds 15
curl.exe -s http://127.0.0.1:8085/actuator/health
```

Resultado esperado: `{"status":"UP",...}`

---

## 6. Relatório de Entrega

Criar **dois** relatórios (conteúdo idêntico):

1. `D:\Projetos\MangaNetWorking\docs\orquestracao\backend\relatorios\RELATORIO-TRGM-SEARCH-001.md`
2. `D:\Projetos\MangaTeofilo\docs\orquestracao\backend\relatorios\RELATORIO-TRGM-SEARCH-001.md`

**Estrutura do relatório:**
```markdown
# RELATORIO-TRGM-SEARCH-001 — Índice Trigram PostgreSQL

**Data:** <data>
**Executor:** OpenCode Backend

## O que foi feito
- Migration criada: V27__catalog_trgm_search_indexes.sql
- Extensão pg_trgm habilitada
- 4 índices GIN criados: idx_works_title_trgm, idx_works_synopsis_trgm, idx_creators_handle_trgm, idx_users_name_trgm

## Resultado dos testes
- Total de testes: XXX
- Falhas: 0
- Build: SUCCESS

## Container
- Status após rebuild: UP / healthy

## Critérios de Aceite
- [x] Migration V27 criada sem erros de sintaxe
- [x] pg_trgm disponível no container de produção
- [x] mvn test: 0 falhas
- [x] Container healthy após rebuild

Assinado por: OpenCode Backend
```

---

## 7. Git — Commit e Push em Ambos os Repos e Branches

### MangaNetWorking
```powershell
cd D:\Projetos\MangaNetWorking

# main
git checkout main
git add .
git commit -m "perf(catalog): add pg_trgm GIN indexes for LIKE %search% queries (TASK-TRGM-SEARCH-001)"
git push origin main

# develop
git checkout develop
git merge main
git push origin develop
```

### MangaTeofilo
```powershell
cd D:\Projetos\MangaTeofilo

# main
git checkout main
git add .
git commit -m "docs: add RELATORIO-TRGM-SEARCH-001 and TASK-TRGM-SEARCH-001"
git push origin main

# develop
git checkout develop
git merge main
git push origin develop
```

---

## 8. Critérios de Aceite (Checklist Final)

- [ ] Migration `V27__catalog_trgm_search_indexes.sql` criada
- [ ] `pg_trgm` disponível no container PostgreSQL de produção
- [ ] `mvn -o test`: **0 falhas**, BUILD SUCCESS (mesma contagem de testes anterior: 453+)
- [ ] Container `manganetworking-backend` healthy após rebuild
- [ ] Relatórios criados nos dois repos
- [ ] Git: `main` e `develop` atualizados em **ambos** os repositórios

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
