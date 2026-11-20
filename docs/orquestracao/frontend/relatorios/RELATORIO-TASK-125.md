# Relatório de Implementação — TASK-125: Testes Automatizados de UI dos Wizards (Mangá e Light Novel)

**Data:** 20 de Novembro de 2026  
**Operário:** OpenCode Frontend  
**Status:** ✅ Concluído com Sucesso

---

## 1. Sumário Executivo

A suíte de testes automatizados do Frontend foi expandida com foco direto na confiabilidade e estabilidade dos wizards de publicação do criador (`useMangaChapterEditor` e `useLightNovelEditor`).

Foram criados 2 arquivos de testes unitários sob o framework Vitest, cobrindo integralmente as regras de persistência de rascunho por conta de usuário (`localStorage`), isolamento seguro para usuários convidados (`guest`), validação estrita de arquivos (> 15 MB) e limite de páginas (> 300), step-locks de progressão editorial e conformidade de payload de API (`blocksJson` em vez do campo legado `content`).

Todos os 58 testes da suíte passaram com 100% de sucesso e a validação estrita de build (`tsc && vite build`) foi concluída sem qualquer erro de tipagem TypeScript ou uso de `any`.

---

## 2. Arquivos de Teste Criados

| Arquivo | Cenários Cobertos | Testes | Status |
|---------|-------------------|--------|--------|
| `frontend/src/components/creator/manga/__tests__/useMangaChapterEditor.test.ts` | Rascunho < 24h, guest, rascunho > 24h, arquivo > 15 MB, limite de 300 páginas, descarte de rascunho | 6 | ✅ Verde |
| `frontend/src/components/creator/novel/__tests__/useLightNovelEditor.test.ts` | Rascunho com blocos válidos, isolamento guest, expurgo de expirado (> 24h), step-lock (etapas 1, 2 e 4), contrato `blocksJson`, descarte de rascunho | 6 | ✅ Verde |

---

## 3. Cobertura de Cenários Detalhada

### A. `useMangaChapterEditor.test.ts`
1. **Recuperação de rascunho recente (< 24h):**
   - População sob a chave `mn:manga-draft:${userId}:${workId}`.
   - Valida que `recoverable` expõe título, data de agendamento e tipo (`chapterType`) corretos.
   - Valida execução de `restoreDraft()` com atualização dos estados internos do editor e limpeza de `recoverable`.
2. **Isolamento de convidado (`guest`):**
   - Com `user.uid === 'guest'`, nenhum rascunho é lido ou recuperado (`recoverable === null`).
3. **Expiração (> 24h):**
   - Com `savedAt` com mais de 24 horas, o rascunho é ignorado e `recoverable` permanece `null`.
4. **Rejeição por tamanho de arquivo (> 15 MB):**
   - Ao tentar adicionar arquivo de 16 MB, o upload é barrado, `pages` permanece vazio e a mensagem informativa `"Cada página pode ter no máximo 15 MB."` é exibida.
5. **Rejeição por teto de 300 páginas:**
   - Adição de 305 imagens aceita exatamente 300 e barra os 5 excedentes com erro explicativo (`"5 acima do limite de páginas"`).
   - Tentativa subsequente com editor em 300 páginas emite `"Este capítulo já atingiu o limite de 300 páginas."` sem alterar a contagem.
6. **Descarte de Rascunho:**
   - Chamada a `discardStoredDraft()` remove fisicamente a chave do `localStorage` e redefine `recoverable` para `null`.

### B. `useLightNovelEditor.test.ts`
1. **Recuperação de rascunho com blocos válidos:**
   - Entrada recente (< 24h) sob `mn:ln-draft:${userId}:${workId}:novo`.
   - Recuperação e sanitização de blocos (`text`, `separator`), título e `chapterType`.
   - Valida execução de `restoreDraft()` aplicando os blocos e metadados ao editor.
2. **Isolamento de convidado (`guest`):**
   - Rascunhos para `user.uid === 'guest'` são sumariamente ignorados.
3. **Expurgo de expirados (> 24h) ou inválidos:**
   - Timestamps expirados não apenas são ignorados (`recoverable === null`), como também são expurgados do `localStorage` (`removeItem`).
4. **Step-Lock de Etapas:**
   - Título vazio/inválido: `maxStep = 1`; tentativas de avançar via `goToStep(2)` são travadas no step 1.
   - Título válido com blocos vazios / abaixo de 1.000 caracteres (política editorial violada): `maxStep = 2`; tentativas de avançar via `goToStep(3)` são travadas no step 2.
   - Modo edição (`isEditing: true` / `editingNumber: 2`): todas as etapas liberadas (`maxStep = 4`), permitindo avanço imediato para `goToStep(4)`.
5. **Contrato de API `blocksJson`:**
   - Ao publicar (`handlePublish`), valida que `workApi.createChapter` recebe o payload contendo o JSON estruturado no campo `blocksJson` (`version: 1`, array `blocks`).
   - Garante que a propriedade legada `content` **não** é transmitida no payload.
6. **Descarte de Rascunho:**
   - Chamada a `discardStoredDraft()` limpa a chave do storage e zera `recoverable`.

---

## 4. Validação da Suíte Vitest

Execução:
```bash
npm test -- --run
```

Resultado:
```
 RUN  v5.1.0 D:/Projetos/MangaNetWorking/frontend

 ✓ src/utils/__tests__/apiMappers.test.ts (3 tests) 8ms
 ✓ src/utils/__tests__/catalogFilters.test.ts (4 tests) 10ms
 ✓ src/components/ui/__tests__/CartoonTitle.test.tsx (2 tests) 15ms
 ✓ src/components/account/__tests__/AccountProfileHeader.test.tsx (4 tests) 34ms
 ✓ src/components/layout/header/__tests__/HeaderMobileNav.test.tsx (4 tests) 26ms
 ✓ src/components/creator/novel/__tests__/useLightNovelEditor.test.ts (6 tests) 51ms
 ✓ src/components/creator/manga/__tests__/useMangaChapterEditor.test.ts (6 tests) 67ms
 ✓ src/components/layout/header/__tests__/HeaderNav.test.tsx (3 tests) 16ms
 ✓ src/components/library/__tests__/LibraryWorkCard.test.tsx (4 tests) 23ms
 ✓ src/components/creator/workspace/__tests__/CreatorNavigation.test.tsx (22 tests) 211ms

 Test Files  10 passed (10)
      Tests  58 passed (58)
   Start at  01:54:25
   Duration  2.28s (environment 88%, import 6%, transform 3%, tests 3%, worker 1%)
```

---

## 5. Validação de Build e TypeScript (`npm run build`)

Execução:
```bash
npm run build
```

Resultado:
```
> manganetworking@1.0.0 build
> tsc && vite build

vite v6.4.4 building for production...
transforming...
✓ 1760 modules transformed.
rendering chunks...
computing gzip size...
✓ built in 5.07s
```

TypeScript estrito 100% verificado, sem warnings, sem inferências frouxas e sem uso de `any`.

---

## 6. Conclusão

A TASK-125 foi concluída com êxito integral, blindando a área mais nobre do autor contra regressões de UI e inconsistências de contrato de envio de dados.

*Assinado por: OpenCode Frontend*
