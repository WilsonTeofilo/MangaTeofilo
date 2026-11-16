# TASK-118 — Tipografia & Microcopy de Rua nos Dashboards (Fase 5)

**Projeto:** MangaNetWorking  
**Camada:** Frontend (React/TypeScript)  
**Prioridade:** ALTA  
**Responsável:** OpenCode Frontend Worker  
**Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## 1. Contexto e Diagnóstico

Em auditoria completa dos documentos oficiais (`DESIGN-SYSTEM-OFICIAL.md`, `NEGATIVE-PROMPTS-FRONTEND.md`) e do código-fonte:
- Foram localizadas **39 ocorrências residuais de `font-mono`** concentradas em 6 arquivos do wizard de publicação de Light Novel / Prosa.
- A regra do Design System é taxativa: **`font-mono` está terminantemente proibida** em metadados, números e textos.
- O sistema tipográfico oficial é composto exclusivamente por 4 fontes:
  1. **Anton (`font-display`)**: Títulos de página, títulos de card, ranking, cabeçalhos e botões principais (sempre caixa-alta `uppercase`).
  2. **Bowlby One (`font-logo`)**: Selos grandes, logo e patches de nível colecionáveis.
  3. **Archivo (`font-body`)**: Textos corridos, parágrafos, formulários, metadados e números (`font-variant-numeric: tabular-nums` / `tabular-nums`).
  4. **Silkscreen (`font-pixel`)**: Exclusivo para microrrótulos de sistema em caixa-alta, **mínimo 12px** (`text-[12px]`). Nunca em texto de leitura.
- A microcopy dos dashboards do autor deve adotar a voz autêntica de rua e independência ("Bancada do Autor", "Ganhos da Temporada", "Missões da Banca", "Obras na Bancada"), sem termos corporativos ou SaaS genérico.

---

## 2. Escopo Cirúrgico de Modificações

### 2.1 Purga Total de `font-mono` no Wizard de Novel
Substituir todas as ocorrências de `font-mono` nos 6 arquivos:
1. `frontend/src/components/creator/LightNovelChapterWizard.tsx`
2. `frontend/src/components/creator/novel/NovelBlockEditorStep.tsx`
3. `frontend/src/components/creator/novel/NovelBlockItem.tsx`
4. `frontend/src/components/creator/novel/NovelDetailsStep.tsx`
5. `frontend/src/components/creator/novel/NovelPublishStep.tsx`
6. `frontend/src/components/creator/novel/NovelReviewStep.tsx`

**Mapeamento de substituição:**
- Rótulos de instrução, descrições, metadados e inputs → `font-body text-xs` (ou `text-sm`)
- Números de parágrafos/contadores → `font-body tabular-nums`
- Badges e microrrótulos de sistema ("PRÉVIA DO LEITOR", "+ INSERIR", "BLOCO", etc.) → `font-pixel text-[12px] uppercase`
- Botões de inserção e ações → `font-display text-xs uppercase tracking-wider`

### 2.2 Microcopy de Rua & Coerência nos Dashboards
- Revisar `CreatorWorkspacePage.tsx`, `CreatorKpiHeader.tsx`, `CreatorOverviewTab.tsx` e `CreatorMissionsPanel.tsx` para assegurar a voz direta, crua e de banca de rua independente em pt-BR.

---

## 3. Critérios de Aceite

- [ ] Zero ocorrências de `font-mono` nos arquivos `.tsx` do frontend (busca por `font-mono` retorna 0).
- [ ] Silkscreen (`font-pixel`) sempre com tamanho mínimo de 12px (`text-[12px]`).
- [ ] Números e métricas utilizam `font-body` (ou `font-display`) com `tabular-nums`.
- [ ] `npm run build` passa com 0 erros de compilação TypeScript.
- [ ] `npm test` passa com 100% dos testes verdes.
- [ ] Relatório emitido em `docs/orquestracao/frontend/relatorios/RELATORIO-118.md`.

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
