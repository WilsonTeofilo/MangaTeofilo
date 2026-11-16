# ESPECIFICAÇÃO DE TAREFA FRONTEND — TASK-114
**Módulo:** Header, Navegação Geral e Despoluição Visual  
**Prioridade:** Alta (P1)  
**Assinado por:** *Hermes (Tech Lead / Gerente / Arquiteto)*  
**Data:** 16 de Novembro de 2026

---

## 1. Contexto & Objetivo Técnico
Em conformidade com a auditoria de UX e despoluição visual (`AUDITORIA-DESIGN-SYSTEM-UX-POLUICAO.md`) e com as diretrizes do usuário, a barra de navegação superior (`Header`) e a barra inferior mobile (`HeaderMobileNav`) precisam ser limpas de sobrecargas e cores concorrentes.

> **REGRA FUNDAMENTAL DO USUÁRIO:** O tamanho do avatar (`w-[54px] h-[54px]`) DEVE SER MANTIDO INTACTO. Não altere as dimensões do avatar.

---

## 2. Escopo Cirúrgico de Modificações

### Arquivo 1: `frontend/src/components/layout/header/HeaderUserMenu.tsx`
1. **Remover poluição do topo externo:**
   - Remover os crachás soltos do topo externo:
     - Remover o crachá vermelho `DONO` (`ShieldAlert`);
     - Remover o crachá/botão amarelo `VIP` (`Crown`);
     - Remover o botão solto de atalho para moderação (`canModerate`).
   - O topo externo do menu deve conter **apenas**:
     - O `<NotificationBell />` (central interna de notificações);
     - O botão do Avatar (preservando o tamanho `w-[54px] h-[54px]`).
2. **Encapsular crachás e atalhos dentro do Dropdown (`menuOpen`):**
   - No topo do menu aberto (abaixo do nome e `@username`):
     - Renderizar os badges contextuais com elegância:
       - Se `user.isOwner`: crachá discreto `DONO` em vermelho.
       - Se `user.isVip`: crachá discreto `VIP` em amarelo.
       - Se não for VIP: botão discreto "Assinar VIP" com ícone de coroa.
   - Adicionar o atalho da moderação editorial no corpo do menu:
     - Se `canModerate`: botão `"Mesa de moderação editorial"` (ícone `ShieldAlert`) direcionando para `onNavigate('moderation')`.

### Arquivo 2: `frontend/src/components/layout/header/HeaderNav.tsx`
1. **Unificação semântica da aba `SOBRE`:**
   - A aba ativa `currentTab === 'about'` atualmente usa `bg-[var(--mn-red)]`. **Substituir por:**
     `bg-[var(--mn-yellow)] text-[var(--mn-ink)] border-2 border-[var(--mn-ink)] shadow-[3px_3px_0_var(--mn-ink)]`
     (padronizando com as demais abas ativas no Design System).
2. **Ocultação de contador vazio na `BIBLIOTECA`:**
   - Quando `favoritesCount === 0`, renderizar apenas o texto `BIBLIOTECA` sem o número `(0)`.
   - Quando `favoritesCount > 0`, renderizar `BIBLIOTECA (${favoritesCount})`.

### Arquivo 3: `frontend/src/components/layout/header/HeaderMobileNav.tsx`
1. **Navegação mobile contextual para criadores:**
   - Receber no componente a flag `isCreator?: boolean` (ou extrair de `useAuth()`).
   - Se o usuário autenticado for um Criador (`isCreator === true`):
     - O 5º botão do rodapé mobile deve ser:
       - Ícone: `LayoutDashboard` (do `lucide-react`);
       - Rótulo: `PAINEL`;
       - Ação: `onNavigate('creator-dashboard')`;
       - Estado ativo: `currentTab.startsWith('creator-')`.
   - Se for apenas leitor:
     - Manter o botão `PERFIL` direcionando para `'account'`.

---

## 3. Critérios de Aceite
- [ ] O avatar do usuário permanece com `w-[54px] h-[54px]`.
- [ ] O topo do Header não exibe mais selos `DONO`, `VIP` ou botão de moderação soltos ao lado do avatar.
- [ ] Todos os crachás (`DONO`, `VIP`), botão de assinar VIP e o link para Moderação estão integrados de forma limpa dentro do dropdown do avatar.
- [ ] A aba `SOBRE` fica amarela quando ativa (nunca vermelha).
- [ ] A biblioteca não exibe `(0)` quando não há favoritos.
- [ ] Usuários criadores têm acesso direto ao Workspace pelo rodapé mobile (`PAINEL`).
- [ ] `npm run build` passa com 0 erros de TypeScript.
- [ ] `npm test` passa com todos os testes verdes.

---
Assinado por: *Hermes (Tech Lead / Gerente / Arquiteto)*
