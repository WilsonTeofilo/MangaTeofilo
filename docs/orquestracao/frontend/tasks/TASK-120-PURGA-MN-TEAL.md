# TASK-120 — Purga Global do Token Inválido `mn-teal`

**Responsável:** OpenCode Frontend Worker  
**Repo:** `d:\Projetos\MangaNetWorking\frontend\src`  
**Status:** 🔴 Pendente  
**Prioridade:** Alta (token CSS fantasma sem definição em tokens.css)

---

## Contexto e Problema

O token `--mn-teal` é referenciado em **25 locais** espalhados por 13 arquivos do `src/`.
Ele **NÃO existe** em `src/styles/tokens.css` — portanto resulta em `var(undefined)` em runtime,
herdando a cor padrão do browser ao invés da cor correta.

O token oficial de sucesso/positivo do design system é `--mn-ok` (#3DDC84), que já existe em tokens.css.
Todos os contextos onde `mn-teal` aparece são contextos de feedback positivo (sucesso, confirmação, estado ativo ok).

---

## Arquivos a Modificar

> Substitua **TODAS** as ocorrências de `mn-teal` por `mn-ok` nos arquivos listados abaixo.
> Use busca literal `mn-teal` → substituição literal `mn-ok` em toda string do arquivo.
> NÃO altere lógica, props, estrutura JSX ou qualquer outra coisa fora desta substituição.

| Arquivo | Linhas com `mn-teal` |
|---|---|
| `src/components/account/AccountSecurityTab.tsx` | 179, 216 |
| `src/components/creator/charts/CreatorDailyChart.tsx` | 76, 96, 163 |
| `src/components/creator/charts/CreatorRealtimeBars.tsx` | 36 |
| `src/components/creator/charts/CreatorRetentionCurve.tsx` | 56 |
| `src/components/auth/RegisterForm.tsx` | 130 |
| `src/components/work/CommentItem.tsx` | 62, 81 |
| `src/components/work/WorkCommentsPanel.tsx` | 130 |
| `src/components/creator/MangaChapterWizard.tsx` | 19, 51, 157 |
| `src/components/creator/CreatorWorkForm.tsx` | 269 |
| `src/pages/BecomeWriterPage.tsx` | 76, 137, 152 |
| `src/pages/OnboardingPage.tsx` | 17 |
| `src/pages/creator/CreatorChaptersPage.tsx` | 272, 275, 284, 321, 322 |
| `src/pages/creator/CreatorMonetizationPage.tsx` | 107 |

---

## Regra de Substituição

```
ANTES: var(--mn-teal)         → DEPOIS: var(--mn-ok)
ANTES: border-[var(--mn-teal)] → DEPOIS: border-[var(--mn-ok)]
ANTES: text-[var(--mn-teal)]  → DEPOIS: text-[var(--mn-ok)]
ANTES: bg-[var(--mn-teal)]    → DEPOIS: bg-[var(--mn-ok)]
ANTES: stroke="var(--mn-teal)"→ DEPOIS: stroke="var(--mn-ok)"
```

Em resumo: qualquer substring `mn-teal` vira `mn-ok`.

---

## Critérios de Aceite

- [ ] `mn-teal` retorna 0 resultados em busca recursiva no `src/`
- [ ] `npm run build` retorna 0 erros TypeScript
- [ ] `npm run test -- --run` continua com 42/42 testes passando
- [ ] Nenhuma lógica ou estrutura JSX foi alterada — apenas o token CSS

---

## Restrições (Design System — INVIOLÁVEIS)

- NÃO adicione `--mn-teal` ao `tokens.css` — ele NÃO deve existir no sistema
- NÃO use hex literals (#3DDC84) — use exclusivamente `var(--mn-ok)`
- NÃO altere nenhum outro token, classe ou prop além do alvo desta task
- NÃO use OpenCode CLI — use as ferramentas nativas de edição de arquivo

---

## Relatório Final

Ao concluir, crie o arquivo:
`docs/orquestracao/frontend/relatorios/RELATORIO-120.md`

Com o seguinte conteúdo:
- Lista de arquivos modificados
- Resultado dos testes (`npm run test -- --run`)
- Resultado do build (`npm run build`)
- Status: ✅ Concluído

Assinado por: OpenCode Frontend Worker
