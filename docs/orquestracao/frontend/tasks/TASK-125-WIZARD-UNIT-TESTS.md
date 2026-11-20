# TASK-125 — Testes Automatizados de UI dos Wizards (Mangá e Light Novel)

**Data:** 2026-11-20  
**Prioridade:** 🟡 Alta (P1) — Qualidade & Confiabilidade  
**Escopo:** Frontend · Suíte Vitest · `useMangaChapterEditor` & `useLightNovelEditor`  
**Dependências:** Nenhuma.

---

## 1. Contexto

A auditoria recente comprovou que a suíte Vitest possuía 46 testes cobrindo navegação, header, mappers, biblioteca e filtros de catálogo.
Porém, os fluxos mais críticos do escritor — os hooks dos wizards de publicação (`useMangaChapterEditor` e `useLightNovelEditor`) — careciam de testes de regressão automatizados cobrindo:
1. Recuperação e expiração de rascunhos no `localStorage` por conta de usuário (`user.uid`).
2. Isolamento de usuário (guest não lê nem grava rascunhos).
3. Rejeição de uploads que ultrapassam o teto de 300 páginas ou tamanho de arquivo (> 15 MB).
4. Step-lock de progressão de etapas no Light Novel Wizard.
5. Conformidade de payload (`blocksJson` em vez do legado `content`).

---

## 2. Arquivos a Criar

### A. `frontend/src/components/creator/manga/__tests__/useMangaChapterEditor.test.ts`
Testes obrigatórios cobrindo `useMangaChapterEditor`:
1. **Rascunho recente (< 24h) carregado**:
   - Com `localStorage` populado sob a chave `mn:manga-draft:${userId}:${workId}` com dados válidos salvos recentemente, o hook expõe `recoverable` com título, data e tipo corretos.
2. **Rascunho expirado (> 24h) ignorado**:
   - Se o timestamp for superior a 24 horas, `recoverable` deve permanecer `null`.
3. **Usuário Convidado (`guest`)**:
   - Quando `user.uid === 'guest'`, nenhum rascunho deve ser lido nem salvo no `localStorage`.
4. **Rejeição por tamanho de arquivo (> 15 MB)**:
   - Ao chamar `addPages` com arquivo cujo tamanho exceda 15 MB, o hook deve setar `error` informativo e não adicionar o arquivo na lista.
5. **Rejeição por limite de páginas (> 300 páginas)**:
   - Ao tentar adicionar páginas que excedam o total de 300 páginas, o hook deve barrar o excedente e exibir mensagem de erro amigável.
6. **Descarte de Rascunho**:
   - Chamar `discardStoredDraft` limpa a chave do `localStorage` e zera `recoverable`.

### B. `frontend/src/components/creator/novel/__tests__/useLightNovelEditor.test.ts`
Testes obrigatórios cobrindo `useLightNovelEditor`:
1. **Recuperação de rascunho com blocos válidos**:
   - Hook recupera blocos sanitizados e metadados quando há entrada recente (< 24h) sob `mn:ln-draft:${userId}:${workId}:novo`.
2. **Ignora rascunho para `guest` ou timestamp inválido/expirado**:
   - `recoverable` permanece `null` e dados inválidos são expurgados do storage.
3. **Step-Lock de Etapas (`maxStep` e `goToStep`)**:
   - Etapa 1 -> Etapa 2 bloqueada quando o título for vazio ou contiver erro (`maxStep === 1`).
   - Etapa 2 -> Etapa 3 bloqueada quando não existirem blocos ou houver violação editorial (`maxStep === 2`).
   - Modo de edição (`isEditing: true` / `editingNumber` preenchido): todas as etapas liberadas (`maxStep === 4`).
4. **Contrato de envio `blocksJson`**:
   - Ao publicar, validar que o payload enviado para `workApi.createChapter` / `updateChapter` envia o JSON estruturado no campo `blocksJson`, e não em `content`.

---

## 3. Critérios de Aceite

- [ ] Todos os novos arquivos de teste criados em seus respectivos diretórios `__tests__/`.
- [ ] Mocks adequados para `useAuth`, `localStorage` e APIs (`storageApi`, `workApi`).
- [ ] `npm test -- --run` em `frontend/` executado com 100% de aprovação (todos os testes verdes, sem falhas).
- [ ] `npm run build` continua 100% verde (sem quebras de TypeScript ou empacotamento).

---

## 4. Relatório e Git

- Relatório em `docs/orquestracao/frontend/relatorios/RELATORIO-TASK-125.md`
- Commit no `MangaNetWorking` e `MangaTeofilo`:
  `test(creator-wizards): add comprehensive unit tests for manga and novel editor hooks (TASK-125)`

*Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)*
