# TASK-124 — Creator Flow: UX, Anti-Monolito e Correções de Consistência

**Data:** 2026-11-18  
**Prioridade:** 🟡 Alta  
**Escopo:** Frontend · Wizards de capítulo (Mangá e Light Novel) · Formulário de obra  
**Pré-requisito:** TASK-SECURITY-001 (backend) pode rodar em paralelo — sem dependência de contrato aqui.

---

## Contexto

Auditoria completa dos fluxos de criação de obra e publicação de capítulos revelou:
- 1 bug de step-lock no `LightNovelChapterWizard`
- 1 token CSS inexistente (`var(--mn-green)`) 
- Falta de `chapterType` no Manga Wizard (LN tem, Manga não tem — inconsistente)
- Formulário de obra (`CreatorWorkForm`) com lacunas de UX (capa sem asterisco de obrigatoriedade, sem CTA pós-criação, formato sem contexto)
- Falta de draft persistence no Manga Wizard (LN tem `localStorage`, Manga não tem)

---

## Arquivos Autorizados para Leitura

```
frontend/src/components/creator/LightNovelChapterWizard.tsx
frontend/src/components/creator/novel/useLightNovelEditor.ts
frontend/src/components/creator/novel/novelEditorTypes.ts
frontend/src/components/creator/novel/NovelDetailsStep.tsx
frontend/src/components/creator/manga/MangaChapterWizard.tsx
frontend/src/components/creator/manga/useMangaChapterEditor.ts
frontend/src/components/creator/manga/mangaEditorTypes.ts
frontend/src/components/creator/manga/MangaReviewStep.tsx
frontend/src/components/creator/works/CreatorWorkForm.tsx
docs/orquestracao/frontend/DESIGN-SYSTEM-OFICIAL.md
docs/orquestracao/frontend/NEGATIVE-PROMPTS-FRONTEND.md
```

---

## Correções Obrigatórias (Bugs)

### #1 — Token CSS inexistente: `var(--mn-green)` → `var(--mn-ok)`

**Arquivo:** `LightNovelChapterWizard.tsx` linha 127

```tsx
// ERRADO — var(--mn-green) não existe no Design System
<div className="border-2 border-[var(--mn-green)] bg-[var(--mn-green)]/10 ...">

// CORRETO — usar token oficial
<div className="border-2 border-[var(--mn-ok)] bg-[var(--mn-ok)]/10 p-3 text-xs font-body text-[var(--mn-ok)]">
```

---

### #2 — Step lock ausente no LightNovelChapterWizard

**Arquivo:** `LightNovelChapterWizard.tsx` linha 79

Atualmente o step-nav permite clicar em qualquer etapa sem validação:
```tsx
onClick={() => editor.setStep(s.id)}
```

**Exigido:** Implementar `maxStep` no `useLightNovelEditor` (espelho exato do `maxStep` do `useMangaChapterEditor`) e usar `Math.min(target, maxStep)` no click:

```tsx
// Em useLightNovelEditor.ts — adicionar (já existe estrutura análoga no useMangaChapterEditor):
const contentReady = editor.blocks.length > 0 && editor.editorial.valid;
const maxStep = useMemo(() => {
  if (isEditing) return 4;
  if (!titleValid) return 1;          // step 1: Detalhes
  if (!contentReady) return 2;        // step 2: Escrever
  return 4;                           // steps 3-4 liberados
}, [isEditing, titleValid, contentReady]);

// Em LightNovelChapterWizard.tsx — no onClick do step nav:
onClick={() => editor.goToStep(s.id)}
// goToStep já existe em useMangaChapterEditor como Math.min(Math.max(1, target), maxStep)
// Implementar o mesmo em useLightNovelEditor
```

> [!IMPORTANT]
> Em modo **edição** (`editingNumber != null`), `maxStep` deve ser sempre 4 (todos os steps liberados), igual ao comportamento do Manga Wizard. Autor editando deve poder navegar livremente.

---

### #3 — Adicionar `chapterType` ao Manga Wizard (paridade com LN)

**Arquivos:** `useMangaChapterEditor.ts` + `MangaReviewStep.tsx`

O backend já aceita `chapterType` para capítulos IMAGE_PAGES (enum `ChapterType`: `REGULAR`, `SPECIAL`, `PROLOGUE`). O frontend Manga nunca envia — defaul é `REGULAR` no backend.

**Exigido:** Adicionar seletor de tipo no step 4 (Revisar/Metadados) do `MangaChapterWizard`:

**Em `useMangaChapterEditor.ts`:**
```ts
// Adicionar estado
const [chapterType, setChapterType] = useState<'REGULAR' | 'SPECIAL' | 'PROLOGUE'>('REGULAR');

// Incluir no payload de publish():
chapterType,
```

**Em `MangaReviewStep.tsx` — adicionar seletor de tipo (UI):**
```tsx
// Seletor de 3 opções, estilo "pill" com borda 2px, sem rounded-xl
// Opções: REGULAR | ESPECIAL | PRÓLOGO
// Mesmo padrão visual do NovelDetailsStep
```

**Regras do backend que o frontend deve reforçar:**
- `PROLOGUE` → campo `chapterNumber` deve ser fixado em `0`
- Se a obra já tem um prólogo (backend retornará erro), mostrar mensagem clara: "Esta obra já possui um prólogo."

> [!NOTE]
> **NÃO inventar contrato**: o campo `chapterType` já está em `CreateChapterRequestDto` no backend. Checar `workApi.ts` para confirmar que o payload o inclui antes de enviar.

---

## Melhorias de UX

### #4 — CreatorWorkForm: Capa obrigatória sem indicador visual

**Arquivo:** `frontend/src/components/creator/works/CreatorWorkForm.tsx`

**Problema:** O campo de capa é obrigatório (backend valida), mas no frontend não há asterisco nem hint text.

**Correção:** Adicionar ao label do campo de capa:
```tsx
<label className="font-display text-xs uppercase text-[var(--mn-mute)] tracking-wider">
  CAPA DA OBRA <span className="text-[var(--mn-red)]">*</span>
  <span className="ml-1 font-body normal-case text-[10px]">Retrato 2:3 — obrigatória</span>
</label>
```

---

### #5 — CreatorWorkForm: Sem CTA após criação bem-sucedida

**Arquivo:** `frontend/src/components/creator/works/CreatorWorkForm.tsx`

Após criação bem-sucedida de obra (callback `onSuccess`), atualmente o form fecha silenciosamente.

**Exigido:** Antes de fechar, mostrar uma mensagem de sucesso com CTA por 3 segundos:
```
✅ Obra criada! Publique o primeiro capítulo agora →
```
O link "→" deve navegar para `?aba=obras&obra={workId}` (abre a tab de capítulos pré-selecionada para a obra recém-criada). Após 3 segundos sem clique, fecha normalmente.

---

### #6 — CreatorWorkForm: Format selector sem contexto educacional

**Arquivo:** `frontend/src/components/creator/works/CreatorWorkForm.tsx`

Abaixo do seletor `MANGÁ / LIGHT NOVEL`, adicionar um bloco de ajuda contextual (apenas quando o usuário ainda não fez upload de nenhum capítulo — em modo criação):

```tsx
<p className="text-[10px] font-body text-[var(--mn-mute)] mt-1">
  {format === 'MANGA'
    ? 'Mangá: capítulos publicados como páginas de imagem (JPG/PNG/WebP).'
    : 'Light Novel: capítulos escritos em blocos de texto com editor visual.'}
</p>
```

---

### #7 — MangaChapterWizard: Draft persistence com localStorage

**Arquivo:** `frontend/src/components/creator/manga/useMangaChapterEditor.ts`

O `useLightNovelEditor.ts` já persiste rascunho em `localStorage` com `recoverable`, `restoreDraft`, `discardStoredDraft`. O Manga Wizard não tem essa funcionalidade — se o autor fechar a aba com 20 páginas prontas, perde tudo.

**Exigido:** Implementar draft persistence **apenas para metadados** (não para as imagens, pois `File` objects não são serializáveis):

```ts
// Chave: `mn:manga-draft:${workId}`
// Salvar: { chapterTitle, releaseDate, chapterType, savedAt }
// NÃO salvar: pages (FileList não é serializável)

// Recuperar ao montar:
// Se existir rascunho no localStorage com savedAt < 24h, mostrar banner:
// "Metadados de capítulo não publicado recuperados de HH:MM. Restaurar?"
```

> [!NOTE]
> As páginas em si (imagens) não podem ser armazenadas no localStorage. O banner deve deixar claro: "Seus textos e configurações foram recuperados. As imagens precisam ser reenviadas."

---

## Anti-Monolito (Refatoração de Limpeza)

### #8 — LightNovelChapterWizard: Já decomposed — só garantir orquestrador limpo

**Arquivo:** `LightNovelChapterWizard.tsx` (311 linhas)

O wizard LN já usa `NovelDetailsStep`, `NovelBlockEditorStep`, `NovelReviewStep`, `NovelPublishStep` como subcomponentes. Porém o arquivo ainda tem 311 linhas porque embute o `<ImageCropper>` inline (linhas 162–210) e a lógica de crop inline.

**Exigido:** Extrair o bloco `{editor.coverCropOpen && <ImageCropper .../>}` para dentro de `NovelDetailsStep.tsx` como prop `cropOpen={editor.coverCropOpen}`, com as props necessárias passadas via interface. Reduzir `LightNovelChapterWizard.tsx` para abaixo de 200 linhas.

---

## Checklist de Aceite

### Bugs
- [ ] `var(--mn-green)` → `var(--mn-ok)` em `LightNovelChapterWizard.tsx` linha 127
- [ ] Step nav do LN wizard tem gating: não é possível pular do step 1 para o step 3 sem preencher conteúdo
- [ ] Em modo edição (LN), todos os steps ficam desbloqueados
- [ ] Manga Wizard envia `chapterType` no payload (`REGULAR` por default)
- [ ] Seletor de tipo visível no step 4 do Manga Wizard

### UX
- [ ] Campo de capa tem asterisco vermelho e hint "Retrato 2:3 — obrigatória"
- [ ] Após criar obra, aparece banner de sucesso com CTA "Publique o primeiro capítulo" por 3 segundos
- [ ] Format selector mostra texto explicativo contextual (Mangá vs LN)
- [ ] Manga Wizard salva `chapterTitle`, `releaseDate`, `chapterType` no localStorage e mostra banner de recuperação

### Anti-Monolito
- [ ] `LightNovelChapterWizard.tsx` abaixo de 200 linhas com `<ImageCropper>` delegado a `NovelDetailsStep`

### Qualidade
- [ ] `npm test -- --run` → 46/46 ✅ (nenhum teste pode regredir)
- [ ] `npm run build` → 0 erros, nenhum chunk > 500 kB
- [ ] Nenhum `var(--mn-green)`, `var(--mn-teal)`, cor hexadecimal ou `.EXE` novo introduzido
- [ ] Nenhum `rounded-xl`, `rounded-2xl` ou `rounded-3xl` novo
- [ ] Nenhum `font-mono` novo

---

## NEGATIVE PROMPTS (NÃO FAÇAS)

- ❌ Não inventar endpoints ou campos de API que não existem
- ❌ Não tocar em arquivos do modo Leitor (`/ler/:id`)
- ❌ Não criar novos componentes com dependências de bibliotecas externas
- ❌ Não usar `any` novo sem `// eslint-disable`
- ❌ Não usar `card-in-card` aninhamento
- ❌ Não redesenhar o layout dos wizards — apenas adições cirúrgicas
- ❌ Não modificar `AppTabRouter.tsx` (já tratado na TASK-123)

---

## Ordem de Execução Recomendada

1. Bug #1 (1 linha) → mais fácil, confirmar build verde
2. Bug #2 (`useLightNovelEditor.ts` + wizard nav) 
3. Bug #3 (chapterType no Manga)
4. Melhorias #4, #5, #6 (`CreatorWorkForm` — 3 ajustes pontuais)
5. Melhoria #7 (localStorage draft Manga)
6. Anti-monolito #8 (extrair ImageCropper)

---

## Git Commit

```bash
# MangaNetWorking (código)
cd D:\Projetos\MangaNetWorking
git add .
git commit -m "feat(creator-flow): UX improvements + LN step lock + manga chapterType (TASK-124)"
git push origin develop
git checkout main
git merge develop --no-ff -m "Merge TASK-124: creator flow UX"
git push origin main
git checkout develop

# MangaTeofilo (docs)
cd D:\Projetos\MangaTeofilo
git add .
git commit -m "docs: add TASK-124 spec"
git push origin develop
git checkout main
git merge develop
git push origin main
git checkout develop
```

---

## Relatório

Após implementar, criar:
`docs/orquestracao/frontend/relatorios/RELATORIO-TASK-124.md`

Conteúdo mínimo:
- Lista de arquivos modificados com contagem de linhas antes/depois
- Resultado de `npm test -- --run`
- Resultado de `npm run build` (tamanho dos chunks principais)
- Assinatura: `Assinado por: OpenCode Frontend`

---

*Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)*
