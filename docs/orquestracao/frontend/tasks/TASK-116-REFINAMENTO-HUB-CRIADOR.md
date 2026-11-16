# TASK-116 (Refinamento) — Hub Unificado do Workspace do Autor & Sincronização via URL

**Projeto:** MangaNetWorking  
**Camada:** Frontend (React/TypeScript)  
**Prioridade:** ALTA  
**Responsável:** OpenCode Frontend Worker  
**Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## 1. Contexto e Objetivos

O usuário solicitou o refinamento exato da Fase 3 (Workspace do Autor) com fechamento de pontas soltas das Fases 1 e 2:
1. **Ponta solta da Fase 2:** Excluir fisicamente o arquivo morto zumbi `frontend/src/pages/ReaderProfilePage.tsx` (já não é importado em nenhum lugar).
2. **Sincronização via URL (?aba=...):**
   - O `CreatorWorkspacePage.tsx` deve ler o parâmetro `?aba=` da URL ao carregar e refletir na aba ativa:
     - `?aba=visao-geral` ou `?aba=overview` → Aba Visão Geral
     - `?aba=obras` ou `?aba=works` → Aba Minhas Obras
     - `?aba=missoes` ou `?aba=missions` → Aba Missões & XP
     - `?aba=configuracoes` ou `?aba=settings` → Aba Perfil & Ajustes
     - `?aba=analytics` → Seção Analytics
     - `?aba=capitulos` → Seção Capítulos
     - `?aba=monetizacao` → Seção Monetização
   - Ao trocar de aba no `CreatorWorkspacePage`, a URL deve ser atualizada via `window.history.replaceState` com o query param `?aba=...`.
3. **Menu do Criador no Header (`HeaderUserMenu.tsx`):**
   - No dropdown do avatar, o menu do criador deve oferecer opções que navegam para o Workspace com a URL já apontando para a aba correta:
     - `Visão Geral` → navega para `creator-dashboard` com `?aba=visao-geral`
     - `Minhas Obras` → navega para `creator-dashboard` com `?aba=obras`
     - `Missões & XP` → navega para `creator-dashboard` com `?aba=missoes`
     - `Perfil & Ajustes` → navega para `creator-dashboard` com `?aba=configuracoes`
4. **Remoção de Redundância de Botões no Painel (`CreatorOverviewTab.tsx`):**
   - O botão `+ NOVA OBRA` já existe de forma destacada, única e soberana no topo (`CreatorKpiHeader.tsx`).
   - O botão redundante `NOVA OBRA / CAPÍTULO` dentro da seção "AÇÕES RÁPIDAS DA BANCADA" em `CreatorOverviewTab.tsx` deve ser **removido**, mantendo apenas as ações não duplicadas ("VER MISSÕES DA SEASON" e "TERMOS DE AUTORIA").
5. **Limpeza de Query Params ao Sair do Workspace:**
   - Em `useAppNavigation.ts` (ou `handleSwitchTab`), quando a tab de destino não for `creator-dashboard`, remover o parâmetro `?aba=` da URL se ele existir.

---

## 2. Arquivos Envolvidos

1. `frontend/src/pages/ReaderProfilePage.tsx` → **Excluir**
2. `frontend/src/pages/CreatorWorkspacePage.tsx` → Suporte a `?aba=` e sincronização com URL
3. `frontend/src/components/layout/header/HeaderUserMenu.tsx` → Navegação com query params de aba
4. `frontend/src/components/creator/workspace/CreatorOverviewTab.tsx` → Remover botão redundante nas Ações Rápidas
5. `frontend/src/components/app/useAppNavigation.ts` → Reconhecer `?aba=` na inicialização e limpar ao sair
6. `frontend/src/components/creator/workspace/__tests__/CreatorNavigation.test.tsx` → Atualizar/expandir suíte de testes

---

## 3. Critérios de Aceite

- [ ] Arquivo `frontend/src/pages/ReaderProfilePage.tsx` excluído com sucesso.
- [ ] `CreatorWorkspacePage` sincroniza bidirecionalmente a aba com `?aba=...` na URL.
- [ ] Submenu do criador em `HeaderUserMenu` abre o Workspace diretamente na aba solicitada via URL.
- [ ] Botão redundante `NOVA OBRA / CAPÍTULO` removido de "AÇÕES RÁPIDAS DA BANCADA" em `CreatorOverviewTab.tsx`.
- [ ] O único CTA primário amarelo no painel é o botão `+ NOVA OBRA` do `CreatorKpiHeader.tsx`.
- [ ] `npm run build` passa com 0 erros TypeScript.
- [ ] `npm run test` passa 100% verde (incluindo testes de navegação).

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
