# AUDITORIA TÉCNICA E PLANO DE SANEAMENTO — MANGANETWORKING
> **Data:** 26 de Outubro de 2026  
> **Autor / Tech Lead:** Hermes (Tech Lead & Arquiteto Principal)  
> **Status:** Aprovado para Planejamento e Execução pelos Operários Especializados

---

## 1. Visão Geral da Revisão

Esta auditoria inspecionou a base de código completa do projeto **MangaNetWorking** (Backend Java/Spring Boot e Frontend React/TypeScript), confrontando-a com a nossa "Bíblia de Engenharia":
- **Segurança estrita (Defense in Depth / Zero Trust)**
- **Eliminação total de dados fabricados (Mock em Produção)**
- **Anti-hardcoded e eliminação de Magic Numbers**
- **Clean Architecture & Separação de Responsabilidades (SRP)**
- **Decomposição de classes e componentes gigantes em unidades atômicas testáveis**

---

## 2. Diagnóstico por Categoria

### 2.1 🔴 Segurança & Falhas de Blindagem

| # | Arquivo | Linha / Trecho | Problema Encontrado | Risco & Impacto | Ação de Correção |
|---|---|---|---|---|---|
| **S1** | `SecurityConfig.java` | L118: `.requestMatchers("/api/auth/**").permitAll()` | Permissão wildcard genérica para todo o namespace `/api/auth/`. | Se novos endpoints forem criados sob `/api/auth/`, nascerão públicos por falha de configuração. Endpoints como `/api/auth/me`, `/api/auth/logout` e `/api/auth/2fa/request` já exigem sessão válida por código interno, mas não são blindados no Spring Security. | Especificar estritamente as rotas públicas (`/login`, `/register`, `/google`, `/2fa/verify`, `/policy`, `/password-reset/**`) e marcar `.anyRequest().authenticated()`. |
| **S2** | `WorkApplicationService.java` | L333, L379, L570 | Métodos públicos retornam entidades JPA (`WorkEntity`, `ChapterEntity`) diretamente para os Controllers. | Vaza o modelo relacional de banco, risco de `LazyInitializationException` ou serialização acidental de dados sensíveis na resposta JSON. | Refatorar para retornar DTOs imutáveis (`WorkDetailsResponseDto`, `ChapterSummaryDto`). |
| **S3** | `MercadoPagoService.java` | L385, L390, L546 | `new BigDecimal(amount.toString())` e conversões sem scale fixo. | Risco de `NumberFormatException`, imprecisão em arredondamento financeiro ou falha em comparação monetária. | Utilizar `BigDecimal.valueOf(...)` ou converter com escala explícita `setScale(2, RoundingMode.HALF_EVEN)`. |

---

### 2.2 🟠 Dados Fabricados (Mocks) & Inconsistências de Negócio

| # | Arquivo | Linha / Trecho | Problema Encontrado | Risco & Impacto | Ação de Correção |
|---|---|---|---|---|---|
| **D1** | `WorkDetailPage.tsx` | L134-136, L156-159 | Uso de `MOCK_CREATORS` e `MOCK_CHAPTERS` quando em ambiente `DEV` e a API não retorna dados. | Polui a interface com capítulos e autores falsos, causando confusão com contadores reais (ex: 420 likes vs 49 views). | Remover todo e qualquer fallback para `mockData.ts`. Se a API não tem capítulos, exibir estado vazio legítimo (`EmptyState`). |
| **D2** | `CreatorWorkspacePage.tsx` | L19 | `MOCK_CREATORS['creator-teofilo']` usado como fallback em `DEV`. | Exibe saldos, missões e dados financeiros inventados na tela do criador. | Eliminar fallback de mock. Exibir skeleton ou redirecionar/bloquear se não houver dados reais. |
| **D3** | `ReaderProfilePage.tsx` | L79 | `const likedWorks = (import.meta.env.DEV ? MOCK_WORKS : [])...` | Lê obras favoritadas de uma constante local em vez do endpoint real `/api/users/me/library`. | Substituir por chamada ao `userApi.getLibrary()`. |
| **D4** | `WorkApplicationService.java` | L542-567 (`deleteChapter`) | Ao excluir um capítulo, decrementa `totalChapters` e `totalLikes`, mas ignora `totalViews`. | O total de visualizações da obra fica descalibrado em relação à soma real dos capítulos restantes. | Chamar `workRepository.decrementTotalViewsBy(work.getId(), chapter.getViews())`. |

---

### 2.3 🟡 Anti-Hardcoded & Magic Numbers

| # | Arquivo | Linha / Trecho | Problema Encontrado | Ação de Correção |
|---|---|---|---|---|
| **H1** | `MercadoPagoService.java` | L90-91: `new BigDecimal("2.00")` e `new BigDecimal("10000.00")` | Valores mínimo e máximo de doação soltos no corpo do método. | Extrair para constantes da classe ou carregar de `PlatformProperties`: `MIN_DONATION_AMOUNT_BRL` e `MAX_DONATION_AMOUNT_BRL`. |
| **H2** | `RateLimitingFilter.java` | L47-53: Paths estritos fixados em array local | Conjunto de paths de autenticação espalhados no filtro. | Centralizar as definições de rotas sensíveis em classe utilitária de rotas da plataforma. |
| **H3** | `Header.tsx` e `SobrePage.tsx` | Cores hexadecimais literais inline (`#E8402F`, `#111111`) | Uso de cores fora dos design tokens. | Substituir por variáveis do Design System oficial: `var(--mn-ink)`, `var(--mn-paper)`, `var(--mn-yellow)`, `var(--mn-red)`. |

---

### 2.4 🔵 Classes & Componentes Monolíticos (Violação do SRP)

#### 1. Backend: `WorkApplicationService.java` (37.5 KB / 620 linhas)
* **Diagnóstico:** A classe é um monólito que mistura:
  1. Gerenciamento de Obras (criação, edição, exclusão, busca por slug).
  2. Gerenciamento de Capítulos (criação de capítulo de mangá, criação de capítulo de prosa, reordenação de páginas).
  3. Validação de blocos de Light Novel (`ChapterBlocksPolicy`).
  4. Leitura e autorização de capítulos (`readChapter`).
* **Refatoração Proposta:**
  * Manter `WorkApplicationService`: focado estritamente no agregado `Work` (criação, atualização, exclusão, metadados e listagem).
  * Criar `ChapterApplicationService`: responsável pelo ciclo de vida do capítulo (`ChapterEntity`, leitura pública, validação de blocos de light novel, permissões de early access e exclusão com recálculo de contadores).

#### 2. Backend: `CreatorAnalyticsApplicationService.java` (30 KB / 638 linhas)
* **Diagnóstico:** Um único método gigante (`getAnalytics`) realiza busca NoSQL, agrupamento diário, mapa de calor 7x24, funil de leitura e cálculo de retenção.
* **Refatoração Proposta:**
  * Extrair `CreatorRetentionCalculator`: isolar a computação de retenção por página/bloco.
  * Extrair `CreatorDiscoveryFunnelCalculator`: isolar a lógica de cálculo de impressões, cliques e CTR.

#### 3. Frontend: `LightNovelChapterWizard.tsx` (61.3 KB / 1.443 linhas / 19 useStates)
* **Diagnóstico:** O componente mais inflado do projeto. Contém o wizard inteiro de 4 etapas em um switch-case colossal, gerenciando drag-and-drop, upload multipart, modal de crop de imagem, preview do leitor de prosa e persistência de rascunho.
* **Refatoração Proposta:**
  * Criar `useLightNovelEditor.ts`: Custom hook com o estado dos blocos, regras de autosave no `localStorage`, validação de limites e atalhos de teclado.
  * Criar subcomponentes modulares dentro de `components/creator/novel/`:
    * `NovelDetailsStep.tsx` (Etapa 1: tipo, título, agendamento, capa).
    * `NovelBlockEditorStep.tsx` (Etapa 2: lista de blocos, drag-and-drop, inserção).
    * `NovelReviewStep.tsx` (Etapa 3: sumário de caracteres, alertas da política editorial).
    * `NovelPublishStep.tsx` (Etapa 4: checklist e botão de publicação).
    * `NovelBlockItem.tsx` (Renderizador de bloco individual com botões subir/descer/remover).

#### 4. Frontend: `ReaderPage.tsx` (46.4 KB / 1.129 linhas)
* **Diagnóstico:** Controla leitura paginada de mangá, leitura contínua de webtoon, leitura contínua de prosa de light novel, barra de preferências de tipografia, AdOverlay e envio de telemetria.
* **Refatoração Proposta:**
  * Criar `MangaReaderView.tsx`: exclusivamente para navegação de imagens (paginada/scroll).
  * Criar `ProseReaderView.tsx`: renderização dos blocos de light novel com a barra de configurações de texto.
  * Criar `useReaderTelemetry.ts`: hook isolado para despachar eventos de telemetria (`VIEW`, `READ`) sem poluir a visualização.

---

## 3. Matriz de Execução (Tasks Delegadas)

Para manter a ordem e a rastreabilidade sem quebrar os 434 testes verdes existentes, a execução será dividida em 3 tarefas atômicas:

1. **TASK-BACKEND-CLEANUP-001 (OpenCode Backend):**
   - Extrair `ChapterApplicationService` de `WorkApplicationService`.
   - Eliminar retorno de `@Entity` nos métodos de criação/atualização.
   - Tratar ajuste de views no `deleteChapter`.
   - Blindagem granular de `/api/auth/**` no `SecurityConfig.java`.
   - Limpeza de magic numbers e conversões de BigDecimal em `MercadoPagoService.java`.

2. **TASK-FRONTEND-MOCKS-PURGE (OpenCode Frontend):**
   - Expurgo completo de `mockData.ts` de `WorkDetailPage.tsx`, `CreatorWorkspacePage.tsx` e `ReaderProfilePage.tsx`.
   - Garantir que toda listagem sem dados utilize `EmptyState` real.

3. **TASK-FRONTEND-DECOMPOSE-WIZARD (OpenCode Frontend):**
   - Fatiar `LightNovelChapterWizard.tsx` (1.443 linhas) no hook `useLightNovelEditor.ts` e etapas modulares em pasta dedicada.
   - Fatiar `ReaderPage.tsx` em visualizadores dedicados (`MangaReaderView` e `ProseReaderView`).

---

*Assinado por: Hermes (Tech Lead & Arquiteto Principal MangaNetWorking)*
