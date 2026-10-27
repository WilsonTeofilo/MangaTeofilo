# RELATÓRIO DE AUDITORIA & EXECUÇÃO — FRONTEND (SEGURANÇA XSS, INTEGRIDADE DE DADOS & UX)

**Data:** 26/10/2026  
**Status:** CONCLUÍDO COM SUCESSO  
**Escopo:** Leitor e Editor de Light Novels (`ProseReaderView.tsx`, `NovelBlockItem.tsx`, `useLightNovelEditor.ts`, `novelEditorTypes.ts`, `NovelBlockEditorStep.tsx`)

---

## 1. Sumário Executivo

Esta auditoria e intervenção sanou vulnerabilidades de segurança (injeção de scripts via XSS), inconsistências funcionais de UX no upload de ilustrações, falhas de integridade ao restaurar rascunhos do `localStorage` e unificou os tokens de design sob a cartilha oficial da **Banca de Rua**.

O frontend foi compilado e validado via `tsc && vite build`, sem quaisquer erros de tipagem TypeScript ou quebras de contrato.

---

## 2. Ações Implementadas & Blindagens de Segurança

### 2.1. Eliminação Absoluta de Risco XSS (`ProseReaderView.tsx`)
- **Vulnerabilidade Prévia:** O leitor de prosa utilizava `dangerouslySetInnerHTML` com substituição ingênua de quebras de linha (`replace(/\n/g, '<br/>')`), abrindo brecha para injeção de HTML malicioso e tags de script se o conteúdo de um capítulo contivesse vetores de ataque.
- **Correção Defensiva:** Remoção completa da flag `dangerouslySetInnerHTML`. As quebras de linha são renderizadas nativamente pela árvore virtual do React:
  ```tsx
  {block.type === 'text' && block.content.text && (
    <div className="prose-block-text">
      {block.content.text.split('\n').map((line, lineIdx) => (
        <span key={lineIdx}>
          {lineIdx > 0 && <br />}
          {line}
        </span>
      ))}
    </div>
  )}
  ```

### 2.2. Correção Funcional do Seletor de Arquivos (`NovelBlockItem.tsx`)
- **Problema:** Ao clicar no botão "Trocar arquivo", era executado `fileInputRef(null)`, que apenas desassociava a referência do elemento React sem acionar o diálogo nativo do sistema operacional.
- **Correção:** Introduzida a prop `onClickFileInput` que dispara programaticamente `.click()` no `<input type="file" ref={...}>` do bloco, permitindo substituição imediata e fluida de ilustrações pelo criador.

### 2.3. Blindagem contra Schema Corrompido no LocalStorage (`useLightNovelEditor.ts`)
- **Problema:** O hook `useLightNovelEditor` desserializava os rascunhos recuperados do `localStorage` e os aplicava diretamente ao estado do componente, arriscando corromper a renderização se o schema salvo fosse inválido ou corrompido por versões antigas.
- **Correção:** Desenvolvida a função pura e defensiva `sanitizeRestoredBlocks(rawBlocks: unknown[]): EditorBlock[]`. Todo bloco recuperado é validado campo a campo, garantindo que `type`, `key`, `text`, `fileId`, `width` e `style` correspondam estritamente aos tipos do domínio.

### 2.4. Validação Estrita de MIME Type no Upload
- **Problema:** O dropzone e os inputs de arquivo podiam aceitar extensões ou MIME types indesejados (como vetores SVG maliciosos ou binários).
- **Correção:** 
  - Restrição explícita no elemento nativo: `accept="image/jpeg,image/png,image/webp"`.
  - Validação rigorosa em runtime no manipulador `handleIllustrationUpload`:
    ```ts
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('Formato não suportado. Envie apenas imagens nos formatos JPEG, PNG ou WebP.');
      return;
    }
    ```

### 2.5. Harmonização de Glifos dos Separadores (`novelEditorTypes.ts`)
- Padronizada a função centralizada `getSeparatorGlyph(style)` garantindo consistência visual de 100% entre a área de edição do autor, a pré-visualização e a visualização final do leitor:
  - `scene`: `• • •`
  - `time`: `~ ~ ~`
  - `pov`: `◆ ◆ ◆`
  - `line`: `—`

### 2.6. Unificação dos Design Tokens ("Banca de Rua")
- Expurgo total de cores hexadecimais literais soltas (`#FFD400`, `#0B0B0C`, `#151517`, `#34343A`, `#F4EFE3`, `#A9A59A`) em todos os componentes de leitura e edição de Light Novel.
- Aplicação uniforme das variáveis CSS oficiais do tema:
  - `var(--mn-yellow)` — Destaques e acentos
  - `var(--mn-ink)` e `var(--mn-ink-2)` — Fundos e painéis de leitura
  - `var(--mn-line)` — Delimitadores de blocos e molduras
  - `var(--mn-paper)` e `var(--mn-paper-muted)` — Tipografia de leitura
  - `var(--mn-mute)` — Textos secundários, contadores e metadados

---

## 3. Verificação de Integridade

- **Compilação TypeScript / Vite Build:**
  ```text
  > manganetworking@1.0.0 build
  > tsc && vite build

  ✓ 1691 modules transformed.
  dist/index.html   0.76 kB
  dist/assets/index-C9P8FOwz.css  95.59 kB
  dist/assets/index-BSih0wom.js  645.87 kB
  ✓ built in 2.30s
  ```
- **Auditoria de Tokens Hexadecimais & XSS:**
  - `Get-ChildItem frontend/src/components/reader | Select-String "dangerouslySetInnerHTML|#FFD400..."`: 0 ocorrências.
  - `Get-ChildItem frontend/src/components/creator/novel | Select-String "dangerouslySetInnerHTML|#FFD400..."`: 0 ocorrências.

---

**Assinado por:** OpenCode Frontend  
**Validado por:** Hermes (Tech Lead / Gerente / Arquiteto)
