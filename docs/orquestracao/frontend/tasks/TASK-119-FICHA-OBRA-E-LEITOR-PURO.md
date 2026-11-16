# TASK-119 — Ficha da Obra & Modo Leitor Puro (Fase 6)

**Projeto:** MangaNetWorking  
**Camada:** Frontend (React/TypeScript)  
**Prioridade:** ALTA  
**Responsável:** OpenCode Frontend Worker  
**Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## 1. Contexto e Diagnóstico

### Diretrizes Rígidas do Design System para Leitura & Obras
- **O Modo Leitor é Sagrado:**
  A experiência de leitura deve ser 100% imersiva, limpa e escura (`--mn-ink`).
  São **proibidos** adesivos decorativos, fitas, halftones, texturas e mascotes sobre a leitura.
  A barra de progresso fina e o botão de próximo capítulo são os únicos elementos com amarelo discreto.
- **Ficha da Obra:**
  Apresentação editorial limpa com capa 2:3 vertical em destaque, lista de capítulos em linhas (não cards) com números em Anton e metadados em Archivo tabular.
- **Não-conformidades localizadas na auditoria:**
  1. `WorkDetailHero.tsx`: Possui uma sombra gigante artificial `shadow-[6px_6px_0_var(--mn-paper)]` num container estático.
  2. `WorkCreatorSidebar.tsx`: Possui caixas fechadas com `border-2 border-[var(--mn-line)]` criando ruído na barra lateral.
  3. `WorkChapterList.tsx`: Utiliza token inexistente `text-[var(--mn-teal)]` e microrrótulos abaixo de 12px (`text-[10px]`, `text-[11px]`).
  4. `MangaReaderView.tsx`: Possui literais hexadecimais residuais (`bg-[#000000]`).
  5. `ChapterEndPanel.tsx`: Possui caixa amarela berrante no leitor (`border-2 border-[var(--mn-yellow)]`) e hexadecimal literal (`bg-[#101114]`).

---

## 2. Escopo Cirúrgico de Modificações

### 2.1 Ficha da Obra (`frontend/src/components/work/`)
1. **`WorkDetailHero.tsx`**:
   - Remover a sombra dura estática `shadow-[6px_6px_0_var(--mn-paper)]`.
   - Adotar container limpo com fundo chapado e borda sutil:
     `border border-[var(--mn-line)] bg-[var(--mn-ink-2)] p-6 sm:p-8 relative overflow-hidden`
2. **`WorkCreatorSidebar.tsx`**:
   - Remover bordas perimétricas pesadas `border-2 border-[var(--mn-line)]` nos blocos estáticos do autor e detalhes de publicação, adotando fundo chapado sutil `bg-[var(--mn-ink-2)] border border-[var(--mn-line)] p-5 space-y-4`.
3. **`WorkChapterList.tsx`**:
   - Substituir `text-[var(--mn-teal)]` por token oficial `text-[var(--mn-ok)]`.
   - Elevar todos os microrrótulos em Silkscreen para o tamanho mínimo oficial: `text-[12px] font-pixel`.

### 2.2 Modo Leitor Puro & Imersivo (`frontend/src/components/reader/`)
4. **`MangaReaderView.tsx`**:
   - Substituir todas as ocorrências de `bg-[#000000]` pelo token oficial `bg-[var(--mn-ink)]`.
   - Garantir que as páginas e o leitor webcomic estejam 100% livres de contornos e decorações.
5. **`ChapterEndPanel.tsx`**:
   - Substituir `border-2 border-[var(--mn-yellow)]` por divisor sutil `border-t-2 border-[var(--mn-line)]` com fundo imersivo `bg-[var(--mn-ink-2)]`.
   - Substituir `bg-[#101114]` pelo token `bg-[var(--mn-ink-3)]`.
   - Manter o botão de próximo capítulo com destaque amarelo único e claro.

---

## 3. Critérios de Aceite

- [ ] Modo Leitor 100% limpo, sem sombras pesadas, sem adesivos e sem halftones sobre as páginas.
- [ ] Purga de todos os hexadecimais literais (`#000000`, `#101114`) no Modo Leitor.
- [ ] Remoção da cor não oficial `mn-teal` em `WorkChapterList.tsx`.
- [ ] Ficha da Obra despoluída sem a sombra estática gigante `shadow-[6px_6px_0_var(--mn-paper)]`.
- [ ] Todos os microrrótulos respeitam o tamanho mínimo de 12px em `font-pixel`.
- [ ] `npm run build` passa com 0 erros TypeScript.
- [ ] `npm test` passa com 100% dos testes verdes.
- [ ] Relatório emitido em `docs/orquestracao/frontend/relatorios/RELATORIO-119.md`.

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
