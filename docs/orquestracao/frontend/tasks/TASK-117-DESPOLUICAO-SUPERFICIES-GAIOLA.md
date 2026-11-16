# TASK-117 — Despoluição de Superfícies & Fim do "Efeito Gaiola"

**Projeto:** MangaNetWorking  
**Camada:** Frontend (React/TypeScript)  
**Prioridade:** ALTA  
**Responsável:** OpenCode Frontend Worker  
**Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## 1. Contexto e Diagnóstico

### O Problema do "Efeito Gaiola"
Atualmente, dezenas de blocos informativos secundários (KPIs, seções estáticas, cabeçalhos de perfil e painéis) utilizam sistematicamente:
`border-2 border-[var(--mn-line)] bg-[var(--mn-ink-2)]` combinado com sombras duras artificiais em elementos não-interativos.

Isso gera uma profusão de caixas fechadas por toda a viewport ("efeito gaiola" ou card dentro de card), poluindo visualmente a tela, sufocando o conteúdo e cansando a leitura.

### Diretriz Oficial do Design System & Solução
1. **Hierarquia Clara de Bordas e Sombras:**
   - **Bordas duras de 2px e Sombras duras (`shadow-[4px_4px_0_var(--drop)]`) são EXCLUSIVAS para elementos INTERATIVOS:** botões, inputs/selects em foco, cards totalmente clicáveis e modais de diálogo.
   - **Blocos informativos secundários, painéis de leitura e seções estáticas passam a usar fundos chapados sutis (`bg-[var(--mn-ink-2)]`) SEM o contorno agressivo perimétrico de 2px** (ou com acento lateral sutil `border-l-2 border-[var(--mn-line)]` quando necessário para agrupamento visual, ou apenas divisor inferior `border-b-2`).
2. **Aumento do Respiro (Whitespace) e Ritmo Vertical:**
   - Garantir respiro de `p-6` a `p-8` em seções estruturais.
   - Aumentar o ritmo vertical com espaçamentos confortáveis (`space-y-8` a `space-y-10`) entre blocos principais.

---

## 2. Escopo Cirúrgico de Modificações

### 2.1 Workspace do Autor (`CreatorKpiHeader.tsx` & `CreatorOverviewTab.tsx`)
1. **`frontend/src/components/creator/workspace/CreatorKpiHeader.tsx`**:
   - Remover a caixa fechada perimétrica `border-2 border-[var(--mn-line)]` e a sombra artificial em elemento estático `shadow-[4px_4px_0_var(--mn-ink)]`.
   - Adotar fundo chapado com respiro e divisor inferior limpo:
     `bg-[var(--mn-ink-2)] border-b-2 border-[var(--mn-line)] p-6 sm:p-8 space-y-6 select-none`
   - O botão `+ NOVA OBRA` permanece como o único CTA interativo com sombra e borda.
2. **`frontend/src/components/creator/workspace/CreatorOverviewTab.tsx`**:
   - Nos 3 cards de métricas (Saldo Disponível, Membros Ativos, Leituras Totais):
     - Substituir `border-2 border-[var(--mn-line)] bg-[var(--mn-ink-2)]` por fundo chapado com acento sutil na borda esquerda:
       `bg-[var(--mn-ink-2)] border-l-2 border-[var(--mn-line)] p-5 space-y-2` (eliminando a gaiola de 4 bordas).
   - Na seção "AÇÕES RÁPIDAS DA BANCADA":
     - Substituir `border-2 border-[var(--mn-line)] bg-[var(--mn-ink-2)] p-5 space-y-4` por:
       `bg-[var(--mn-ink-2)] p-6 space-y-4` (fundo chapado sutil sem contorno agressivo).
   - Na listagem de obras recentes: manter o fundo limpo e cards internos sem bordas perimétricas duplicadas.

### 2.2 Área do Leitor (`AccountSecurityTab.tsx` & `AccountCollectionTab.tsx`)
3. **`frontend/src/components/account/AccountSecurityTab.tsx`**:
   - Nos 3 blocos informativos secundários (Username/Conta, Visibilidade & Privacidade, Exclusão de Conta):
     - Substituir `border-2 border-[var(--mn-line)] bg-[var(--mn-ink-2)] p-6 space-y-4` por:
       `bg-[var(--mn-ink-2)] p-6 sm:p-7 space-y-4` (fundo chapado sutil, eliminando as caixas fechadas repetitivas).
4. **`frontend/src/components/account/AccountCollectionTab.tsx`**:
   - No banner informativo VIP / Status de Apoio:
     - Substituir `border-2 border-[var(--mn-line)] bg-[var(--mn-ink-2)]` por:
       `bg-[var(--mn-ink-2)] p-5 sm:p-6 border-l-2 border-[var(--mn-yellow)]` (acento sofisticado sem gaiola fechada).

### 2.3 Perfil Público (`PublicProfilePage.tsx`)
5. **`frontend/src/pages/PublicProfilePage.tsx`**:
   - No header informativo do perfil público:
     - Substituir a caixa perimétrica `border-2 border-[var(--mn-line)] bg-[var(--mn-ink-2)]` por:
       `bg-[var(--mn-ink-2)] border-b-2 border-[var(--mn-line)] p-6 sm:p-8 flex flex-col sm:flex-row gap-6`.
   - No bloco de Bio e dados:
     - Substituir `border-2 border-[var(--mn-line)] bg-[var(--mn-ink)] p-4` por:
       `bg-[var(--mn-ink-2)] p-4`.

---

## 3. Critérios de Aceite

- [ ] Nenhum bloco informativo secundário utiliza caixas perimétricas pesadas `border-2 border-[var(--mn-line)]` combinadas com sombras artificiais estáticas.
- [ ] Bordas duras e sombras `shadow-[4px_4px_0_var(--drop)]` preservadas com exclusividade em elementos interativos (botões, inputs, cards clicáveis).
- [ ] Cards de métricas no Workspace usam fundo chapado com acento sutil na borda esquerda (`border-l-2`).
- [ ] Blocos de Segurança LGPD e Status VIP utilizam fundos chapados sutis com whitespace generoso.
- [ ] `npm run build` passa com 0 erros de compilação TypeScript.
- [ ] `npm test` passa com 100% dos testes verdes (mínimo de 42 testes aprovados).
- [ ] Relatório formal emitido em `docs/orquestracao/frontend/relatorios/RELATORIO-117.md`.

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
