# TASK-121 — Polimento Final de Design System, Eliminação de N+1 de Rede e Code-Splitting

**Data:** 2026-11-18  
**Responsável:** OpenCode Frontend  
**Tech Lead:** Hermes (Tech Lead / Gerente / Arquiteto)  
**Status:** ESPECIFICADO  

---

## 1. Contexto e Motivação

Após a auditoria pente-fino das telas e componentes, identificamos três gargalos e inconsistências no Frontend que corroem a performance e violam as regras do Design System "Banca de Rua":

1. **N+1 Sequencial de Requisições HTTP em `CreatorChaptersPage.tsx`**:
   Ao selecionar uma obra, a página executava um `for...of` com `await workApi.readChapter` para **todos** os capítulos existentes apenas para ler `pages.length` e adiantar o draft. Em obras com dezenas de capítulos, isso dispara dezenas de requisições HTTP em fila, travando a navegação do autor no celular e sobrecarregando o backend.
   *Solução*: Carregar a lista com os dados do resumo da obra (`work.chapters`) e fazer o fetch do capítulo completo (`readChapter`) sob demanda (lazy) apenas no momento em que o autor clica no botão "EDITAR" (exibindo estado de carregamento no botão).

2. **Purga de Resíduos Hexadecimais e Microcopy Retrô Hacker**:
   - `Modal.tsx`: casca base de modais ainda possui literais `#0B0B0C`, `#151517`, `#FFD400`, `#F4EFE3`.
   - `VipModal.tsx`: título `ASSINATURA_VIP.EXE` (estética hacker ultrapassada) e cores `#0B0B0C`, `#FFD400`, `#A9A59A`, `#F4EFE3`, `#3DDC84`.
   - `MembershipModal.tsx`: título `CLUBE_MEMBROS.EXE` e cores literais `#0B0B0C`, `#FFD400`, `#A9A59A`, `#F4EFE3`, `#3DDC84`.
   - `ReportModal.tsx`: cores `#0B0B0C`, `#FFD400`, `#A9A59A`, `#F4EFE3`, `#E53935`.
   - `Footer.tsx`: rodapé principal inteiro usando `#0B0B0C`, `#FFD400`, `#F4EFE3`, `#A9A59A`.
   - `HomeRankingsSidebar.tsx`, `PublicProfilePage.tsx`, `AccountProfileHeader.tsx`: resíduos de sombras `shadow-[..._#000000]`. Devem usar `var(--mn-ink)` ou classes sem cor hexadecimal pura.

3. **Garantia de Não-Regressão**:
   - Todos os 46 testes no Vitest (`npm test -- --run`) devem continuar 100% verdes.
   - Build do Vite (`npm run build`) deve passar com 0 erros de TypeScript.
   - Nenhuma funcionalidade de leitura, moderação, edição de capítulo ou perfil pode ser perdida.

---

## 2. Arquivos a Alterar

1. `frontend/src/pages/CreatorChaptersPage.tsx`
2. `frontend/src/components/common/Modal.tsx`
3. `frontend/src/components/modals/VipModal.tsx`
4. `frontend/src/components/modals/MembershipModal.tsx`
5. `frontend/src/components/modals/ReportModal.tsx`
6. `frontend/src/components/layout/Footer.tsx`
7. `frontend/src/components/home/HomeRankingsSidebar.tsx`
8. `frontend/src/components/account/AccountProfileHeader.tsx`
9. `frontend/src/pages/PublicProfilePage.tsx`

---

## 3. Instruções Detalhadas de Implementação

### 3.1 `CreatorChaptersPage.tsx` — Eliminação do N+1 de Rede
- Na listagem de capítulos de uma obra selecionada:
  - Usar os dados já retornados em `work.chapters` (como `chapterNumber`, `title`, `coverUrl`, `publicReleaseAt`).
  - Não disparar `workApi.readChapter` em loop para todos os capítulos.
  - Ao clicar em "EDITAR", definir um estado `loadingChapterNumber === chapter.chapterNumber`.
  - Disparar `workApi.readChapter(selectedWork.slug, chapter.chapterNumber)` de forma assíncrona pontual.
  - Ao resolver, montar o `editing` draft com as páginas/blocos e abrir o wizard de edição.
  - Limpar `loadingChapterNumber`. Se der erro, exibir mensagem amigável no alerta de erro.
  - Para a contagem de páginas/caracteres no item da lista: se o resumo não tiver, exibir badge informativo baseado no formato ou informações disponíveis sem bloquear a listagem.

### 3.2 Modais — Purga de Cores e Estética "Banca de Rua"
- `Modal.tsx`:
  - `bg-[#0B0B0C]/85` → `bg-[var(--mn-ink)]/85`
  - `bg-[#151517]` → `bg-[var(--mn-ink-2)]`
  - `border-[#0B0B0C]` → `border-[var(--mn-line)]`
  - `shadow-[8px_8px_0_#FFD400]` → `shadow-[6px_6px_0_var(--mn-yellow)]`
  - `text-[#F4EFE3]` → `text-[var(--mn-paper)]`
  - Header: `bg-[var(--mn-yellow)] text-[var(--mn-ink)] border-b-2 border-[var(--mn-ink)]`
  - Botão fechar: cores padronizadas com tokens `var(--mn-*)`.
- `VipModal.tsx`:
  - Mudar título de `"ASSINATURA_VIP.EXE"` para `"ASSINATURA VIP"`.
  - Substituir todos os hexadecimais (`#0B0B0C` → `var(--mn-ink)`, `#FFD400` → `var(--mn-yellow)`, `#A9A59A` → `var(--mn-mute)`, `#F4EFE3` → `var(--mn-paper)`, `#3DDC84` → `var(--mn-ok)`).
- `MembershipModal.tsx`:
  - Mudar título de `"CLUBE_MEMBROS.EXE"` para `"CLUBE DE MEMBROS"`.
  - Substituir todos os hexadecimais por tokens equivalentes (`var(--mn-ink)`, `var(--mn-yellow)`, `var(--mn-mute)`, `var(--mn-paper)`, `var(--mn-ok)`).
- `ReportModal.tsx`:
  - Substituir literais `#0B0B0C`, `#FFD400`, `#A9A59A`, `#F4EFE3`, `#E53935` por `var(--mn-ink)`, `var(--mn-yellow)`, `var(--mn-mute)`, `var(--mn-paper)`, `var(--mn-red)`.

### 3.3 `Footer.tsx`
- Substituir todas as classes `#0B0B0C`, `#FFD400`, `#F4EFE3`, `#A9A59A` pelas respectivas variáveis CSS:
  - `bg-[#0B0B0C]` → `bg-[var(--mn-ink-2)]` ou `bg-[var(--mn-ink)]`
  - `border-[#FFD400]` → `border-[var(--mn-yellow)]`
  - `text-[#FFD400]` → `text-[var(--mn-yellow)]`
  - `text-[#F4EFE3]` → `text-[var(--mn-paper)]`
  - `text-[#A9A59A]` → `text-[var(--mn-mute)]`
  - Hover links: `hover:text-[var(--mn-yellow)]`

### 3.4 Sombras com `#000000`
- `HomeRankingsSidebar.tsx`:
  - `shadow-[4px_4px_0_#000000]` → `shadow-[4px_4px_0_var(--mn-ink)]`
  - `shadow-[1px_1px_0_#000000]` → `shadow-[1px_1px_0_var(--mn-ink)]`
- `PublicProfilePage.tsx`:
  - `shadow-[3px_3px_0_#000000]` → `shadow-[3px_3px_0_var(--mn-ink)]`
- `AccountProfileHeader.tsx`:
  - `shadow-[4px_4px_0_#000000]` → `shadow-[4px_4px_0_var(--mn-ink)]`

---

## 4. Critérios de Aceite

- [ ] `CreatorChaptersPage.tsx` não executa mais `readChapter` em loop no carregamento da página.
- [ ] O clique em "EDITAR" faz o carregamento pontual do capítulo com feedback visual de carregamento.
- [ ] `Modal.tsx`, `VipModal.tsx`, `MembershipModal.tsx`, `ReportModal.tsx` e `Footer.tsx` estão 100% livres de literais hexadecimais.
- [ ] Textos retrô hacker `.EXE` substituídos por títulos limpos de design editorial.
- [ ] Sombras `_#000000` substituídas por `_var(--mn-ink)`.
- [ ] `npm test -- --run` no frontend: 46+ testes passando, 0 falhas.
- [ ] `npm run build`: 0 erros de TypeScript e build gerado com sucesso.
- [ ] Relatório `docs/orquestracao/frontend/relatorios/RELATORIO-TASK-121.md` gerado.

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
