# RELATORIO-TRGM-SEARCH-001 — Índice Trigram PostgreSQL para Busca Textual

**Data:** 2026-11-18  
**Executor:** OpenCode Backend (Hermes — execução direta por esgotamento de quota dos Workers)  
**Tech Lead:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## O que foi feito

### Migration criada
- **Arquivo:** `backend/src/main/resources/db/migration/V27__catalog_trgm_search_indexes.sql`
- **Extensão habilitada:** `pg_trgm` via `CREATE EXTENSION IF NOT EXISTS pg_trgm` (idempotente)
- **4 índices GIN criados:**
  | Índice | Tabela | Coluna | Propósito |
  |---|---|---|---|
  | `idx_works_title_trgm` | `works` | `title` | Busca por título da obra |
  | `idx_works_synopsis_trgm` | `works` | `synopsis` | Busca por sinopse |
  | `idx_creators_handle_trgm` | `creators` | `handle` | Busca por handle do criador |
  | `idx_users_name_trgm` | `users` | `name` | Busca por nome do usuário |

### Problema resolvido
`CatalogQueryService` usava predicados `LIKE %termo%` nesses campos. Com wildcard à esquerda (`%x%`), o PostgreSQL ignora índices B-Tree padrão e executa **full sequential scan** em toda a tabela a cada busca. Com índices GIN trigram, o PostgreSQL usa os índices normalmente para qualquer operação `LIKE`, `ILIKE` e operadores de similaridade.

### Impacto esperado
- Busca textual no catálogo: de `O(n)` full scan para `O(log n)` via GIN
- Aplicável automaticamente a todas as queries `LIKE %x%` existentes em `CatalogQueryService` — zero alterações de código Java

---

## Resultado dos Testes

```
Tests run: 453, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
Total time: 01:13 min
```

- **pg_trgm disponível no Testcontainers:** ✅ Sem necessidade de fallback
- **Migration aplicada sem erros de sintaxe:** ✅
- **Regressões:** Nenhuma

---

## Container

- **Status após rebuild:** UP / healthy
- **Endpoint:** `http://127.0.0.1:8085/actuator/health`

---

## Critérios de Aceite

- [x] Migration `V27__catalog_trgm_search_indexes.sql` criada
- [x] `pg_trgm` disponível no container PostgreSQL (sem fallback necessário)
- [x] `mvn -o test`: **453 testes, 0 falhas, BUILD SUCCESS**
- [x] Container `manganetworking-backend` healthy após rebuild
- [x] Relatórios criados nos dois repos
- [x] Git: `main` e `develop` atualizados em ambos os repositórios

---

Assinado por: OpenCode Backend
