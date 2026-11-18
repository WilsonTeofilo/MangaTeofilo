# RELATORIO-PERF-N1-CATALOG — Eliminação de N+1 Queries no Catálogo

**Tarefa:** TASK-PERF-N1-CATALOG  
**Executor:** OpenCode Backend  
**Data:** 18/11/2026  
**Status:** CONCLUÍDO COM SUCESSO  

---

## 1. Resumo Executivo das Alterações

Na consulta paginada do catálogo em `CatalogQueryService.java`, a conversão para DTO (`toDto`) navega pelas relações preguiçosas `work.getAuthor()` (`@ManyToOne LAZY`) e `author.getUser()` (`@OneToOne LAZY`). Anteriormente, o mapeamento disparava SELECTs individuais adicionais para cada obra retornada na página (problema N+1).

### Solução Técnica Implementada:
No método `baseSpec` de `CatalogQueryService.java`, foi incluído o `LEFT JOIN FETCH` encadeado para `author` e `user`:

```java
if (query.getResultType() != Long.class && query.getResultType() != long.class) {
    root.fetch("author", JoinType.LEFT).fetch("user", JoinType.LEFT);
}
```

- **Cláusula Condicional Obrigatória:** Quando o Spring Data executa a query de contagem de elementos para paginação (`count(filtered)` e `count(base)`), o `query.getResultType()` é `Long.class` ou `long.class`. Nesses casos, o `fetch` é omitido para prevenir exceções de sintaxe JPA na projeção de agregação.
- **Query Principal de Dados:** O Hibernate inclui `author` e `user` no `SELECT` da projeção principal com `LEFT JOIN FETCH`, consolidando a carga das entidades em uma única query SQL.

---

## 2. Verificação dos Critérios de Aceite

- [x] `CatalogQueryService.java` contém o `fetch join` condicional (`author` e `user`) evitando N+1 queries.
- [x] A contagem de elementos na paginação (`count`) continua executando normalmente sem exceções.
- [x] Compilação limpa sem erros ou warnings.
- [x] Suíte completa do backend verde: `Set-Location D:\Projetos\MangaNetWorking\backend; mvn -o test` (453 testes passando, 0 falhas).
- [x] Relatório gerado em `docs/orquestracao/backend/relatorios/RELATORIO-PERF-N1-CATALOG.md` e replicado no MangaTeofilo.

---

## 3. Evidência Real da Execução da Suíte de Testes

Execução via PowerShell:
```powershell
Set-Location D:\Projetos\MangaNetWorking\backend; mvn -o test
```

Saída do Maven Surefire:
```text
[INFO] Scanning for projects...
[INFO] 
[INFO] ------------< com.manganetworking:manganetworking-backend >-------------
[INFO] Building MangaNetWorking Backend 1.0.0-SNAPSHOT
[INFO]   from pom.xml
[INFO] --------------------------------[ jar ]---------------------------------
[INFO] 
[INFO] --- resources:3.3.1:resources (default-resources) @ manganetworking-backend ---
[INFO] Copying 1 resource from src\main\resources to target\classes
[INFO] Copying 27 resources from src\main\resources to target\classes
[INFO] 
[INFO] --- compiler:3.13.0:compile (default-compile) @ manganetworking-backend ---
[INFO] Recompiling the module because of changed source code.
[INFO] Compiling 248 source files with javac [debug parameters release 21] to target\classes
[INFO] 
[INFO] --- resources:3.3.1:testResources (default-testResources) @ manganetworking-backend ---
[INFO] skip non existing resourceDirectory D:\Projetos\MangaNetWorking\backend\src\test\resources
[INFO] 
[INFO] --- compiler:3.13.0:testCompile (default-testCompile) @ manganetworking-backend ---
[INFO] Recompiling the module because of changed dependency.
[INFO] Compiling 81 source files with javac [debug parameters release 21] to target\test-classes
[INFO] 
[INFO] --- surefire:3.5.2:test (default-test) @ manganetworking-backend ---
[INFO] Using auto detected provider org.apache.maven.surefire.junitplatform.JUnitPlatformProvider
[INFO] 
[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
...
[INFO] Results:
[INFO] 
[INFO] Tests run: 453, Failures: 0, Errors: 0, Skipped: 0
[INFO] 
[INFO] ------------------------------------------------------------------------
[INFO] BUILD SUCCESS
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  01:13 min
[INFO] Finished at: 2026-11-17T23:00:31-03:00
[INFO] ------------------------------------------------------------------------
```

---

Assinado por: OpenCode Backend
