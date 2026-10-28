# TASK-100: Redesenho, Despoluição Visual e Decomposição Modular do Workspace do Autor

> **Data:** 28 de Outubro de 2026  
> **Responsável:** OpenCode Frontend  
> **Supervisão:** Hermes (Tech Lead & Arquiteto)  
> **Status:** Aberto para Execução  

---

## 1. Contexto e Motivação

A auditoria recente em `CreatorWorkspacePage.tsx` (419 linhas) e telas do autor revelou violações diretas ao [DESIGN-SYSTEM-OFICIAL.md](../../DESIGN-SYSTEM-OFICIAL.md):
1. **Carnaval de Bordas Concorrentes e "Card dentro de Card":**
   - 6 caixas de cores divergentes competindo por atenção no mesmo scroll:
     - Caixa cinza pesada com sombra dura para dados LGPD.
     - Caixa vermelha de advertência penal anti-pirataria ocupando quase 200px.
     - Caixa do perfil com avatar de 148px, badges inclinados e 4 patches de medalha.
     - Caixa com borda ciano para links sociais.
     - Caixa com borda amarela para declaração de autoria.
2. **Mistura de Preocupações (Separation of Concerns):**
   - Ferramentas administrativas de usuário leitor (Exportação LGPD, Excluir conta) colocadas no topo da bancada de trabalho editorial do autor.
   - Aviso de autoria penal exibido de forma estática toda vez que o autor acessa o painel, em vez de atuar no momento da publicação (fluxo contextual).
3. **Monólito de Código:**
   - `CreatorWorkspacePage.tsx` aglomera 14 estados locais (crop, upload, formulário, flags, erros), chamadas diretas de API e JSX massivo.

---

## 2. Requisitos Técnicos de Implementação

### 2.1. Extração de Submódulos Atômicos em `frontend/src/components/creator/workspace/`

Criar o diretório `frontend/src/components/creator/workspace/` com os seguintes módulos:

1. **`useCreatorWorkspaceData.ts` (Custom Hook de Estado e Operações):**
   - Centralizar carregamento de `creatorApi.getWorkspace()`.
   - Gerenciar mutações de perfil (`creatorApi.updateProfile`, `creatorApi.updateMembershipPrice`).
   - Gerenciar upload e recorte de avatar (`storageApi.uploadAvatar`, `userApi.updateProfile`, `refreshSession`).
   - Fornecer estados limpos: `workspace`, `loading`, `error`, `isSaving`, `saveSuccess`, `saveProfile`, `saveAvatar`.

2. **`CreatorKpiHeader.tsx` (Topo Sóbrio e Elegante):**
   - Avatar com tamanho balanceado (80px no mobile, 96px no desktop) com botão discreto de alteração.
   - Nome artístico, handle `@username` e badge discreto de nível de monetização.
   - Apenas **1 CTA Primário** no topo: `+ Nova Obra` ou `+ Publicar Capítulo`.
   - Barra de abas de navegação internas (`overview`, `works`, `missions`, `settings`).

3. **`CreatorOverviewTab.tsx` (Aba Visão Geral):**
   - Métricas em cards sóbrios com fundo `var(--mn-ink-2)`, borda sutil `var(--mn-line)` e números nítidos:
     - Leitores e Seguidores.
     - Membros Mensais Ativos.
     - Saldo Disponível (R$).
   - Rail de obras recentes do autor com badge de formato (`MANGA` ou `LIGHT_NOVEL`), contagem de capítulos e status.
   - Ações rápidas de criação.

4. **`CreatorProfileSettingsTab.tsx` (Aba Perfil e Configurações):**
   - Formulário com tipografia clara: Nome artístico, Bio editorial e Preço de membros.
   - Seção de Vínculos Sociais integrada ao formulário, sem caixa ciano chamativa.
   - Feedback de salvamento elegante via banner de status temporário.

5. **`CreatorPrivacyAccordion.tsx` (Governança LGPD Colapsável):**
   - Subseção colapsável (accordion) ou discreta no final da aba de configurações.
   - Botões "Ver Perfil Público", "Exportar Meus Dados (Art. 18 LGPD)" e "Excluir Minha Conta" com modal nativo de confirmação.
   - Não ocupa espaço na tela principal de criação.

6. **`OriginalWorkDeclarationModal.tsx` (Modal de Autoria e Anti-Pirataria):**
   - Modal contextual acionado ao publicar obra/capítulo pela primeira vez ou via botão de conformidade.
   - Explica com clareza o Art. 184 do Código Penal e exige aceite antes do primeiro envio.

7. **`CreatorWorkspacePage.tsx` (Orquestrador Limpo):**
   - Reduzido para < 150 linhas, atuando puramente como roteador das abas e consumidor de `useCreatorWorkspaceData`.

---

## 3. Diretrizes de Design System (Anti-Poluição)
- **Cores Permitidas:**
  - Fundo geral: `var(--mn-ink)` / Fundo dos blocos: `var(--mn-ink-2)`.
  - Bordas: `var(--mn-line)` (2px discreto).
  - Destaques e CTA Primário: `var(--mn-yellow)` exclusivamente.
  - Proibido o uso simultâneo de caixas com bordas vermelhas, ciano e amarelas na mesma visualização.
- **Hierarquia:**
  - Proibido "card dentro de card" com bordas completas.
  - Informações secundárias usam tipografia atenuada (`var(--mn-mute)`) e fontes proporcionais.

---

## 4. Critérios de Aceite
- [ ] `CreatorWorkspacePage.tsx` reduzido para menos de 150 linhas.
- [ ] Submódulos criados e tipados estritamente em `frontend/src/components/creator/workspace/`.
- [ ] Navegação fluida entre as abas (`overview`, `works`, `missions`, `settings`).
- [ ] Ferramentas LGPD mantidas e funcionais, porém organizadas de forma discreta na aba de configurações.
- [ ] `npm.cmd run build` executado com **sucesso (0 erros de TypeScript)**.
- [ ] Navegador ou testes locais validando que nenhum dado real de criador foi perdido ou quebrado.

---

*Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)*
