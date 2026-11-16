# TASK-116 — Hub Unificado do Workspace do Autor

**Projeto:** MangaNetWorking  
**Camada:** Frontend (React/TypeScript)  
**Prioridade:** ALTA  
**Dependência:** TASK-114 ✅ e TASK-115 ✅ concluídas  
**Responsável:** OpenCode Frontend Worker  
**Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## Contexto e Problema

### Diagnóstico (mapeado no código-fonte real)

O `AppTabRouter.tsx` tem **6 rotas independentes** do criador que coexistem com o `CreatorWorkspacePage.tsx` que já é o hub central com abas:

```
AppTabRouter → 'creator-dashboard'   → CreatorDashboardPage → CreatorWorkspacePage section="dashboard"
             → 'creator-works'       → CreatorWorksPage           ← ROTA ÓRFÃ (duplica aba "works")
             → 'creator-chapters'    → CreatorChaptersPage         ← ROTA ÓRFÃ
             → 'creator-missions'    → CreatorMissionsPage          ← ROTA ÓRFÃ (duplica aba "missions")
             → 'creator-analytics'   → CreatorAnalyticsPage         ← ROTA ÓRFÃ
             → 'creator-monetization'→ CreatorMonetizationPage      ← ROTA ÓRFÃ
```

O `HeaderUserMenu.tsx` lista **6 itens separados** no menu do criador (const `CREATOR_MENU`), cada um navegando para uma rota órfã diferente, fragmentando a experiência.

Duplo CTA primário confirmado:
- `CreatorKpiHeader.tsx`: botão `+ NOVA OBRA` (linha `onPrimaryCtaClick`) — abre aba "works"
- `CreatorOverviewTab.tsx`: botão `NOVA OBRA / CAPÍTULO` — `onClick={onOpenDeclarationModal}`

Estes dois botões amarelos violam a regra do Design System: **máximo 1 CTA primário amarelo por tela**.

Rota `'reader-profile'` ainda existe em `AppTabRouter.tsx` como case separado (redireciona para `AccountProfilePage` mas o case não foi removido — ponta solta da TASK-115).

---

## Arquivos a Modificar

> Leia APENAS estes arquivos antes de implementar (economia de contexto):
> 1. `frontend/src/components/app/AppTabRouter.tsx`
> 2. `frontend/src/components/layout/header/HeaderUserMenu.tsx`
> 3. `frontend/src/components/creator/workspace/CreatorKpiHeader.tsx`
> 4. `frontend/src/components/creator/workspace/CreatorOverviewTab.tsx`
> 5. `frontend/src/pages/CreatorWorkspacePage.tsx` (tipo `CreatorWorkspaceSection`)

---

## Critérios de Aceite

- [ ] `AppTabRouter.tsx`: case `'reader-profile'` removido (já redireciona para `account` — era ponta solta da TASK-115)
- [ ] `AppTabRouter.tsx`: cases `creator-works`, `creator-chapters`, `creator-missions`, `creator-analytics`, `creator-monetization` **substituídos** por renderização do `CreatorWorkspacePage` com a prop `section` correspondente
- [ ] `AppTabRouter.tsx`: type `AppTab` atualizado para remover os tabs órfãos (ou mantê-los como aliases que apenas passam `section` diferente para `CreatorWorkspacePage` — preferir a remoção completa se o tipo `AppTab` não é referenciado como literal em outros lugares críticos)
- [ ] `HeaderUserMenu.tsx`: const `CREATOR_MENU` simplificada — apenas **1 item**: "Meu Workspace" → navega para `'creator-dashboard'` (LayoutDashboard icon). Os 5 itens redundantes são eliminados.
- [ ] `CreatorKpiHeader.tsx`: botão `+ NOVA OBRA` (amarelo, primário) **mantido** no KpiHeader pois é o CTA principal da aba "works". Prop `onPrimaryCtaClick` continua existindo.
- [ ] `CreatorOverviewTab.tsx`: botão `NOVA OBRA / CAPÍTULO` da seção Ações Rápidas é **convertido para variante `secondary`** (outline, sem amarelo), mantendo o `onClick={onOpenDeclarationModal}`. Desta forma: 1 primário amarelo (KpiHeader) + 1 secondary (OverviewTab) = sem violação de DS.
- [ ] `CreatorWorkspacePage.tsx`: prop `section` expandida para suportar `'analytics'`, `'chapters'`, `'monetization'` além das existentes (`'dashboard'`, `'missions'`, `'works'`, `'settings'`, `'overview'`). Para essas 3 novas, renderizar os componentes existentes `CreatorAnalyticsPage`, `CreatorChaptersPage`, `CreatorMonetizationPage` **dentro do CreatorWorkspacePage** (como abas internas futuras ou como renderização direta em tab container)
- [ ] Build: `npm run build` passa sem erros TypeScript
- [ ] Testes: `npm run test` passa (22+ testes existentes continuam verdes)
- [ ] Novo teste `CreatorNavigation.test.tsx`: verificar que `AppTabRouter` renderiza `CreatorWorkspacePage` para os 5 casos de rotas do criador

---

## Restrições Obrigatórias (Design System)

- Tokens CSS `var(--mn-*)` exclusivamente (nenhum hex literal)
- Sem `rounded-xl`, `rounded-2xl`, sem sombra suave/blur, sem gradiente decorativo
- Vermelho (`--mn-red`) somente em carimbos/alertas/early access — NUNCA em navegação
- 1 CTA primário amarelo por tela
- **Nunca escrever lógica de negócio no frontend** — apenas renderizar dados vindos do servidor

---

## Plano de Implementação Sugerido (atômico)

### Passo 1 — Limpar AppTabRouter.tsx
```
1. Remover import de ReaderProfilePage (se ainda existir)
2. Remover case 'reader-profile' (ou garantir que apenas faz fallthrough para 'account')
3. Substituir cases creator-* por instâncias de CreatorWorkspacePage com section adequada:
   'creator-works'        → <CreatorWorkspacePage section="works" />
   'creator-chapters'     → <CreatorWorkspacePage section="chapters" />
   'creator-missions'     → <CreatorWorkspacePage section="missions" />
   'creator-analytics'    → <CreatorWorkspacePage section="analytics" />
   'creator-monetization' → <CreatorWorkspacePage section="monetization" />
```

### Passo 2 — Expandir CreatorWorkspacePage section type
```
Expandir CreatorWorkspaceSection para incluir 'chapters', 'analytics', 'monetization'
No switch de tabs, mapear:
  'chapters'     → renderizar CreatorChaptersPage (componente existente)
  'analytics'    → renderizar CreatorAnalyticsPage (componente existente)
  'monetization' → renderizar CreatorMonetizationPage (componente existente)
Desta forma as páginas órfãs existentes são reaproveitadas dentro do hub.
```

### Passo 3 — Simplificar CREATOR_MENU no HeaderUserMenu
```
const CREATOR_MENU = [
  { label: 'Meu Workspace', tab: 'creator-dashboard', icon: LayoutDashboard },
];
Remover imports não usados (BarChart3, BookMarked, Coins, PenLine, Trophy)
```

### Passo 4 — Converter botão secundário no CreatorOverviewTab
```
Localizar o botão "NOVA OBRA / CAPÍTULO" e alterar sua classe CSS:
DE: classes de botão primário amarelo (bg-[var(--mn-yellow)])
PARA: variante secondary: bg-transparent border-2 border-[var(--mn-paper)] text-[var(--mn-paper)]
        hover:border-[var(--mn-yellow)] hover:text-[var(--mn-yellow)]
Manter o onClick={onOpenDeclarationModal} intacto.
```

### Passo 5 — Teste CreatorNavigation.test.tsx
```
Localização: frontend/src/components/creator/workspace/__tests__/CreatorNavigation.test.tsx
Testar:
  - 'creator-works' renderiza CreatorWorkspacePage
  - 'creator-missions' renderiza CreatorWorkspacePage
  - 'creator-analytics' renderiza CreatorWorkspacePage
  - CREATOR_MENU tem exatamente 1 item
  - O botão "NOVA OBRA / CAPÍTULO" no OverviewTab não tem classe bg-[var(--mn-yellow)]
```

---

## Relatório Final Esperado

Ao concluir, gere o relatório em:
`docs/orquestracao/frontend/relatorios/RELATORIO-116.md`

Com os campos:
- Arquivos modificados (com linha count antes/depois)
- Output completo de `npm run build`
- Output completo de `npm run test`
- Checklist de aceite preenchido (✅/❌)
- Assinado por: OpenCode Frontend Worker
