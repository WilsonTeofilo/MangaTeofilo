# AUDITORIA DE IDENTIDADE VISUAL, UX E DESPOLUIÇÃO DA NAVEGAÇÃO
**Projeto:** MangaNetWorking (Banca de Rua / Fliperama Independente)  
**Data:** 16 de Novembro de 2026  
**Auditor / Arquiteto:** Hermes (Tech Lead & Arquiteto Principal)  
**Status:** Auditado & Mapeado para Execução

---

## 1. Visão Geral e Alinhamento com a Filosofia "Banca de Rua"

A diretriz fundamental do Design System (`DESIGN-SYSTEM-OFICIAL.md`) define o conceito:
> *"A banca digital do mangá independente: leia, apoie e descubra quem faz. O site em volta é panfleto de rua + computador antigo + adesivo + placar de fliperama. O mangá é o protagonista. A leitura é sagrada e limpa."*

Embora a erradicação de cores hexadecimais legadas tenha sido concluída com sucesso (100% tokens `var(--mn-*)`), a inspeção analítica das telas atuais revelou **fricção de fluxo, redundância de componentes, poluição por excesso de contornos e fragmentação na navegação entre Leitor e Criador**.

---

## 2. Diagnóstico da Navegação Geral (Header & Mobile Nav)

### 2.1 Fragmentação e Ruído no Topo (`Header.tsx` & `HeaderUserMenu.tsx`)
1. **Acúmulo de Crachás e Cores Concorrentes no Topo:**
   - No `HeaderUserMenu.tsx`, um usuário administrativo com VIP renderiza simultaneamente:
     - Selo vermelho `DONO` (`bg-[var(--mn-red)]`);
     - Selo/Botão amarelo `VIP` (`bg-[var(--mn-yellow)]`);
     - Sino de notificações (`NotificationBell`);
     - Botão de moderação (`ShieldAlert`);
     - Avatar grande de 54px com borda e chevron.
   - *Impacto UX:* Um "carnaval de status" antes mesmo de acessar o menu, roubando a atenção do conteúdo principal da página.
   - *Solução Proposta:* Mover os crachás institucionais (`DONO`, `VIP`) e o acesso de moderação para o interior do dropdown do avatar. Deixar no topo apenas: Sino de Notificação + Avatar.

2. **Avatar Desproporcional no Header:**
   - O avatar possui `w-[54px] h-[54px]`, em um container com altura mínima de 70px. Ele quebra o alinhamento com a logo e com os links de texto.
   - *Solução Proposta:* Padronizar o avatar em `w-10 h-10` (40px) no desktop e `w-9 h-9` no mobile, com borda fina de adesivo (`2px solid var(--mn-yellow)`).

3. **Inconsistência Semântica na Aba "SOBRE":**
   - No `HeaderNav.tsx`, o botão da aba ativa `currentTab === 'about'` recebe `bg-[var(--mn-red)]` (vermelho carimbo), enquanto as outras abas recebem amarelo (`bg-[var(--mn-yellow)]`).
   - *Regra Violada:* O `DESIGN-SYSTEM-OFICIAL.md` (seção 5.2) proíbe vermelho em navegação/fundo de abas (vermelho é exclusivo para carimbos de novo/alerta/early access).
   - *Solução Proposta:* Padronizar todas as abas ativas em fundo amarelo `--mn-yellow` e texto `--mn-ink`.

4. **Contador de Biblioteca Vazia:**
   - O item `BIBLIOTECA (0)` grita zero para usuários novos.
   - *Solução Proposta:* Exibir o número apenas quando `favoritesCount > 0`. Se for zero, exibir apenas `BIBLIOTECA`.

5. **Navegação Mobile Cega para o Criador (`HeaderMobileNav.tsx`):**
   - A barra inferior fixa no mobile exibe 5 botões: `FEED`, `CATÁLOGO`, `BIBLIO`, `SOBRE`, `PERFIL`.
   - Se o usuário for um **Criador**, a aba `PERFIL` o direciona para a conta de leitor (`account`), deixando-o sem atalho rápido para o painel de criação/obras na barra inferior.
   - *Solução Proposta:* Para criadores logados (`user.isCreator`), o 5º ícone da barra inferior deve alternar contextualmente para `PAINEL` (ícone `LayoutDashboard`), dando acesso direto ao Workspace do Autor.

---

## 3. Diagnóstico dos Dashboards: Leitor vs. Criador

### 3.1 O Problema da "Dupla Identidade" do Leitor
Hoje existem **duas páginas de perfil concorrentes** para o leitor:
- `AccountProfilePage.tsx` (`/account` — "Minha conta"): Dados pessoais, username, visibilidade, crop de avatar, exportação LGPD e exclusão.
- `ReaderProfilePage.tsx` (`/reader-profile` — "Painel do Leitor"): Switch de visibilidade (duplicado!), upload de avatar (duplicado!), crachá VIP, número de obras curtidas e grid de obras salvas.

*Por que isso polui a UX?*
- O leitor entra em "Minha conta" e vê um botão `"MEU PAINEL DE LEITOR"`. Ao clicar, vai para outra tela com praticamente os mesmos botões e mais uma vez o upload de avatar.
- *Solução Proposta (Unificação em Tela Única):*
  - Extinguir a rota redundante `reader-profile`.
  - Consolidar a experiência do leitor em uma única tela limpa: **`Minha Conta & Coleção` (`AccountProfilePage.tsx`)**, dividida em duas abas claras:
    1. **Minha Coleção / Leitura:** Obras favoritadas e histórico de leitura com progresso.
    2. **Meus Dados & Segurança:** Username imutável, visibilidade pública/privada, foto e governança LGPD (exportar/excluir).

---

### 3.2 Poluição Visual no Dashboard do Criador (`CreatorWorkspacePage.tsx`)
A página do autor foi muito melhorada na última rodada, mas ainda apresenta pontos de sobrecarga cognitiva:

1. **Botões Concorrentes para "Nova Obra":**
   - Existe um botão primário `+ NOVA OBRA` amarelo no header do painel (`CreatorKpiHeader.tsx`).
   - E no rodapé da aba Overview existe outro botão `NOVA OBRA / CAPÍTULO` dentro de "Ações Rápidas da Bancada".
   - *Solução Proposta:* Manter apenas o botão primário no topo. As ações rápidas devem focar em links contextuais que não existem no topo (ex: "Ver Minhas Obras", "Ver Missões da Season").

2. **Duplicação de Rotas do Criador:**
   - No `HeaderUserMenu.tsx`, o menu lista:
     - Workspace do criador (`creator-dashboard`)
     - Minhas obras (`creator-works`)
     - Capítulos (`creator-chapters`)
     - Missões & XP (`creator-missions`)
     - Analytics (`creator-analytics`)
     - Monetização (`creator-monetization`)
   - No entanto, ao entrar em `creator-dashboard` (`CreatorWorkspacePage.tsx`), a página já possui abas internas (`overview`, `works`, `missions`, `settings`)!
   - Isso faz com que `CreatorWorksPage` e `CreatorMissionsPage` sejam acessadas ora como abas internas, ora como páginas isoladas de tela cheia sem a barra de abas do autor.
   - *Solução Proposta:* O **Workspace do Autor deve ser o Hub Unificado**. Ao clicar em qualquer opção de criação no menu do header, o usuário deve ser levado ao `CreatorWorkspacePage` já com a aba correspondente selecionada (`?tab=works`, `?tab=missions`, `?tab=analytics`, etc.), mantendo a barra de topo do autor sempre fixa e consistente.

3. **Saturação de "Bordas e Caixas":**
   - Atualmente, quase todo elemento possui `border-2 border-[var(--mn-line)] bg-[var(--mn-ink-2)]` com sombras pretas pesadas. Isso cria o efeito "gaiola" (o olho humano salta de contorno em contorno sem encontrar foco de leitura).
   - *Solução Proposta:* Aumentar o respiro (*whitespace*). Usar fundos sutis sem bordas para blocos secundários e reservar bordas marcadas de 2px apenas para elementos interativos (cards clicáveis, inputs e botões).

---

### 3.3 Poluição Visual nos Cards da Biblioteca (`BibliotecaPage.tsx`)
1. **Sobrecarga de Ações por Card:**
   Cada card de 180px na grade da biblioteca tenta acomodar:
   - Capa vertical + Badge de formato + Selo "X CAPS";
   - Título de 2 linhas + Nome do autor;
   - Linha de progresso com texto (`PÁG. 12/48` e `25%`);
   - Barra amarela de progresso;
   - Botão grande "CONTINUAR DE ONDE PAROU";
   - Linha inferior com botão "DETALHES →" e ícone de lixeira vermelha.
2. *Impacto UX:* O card parece um painel de controle espremido em vez de uma estante de mangás convidativa.
3. *Solução Proposta:*
   - O card deve ser limpo e intuitivo:
     - Clicar na capa ou no título retoma a leitura imediatamente (com a barra de progresso embutida na borda inferior da capa).
     - Um menu discreto de 3 pontinhos (`···`) ou hover no canto superior para remover da biblioteca ou ver detalhes.
     - Reduzir o ruído de botões empilhados dentro do card.

---

## 4. Matriz de Prioridades de Limpeza (UX & UI)

| Prioridade | Área | Problema Identificado | Ação Recomendada | Impacto |
| :---: | :--- | :--- | :--- | :---: |
| **P1** | **Navegação & Header** | Crachás e cores competindo no topo (`DONO`, `VIP`, moderação). Avatar gigante (54px). | Mover crachás para o dropdown do usuário; padronizar avatar em 40px; unificar amarelo na aba ativa `SOBRE`. | Alto |
| **P2** | **Navegação Mobile** | Barra inferior mobile não oferece atalho ao painel do criador. | Alternar dinamicamente o 5º botão para `PAINEL` quando o usuário for criador. | Alto |
| **P3** | **Perfil do Leitor** | Duplicação de páginas (`account` vs `reader-profile`) com dados e visibilidade repetidos. | Extinguir `reader-profile` e unificar toda a área do leitor em `AccountProfilePage` com abas limpas. | Alto |
| **P4** | **Dashboard do Criador** | Fragmentação de rotas (`creator-works`, `creator-missions` soltas vs abas no Workspace). | Fazer do `CreatorWorkspacePage` a casca única do autor via sincronização por abas/URL. | Médio |
| **P5** | **Biblioteca do Leitor** | Cards de obras na biblioteca superlotados de botões, barras e links concorrentes. | Limpar o `<LibraryCard>`: clique direto para continuar lendo, lixeira em hover discreto. | Médio |
| **P6** | **Despoluição Visual** | Excesso de caixas com bordas duras ("efeito gaiola") nos dashboards. | Suavizar superfícies secundárias, privilegiando espaçamento e tipografia Anton/Archivo sobre contornos pesados. | Médio |

---

## 5. Próximos Passos & Ordem de Execução Recomendada

Seguindo o protocolo de orquestração do Hermes:
1. **Passo 1 (Especificação):** Criar a tarefa detalhada `TASK-114-HEADER-AND-NAV-CLEANUP.md` para o OpenCode Frontend Worker com foco exclusivo na simplificação do Header, Mobile Nav e unificação de abas ativas.
2. **Passo 2 (Execução):** Delegar ao Frontend Worker a despoluição do Header e Mobile Nav sem quebrar as rotas existentes.
3. **Passo 3 (Auditoria do Leitor):** Especificar a fusão limpa de `ReaderProfilePage` na `AccountProfilePage` (`TASK-115`), eliminando a tela duplicada.
4. **Passo 4 (Auditoria do Criador):** Especificar o alinhamento do Workspace do Autor como SPA de abas sem rotas orfãs soltas (`TASK-116`).
