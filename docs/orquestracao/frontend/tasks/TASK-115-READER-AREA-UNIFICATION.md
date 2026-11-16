# ESPECIFICAÇÃO DE TAREFA FRONTEND — TASK-115
**Módulo:** Unificação da Área do Leitor, Extinção de Telas Duplicadas e Despoluição da Biblioteca  
**Prioridade:** Alta (P1)  
**Assinado por:** *Hermes (Tech Lead / Gerente / Arquiteto)*  
**Data:** 16 de Novembro de 2026

---

## 1. Contexto & Diretrizes Arquiteturais
Conforme a auditoria de UX e a ordem executiva do usuário, a experiência do leitor sofre com fragmentação (`AccountProfilePage` vs `ReaderProfilePage` concorrentes) e sobrecarga de controles em cards de mangá na biblioteca.

> **REGRAS DE ARQUITETURA LIMPA (CLEAN CODE & ANTI-MONÓLITO):**
> 1. **Proibido criar monólitos:** Não inflar `AccountProfilePage.tsx` nem `BibliotecaPage.tsx`. Decompor em submódulos especialistas.
> 2. **Backend First:** Nenhuma regra de negócio inventada no frontend. Dados de perfil, biblioteca e progresso vêm estritamente de `userApi.getProfile()`, `userApi.getLibrary()` e `userApi.getReadingProgress()`.
> 3. **Design System "Banca de Rua":** Respeitar estritamente tokens CSS `var(--mn-*)`, fontes Anton/Archivo/Silkscreen e bordas 2px com sombras duras.

---

## 2. Escopo Cirúrgico de Implementação

### 2.1 Extinção e Redirecionamento da Rota Duplicada
- **Arquivo:** `frontend/src/components/app/AppTabRouter.tsx`
  - A rota `'reader-profile'` deve ser desativada/redirecionada para renderizar diretamente `<AccountProfilePage />` (passando `onSelectWork`, `onOpenChapter`, etc.).
  - Eliminar qualquer import ou uso de `ReaderProfilePage`.

### 2.2 Reestruturação Modular da Área do Leitor (`AccountProfilePage.tsx`)
Decompor a página do leitor criando submódulos em `frontend/src/components/account/`:
1. **`AccountProfileHeader.tsx`**:
   - Avatar do leitor com botão de trocar/recortar foto (preservando o ImageCropper).
   - Nome, `@username` (com tag LEITOR OFICIAL e selo VIP quando aplicável).
   - Barra de abas limpa com 2 abas:
     - `COLLECTION`: "MINHA COLEÇÃO" (ativa por padrão)
     - `SECURITY`: "SEGURANÇA & DADOS"
2. **`AccountCollectionTab.tsx`**:
   - Grid limpo e responsivo das obras favoritadas e em andamento do leitor (carregadas de `userApi.getLibrary()`).
   - Seção compacta de Assinatura VIP (status ativo ou CTA para assinar VIP).
   - Card vazio elegante com o mascote Nanquim quando não houver obras.
3. **`AccountSecurityTab.tsx`**:
   - Reivindicação única de `@username` (quando gerado `user_...`).
   - Switch de visibilidade do perfil (Público / Privado com confirmação e conformidade LGPD).
   - Botão para ver a página pública do perfil (`onOpenPublicProfile`).
   - Seção de Governança de Dados LGPD: "Baixar Meus Dados (JSON)", "Sair da Conta" e "Excluir Conta" (com modal de confirmação irreversível).
   - Botão para criadores em potencial: "Quero publicar como escritor" (`onBecomeWriter`).

> **ATENÇÃO:** Remover terminantemente o botão antigo `"MEU PAINEL DE LEITOR"`.

---

### 2.3 Despoluição dos Cards da Biblioteca (`BibliotecaPage.tsx`)
1. **Extração do Componente Especialista:**
   - Criar `frontend/src/components/library/LibraryWorkCard.tsx` para isolar a apresentação e interação do card de mangá na biblioteca.
2. **Eliminação da Sobrecarga de Controles (Clean UI):**
   - **Capa 2:3 Clicável e Soberana:** O clique na capa ou no título retoma a leitura imediatamente no capítulo/página corretos (`openResume`).
   - **Barra de Progresso Embutida:** A barra de progresso amarela de leitura fica fininha (3px) embutida na base inferior da capa, com texto discreto em Silkscreen (`PÁG. 12/48 · 25%` ou `100% CONCLUÍDO`).
   - **Remoção de Botões Concorrentes:**
     - Remover o botão grande de texto `"CONTINUAR DE ONDE PAROU"` que ocupava 40% da altura do rodapé do card.
     - Remover o link redundante `"DETALHES →"`.
   - **Ação de Desfavoritar Discreta:** Ícone de lixeira no canto superior da capa (ou hover discreto) com `aria-label="Remover da biblioteca"`.

---

## 3. Critérios de Aceite
- [ ] Rota `'reader-profile'` extinta e absorvida por `AccountProfilePage`.
- [ ] Botão redundante `"MEU PAINEL DE LEITOR"` removido de vez.
- [ ] `AccountProfilePage` decomposta modularmente em componentes sob `src/components/account/`.
- [ ] Abas "Minha Coleção" e "Segurança & Dados" funcionam de forma limpa e reativa.
- [ ] Cards da `BibliotecaPage` despoluídos: capa clicável com progresso embutido, sem botões empilhados.
- [ ] Regras LGPD (exportação, exclusão irreversível e alternância de privacidade) 100% preservadas e operacionais.
- [ ] Testes automatizados criados no Vitest cobrindo a alternância de abas e os cards da biblioteca.
- [ ] `npm run test` verde.
- [ ] `npm run build` verde sem qualquer erro de TypeScript.

---
Assinado por: *Hermes (Tech Lead / Gerente / Arquiteto)*
