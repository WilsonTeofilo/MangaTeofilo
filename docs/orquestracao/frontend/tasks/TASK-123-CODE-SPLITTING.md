# TASK-123 — Code-Splitting de Rotas, Otimização de Chunks e Purga Final de Títulos .EXE

**Data:** 2026-11-18  
**Responsável:** OpenCode Frontend  
**Tech Lead:** Hermes (Tech Lead / Gerente / Arquiteto)  
**Status:** ESPECIFICADO  

---

## 1. Contexto e Motivação

1. **Problema de Performance no Bundle Inicial (688 kB Monolítico)**:
   Atualmente, o bundle principal do Vite (`dist/assets/index-*.js`) contém a aplicação inteira em um único arquivo de quase 700 kB. Um leitor casual acessando pelo celular 3G/4G para ler um mangá baixa desnecessariamente:
   - A mesa de Moderação Backoffice.
   - Os gráficos e funis pesados de Analytics do Criador.
   - O editor de Light Novel com drag-and-drop.
   - As páginas de administração e onboarding do criador.
   
2. **Resíduos de Títulos Retrô Hacker (.EXE)**:
   Algumas chamadas ao componente `<Win title="...">` ainda possuem o sufixo `.EXE`, violando o padrão editorial limpo da Banca de Rua.

---

## 2. Instruções de Implementação

### 2.1 Code-Splitting via `React.lazy()` e `Suspense` em `AppTabRouter.tsx` e `App.tsx`
- Em `frontend/src/components/app/AppTabRouter.tsx`:
  - Converter páginas secundárias e administrativas para carregamento lazy:
    ```typescript
    const SobrePage = lazy(() => import('../../pages/SobrePage').then(m => ({ default: m.SobrePage })));
    const CreatorAnalyticsPage = lazy(() => import('../../pages/CreatorAnalyticsPage').then(m => ({ default: m.CreatorAnalyticsPage })));
    const ModerationBackofficePage = lazy(() => import('../../pages/ModerationBackofficePage').then(m => ({ default: m.ModerationBackofficePage })));
    const CreatorChaptersPage = lazy(() => import('../../pages/CreatorChaptersPage').then(m => ({ default: m.CreatorChaptersPage })));
    const CreatorWorksPage = lazy(() => import('../../pages/CreatorWorksPage').then(m => ({ default: m.CreatorWorksPage })));
    const CreatorMissionsPage = lazy(() => import('../../pages/CreatorMissionsPage').then(m => ({ default: m.CreatorMissionsPage })));
    const CreatorMonetizationPage = lazy(() => import('../../pages/CreatorMonetizationPage').then(m => ({ default: m.CreatorMonetizationPage })));
    const BecomeWriterPage = lazy(() => import('../../pages/BecomeWriterPage').then(m => ({ default: m.BecomeWriterPage })));
    const OnboardingPage = lazy(() => import('../../pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })));
    ```
  - As páginas prioritárias de leitura/navegação direta do usuário (`HomePage`, `CatalogPage`, `BibliotecaPage`, `AccountProfilePage`) podem permanecer eager para carregamento instantâneo.
  - Envolver os retornos das abas com `<Suspense fallback={<RouteLoadingFallback />}>`, onde `RouteLoadingFallback` exibe um placeholder discreto e acessível seguindo o tema:
    ```tsx
    function RouteLoadingFallback() {
      return (
        <div className="mn-container py-24 text-center">
          <p className="font-pixel text-xs text-[var(--mn-mute)] uppercase tracking-wider animate-pulse">
            Carregando seção...
          </p>
        </div>
      );
    }
    ```

### 2.2 Otimização de Chunks no `vite.config.ts`
- Adicionar divisão de chunks manuais para vendors pesados (`react` e `lucide-react`):
  ```typescript
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
  ```

### 2.3 Purga de Títulos `.EXE` em Componentes `<Win>`
- `frontend/src/components/analytics/CreatorFunnelPanel.tsx`: `title="FUNIL DE DESCOBERTA"`
- `frontend/src/components/auth/TwoFactorStep.tsx`: `title="DEV OUTBOX"`
- `frontend/src/components/common/AvatarCropper.tsx`: `title="AJUSTAR FOTO"`
- `frontend/src/components/common/ImageCropper.tsx`: `title="AJUSTAR IMAGEM"`
- `frontend/src/components/creator/CreatorMissionsPanel.tsx`: `title="MISSÕES DA BANCA"` e `title="GANHOS DA TEMPORADA"`
- `frontend/src/components/home/HomeContinueReading.tsx`: `title="CONTINUAR LENDO"`
- `frontend/src/pages/CreatorAnalyticsPage.tsx`:
  - `title="VISUALIZAÇÕES POR DIA"`
  - `title="RETENÇÃO POR PÁGINA"`
  - `title="QUANDO A AUDIÊNCIA LÊ"`
  - `title="FINANCEIRO DA JANELA"`

---

## 3. Critérios de Aceite

- [ ] Chunk principal do JS (`index-*.js`) significativamente reduzido (sem o aviso de > 500 kB).
- [ ] Chunks separados para `vendor-react`, `vendor-icons` e rotas administrativas (`CreatorAnalyticsPage`, `ModerationBackofficePage`, etc.).
- [ ] Zero títulos com sufixo `.EXE` em componentes `<Win>` em toda a aplicação.
- [ ] Suíte de testes `npm test -- --run` com 100% dos 46+ testes passando.
- [ ] `npm run build` gerando sem erros e com tempo de build inferior a 4 segundos.
- [ ] Relatório `docs/orquestracao/frontend/relatorios/RELATORIO-TASK-123.md` gerado.

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
