# RELATORIO-TASK-SECURITY-002 — Work Lifecycle DRAFT → ONGOING

**Data:** 2026-11-20  
**Task Referência:** `docs/orquestracao/backend/tasks/TASK-SECURITY-002-WORK-CREATION-DRAFT-PROMOTION.md`  
**Branch:** `develop` → mergeado em `main`  
**Commit:** `e375c1c`  
**Merge main:** `4f9eacb`

---

## Resumo da Entrega

Implementada a regra de ciclo de vida de obras:

> **Nova obra nasce como `DRAFT`** (invisível no catálogo, feed e para não-autores).  
> **Ao publicar o 1º capítulo**, a obra é **automaticamente promovida para `ONGOING`**.

---

## Arquivos Modificados

### Produção

| Arquivo | Linha | Alteração |
|---------|-------|-----------|
| `WorkApplicationService.java` | L227 | `work.setStatus(WorkStatus.ONGOING)` → `work.setStatus(WorkStatus.DRAFT)` |
| `ChapterApplicationService.java` | L185-187 | Adicionada promoção automática: `if (work.getStatus() == WorkStatus.DRAFT) { work.setStatus(WorkStatus.ONGOING); }` antes do `workRepository.save(work)` |

### Testes

| Arquivo | Alteração |
|---------|-----------|
| `WorkApplicationServiceTest.java` | +9 linhas: assertiva `createWork` persiste com `WorkStatus.DRAFT` |
| `ChapterApplicationServiceTest.java` | +40 linhas: 3 novos cenários — promoção DRAFT→ONGOING, ONGOING mantém status, COMPLETED mantém status |
| `FeedSyncIntegrationTest.java` | +34 linhas: `newOngoingWork()` helper (cria obra + publica capítulo); teste reescrito verificando que DRAFT não entra no feed e ONGOING entra |
| `CatalogIntegrationTest.java` | +28 linhas: ajuste de obras de teste para publicar capítulo antes de aparecer no catálogo |

---

## Resultado dos Testes

```
Tests run: 45, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
Total time: 34.367 s
```

| Suite | Testes | Status |
|-------|--------|--------|
| `FeedSyncIntegrationTest` | 6 | ✅ Verde |
| `ChapterApplicationServiceTest` | 18 | ✅ Verde |
| `WorkApplicationServiceTest` | 12 | ✅ Verde |
| `CatalogIntegrationTest` | 9 | ✅ Verde |

---

## Critérios de Aceite

- [x] `createWork` persiste com `WorkStatus.DRAFT`
- [x] Obra DRAFT não aparece no catálogo (`CatalogQueryService.HIDDEN_STATUSES` já incluía DRAFT ✅)
- [x] Obra DRAFT não aparece no feed MongoDB (`RecommendationAlgorithmService.isHidden()` usa `work.getStatus().isHidden()` ✅)
- [x] Obra DRAFT não é acessível por não-autores (`assertWorkVisible()` já bloqueava DRAFT ✅ — TASK-SECURITY-001)
- [x] Publicar 1º capítulo em obra DRAFT promove para ONGOING
- [x] Publicar capítulo em obra ONGOING/COMPLETED não altera status
- [x] `FeedSyncIntegrationTest` passou com `newOngoingWork()` que cria obra + capítulo
- [x] Todos os 45 testes dos 4 suites: **BUILD SUCCESS**
- [x] Commit `e375c1c` em `develop` + merge `4f9eacb` em `main` + push

---

Assinado por: OpenCode Backend
