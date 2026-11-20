# TASK-SECURITY-002 — Regra de Visibilidade e Ciclo de Vida da Obra: Criação em DRAFT e Promoção no 1º Capítulo

**Data:** 2026-11-20  
**Prioridade:** 🔴 Alta (P1) — Regra de Negócio & Segurança  
**Escopo:** Backend · `WorkApplicationService.java` & `ChapterApplicationService.java`  
**Dependências:** Nenhuma.

---

## 1. Contexto e Regra de Negócio

Atualmente, `WorkApplicationService.createWork()` cadastra novas obras diretamente com status `WorkStatus.ONGOING`.
Isso gera dois problemas:
1. **Poluição de Catálogo:** Obras "fantasmas" (sem nenhum capítulo publicado) ficam visíveis publicamente no catálogo e no feed.
2. **Incoerência com a Proteção de Rascunhos:** Conforme especificado na auditoria e no roadmap mestre (`ROADMAP-FASES.md` / `AUDITORIA-ATUAL.md`), uma obra nova recém-criada deve iniciar o seu ciclo de vida em `DRAFT`.
3. **Proteção Automática:** Pela regra implementada em `assertWorkVisible` (TASK-SECURITY-001), obras em `DRAFT` ficam 100% invisíveis a visitantes e outros leitores, sendo acessíveis exclusivamente ao autor proprietário e à moderação.

### Ciclo de Promoção Automática:
- Ao criar a obra (`createWork`), seu status inicial é **`WorkStatus.DRAFT`**.
- Ao criar/publicar o primeiro capítulo na obra (`createChapter` em `ChapterApplicationService`):
  - Se a obra estiver com `work.getStatus() == WorkStatus.DRAFT`, seu status é **automaticamente promovido para `WorkStatus.ONGOING`**.
  - A obra passa a ser pública no catálogo e feed sincronizado.

---

## 2. Modificações Exigidas no Código

### A. `WorkApplicationService.java`
No método `createWork(...)`:
```java
// ANTES:
work.setStatus(WorkStatus.ONGOING);

// DEPOIS:
work.setStatus(WorkStatus.DRAFT);
```

### B. `ChapterApplicationService.java`
No método `createChapter(...)`:
Após salvar o capítulo e atualizar a contagem de capítulos da obra, verificar se a obra está em `DRAFT` e promovê-la para `ONGOING`:
```java
// Incrementa total de capítulos
work.setTotalChapters(work.getTotalChapters() + 1);

// Promoção automática do ciclo de vida: obra em DRAFT vira ONGOING ao receber o 1º capítulo
if (work.getStatus() == WorkStatus.DRAFT) {
    work.setStatus(WorkStatus.ONGOING);
}

WorkEntity updatedWork = workRepository.save(work);
publishFeedSync(updatedWork.getId(), "publicação de capítulo");
```

---

## 3. Testes Automatizados e Regressões

1. **`WorkApplicationServiceTest.java`**:
   - Garantir que `createWork` salva a entidade com status `WorkStatus.DRAFT`.
2. **`ChapterApplicationServiceTest.java`**:
   - Adicionar teste unitário comprovando que publicar um capítulo em uma obra com status `DRAFT` promove automaticamente a obra para `ONGOING`.
   - Garantir que se a obra já estiver em `ONGOING` ou `COMPLETED`, seu status não é alterado indevidamente.
3. **Adequação de Testes de Integração Legados**:
   - Se algum teste de catálogo ou feed criava obras sem capítulos e esperava encontrá-las na listagem pública do catálogo, criar pelo menos 1 capítulo de teste para que a obra seja promovida ou ajustar o status na fixture para refletir o cenário real.

---

## 4. Critérios de Aceite

- [ ] `WorkApplicationService.createWork` define status inicial como `WorkStatus.DRAFT`.
- [ ] `ChapterApplicationService.createChapter` promove obra de `DRAFT` para `ONGOING` na publicação do capítulo.
- [ ] Testes unitários novos e existentes verdes.
- [ ] `mvn test` no backend passa com 100% de sucesso (zero regressões).

---

## 5. Relatório e Git

- Relatório em `docs/orquestracao/backend/relatorios/RELATORIO-TASK-SECURITY-002.md`
- Commit no `MangaNetWorking` e `MangaTeofilo`:
  `feat(backend): set new works to DRAFT and auto-promote to ONGOING on first chapter (TASK-SECURITY-002)`

*Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)*
