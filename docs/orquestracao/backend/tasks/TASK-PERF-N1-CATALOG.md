# TASK-PERF-N1-CATALOG — Eliminação de N+1 Queries no Catálogo

**Status:** Especificada pelo Tech Lead Hermes  
**Executor:** OpenCode Backend Worker  
**Escopo:** Backend Spring Boot (`com.manganetworking.service.catalog.CatalogQueryService`)  

---

## 1. Contexto e Objetivo

Na auditoria de performance e JPA do MangaNetWorking, identificamos que a consulta do catálogo executa queries adicionais desnecessárias (problema clássico de N+1 queries) ao converter cada obra encontrada para DTO:

- Em `CatalogQueryService.java`:
  A busca paginada executa `Page<WorkEntity> result = workRepository.findAll(filtered, pageable);`.
  Em seguida, cada item é mapeado via `result.getContent().stream().map(this::toDto).toList()`.
- O método `toDto(WorkEntity work)` acessa:
  - `CreatorEntity author = work.getAuthor();`
  - `author.getUser().getName();`
- Em `WorkEntity.java`, `author` é mapeado com `@ManyToOne(fetch = FetchType.LAZY)`.
- Em `CreatorEntity.java`, `user` é mapeado com `@OneToOne(fetch = FetchType.LAZY)`.
- Como `baseSpec` realiza apenas `root.join("author", JoinType.LEFT)` e `author.join("user", JoinType.LEFT)` para aplicar os predicados da cláusula `WHERE`, o Hibernate não inclui `author` e `user` no `SELECT` da projeção principal. Como resultado, ao percorrer os 48 registros da página, o Hibernate dispara até 96 SELECTs adicionais para carregar autores e usuários individualmente.

---

## 2. Instruções Técnicas Passo a Passo

### Arquivo Alvo:
`D:\Projetos\MangaNetWorking\backend\src\main\java\com\manganetworking\service\catalog\CatalogQueryService.java`

### Modificação em `baseSpec`:
No método `private Specification<WorkEntity> baseSpec(...)`:
Quando a CriteriaQuery não for uma consulta de contagem (`count`), realize o `fetch join` de `author` e `user`:

```java
if (query.getResultType() != Long.class && query.getResultType() != long.class) {
    root.fetch("author", JoinType.LEFT).fetch("user", JoinType.LEFT);
}
```

> **Atenção Técnica:** A verificação `query.getResultType() != Long.class && query.getResultType() != long.class` é OBRIGATÓRIA. Em JPA Criteria, quando o Spring Data executa `count(Specification)` para calcular a paginação, a cláusula `FETCH` não pode estar presente na árvore da query (geraria erro de sintaxe JPA na contagem). Ao verificar o tipo de resultado, a contagem executa de forma limpa e a busca de dados executa com `LEFT JOIN FETCH` unificado.

---

## 3. Critérios de Aceite

- [ ] `CatalogQueryService.java` contém o `fetch join` condicional (`author` e `user`) evitando N+1 queries.
- [ ] A contagem de elementos na paginação (`count`) continua executando normalmente sem exceções.
- [ ] Compilação limpa sem erros ou warnings.
- [ ] Suíte completa do backend verde:
  `Set-Location D:\Projetos\MangaNetWorking\backend; mvn -o test` (mínimo 453 testes passando, 0 falhas).
- [ ] Relatório gerado em:
  `D:\Projetos\MangaNetWorking\docs\orquestracao\backend\relatorios\RELATORIO-PERF-N1-CATALOG.md`
  e replicado em `D:\Projetos\MangaTeofilo\docs\orquestracao\backend\relatorios\RELATORIO-PERF-N1-CATALOG.md`.

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
