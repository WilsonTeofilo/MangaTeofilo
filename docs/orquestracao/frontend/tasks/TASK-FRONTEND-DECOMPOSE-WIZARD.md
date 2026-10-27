# TASK-FRONTEND-DECOMPOSE-WIZARD: Decomposição Modular de Componentes Monolíticos

> **Data:** 26 de Outubro de 2026  
> **Responsável:** OpenCode Frontend  
> **Supervisão:** Hermes (Tech Lead & Arquiteto)  
> **Status:** Aberto para Execução  

---

## 1. Objetivo Técnico
Fatiar os dois maiores componentes monolíticos do frontend (`LightNovelChapterWizard.tsx` com 1.443 linhas e `ReaderPage.tsx` com 1.129 linhas) em submódulos atômicos e coesos, desacoplando estado, regras de negócio e renderização de acordo com o Princípio da Responsabilidade Única (SRP).

---

## 2. Requisitos de Implementação

### 2.1. Fatiamento de `LightNovelChapterWizard.tsx` (1.443 linhas → Componentes Modulares)
Criar o diretório `frontend/src/components/creator/novel/` e extrair os seguintes submódulos:

1. **`useLightNovelEditor.ts` (Custom Hook de Domínio):**
   - Centralizar os 19 estados locais (`step`, `blocks`, `chapterType`, `dirty`, `savedAt`, etc.).
   - Lógica de inserção de blocos (`addTextBlock`, `addIllustrationBlock`, `addSceneBreakBlock`).
   - Lógica de movimentação (`moveBlockUp`, `moveBlockDown`, drag-and-drop).
   - Lógica de persistência em `localStorage` (autosave/restore de rascunho com aviso).
   - Validações da política editorial (`countVisibleProseCharacters`, limites de 1k-30k e teto de 6 imagens).

2. **Subcomponentes das 4 Etapas:**
   - `NovelDetailsStep.tsx`: Etapa 1 (Tipo de capítulo, número, título, data de agendamento e capa opcional com `ImageCropper`).
   - `NovelBlockEditorStep.tsx`: Etapa 2 (Lista de blocos, toolbar de inserção, dropzone e atalhos).
   - `NovelReviewStep.tsx`: Etapa 3 (Sumário de caracteres, contagem de imagens, avisos da política editorial e pré-visualização fiel).
   - `NovelPublishStep.tsx`: Etapa 4 (Checklist final de conformidade e botão de publicação).

3. **Subcomponentes Atômicos de Blocos:**
   - `NovelBlockItem.tsx`: Componente base de renderização de bloco individual.
   - `ParagraphBlock.tsx`: Textarea expansível com foco automático.
   - `IllustrationBlock.tsx`: Preview da imagem, input de legenda e remoção.
   - `SceneBreakBlock.tsx`: Renderização do separador `* * *`.

4. **`LightNovelChapterWizard.tsx` (Container Limpo):**
   - Atua apenas como orquestrador do fluxo, reduzindo o arquivo principal para menos de 200 linhas de código limpo e declarativo.

---

### 2.2. Fatiamento de `ReaderPage.tsx` (1.129 linhas → Modos Dedicados)
Extrair as visões específicas de leitura para submódulos independentes:

1. **`MangaReaderView.tsx`:**
   - Focado na renderização de páginas de imagem (modo paginado com duplo clique, zoom e transição lateral, e modo scroll vertical contínuo).
2. **`ProseReaderView.tsx`:**
   - Focado na renderização fluida dos blocos de light novel (`contentBlocks`).
3. **`ReaderProseSettingsBar.tsx`:**
   - Barra suspensa de personalização de leitura de prosa (família de fonte serif/sans, tamanho 15-26px, entrelinha e largura da coluna de leitura).
4. **`useReaderTelemetry.ts`:**
   - Hook isolado para despacho de `VIEW` diário e `READ` deduplicado por progresso de página no MongoDB.

---

## 3. Critérios de Aceite
- [ ] `LightNovelChapterWizard.tsx` reduzido para < 250 linhas, delegando lógica para `useLightNovelEditor` e submódulos em `novel/`.
- [ ] `ReaderPage.tsx` reduzido para < 350 linhas, delegando visualização para `MangaReaderView` e `ProseReaderView`.
- [ ] Nenhuma quebra de regressão visual ou funcional nos fluxos de publicação e leitura.
- [ ] `npm run build` verde, sem erros de tipagem TypeScript ou ciclos de dependência.

---

*Assinado por: Hermes (Tech Lead & Arquiteto)*
