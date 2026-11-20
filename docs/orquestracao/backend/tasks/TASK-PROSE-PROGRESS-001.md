# TASK-PROSE-PROGRESS-001 — Suporte a Progresso Real e Checkpoints em Capítulos de Prosa (Light Novel)

**Prioridade:** P1  
**Módulo:** Backend (Spring Boot / MongoDB / Reading Progress)  
**Objetivo:** Permitir que capítulos em formato `PROSE` (Light Novel) registrem progresso contínuo de leitura e retenção (em percentual de scroll `page <= totalPages`, ex: 1 a 100 com totalPages=100, ou por índice de bloco), eliminando a trava engessada de `page=1 && totalPages=1`.

---

## 1. Contexto e Motivação

Atualmente, `ReadingProgressService.java` (L186-191) contém a seguinte trava:
```java
if (chapter.getFormat() == ChapterFormat.PROSE) {
    if (page != 1 || totalPages != 1) {
        throw new IllegalArgumentException("Capítulo em prosa deve ser lido na página 1 de 1.");
    }
    return chapter;
}
```
Essa validação forçou o frontend a sempre enviar `page=1, totalPages=1`. Com isso:
1. O leitor de Light Novel nunca retoma a leitura de onde parou ao voltar para a obra.
2. A biblioteca e home não conseguem exibir o percentual real de progresso do leitor.
3. Os checkpoints de retenção de scroll (10% a 100%) enviavam eventos idênticos de `page=1`, impossibilitando métricas analíticas reais de retenção de prosa.

---

## 2. Requisitos de Implementação

### 2.1 Atualização em `ReadingProgressService.java`
No método `validateReadingPage(String workId, String chapterId, int page, int totalPages)`:
- Substituir a trava estrita `(page != 1 || totalPages != 1)` por:
```java
if (chapter.getFormat() == ChapterFormat.PROSE) {
    if (page < 1 || totalPages < 1 || page > totalPages) {
        throw new IllegalArgumentException("A posição de leitura em prosa deve estar entre 1 e o total.");
    }
    return chapter;
}
```
- Manter a validação de mangá (`totalPages != countChapterPages(chapter.getPagesJson())`) inalterada.
- O restante do fluxo (`doc.setPage(pageToPersist)`, `doc.setTotalPages(totalPages)`, `recordReadEvent(...)`) já suporta persistência no MongoDB sem alterações de schema.

### 2.2 Testes Unitários em `ReadingProgressServiceValidationTest.java`
Adicionar testes específicos para `ChapterFormat.PROSE`:
1. `shouldAcceptValidProseReadingProgress`: testa `page=50, totalPages=100` e verifica se salva com sucesso.
2. `shouldAcceptLegacyProseReadingProgress`: testa `page=1, totalPages=1` garantindo compatibilidade reversa.
3. `shouldRejectProseWhenPageGreaterThanTotalPages`: testa `page=101, totalPages=100` e valida que lança `IllegalArgumentException`.
4. `shouldRejectProseWhenPageIsZeroOrNegative`: testa `page=0, totalPages=100` e valida que lança `IllegalArgumentException`.

---

## 3. Critérios de Aceite

- [ ] Validação atualizada em `ReadingProgressService.java`.
- [ ] Testes unitários novos cobrindo cenários válidos e inválidos de prosa.
- [ ] `mvn test -Dtest="ReadingProgressServiceValidationTest,CreatorAnalyticsApplicationServiceTest"` passa verde.
- [ ] `mvn test` completo roda sem quebrar nenhuma regressão existente.
- [ ] Gerar relatório `docs/orquestracao/backend/relatorios/RELATORIO-TASK-PROSE-PROGRESS-001.md`.

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
