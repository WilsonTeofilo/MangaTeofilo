# TASK-126 — Otimização do Bundle Inicial (< 300 kB)

**Prioridade:** P2  
**Módulo:** Frontend (Vite + React)  
**Objetivo:** Reduzir o chunk inicial (`dist/assets/index-*.js`) de **~465 kB** para **< 300 kB** minificado através de Code-Splitting inteligente (React.lazy) e otimização de chunks no Vite.

---

## 1. Diagnóstico Atual

No build de produção atual (`npm run build`):
```
dist/assets/index-De8frryL.js   465.24 kB │ gzip: 133.64 kB
```

### Causa Raiz:
1. `src/App.tsx` importa estaticamente rotas pesadas:
   - `ReaderPage` (inclui renderers de mangá com canvas/scroll, renderer de prosa, telemetria, controles)
   - `WorkDetailPage` (hero, abas de capítulos, comentários, doações, modal de apoio)
   - `LoginPage`
   - `PasswordResetPage`
2. `src/components/app/AppTabRouter.tsx` importa estaticamente:
   - `CatalogPage`
   - `BibliotecaPage`
   - `AccountProfilePage`
3. Como resultado, qualquer usuário que entra na Home baixa antecipadamente o código de leitura de mangá, leitura de novel, catálogo completo, biblioteca e perfil de usuário.

---

## 2. Escopo da Implementação

### 2.1 Code-Splitting em `App.tsx`
- Converter as seguintes páginas para `React.lazy()` com `<Suspense fallback={<RouteLoadingFallback />}>`:
  - `ReaderPage`
  - `WorkDetailPage`
  - `LoginPage`
  - `PasswordResetPage`
- Manter o fallback padrão limpo e responsivo.

### 2.2 Code-Splitting em `AppTabRouter.tsx`
- Converter para `React.lazy()`:
  - `CatalogPage`
  - `BibliotecaPage`
  - `AccountProfilePage`
- `HomePage` pode continuar carregando rápido no chunk principal ou ser lazy se necessário.

### 2.3 Refinamento em `vite.config.ts` (se necessário)
- Verificar a configuração de `manualChunks`:
  ```ts
  manualChunks: {
    'vendor-react': ['react', 'react-dom'],
    'vendor-icons': ['lucide-react'],
  }
  ```
- Se bibliotecas utilitárias pesadas ficarem no index, modularizá-las em chunk vendor dedicado sem quebrar a inicialização.

---

## 3. Critérios de Aceite

- [ ] `npm run build` conclui com sucesso (código 0).
- [ ] O tamanho do chunk principal `dist/assets/index-*.js` é estritamente **menor que 300 kB** (meta: < 300 kB minificado).
- [ ] `npm run test:run` passa com **100% dos testes verdes** (mínimo 58/58 testes).
- [ ] A navegação entre Home, Catálogo, Detalhes da Obra, Leitor e Login funciona sem erros em tempo de execução.
- [ ] Gerar relatório `docs/orquestracao/frontend/relatorios/RELATORIO-TASK-126.md` com a tabela comparativa antes/depois dos chunks.

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
