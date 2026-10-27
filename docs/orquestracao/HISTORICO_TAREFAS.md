# Histórico de Tarefas, Relatórios e Auditorias Concluídas

> **Registro Histórico Consolidado**  
> Este documento arquiva o histórico de ordens de serviço (tasks), relatórios de implementação e pareceres de auditoria executados durante o desenvolvimento do MangaNetWorking.

---

## 1. Linha do Tempo de Tarefas Concluídas

### TASK-001: Session Store Cleanup & Desacoplamento
- **Objetivo:** Isolar e desacoplar a gestão de sessões HTTP em memória, criando a porta `SessionStore` e a implementação `InMemorySessionStore`.
- **Arquivos Tocados:** `SessionService.java`, `SessionStore.java`, `InMemorySessionStore.java`.
- **Status:** ✅ Concluído e auditado (PARECER-001 APROVADO).
- **Evidência:** Sessões expiram corretamente por TTL; sem concorrência destrutiva no `ConcurrentHashMap`.

---

### TASK-002: Rate Limit Store In-Memory
- **Objetivo:** Extração do controle de taxa de requisições por IP para porta desacoplada `RateLimitStore` e implementação `InMemoryRateLimitStore`.
- **Arquivos Tocados:** `RateLimitingFilter.java`, `RateLimitStore.java`, `InMemoryRateLimitStore.java`.
- **Status:** ✅ Concluído e auditado (PARECER-002 APROVADO).
- **Evidência:** Limite de 15 req/min para rotas críticas de autenticação e denúncia; 120 req/min global; headers `Retry-After` formatados.

---

### TASK-003: Purga de Placeholders e Design System no Frontend
- **Objetivo:** Remoção de mocks e placeholders de XP (`340/500`), temporadas e dias no painel do criador (`CreatorWorkspacePage.tsx`). Conversão de cores literais para tokens CSS `var(--mn-*)`.
- **Arquivos Tocados:** `frontend/src/pages/CreatorWorkspacePage.tsx`, `frontend/src/styles/global.css`, `frontend/src/components/ui/`.
- **Status:** ✅ Concluído e auditado (RELATORIO-003 / RELATORIO-004 FE).
- **Evidência:** `npm run build` aprovado em 2.02s (1640 módulos). Zero menção hardcoded de XP no workspace.

---

### TASK-004: Hardening de LGPD, Sessão, Cookie e Rate Limiting
- **Objetivo:** Resolver achados críticos de segurança identificados na auditoria:
  1. Revogação de sessões em memória no momento do delete de conta LGPD (`SessionStore.removeByUserId`).
  2. Anonimização de perfil do criador (`CreatorEntity`), remoção de binários de avatar do storage.
  3. Configuração de `SameSite=Lax` e `Secure` no cookie de sessão via `PlatformProperties`.
  4. Eliminação de registro duplicado de filtros (`FilterRegistrationBean#setEnabled(false)`).
  5. Desoneração de assets estáticos e storage no `RateLimitingFilter`.
- **Arquivos Tocados:** `UserProfileApplicationService.java`, `SessionService.java`, `SecurityConfig.java`, `RateLimitingFilter.java`, `PlatformProperties.java`, `LocalFileStorageService.java`.
- **Status:** ✅ Concluído (189 testes verdes).

---

### TASK-005: Regularização e Blindagem Final (Passes 15 e 16)
- **Objetivo:** Finalização do ciclo com Flyway V5 (`terms_accepted_at`, `birth_date`), validação de termos no cadastro, step-up 2FA em alteração de chave PIX (`PUT /api/creators/pix-key`), maioridade (18+) para monetização e despublicação de obras no esquecimento (`status = 'archived_lgpd'`).
- **Arquivos Tocados:** `V5__lgpd_consent_and_work_archival.sql`, `UserEntity.java`, `RegisterRequestDto.java`, `AuthApplicationService.java`, `CreatorApplicationService.java`, `CreatorController.java`, `UpdatePixKeyRequestDto.java`, `LocalFileStorageService.java`, `LoginPage.tsx`, `CreatorWorkspacePage.tsx`.
- **Status:** ✅ Concluído e verificado (189 testes verdes, 0 falhas).

---

### TASK-006: Revisão F1–F4, escopo editorial e Sobre nós (2026-10-19)
- **Objetivo:** conferir as anotações de Java/SQL/Docker, Clean Code e segurança contra o código real; revisar os bloqueios F1–F4; iniciar F5 com a página institucional do projeto.
- **Arquivos principais:** `frontend/src/pages/SobrePage.tsx`, `frontend/public/assets/about/`, `MonetizationServiceTest.java` e documentos canônicos existentes (`ROADMAP-FASES.md`, `AUDITORIA-ATUAL.md`, `PLANO_DE_FASES.md`). Referências antigas das skills foram alinhadas aos mesmos documentos, sem criar outro plano.
- **Resultado:** Sobre nós refeito com as duas fotos locais do MangaTeofilo e a transição circular adaptada para toque/teclado. A cópia conta a origem do MangaTeofilo/Kokuin, apresenta o criador e posiciona light novels como requisito em construção. Escopo de negócio esclarecido: sem loja, venda de mangá/capítulo ou produtos físicos, estoque e logística.
- **Evidência:** `npm.cmd run build` concluído (1644 módulos); `mvn -o test` → **254 testes, 0 falhas/erros**, incluindo arredondamento do split `HALF_UP`, rejeição de campos JSON extras e integrações Testcontainers com Docker real.
- **Estado preservado:** histórico anterior não foi apagado nem renumerado. F1–F4 seguem parciais por DNS/Google externo/OTP distribuído, referências de storage sem arquivos, CPF sentinela, checkout de doações/membros e Sandbox. F5 segue parcial pelos mocks em outras telas. Light novel ainda não tem modelo/leitor em prosa.

### TASK-007: Continuação F3–F6 e correção do estado real (2026-10-19)
- **Objetivo:** atender os itens pedidos de F3/F4/F5 e iniciar F6 sem sobrescrever o histórico anterior.
- **Arquivos principais:** `WorkEntity`, `ChapterEntity`, `WorkApplicationService`, `MercadoPagoService`, `MonetizationService`, `AuthApplicationService`, migrations V8–V10, telas do leitor/perfil/workspace e documentos canônicos existentes.
- **Resultado:** criado formato `MANGA`/`LIGHT_NOVEL` com capítulos `IMAGE_PAGES`/`PROSE`, sanitização de prosa e renderização dedicada; checkout de apoio idempotente e webhook vinculado à intent persistida; novos cadastros não gravam CPF sentinela; mocks limitados a DEV; 401 encerra sessão; exportação/exclusão não fingem sucesso e perfil não inventa preço/validade VIP.
- **Evidência:** `mvn -o -Dtest=WorkApplicationServiceTest,AuthApplicationServiceTest,MonetizationServiceTest,MercadoPagoServiceTest test` → **32 testes, 0 falhas/erros**; inclui teste de retry idempotente. Depois `mvn -o test` completo → **258 testes, 0 falhas/erros**, Testcontainers validou V1..V10. `npm.cmd run build` → TypeScript/Vite verde, 1644 módulos. Stack após `docker compose up -d --build backend`: backend healthy, Flyway V8/V9/V10 `success=true`, `GET /api/feed` HTTP 200.
- **Pendências honestas:** carga do leitor retornou 100/100 HTTP 404 porque páginas registradas não existem no storage; não é medição válida. Checkout de doação/membro ainda não tem teste de regressão próprio nem homologação Sandbox. F5 tem ocorrência de contraste `--mn-mute` sobre fundo claro (2.14:1) e falta passe global de teclado. F6: consentimento versionado, reaceite e auditoria ponta a ponta continuam abertos.
- **Preservação:** nenhuma migração anterior ou histórico foi reescrito; V8, V9 e V10 foram aplicadas sem remoção de volumes.

### TASK-008: F5/F7 pendências e avanço operacional F8 (2026-10-19)
- **Objetivo:** concluir o que é possível no passe F5/F7 e avançar F8 sem simular evidência ou alterar histórico anterior.
- **Resultado F8:** adapter de desafios OTP em Redis com operação atômica e store local condicionado ao ambiente; produção exige Redis para sessão, rate limit e OTP. Adicionados contadores de OTP/e-mail, logging estruturado sem segredos, regras Prometheus, script de backup/restore-check isolado e runbook operacional.
- **Evidência local:** 12 testes direcionados passaram (`Failures: 0, Errors: 0`, `BUILD SUCCESS`); parser do PowerShell e `docker compose config --quiet` passaram; `npm.cmd run build` passou (1647 módulos).
- **Pendências F5/F7:** passe visual/teclado não pôde ser realizado porque navegador local está desabilitado; CI workflow já atende `pull_request`, mas não existe execução remota e permissão GitHub disponível é read/pull, sem push.
- **Pendências F8:** Docker negou acesso e Redis não estava escutando; logo não houve teste operacional de Redis/backup/restore. Alertmanager, storage externo cifrado, SMTP autenticado/bounce, DPO e retenção dependem de decisões e credenciais externas.
- **Preservação:** entrada adicionada ao histórico existente; nenhuma tarefa anterior foi removida ou renumerada. Sem commit/push.

### TASK-009: UX e força mínima de senha (2026-10-19)
- **Objetivo:** melhorar o fluxo de senha com visibilidade sob demanda, feedback de força e rejeição server-side de senhas fracas.
- **Resultado:** componente `PasswordInput` é reutilizado em login, cadastro, confirmação e reset; botão de olho tem nome acessível e estado pressionado. Cadastro/reset mostram painel inline Fraca/Média/Forte, requisitos e orientação restante. Backend aceita novas senhas somente em nível Médio/Forte; login não aplica esse gate para preservar credenciais legadas. Unicode e espaços seguem aceitos como caracteres.
- **Evidência:** `PasswordPolicyTest` → **4 testes, 0 falhas/erros, BUILD SUCCESS**; `npm.cmd run build` → TypeScript/Vite verde, **1648 módulos**.
- **Pendente:** o teste de serviço para cadastro fraco foi acrescentado, porém `AuthApplicationServiceTest` não completou localmente devido ao attach do Mockito no Windows; execução limpa ainda necessária. A classificação é heurística, não uma base de senhas vazadas.
- **Próximas ações:** conforme a fila única do roadmap, confirmar a regressão em CI, depois passe global F5, execução PR F7 e provas operacionais F8 conforme permissões/infra disponíveis.

---

### TASK-010: Recuperação de senha, fases 13/14 e consolidação local (2026-10-20)
- **Objetivo:** revisar o fluxo de recuperação de conta, atualizar o plano mestre sem apagar o histórico e consolidar alterações em commits locais pequenos, sem push.
- **Resultado:** token de recuperação com hash persistido, TTL e origem configuráveis/validados, teste com relógio fixo, revogação de sessão e OTP pendente, e Dev Outbox local com link expirável apenas em `dev/test/local`. A Fase 13 registra DNS/provedor e Mercado Pago Sandbox como dependências externas; a Fase 14 registra o Compose local preparado, mas nenhuma VM/produção implantada.
- **Evidência:** testes de recuperação/controller/SMTP 17/17; suíte backend 284 testes, 0 falhas/erros e 12 ignorados por Docker inacessível; frontend build 1649 módulos. Compose local e Compose de produção passaram validação estática, com placeholders no último.
- **Commits:** migrations, auth, frontend, leitor F3, perfis/uploads, checkout, Compose/stores, CI e documentos foram gravados localmente em grupos; nenhum push/PR foi criado.
- **Pendências:** aplicar V12/V13 em Postgres real; recuperação ponta a ponta Mailpit e concorrência; DNS SPF/DKIM/DMARC; credenciais Sandbox + webhook público; acesso/decisões Oracle; execução CI remota e operação real de backup/restore.
- **Preservação:** alterações de outras áreas que não puderam ser isoladas com segurança permanecem no working tree; nenhum reset, limpeza destrutiva ou descarte foi executado.
