# TASK-122 — Purga de Títulos .EXE e Cores Hexadecimais em DonateModal e EarlyAccessModal

**Data:** 2026-11-18  
**Responsável:** OpenCode Frontend  
**Tech Lead:** Hermes (Tech Lead / Gerente / Arquiteto)  
**Status:** ESPECIFICADO  

---

## 1. Contexto e Motivação

Na continuidade da padronização total dos modais do Design System "Banca de Rua", identificamos que os dois modais restantes em `src/components/modals/` ainda continham resíduos de estética retrô hacker (.EXE) e cores hexadecimais literais:

1. **`DonateModal.tsx`**:
   - `title="APOIAR_AUTOR.EXE"` → deve ser padronizado para `"APOIAR AUTOR"`.
   - Purga de literais hexadecimais: `#0B0B0C` → `var(--mn-ink-2)` ou `var(--mn-ink)`, `#34343A` → `var(--mn-line)`, `#FFD400` → `var(--mn-yellow)`, `#A9A59A` → `var(--mn-mute)`, `#F4EFE3` → `var(--mn-paper)`.

2. **`EarlyAccessModal.tsx`**:
   - `title="ACESSO_ANTECIPADO.EXE"` → deve ser padronizado para `"ACESSO ANTECIPADO"`.
   - Purga de literais hexadecimais: `#0B0B0C` → `var(--mn-ink-2)` ou `var(--mn-ink)`, `#34343A` → `var(--mn-line)`, `#FFD400` → `var(--mn-yellow)`, `#A9A59A` → `var(--mn-mute)`, `#F4EFE3` → `var(--mn-paper)`.
   - Sombra dura `#FFD400` → `var(--mn-yellow)`.

---

## 2. Arquivos a Alterar

1. `frontend/src/components/modals/DonateModal.tsx`
2. `frontend/src/components/modals/EarlyAccessModal.tsx`

---

## 3. Critérios de Aceite

- [ ] Zero menções a `.EXE` em títulos de modais em toda a aplicação.
- [ ] 100% dos modais em `src/components/modals/` usando estritamente os tokens CSS `var(--mn-*)`.
- [ ] Suíte de testes `npm test -- --run` no frontend passando 100% verde (46+ testes).
- [ ] `npm run build` passando com 0 erros de TypeScript.
- [ ] Relatório `docs/orquestracao/frontend/relatorios/RELATORIO-TASK-122.md` gerado.

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
