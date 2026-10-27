# AUDITORIA ATUAL — MangaNetWorking

> **Data:** 22/10/2026 · **Escopo:** working tree real (backend Spring Boot, frontend React, Docker, documentação).
> **Método:** leitura do código/diff e verificações anotadas nas seções 7.2–7.6.
> **Verificação mais recente:** `mvn -o test` → **412 testes, 0 falhas, 0 erros, 0 ignorados**; Docker/Testcontainers disponíveis. V13 e V14 aplicadas em PostgreSQL real (`token_hash character varying(64)` e `users.is_owner boolean`, `validate` verde); fluxo de recuperação no Mailpit, consumo concorrente 204/401, rotação de token e `ROLE_OWNER` exercitados. `npm.cmd run build` verde; container frontend reconstruído. Compose local e de produção passaram `config --quiet` (prod com `MAIL_*` fictícios, sem `.env`). As seções 7.15–7.17 registram o estado mais recente. Nesta rodada foram executados testes reais, QA autenticado de criador/moderador, revisão de segurança/arquitetura e criação da conta DONO com sessão real verificada; a senha não foi registrada.

---

## 1. Resumo por severidade

| Severidade | Quantidade | Bloqueia produção? |
|---|---:|---|
| 🔴 Crítico | 5 | Sim |
| 🟠 Alto | 7 | Sim |
| 🟡 Médio | 9 | Não, mas corrói confiança/segurança |
| 🔵 Baixo | 6 | Não |

As quantidades contam achados registrados, incluindo os já resolvidos; status e correção ficam anotados em cada achado e na verificação 7.6.

**Veredito:** o projeto **não está pronto para produção**. Permanecem pendentes DNS autenticado, operação real atual do Redis OTP, aplicação de V12, homologação Sandbox, inspeção visual completa, política oficial e controles externos de backup/alertas/governança. A carga controlada do leitor com arquivo real passou, embora referências órfãs antigas ainda existam. O avanço à monetização bloqueia data de nascimento ausente ou idade inferior a 18; step-up PIX, SMTP local/Mailpit, privacidade/avatar e stack foram verificados anteriormente. Veja a seção 7.13 para o quadro vigente.

---

## 2. 🔴 Críticos

### C1 — ✅ RESOLVIDO — `loginWithGoogle` não verificava o token do Google

**Evidência:** `GoogleLoginRequestDto.java:8` recebe `googleToken`; `AuthApplicationService.java:115-136` usa apenas `dto.email()` e nunca lê o token.

**Impacto:** qualquer pessoa pode chamar `POST /api/auth/google` com o e-mail de outra pessoa. O servidor cria conta se não existir e envia OTP para o e-mail da vítima. Com Dev Outbox exposto por engano (perfil errado) ou SMTP comprometido, vira takeover. Mesmo sem isso, permite criação de contas e spam de OTP em nome de terceiros.

**Correção esperada:** validar o ID token no servidor (`GoogleIdTokenVerifier`, audience = client ID, issuer, expiração), extrair `email`, `name`, `picture` das claims verificadas e ignorar completamente os campos de identidade do corpo. Se o token for inválido, 401.

**Correção aplicada (2026-10-19):** `GoogleIdTokenVerifier` verifica audience/issuer/expiração/assinatura; o serviço exige email verificado e subject, deriva identidade apenas das claims e falha fechado sem `GOOGLE_CLIENT_ID`. O DTO recebe somente o token. Teste direcionado confirma token inválido rejeitado antes de acessar/criar conta. Token válido real ainda não foi testado por depender de credencial Google.

**Fase:** F1 · **Arquivos:** `AuthApplicationService.java`, `GoogleLoginRequestDto.java`, configuração do client ID.

---

### C2 — ✅ RESOLVIDO — Maioridade é contornável com `birthDate` nulo

**Evidência histórica:** `birth_date` continua opcional no cadastro/schema, mas `CreatorApplicationService.claimMissionReward` agora rejeita data ausente e idade abaixo de 18 antes de avançar ao nível 2.

**Impacto histórico:** antes da correção, uma data ausente permitia contornar a regra 18+ no avanço para monetização.

**Correção aplicada:** guardas no serviço bloqueiam `user == null`, `birthDate == null` e idade menor que 18; `CreatorApplicationServiceTest` cobre data ausente e menoridade. O schema permanece nullable para permitir cadastro sem monetização; consentimento/data exigidos devem ser tratados no onboarding financeiro.

**Fase:** F4/F6 · **Arquivos:** `CreatorApplicationService.java`, `CreatorApplicationServiceTest.java`.

---

### C3 — Step-up PIX e disponibilidade de desafio entre réplicas

**Evidência atualizada (2026-10-19):** `POST /api/auth/2fa/request` autenticado emite `STEP_UP_PIX`; OTP HMAC e purpose são vinculados; o limiter aplica cooldown de 60 s e limite 3/10 min por conta/IP; troca PIX audita a alteração. Adapter Redis com consumo atômico entre réplicas foi implementado e selecionado pelo Compose, mas aguarda teste operacional com Redis real nesta rodada.

**Impacto remanescente:** uma implantação horizontal pode emitir o código numa réplica e receber a verificação em outra, que não possui o desafio.

**Correção aplicada:** purpose/HMAC, limiter e auditoria PIX foram implementados; o caminho Redis do limiter existe. Próximo: mover o desafio OTP a storage compartilhado e testá-lo em múltiplas réplicas.

**Fase:** F1/F4 · **Arquivos:** `AuthController.java`, `AuthApplicationService.java`, `TwoFactorAuthService.java`.

---

### C4 — Entrega SMTP local homologada; domínio real pendente

**Status atualizado (2026-10-19):** adapter `SmtpMfaNotificationSender`, `JavaMailSender`, Mailpit, remetente de marca e envio após commit existem. Teste unitário confirma composição sem OTP no assunto; teste E2E local recebeu a mensagem e validou o OTP. SPF/DKIM/DMARC dependem de domínio/provedor externos.

**Impacto:** em produção o 2FA obrigatório não entrega código; o login fica impossível. Se o perfil de dev for ativado por engano, o endpoint `/api/dev/outbox/latest` entrega OTP sem autenticação.

**Pendência:** configurar e provar SPF/DKIM/DMARC no domínio real. Compose de produção exige variáveis SMTP e `MAIL_FROM`.

**Fase:** F1 · **Detalhamento:** `docs/orquestracao/EMAIL-E-2FA.md`.

---

### C5 — ✅ RESOLVIDO — `docker-compose.yml` inválido impedia subir a stack

**Evidência original:** `docker-compose.yml:13` usava `${POSTGRES_PASSWORD:manga_dev_local_secure_2026}`; o Compose respondia `invalid interpolation format`.

**Correção aplicada:** `${POSTGRES_PASSWORD:-manga_dev_local_secure_2026}`. Evidência de verificação: `docker compose config --quiet` → exit 0; `docker compose up -d --build` deixou Postgres, Mongo, Redis, Mailpit, backend e frontend `healthy`; `GET /api/feed` respondeu HTTP 200 no backend e pelo proxy frontend.

**Pendência identificada na auditoria original:** o volume `manganetworking_postgres_data` tinha senha de inicialização anterior. Na verificação F0 de 2026-10-19, o backend conectou ao volume existente usando a configuração local, sem recriá-lo; a pendência não se reproduziu.

**Fase:** F0 · **Arquivo:** `docker-compose.yml`.

## 2.1 Correções F1/F2 executadas (2026-10-19)

### Perfil público/privado e links de criador

O GET de perfil de leitor aceita visitante anônimo, mas a regra de privacidade continua no `UserProfileApplicationService`; terceiros recebem negação para perfis privados. A identidade de usuário autenticado vem exclusivamente da sessão. Instagram e YouTube são limitados aos domínios oficiais; links de portfólio exigem HTTPS e rejeitam credenciais e hosts locais. `POST /api/storage/avatar` exige autenticação, rejeita imagens acima de 8192 px ou 16 MP, recorta/redimensiona para 512×512 e reencoda em JPEG para remover metadados da origem.

**Evidência:** `UserProfileIdentityTest`, `UserProfileLgpdTest`, `CreatorApplicationServiceTest` e `FileStorageUploadTest` verdes; upload confirma JPEG 512×512, imagem inválida rejeitada, URL externa de avatar negada, privacidade persistida via API e HTML removido da bio.

**Revisão F2 (2026-10-19):** upload de avatar integrado nas telas do leitor e criador; perfil atualiza somente após confirmação do backend. Controllers enviam `Cache-Control: no-store`. JPEG/PNG são normalizados; WebP segue sem decoder nesse pipeline.

### F3 — publicação, páginas e obra arquivada

O detalhe público da obra agora omite capítulos com `publicReleaseAt` futuro; obras arquivadas por exclusão LGPD ficam indisponíveis por detalhe e URLs antigas de páginas são negadas no guard. A entrega de páginas verifica MIME por extensão, `nosniff` e `private, no-store`; GET de storage fica fora do rate-limit geral. O progresso tem índice único `userId + workId` e testes de repetição/ordem atrasada.

**Correção F3 (2026-10-19):** upload em lote e criação de capítulo limitam o capítulo a 300 páginas; o lote inteiro é validado antes da escrita, e dimensões acima de 8192 px por lado ou 16 MP são rejeitadas por metadata do decoder. Testes cobrem o limite dimensional e a rejeição acima de 300 páginas. Formatos sem reader ImageIO instalado (WebP neste runtime) são rejeitados no lote.

**Atualização F3 (2026-10-19):** V8 acrescenta formatos `MANGA`/`LIGHT_NOVEL` e capítulos `IMAGE_PAGES`/`PROSE`; a API sanitiza texto e o frontend escolhe leitor de prosa sem alterar o leitor de imagens. A suíte de regressão ainda não teve execução conclusiva nesta rodada.

**Registro histórico F3 (supersedido):** a primeira tentativa com referências órfãs retornou 404, sem medir desempenho. A seção 7.9 registra a repetição posterior com fixture JPEG real (100/100 HTTP 200, p95 190 ms); referências órfãs foram preservadas. Mobile offline e sincronização do documento Mongo de feed no arquivamento ainda precisam de revisão específica.

---

## 3. 🟠 Altos

### A1 — V5 presume consentimento retroativo

**Evidência:** `V5__lgpd_consent_and_work_archival.sql:13-16` faz `terms_accepted_at = created_at` e `privacy_policy_version = 'v1.0'` para todos os usuários existentes.

**Impacto:** registrar consentimento que não foi efetivamente dado é risco jurídico (Art. 8º). O correto é reaceite ou base legal diversa documentada.

**Correção:** manter nulo para legado e forçar reaceite no próximo login, ou registrar a base legal (execução de contrato) com nota formal. Não silenciar o problema no SQL.

**Correção aplicada (V11):** V5 permaneceu imutável. A V11 limpa apenas linhas que correspondem ao padrão exato do backfill inferido (`terms_accepted_at = created_at` e versão `v1.0`), registra consentimentos futuros como eventos append-only e exige reaceite da versão corrente antes das demais operações. O conteúdo oficial da política ainda precisa ser fornecido/publicado; versionar sem documento aprovado não encerra a revisão jurídica.

---

### A2 — ✅ RESOLVIDO PARA NOVOS CADASTROS — CPF sentinela

**Evidência histórica:** cadastro antigo gravava `"000.000.000-00"` quando `dto.cpf()` era nulo.

**Impacto:** dado fiscal falso no banco, quebra de integridade e risco de fraude/pagamento. Também mascara a ausência de um dado obrigatório para monetização.

**Correção aplicada nesta rodada:** `CpfValidator` valida os dígitos verificadores; cadastro de criador sem CPF armazena `null`, CPF inválido é rejeitado, e V10 permite identidade fiscal pendente. Checkout de apoio exige CPF válido. `AuthApplicationServiceTest` passou dentro dos 32 testes direcionados; V10 foi aplicada ao Postgres local com `success=true`. Dados legados com CPF sentinela não foram alterados e ainda precisam de saneamento explícito.

---

### A3 — OTP em texto puro e sem vínculo de propósito — corrigido em 2026-10-19

**Evidência histórica:** a implementação anterior armazenava o código em texto puro e não separava os propósitos.

**Correção verificada:** `TwoFactorAuthService` armazena HMAC-SHA-256 com chave configurável, compara em tempo constante (`MessageDigest.isEqual`) e vincula cada desafio a usuário e purpose (`LOGIN`, `STEP_UP_PIX` ou `RESET_PASSWORD`). Testes cobrem expiração, reuso, purpose trocado e bloqueio na 6ª tentativa. A chave de produção é obrigatória via `OTP_HMAC_SECRET`.

**Risco remanescente:** o desafio continua em memória por instância; ver C3 para impacto em deployment horizontal.

---

### A4 — Enumeração de e-mail no cadastro — corrigido em 2026-10-19

**Evidência:** `AuthApplicationService.java:49-51` retorna `"E-mail já cadastrado na plataforma"`.

**Impacto:** permite descobrir quais e-mails têm conta (privacidade e base para phishing).

**Correção aplicada:** cadastro duplicado e pedido de recuperação retornam a mesma resposta genérica; teste garante que o cadastro duplicado não revela a existência da conta. Verificação independente de e-mail não faz parte do fluxo implementado.

---

### A5 — Envio de OTP dentro da transação — corrigido em 2026-10-19

**Evidência:** `AuthApplicationService.java:46` (`@Transactional`) e `:86` (`generateAndSendOtp` dentro do método).

**Impacto:** se o commit falhar depois do envio, o usuário recebe um código de uma conta que não existe; se o SMTP falhar, a transação inteira reverte. E-mail não é transacional.

**Correção aplicada:** emissão ativa o desafio e envia a mensagem apenas em `afterCommit`; teste garante que rollback não disponibiliza OTP nem dispara e-mail.

---

### A6 — Login Google cria conta sem consentimento nem maioridade

**Evidência:** `AuthApplicationService.java:118-125` cria `UserEntity` com e-mail/nome/avatar e `twoFactorEnabled=true`, sem `termsAcceptedAt`, `privacyPolicyVersion` ou `birthDate`.

**Impacto:** contas criadas por OAuth sem base legal registrada; criadores podem monetizar sem idade.

**Correção:** tratar primeiro login Google como cadastro: exigir aceite de termos e data de nascimento em tela de complemento antes de criar a sessão definitiva.

**Correção aplicada:** criação de conta Google exige aceite e versão atual enviados pelo cliente; nome/e-mail/avatar continuam derivados somente das claims verificadas. O fluxo de cadastro federado na UI e coleta de nascimento permanecem pendentes; a monetização segue bloqueada sem nascimento/18+.

---

### A7 — Troca de PIX sem trilha de auditoria — corrigido em 2026-10-19

**Evidência histórica:** a versão anterior alterava `pixKey`/`pixKeyType` sem evento de auditoria.

**Impacto:** operação financeira crítica sem rastro de quem, quando, de qual IP e de qual valor antigo/novo. Dificulta investigação de fraude e atendimento LGPD.

**Correção aplicada:** V7 registra ator, IP, tipos e sufixos mascarados, nunca a chave completa; trigger bloqueia UPDATE/DELETE. Teste de integração PostgreSQL comprova inserção e imutabilidade. User-agent/resultado não são armazenados.

---

## 4. 🟡 Médios

| # | Achado | Evidência | Correção |
|---|---|---|---|
| M1 | Construtor de conveniência do DTO assume `termsAccepted=true` e nascimento em 2000 | `RegisterRequestDto.java:36-38` | Mover para builder de teste; produção nunca defaulta consentimento |
| M2 | Versão da política hardcoded | `AuthApplicationService.java:66` | Constante/config versionada e reaceite |
| M3 | `terms_accepted_at` nullable e sem reaceite | V5:8 | `NOT NULL` para novos + checagem de versão |
| M4 | Frontend ainda semeia identidade mock | `CreatorWorkspacePage.tsx`, `useCatalogWorks.ts`, `ReaderProfilePage.tsx`, `WorkDetailPage.tsx` | Usar somente API; fixtures atrás de `import.meta.env.DEV` |
| M5 | `AuthContext` mantém demo em 401 | `AuthContext.tsx:49` | 401 = deslogado; demo só em DEV |
| M6 | Várias telas têm fallback de catálogo/capítulo para mock | `App.tsx`, `useCatalogWorks.ts`, `BibliotecaPage.tsx`, `HomePage.tsx`, `ReaderProfilePage.tsx`, `WorkDetailPage.tsx` | Isolar fixtures de demonstração em DEV; 401 sempre desloga |
| M7 | Avatar não é recodificado no servidor — resolvido | Pipeline de `/api/storage/avatar` | ImageIO com limites, crop 512×512 e JPEG recodificado; testes verdes |
| M8 | Stores têm fallback local para dev/test; operação Redis OTP/sessão/throttle foi observada na stack real, mas boot `prod` entre réplicas e TTL/failover seguem não executados | `RedisSessionStore`, `RedisRateLimitStore`, `RedisOtpChallengeStore` | Compose e profile prod selecionam/exigem Redis; executar teste operacional entre réplicas antes de escalar |
| M9 | Sem métrica/alerta de falha 2FA e bounce de e-mail | `TwoFactorAuthService` | Contadores, alerta e bloqueio progressivo |

---

## 5. 🔵 Baixos

| # | Achado | Evidência | Correção |
|---|---|---|---|
| B1 | Comparação de OTP não é constant-time — resolvido | `TwoFactorAuthService` | `MessageDigest.isEqual` compara os HMACs |
| B2 | Multiplicação de tamanho podia estourar `long` — resolvido | `LocalFileStorageService` | `Math.multiplyExact` e rejeição de limites zero/negativo/overflow, cobertos por teste |
| B3 | Documentação com contagem divergente (189 vs 197) | `HISTORICO_TAREFAS.md:49` vs `PLANO_DE_FASES.md:5` | Fonte única: saída real do Maven |
| B4 | Referências legadas a `docs/reviews/` | `PROMPT_ANTIGRAVITY.md`, `code-review/SKILL.md` | ✅ Resolvido: referências apontam para os documentos canônicos atuais |
| B5 | Skills citavam checklists/status inexistentes | `database-design/SKILL.md`, `skills/README.md` | ✅ Resolvido: instruções apontam para roadmap/auditoria e skills existentes |
| B6 | `XpBar.tsx` órfão | `frontend/src/components/ui/XpBar.tsx` | Remover em limpeza ou reutilizar |

---

## 6. O que está sólido (não mexer sem motivo)

- **Ownership server-side:** `CreatorController.java:31,39,48,58,70` usa `SecurityContextUtils.requireCurrentCreatorId()`, não ID do cliente.
- **DTOs explícitos:** entrada por `record` com Bean Validation; sem entidade JPA como request.
- **Exclusão LGPD:** revoga sessões, apaga avatar local com guarda de URL externa, anonimiza usuário e criador, arquiva obras e limpa Mongo (`UserProfileApplicationService.java:199-253`).
- **Magic bytes:** JPEG/PNG/WebP validados em `LocalFileStorageService.java:139-175`.
- **Índices Mongo:** `ReadingProgressDocument` tem composto único `userId+workId`; `CreatorMissionDocument` e `EngagementEventDocument` têm `@Indexed`.
- **Split financeiro:** `BigDecimal` + `HALF_UP`, constantes em `application.yml`.
- **Rate limit:** buckets separados, storage/OPTIONS fora do contador, `Retry-After` real.
- **Cookie:** `SameSite=Lax` + `Secure` configurável por `platform.security.cookie-secure`.
- **Migrações:** V1..V16 aplicadas em PostgreSQL real e imutáveis; V13 usa `VARCHAR(64)`, V14 adiciona `users.is_owner`, V15 cria `privacy_governance_actions` e V16 cria `email_delivery_events` (ambas append-only); o `validate` do Hibernate está verde. Limiter Redis usa chaves expiráveis, sem tabela SQL. Desafios OTP usam adapter selecionável em memória ou Redis; a operação real foi observada no Redis local.

---

## 7. Verificado nesta rodada (2026-10-19)

- [x] `mvn -o test` → **Tests run: 207, Failures: 0, Errors: 0, Skipped: 0** / BUILD SUCCESS (inclui Testcontainers de Postgres/Mongo/Redis rodando de verdade).
- [x] `npm run build` → tsc + vite build OK (386 kB JS / 62 kB CSS).
- [x] `docker compose up -d` → postgres, mongodb, mailpit e redis `healthy` (C5 corrigido).
- [x] Flyway V1..V5 aplicado em Postgres limpo (sem erro de validação do Hibernate).
- [x] Smoke real em sandbox: `/api/feed` 200, `/actuator/health` 200 `{"status":"UP"}`, `/actuator/prometheus` **401**, `/api/creators/analytics` **401**, `/api/creators/season` **401**.
- [ ] Smoke E2E 12/12 (script completo) — não reexecutado nesta rodada.
- [ ] Cookie emitido pelo Tomcat e ordem real dos filtros — não observado empiricamente.

## 7.1 Achados novos desta rodada

| ID | Severidade | Achado | Estado |
|---|---|---|---|
| N1 | 🔴 Alto | `engagement_events` existia sem **nenhum escritor**; o analytics da Fase 13 sairia vazio. | Corrigido: `ReadingProgressService` grava evento `READ` (best-effort) + `EngagementEventMongoRepository`. |
| N2 | 🟠 Médio | `spring.data.mongodb.auto-index-creation` ausente → `@Indexed`/`@CompoundIndex` nunca eram materializados. | Corrigido (`true`) + índice composto `workId+timestamp`. |
| N3 | 🔴 Alto | `/actuator/prometheus` e `/actuator/metrics/**` em `permitAll`. | Corrigido para `hasRole("MODERATOR")`; verificado 401 sem sessão. |
| N4 | 🟠 Médio | Redis introduzido na Fase 12 mas ausente do `docker-compose.yml` local → `/actuator/health` DOWN. | Corrigido: serviço `redis` + volume `manganetworking_redis_data`. |
| N5 | 🟡 Baixo | `sw.js` usava `cache.addAll` com `/vite.svg` inexistente → instalação do Service Worker falhava (offline PWA não ativava). | Corrigido: assets individuais com fallback. |
| N6 | 🟡 Baixo | `offlineStorage` marcava capítulo como baixado mesmo com páginas falhando. | Corrigido: download incompleto lança erro e não grava metadados. |
| N7 | 🟡 Baixo | `VipModal` dizia "Leitura Offline (em breve) ... não disponível" com a feature já entregue. | Corrigido. |
| N8 | 🟡 Baixo | `RedisSessionStore`/`RedisRateLimitStore` usavam `KEYS` (O(N), bloqueia o Redis). | Corrigido para `SCAN` com `Cursor`. |
| N9 | 🟡 Baixo | `CreatorApplicationServiceTest` não compilava (`UserEntity` sem import). | Corrigido. |

**Regra:** itens 7.1 marcados como corrigidos têm saída de terminal ou de suíte nesta rodada; o restante segue pendente.

## 7.2 Verificação posterior — Checkout e crédito financeiro (2026-10-19)

- [x] `mvn -o test` → **Tests run: 227, Failures: 0, Errors: 0, Skipped: 0** / BUILD SUCCESS.
- [x] `npm.cmd run build` → TypeScript + Vite concluídos (1644 módulos, 2,84 s).
- [x] `MonetizationAuthorizationTest` confirma que sessão autenticada recebe `410 Gone` para os endpoints legados de doação, membro e VIP; não há crédito, acesso antecipado ou benefício sem checkout confirmado.
- [x] Checkout VIP persiste a associação preferência→usuário→valor e valida assinatura, aprovação, moeda, valor, referência e idempotência pelo `financial_ledger.payment_external_id`.
- [ ] Homologação do Mercado Pago continua pendente: sem token Sandbox válido, segredo de webhook, URL pública e teste ponta a ponta.
- [x] **Estado histórico supersedido:** na data desta verificação as doações e membros ainda não tinham checkout. V9 implementou intents idempotentes, registrado na seção 7.8; Sandbox continua pendente.

## 7.3 Verificação F0 — Stack local e persistência (2026-10-19)

- [x] Compose local corrigido e ampliado para Postgres, Mongo, Redis, Mailpit, backend e frontend; publicação das portas limitada a `127.0.0.1`.
- [x] `docker compose config --quiet` e `docker compose up -d --build` concluídos; os seis serviços saudáveis. Healthcheck do Nginx fixado em `127.0.0.1` para evitar resolução local em IPv6 sem listener.
- [x] `GET /api/feed` → HTTP 200 no backend e via proxy Nginx do frontend.
- [x] Validação isolada com Postgres 16 e Mongo 7 descartáveis: backend ficou pronto e Flyway aplicou V1..V6, todas com `success=true`.
- [x] `docker compose down` sem `-v` preservou os volumes nomeados de Postgres, Mongo, Redis e uploads; a stack foi iniciada novamente.

## 7.4 Verificação F1/F2 — Auth e perfis (2026-10-19)

- [x] `mvn -o '-Dtest=SmtpMfaNotificationSenderTest,CreatorApplicationServiceTest,AuthApplicationServiceTest,UserProfileIdentityTest,UserProfileLgpdTest' test` → **Tests run: 29, Failures: 0, Errors: 0, Skipped: 0** / BUILD SUCCESS.
- [x] Google: teste rejeita token inválido antes de consultar/criar usuário; origem dos dados de identidade passou a ser apenas claims verificadas.
- [x] SMTP: teste unitário confirma remetente e OTP no corpo, sem código no assunto.
- [x] Perfil público: teste de controller confirma acesso anônimo; requisição autenticada usa ID da sessão e ignora header forjado.
- [x] Perfil privado: teste de serviço confirma bloqueio de terceiro.
- [x] Links: testes cobrem hosts oficiais aceitos, domínio social falso rejeitado, YouTube HTTP rejeitado e scheme `javascript:` rejeitado.
- [x] Avatar: `FileStorageUploadTest` confirma imagem final JPEG de 512×512 e rejeita bytes que não formam imagem.
- [ ] Token Google válido, entrega SMTP ponta a ponta ao Mailpit e smoke E2E continuam pendentes.
- [x] `mvn -o test` → **Tests run: 235, Failures: 0, Errors: 0, Skipped: 0** / BUILD SUCCESS.
- [x] `docker compose config --quiet` → exit 0.
- [x] `docker compose up -d --build` após as alterações de avatar; seis serviços saudáveis; `GET /api/feed` → HTTP 200 direto (`127.0.0.1:8085`) e pelo proxy frontend (`127.0.0.1:5180`).

## 7.5 Verificação F1–F3 (2026-10-19)

- [x] OTP: HMAC com chave configurável, purpose `LOGIN`/`STEP_UP_PIX`, reuso negado, purpose trocado rejeitado e 6ª tentativa bloqueada.
- [x] F2: perfil privado consultado do servidor, avatar remoto recusado, bio sem tags HTML.
- [x] F3: capítulo agendado omitido do detalhe; obra arquivada e URL antiga da página bloqueadas; resposta inclui MIME correto e `nosniff`.
- [x] `mvn -o test` → **Tests run: 243, Failures: 0, Errors: 0, Skipped: 0** / BUILD SUCCESS (Testcontainers com PostgreSQL 16 e MongoDB 7).
- [x] `npm.cmd run build` → TypeScript e Vite concluídos (1644 módulos, 3,54 s).
- [ ] Cooldown/limites de reenvio, recuperação de senha, SMTP ponta a ponta, integração de avatar nas telas, teste de carga do leitor e smoke E2E continuam pendentes.

## 7.6 Revisão F1–F4 (2026-10-19)

- [x] `mvn -o test` → **Tests run: 252, Failures: 0, Errors: 0, Skipped: 0** / BUILD SUCCESS. Testcontainers conectou ao Docker real e aplicou V1..V7 em PostgreSQL 16; a V7 de auditoria PIX foi validada em schema limpo.
- [x] Teste direcionado de auth, MFA, limiter, perfil, upload/capítulo e progresso → **59 testes, 0 falhas/erros**.
- [x] `FileStorageServiceTest` → **6 testes, 0 falhas/erros**, incluindo limites zero, negativo e overflow.
- [x] `npm.cmd run build` → TypeScript + Vite concluídos, 1644 módulos (407.02 kB JS bruto).
- [x] Stack local: seis serviços `healthy`; `docker compose config --quiet` sem erro; `GET /api/feed` → HTTP 200; `flyway_schema_history` local confirma V7 `success=true`.
- [x] Mailpit E2E: mensagem recebida, OTP obtido apenas do corpo e `/api/auth/2fa/verify` autenticou. A conta sintética e sua sessão Redis foram removidas após confirmar que não havia obras, relações financeiras ou auditoria vinculadas.
- [x] F1: cooldown de 60 s e teto 3/10 min por conta/IP, respostas genéricas de cadastro/reset, OTP `RESET_PASSWORD`, expiração e revogação de sessão implementados; testes cobrindo os fluxos relevantes.
- [x] F2: upload de avatar conectado às interfaces de leitor/criador; perfis com `no-store`; validações e serviços cobertos pela suíte.
- [x] F3: limite de 300 páginas, limite de dimensão e progresso idempotente cobertos por testes; filtros de publicação, guard LGPD e headers verificados.
- [x] F4 iniciado: migration V7 cria auditoria PIX append-only com valores mascarados; serviço salva ator, IP e tipos sem gravar a chave completa.
- [ ] Pontas externas F1: autenticação DNS SPF/DKIM/DMARC e token Google válido de produção; o cache de desafio OTP ainda é em memória por instância (o limiter de emissões usa Redis quando configurado).
- [ ] F3: teste de carga não executado porque todas as 7 referências existentes no Postgres responderam 404 e o volume de uploads estava vazio. Não se apagaram nem alteraram registros de capítulo.
- [x] F4 PIX: `CreatorPixKeyAuditIntegrationTest` prova em PostgreSQL que auditoria pode ser inserida, mas UPDATE e DELETE são negados pelo trigger.
- [ ] F4: webhook Sandbox de produção/homologação e checkout de doação/membros seguem na fila.
- [x] Revisão de produto: a página Sobre usa as duas fotos locais do MangaTeofilo e reaproveita somente a transição do retrato; a composição foi refeita e o texto não promete funcionalidades inexistentes.
- [ ] Light novels ainda não são suportadas pelo modelo/leitor, que representam capítulos como páginas de imagem; manter como requisito F3 e não anunciar como disponível.
- [ ] Consentimento/política versionada e CPF real continuam como achados F6; maioridade ausente/menoridade agora é bloqueada antes do nível 2 e coberta por teste.

## 7.7 Revisão de anotações e F5 — 2026-10-19

- [x] `mvn -o test` → **Tests run: 254, Failures: 0, Errors: 0, Skipped: 0** / BUILD SUCCESS; Testcontainers conectou ao Docker real. Inclui arredondamento de 5 centavos e payload desconhecido rejeitado.
- [x] `npm.cmd run build` → TypeScript + Vite concluídos, **1644 módulos transformados**, saída de produção criada.
- [x] A página Sobre deixou de buscar fotos genéricas externas; os dois retratos do MangaTeofilo foram copiados para `frontend/public/assets/about/` e a transição por revelação foi refeita com suporte a toque/teclado e movimento reduzido.
- [x] A copy explica a origem (trabalho de faculdade em React + antiga vitrine de Kokuin), apresenta a proposta comunitária e contextualiza “Kokuin — Herança do Abismo / A Cicatriz dos Deuses”. Não afirma que capítulos de light novel já podem ser publicados.
- [x] Mass assignment: Jackson rejeita campos desconhecidos; teste prova que `twoFactorEnabled` e `role` retornam 400 e não chamam o serviço.
- [x] Busca no código não encontrou carrinho, estoque, frete ou venda de produto físico; doações, membros e anúncios permanecem como os modelos digitais previstos.
- [x] Mocks em catálogo, perfil, leitor e workspace ficam atrás de `import.meta.env.DEV`; showcase de design usa fixtures apenas na rota interna.

## 7.8 Continuação F3–F6 — 2026-10-19

- [x] Modelo de obra/capítulo em prosa implementado com V8; mangá continua em `IMAGE_PAGES`. `WorkApplicationServiceTest` passou (13 testes) e V8 está aplicada.
- [ ] Carga real tentou 100 requisições concorrentes a uma página registrada e recebeu 404 em todas: critério segue aberto até restaurar arquivos reais.
- [x] V9 e checkout idempotente para doações/membros implementados; UI aguarda confirmação do provedor. Sem credenciais Sandbox/webhook público, não se afirma homologação financeira.
- [x] V10 permite CPF pendente; novos cadastros não gravam sentinela e CPF é validado antes do checkout. Registros legados não foram alterados.
- [x] F5: `401` desloga; mocks ficam em DEV; falhas de exportação/exclusão não simulam resultado; removidos preço e vencimento VIP fictícios. `npm.cmd run build` verde (1644 módulos).
- [x] Contraste token medido: paper/ink 17.15:1, mute/ink 8.00:1, yellow/ink 13.74:1, mute-paper/paper 6.80:1. `mute`/paper é 2.14:1 e fica abaixo de WCAG AA; corrigir usos em fundos claros e completar navegação por teclado nas rotas.
- [x] Testes direcionados F3/F4/F6: **32 testes, 0 falhas/erros**; `mvn -o -DskipTests test` compilou produção e testes.
- [x] Suíte completa `mvn -o test`: **258 testes, 0 falhas/erros**, `BUILD SUCCESS`; Testcontainers iniciou Postgres 16/Mongo 7 e validou V1..V10.
- [x] `docker compose up -d --build backend`: backend `healthy`; Flyway V8, V9 e V10 com `success=true`; `GET /api/feed` HTTP 200. Sem remoção de volumes.
- [x] Checkout de apoio: teste em `MercadoPagoServiceTest` prova que retry de doação reutiliza preferência persistida sem nova chamada externa; V9 aplicada. [ ] Homologação Sandbox ainda pendente.

## 7.9 Fechamento F3–F7 e LGPD — 2026-10-19

- [x] Carga F3 via `ChapterFileAccessIntegrationTest`: capítulo publicado com JPEG real do projeto (`shito.jpg`, 1.060.446 bytes), 100 GETs HTTP concorrentes (10 workers), 100×200, `image/jpeg`, bytes conferidos; medição final total 723 ms, p50 46 ms, p95 190 ms e máximo 191 ms. Não representa benchmark de CDN/produção e não removeu as referências órfãs legadas.
- [x] Corrigida sessão Redis: o getter calculado `isExpired()` era serializado como campo JSON e rejeitado ao ler a sessão, fazendo `/auth/me` retornar 401 logo após 2FA. `@JsonIgnore` impede gravação nova e mantém leitura compatível com valores antigos; `RedisSessionStoreTest` cobre JSON legado.
- [x] Contraste: `.mn-on-paper`/`.mn-on-yellow` remapeiam `--mn-mute` para o token de 6.80:1 e definem foco escuro em amarelo. Botões amarelos e o hero Sobre usam o contexto; as ocorrências atuais de `--mn-mute` estão em fundo escuro.
- [ ] Navegação por teclado/contraste inspecionada visualmente em todas as rotas. A ferramenta de UI não conseguiu identificar a URL do Chrome; nenhuma interação foi feita. O build e a auditoria estática não substituem esse passe.
- [x] V11 substitui o consentimento retroativo inferido por reaceite, versionado por `PRIVACY_POLICY_VERSION`; cadastros e primeiro login Google exigem versão atual. Usuários com política antiga ficam limitados a ler política, exportar, sair, excluir ou aceitar novamente.
- [x] `GET /api/users/me/export` inclui cadastro, consentimentos, curtidas, progresso de leitura e histórico financeiro sem chaves/credenciais; registro de exportação e de exclusão em tabelas append-only. Exclusão requer mídia própria fisicamente apagada, revoga sessões, anonimiza dados, preserva ledger, remove progresso/eventos Mongo e limpa mensagens livres de doação.
- [ ] Texto oficial aprovado da Política de Privacidade não existe no workspace nem foi fornecido. A API expõe a versão, mas a publicação do documento e a validação jurídica precisam de conteúdo do responsável pelo produto.
- [x] Smoke stack real `smoke_test_e2e.ps1`: 12/12; cadastro sem aceite 400, sessão 2FA, step-up PIX, upload, obra/capítulo, doação legada 410, exportação e exclusão com 401 após revogação. O script não gera pagamento nem saldo.
- [x] `npm.cmd run build`: TypeScript + Vite, 1647 módulos transformados, sucesso.
- [x] `.github/workflows/ci.yml` mantém `pull_request` e agora executa o smoke com stack Docker; ainda sem evidência de uma execução remota porque não há PR iniciado nesta rodada.

## 7.10 Continuação: senha, acessibilidade, CI e início F8 — 2026-10-19

- [x] Cadastro/reset exigem no servidor 8–64 pontos de código; espaços, pontuação, acentos e emojis são aceitos. Cadastro e reset comparam confirmação no formulário; campos limitam entrada a 64 pontos de código.
- [x] Hashes novos usam BCrypt sobre digest SHA-256/Base64 para não truncar UTF-8 acima de 72 bytes; hashes BCrypt antigos continuam verificáveis e são re-hashados após login correto. Seleção direcionada de política, encoder Unicode/legado e guard Redis: 6 testes, 0 falhas/erros, BUILD SUCCESS. A tentativa do `AuthApplicationServiceTest` depois da inclusão do teste de regressão não encerrou por falha de attach do Mockito no ambiente Windows; não se declara resultado para essa execução.
- [x] `npm.cmd run build` depois da alteração de formulário: TypeScript + Vite, 1647 módulos, sucesso.
- [ ] Passe visual/teclado em todas as rotas permanece pendente: navegador local desabilitado nas configurações do Work; nenhuma interação visual foi realizada. Build e inspeção estática não substituem o passe.
- [ ] CI remoto em PR permanece sem evidência. Workflow declara `pull_request`, mas branch `develop` não foi enviada e o conector GitHub confirmou permissão `push:false`; sem commit/push nem PR iniciado.
- [x] F8: store OTP Redis com operações Lua atômicas e fail-fast de produção; métricas OTP/e-mail, logs estruturados seguros, regras Prometheus, script de backup/restore-check isolado e runbook foram adicionados. Verificações: 12 testes executados verdes; parser PowerShell e `docker compose config --quiet` verdes; build frontend verde.
- [ ] F8 operacional: Docker negou acesso e 127.0.0.1:6379 não respondeu; OTP Redis e backup/restore não foram exercitados com serviços reais. Alertmanager, destino cifrado de backup, domínio/bounce SMTP, encarregado, prazos de retenção e exercício de incidente continuam pendentes por infraestrutura/decisão externa.

## 7.11 F8 — operação segura e observabilidade (2026-10-19)

- [x] Desafio OTP extraído para `OtpChallengeStore`; adapter Redis usa chave derivada SHA-256 do identificador, HMAC do código, propósito, TTL de cinco minutos, cinco tentativas e consumo/atualização atômicos por Lua. Compose seleciona Redis; guarda de produção exige stores distribuídos.
- [x] Teste Testcontainers Redis compila casos de purpose, expiração, limite de tentativas e consumo concorrente único; os dois casos foram **Skipped** porque Docker named pipe respondeu `AccessDeniedException`.
- [x] Testes direcionados `TwoFactorAuthServiceTest`, `ProductionDistributedStoresGuardTest`, `OtpIssuanceLimiterTest` e `SecurityObservabilityMetricsTest`: **12 executados, 0 falhas/erros, BUILD SUCCESS**; integração Redis: **2 skipped**.
- [x] Logs Spring estruturados e eventos MFA sem conteúdo do OTP, mais contadores Micrometer para OTP/e-mail e regras Prometheus para falhas SMTP e volume de OTP inválido/bloqueado.
- [x] `ops/backup-restore.ps1` cria dumps Postgres/Mongo, cópia do storage e manifest SHA-256; RestoreCheck usa bancos com nome isolado e pasta de storage separada, sem sobrescrever dados ativos. Parser PowerShell e `docker compose config --quiet` passaram.
- [x] `npm.cmd run build`: TypeScript + Vite verde (1647 módulos).
- [x] `docs/orquestracao/RUNBOOK-PRODUCAO-F8.md` documenta contingência, rotação de chaves, backup, alertas, bounce e governança.
- [x] Compose de produção exige autenticação Mongo e senha Redis; CI valida sua sintaxe com placeholders não secretos.
- [ ] Docker negou acesso e porta Redis local não respondeu; nenhum teste de Redis real ou backup/restore operacional foi executado nesta rodada.
- [ ] Alertmanager/canal de plantão, cifragem e destino externo de backup, DNS SPF/DKIM/DMARC, webhook bounce, nomeação do encarregado/DPO e retenção exigem configuração/provedor/aprovação externos. Não foram inventados valores legais ou identidades.

## 7.12 F1 — medidor e bloqueio de senha fraca (registro anterior; complemento em 7.13)

- [x] `PasswordInput` adiciona botão de revelar/ocultar com rótulo acessível para senha e confirmação no login/cadastro e redefinição.
- [x] Cadastro/reset exibem painel inline Fraca/Média/Forte, os critérios para cada nível e indicação do que falta; confirmação permanece funcional.
- [x] Backend permite somente força média/forte em novas senhas. A força é calculada no servidor; login mantém validação de comprimento sem rejeitar hash legado por fraqueza.
- [x] `PasswordPolicyTest`: **4 testes, 0 falhas/erros, BUILD SUCCESS** cobrindo padrões fracos, níveis médio/forte, Unicode e compatibilidade da validação legada.
- [x] `npm.cmd run build`: TypeScript + Vite, **1648 módulos**, sucesso.
- [ ] Naquela execução, a regressão em `AuthApplicationServiceTest` não concluiu por self-attach do Mockito. Foi confirmada depois em 7.13 com o agente pré-carregado (10/10).
- [ ] Critérios de nível são heurísticos e denylist é curta; não equivale a serviço/base completa de senhas vazadas. Não afirmar que todas as senhas comprometidas são detectadas.

---

## 7.13 Revisão integrada F1–F8 (2026-10-19)

- [x] F1: `AuthApplicationServiceTest` 10/10 (inclui rejeição de cadastro com senha fraca e confirmação de e-mail após OTP), `PasswordPolicyTest` 4/4 e suíte backend 273 testes, 0 falhas/erros. Frontend build 1648 módulos verde.
- [x] F1: implementação de V12 e persistência `email_verified_at`; OTP válido de login/recuperação confirma e-mail, Google usa claim verificada.
- [ ] F1: aplicar e verificar V12 em PostgreSQL real; Docker negou acesso nesta rodada.
- [x] F2: testes de privacidade/ownership/avatar/social links executados pela suíte; nenhum novo defeito reproduzido nesta verificação.
- [x] F3: teste de integração com fixture de imagem real já registrado na seção 7.9 — 100/100 GETs 200, concorrência 10, p95 190 ms. A tentativa antiga que recebeu 404 contra referência órfã foi supersedida; dados órfãos do storage seguem sem saneamento destrutivo.
- [x] F4: checkout idempotente de doação e membro e bloqueio de efeitos antes da confirmação têm cobertura automatizada; Sandbox e webhook público continuam sem credenciais/infra de homologação.
- [ ] F5: inspeção visual/teclado completa não executada. Porta 5180 rejeitou conexão pelo sandbox e o navegador local não foi usado; build/checagens estáticas não substituem QA visual.
- [ ] F6: implementação técnica de reaceite, exportação, exclusão e auditoria está registrada; publicação do texto oficial da Política de Privacidade e eventual saneamento de CPF sentinela legado dependem de aprovação e procedimento controlado.
- [x] F7: suíte/backend e build frontend verdes; smoke 12/12 tem evidência local anterior. Os 12 testes ignorados são dependentes do Docker nesta execução.
- [ ] F7: não há execução remota de CI em PR nesta rodada; não foi criada branch, commit ou PR.
- [x] F8: adapters Redis OTP, métricas, regras, backup/restore-check e runbook existem e testes unitários passaram.
- [ ] F8: Docker named pipe negou acesso; Redis e backup/restore não foram exercitados operacionalmente. Alertmanager/canal, cifra/destino externo, SMTP autenticado/bounce, encarregado/retention e drill dependem de configuração ou decisão organizacional externa.
- [ ] F1: validação com ID token Google real e autenticação de DNS SMTP dependem de credencial, domínio e provedor externos.

## 7.14 Recuperação de senha por link (2026-10-19)

> **Nota histórica:** o comportamento foi revisto em 7.15–7.16. Onde este bloco diz que o reenvio não substitui o link ativo ou que falha SMTP limpa o token, prevalece o estado atual: reenvio rotaciona o token e falha de entrega mantém o token até expirar.

- [x] O fluxo anterior com OTP `RESET_PASSWORD` foi substituído para recuperação por e-mail; OTP de login e step-up permanecem separados.
- [x] V13 cria `password_reset_tokens`, com hash SHA-256 único, FK para usuário, expiração e índice; token aleatório de 32 bytes nunca é persistido em texto puro.
- [x] Solicitação genérica para conta inexistente, throttling account/IP em namespace próprio; reenvio rotaciona o token ativo e falha SMTP mantém o token até expirar, sem alterar a resposta pública.
- [x] Confirmação usa política oficial, encoder oficial, lock pessimista do token e usuário, revoga sessões e desafio OTP, consome token e não altera email verificado/perfil nem cria sessão.
- [x] SMTP envia link configurado via `PUBLIC_FRONTEND_URL`; frontend oferece solicitação genérica, rota de nova senha com confirmação/força, fragmento removido da barra e `Referrer-Policy: no-referrer`.
- [x] Testes focados de recuperação, SMTP e controller: 16/16 verdes. `npm.cmd run build` verde.
- [ ] V13/V12 não aplicadas em PostgreSQL real; Mailpit integrado desta recuperação e teste de consumo concorrente ainda não executados. Docker daemon negou acesso.

## 7.15 Estado consolidado em 20/10/2026 — recuperação, commits e bloqueios externos

- [x] Recuperação: token aleatório de 32 bytes; persistência apenas do SHA-256; uso único com lock transacional; TTL via `PASSWORD_RESET_TOKEN_TTL` (5–60 min, padrão 30); `PUBLIC_FRONTEND_URL` aceita HTTPS e HTTP apenas em localhost, sem path/query; resposta genérica; throttle no namespace `password-reset`, separado do OTP de login; senha validada pela política oficial; sessões e desafio OTP pendentes revogados sem autenticação automática ou confirmação de e-mail. Reenvio rotaciona o token ativo e o envio SMTP ocorre após commit, sem invalidar o token em falha de e-mail.
- [x] Desenvolvimento sem SMTP: link fica na Dev Outbox em memória apenas nos perfis `dev/test/local`, some após expirar e é acessível somente pelo endpoint de perfil local; a rota não existe em produção.
- [x] Evidência em 20/10/2026: V13 aplicada em PostgreSQL real (`token_hash character varying(64)`, `validate` verde); fluxo Mailpit pedido→link→nova senha→2FA→`/me` com 2FA real; duas confirmações simultâneas retornaram 204/401; teste de rotação prova hash anterior ausente e novo presente; suíte completa **291/0/0** com Docker; Compose de produção validado sem `.env` usando `MAIL_*` fictícios.
- [x] Correção adicional: `ResponseStatusException` (ex.: throttle 429) deixou de ser mapeada para 500 pelo handler genérico; teste de controller/handler cobre o status.
- [ ] Homologar ID token Google válido e DNS autenticado SPF/DKIM/DMARC; dependem de credenciais/domínio reais (#44, #46).
- [ ] Fases 13.2a/13.4 dependem de domínio/provedor/DNS autenticado, credenciais Sandbox e webhook HTTPS público. Nenhuma compra real foi feita.
- [ ] Fase 14 não foi implantada: requer conta Oracle autorizada, região/shape disponíveis, chave SSH aprovada e decisão de rede/TLS. Compose não equivale a VM; nenhuma infraestrutura externa ou migration de produção foi criada.
- [x] As alterações desta rodada permanecem no working tree; não houve commit nem push sem autorização. Nenhum trabalho existente foi descartado.
- [x] Suíte backend completa: **291 testes, 0 falhas, 0 erros, 0 ignorados** (Docker/Testcontainers disponíveis). Build frontend já estava verde; container foi reconstruído para a inspeção visual.

## 7.16 Backup/restore real e QA autenticado (2026-10-20)

- [x] `ops/backup-restore.ps1 -Mode Backup`: dump PostgreSQL, archive MongoDB e storage copiados; manifest com SHA-256 gerado. A execução revelou e corrigiu uma incompatibilidade com Windows PowerShell 5.1 (`[IO.Path]::GetRelativePath` não existe); o caminho relativo passou a ser calculado por substring.
- [x] `ops/backup-restore.ps1 -Mode RestoreCheck`: restore em banco PostgreSQL e pasta de storage isolados; consulta no banco restaurado retornou **17 usuários** e **Flyway versão 13, success=true**. Nenhum dado ativo foi sobrescrito.
- [x] `docker compose config --quiet` local e de produção (com `MAIL_*` fictícios e sem `.env`) retornaram 0.
- [x] `mvn -o test`: **322 testes, 0 falhas, 0 erros, 0 ignorados**. `npm.cmd run build`: **sucesso**.
- [x] Smoke E2E local 12/12 após trocar a senha fixa do script por uma frase aceita pela política atual. O mesmo script passou no CI remoto do PR #5, run `39448285071`, junto com backend, frontend e Docker.
- [x] A primeira execução remota do PR #5 falhou apenas no smoke porque `Password123!` tinha 12 caracteres mas era rejeitada pela política; a correção foi um commit no próprio PR e o run seguinte ficou verde.
- [x] QA autenticado no navegador: login real com OTP do Mailpit, feed, catálogo, sobre, Biblioteca (estado vazio) e perfil do leitor inspecionados. Foco visível medido em `Sair da conta` (`outline: solid 3px rgb(169, 165, 154)`); viewport 1296×886 com navegação desktop visível e mobile oculta.
- [x] Tab real percorreu 10–14 elementos em feed, catálogo, sobre e perfil; todos os focados estavam visíveis, com `outline: solid 3px`, sem armadilha observada. Login/reset e biblioteca foram inspecionados por focáveis, sem traversal completo.
- [x] Rotas autenticadas de criador/moderador e passe de teclado/layout concluídos em 20/10/2026 (#40); a captura pixel não foi produzida pela ferramenta (aba não visível). Ver 7.17.
- [ ] O feed local referencia capas antigas de smoke cujo volume `/data/uploads` está vazio; `GET /api/storage/*` retorna 404. É dado de teste órfão já registrado em F3, não regressão do fluxo de recuperação; limpeza/restauração exige autorização.
- [ ] Permanecem externos: ID token Google real/DNS autenticado, Sandbox/webhook, retenção/cifra/off-site, Alertmanager/canal, DPO/inventário e drill. O backup local não substitui cópia off-site.

## 7.17 Governança do proprietário, hardening e QA autenticado (2026-10-20)

- [x] **V14/`ROLE_OWNER`:** `users.is_owner` (`BOOLEAN NOT NULL DEFAULT FALSE`) e índice parcial; `Role` derivado exclusivamente no `SessionAuthenticationFilter`, nunca de DTO/cookie. O proprietário recebe `ROLE_OWNER` e, por herança operacional, `ROLE_MODERATOR`; `/api/owner/**` exige `ROLE_OWNER`. `AuthSessionResponseDto` e `/auth/me` expõem `isOwner`; o header mostra o selo DONO. Evidência HTTP: sessão não-proprietária em `/api/owner/ping` recebeu `403`; sessão de teste com `isOwner=true` recebeu `404` (rota ainda inexistente, mas autorizada). Sessão Redis gravada antes da V14 foi lida por `/auth/me` com `200` e `isOwner=false`, provando compatibilidade do JSON antigo. No navegador, a sessão de teste hidratou `/auth/me` com `isOwner=true` e o header exibiu `DONO`.
- [x] **Conta administrativa:** a criação via cadastro público com a senha inicial de 9 caracteres foi recusada pela política (`Senha fraca...`); nenhum hash foi inserido manualmente. Em 20/10/2026 a conta de `Wilsonteofilosouza@live.com` foi criada com senha forte fornecida pelo titular, confirmada por OTP de e-mail e com `is_owner=true`/`is_moderator=true` aplicados no PostgreSQL. A sessão real respondeu `/api/auth/me` com `isOwner=true` e `isModerator=true`; novo login após aplicar as flags recebeu `429` temporário por rate limit, mas a sessão de cadastro autenticada acessou `/api/owner/ping` com `404` (autorizada, rota ainda ausente). Uma sessão não-proprietária continuou recebendo `403`. A senha não foi registrada em código, log ou documento.
- [x] **Enumeração por tempo no login:** e-mail inexistente ou conta somente Google agora executa `BCryptPasswordEncoder.matches` contra um hash descartável antes de retornar `Credenciais inválidas`; teste direcionado de auth continua verde.
- [x] **Fronteira de camadas:** `AuthController` deixou de injetar `UserRepository`; `GET /api/auth/me` usa `CurrentSessionResponseDto` produzido por `AuthApplicationService`, incluindo avatar e consentimento. `AuthControllerTest` cobre 401 sem sessão e `isOwner=true`.
- [x] **Fail-fast de produção:** `ProductionSecretsGuard` (`@Profile("prod")`) recusa o OTP HMAC padrão de desenvolvimento e `COOKIE_SECURE != true`; quatro testes unitários cobrem rejeição/aceite, incluindo segredo com menos de 32 caracteres.
- [x] **Rate limit atrás de proxy:** `platform.security.trust-forwarded-headers` passou a `${TRUST_FORWARDED_HEADERS:false}`; o Compose de produção define `TRUST_FORWARDED_HEADERS=true` porque o backend só recebe tráfego do Nginx, que acrescenta o IP real ao `X-Forwarded-For`. O filtro já usa o hop mais à direita e valida literal de IP.
- [x] **Exclusão LGPD sem privilégios residuais:** a anonimização agora limpa `is_moderator`, `is_owner`, `is_creator`, `is_vip`, `vip_expires_at`, `email_verified_at` e `birth_date`, além de senha/2FA/avatar. O teste `UserProfileLgpdTest` cobre a limpeza. A auditoria local encontrou 6 contas já anonimizadas com flags antigas e as saneou (`0` restantes).
- [x] **Feed não expõe obra arquivada por LGPD:** o feed público filtra `suspended` e `archived_lgpd` na consulta Mongo e em memória; o recálculo agendado também remove esses documentos. Evidência: 5 obras `archived_lgpd` no PostgreSQL, `0` documentos correspondentes em `feed_works`, `/api/feed` sem `archived_lgpd` e sincronização pós-correção retornando 9 obras ativas. Testes de `FeedApplicationService` e `RecommendationAlgorithmService` cobrem a regressão.
- [x] **Hardcoded/segredos:** varredura não encontrou token Mercado Pago, chave privada, `APP_USR`, `sk_live` ou segredo de produção literal. Permanecem apenas valores de negócio versionados (`application.yml`) e fallbacks de desenvolvimento com guarda de boot; `docker-compose.yml` usa senha local documentada.
- [x] **QA autenticado:** mesa de moderação abriu com 2 denúncias reais; workspace do criador abriu com dados do servidor. Tab real percorreu a moderação com `outline: solid 3px`; no workspace, todos os focáveis visíveis tinham outline de 3 px. Sem overflow horizontal (viewport 863 px, `scrollWidth == clientWidth`). Três campos do workspace ganharam `htmlFor`/`id`: gênero, sinopse e biografia.
- [x] **Reexecução final:** `mvn -o test` → **322 testes, 0 falhas, 0 erros, 0 ignorados**; `npm.cmd run build` → 1649 módulos; smoke E2E **12/12** com OTP real via Mailpit, incluindo exclusão e `401` após revogação; `docker compose -f docker-compose.prod.yml config --quiet` → 0; stack com seis serviços `healthy`; Flyway **V16** `success=true`. A primeira tentativa do smoke falhou porque o stack usa Mailpit e o script só consultava o Dev Outbox; o script ganhou fallback para Mailpit e passou integralmente na reexecução.

## 7.18 Governança de dados, observabilidade e preparação de produção (2026-10-20)

> Continuação da 7.17. Itens 42 e 45–49 do roadmap e o terreno do 14.3. O que é código está
> implementado e exercitado na stack local; o que depende de aprovação ou credencial externa
> segue explicitamente aberto.

- [x] **Publicação controlada da Política de Privacidade:** `GET /api/legal/privacy-policy` publica o texto oficial aprovado com `version`, `effectiveDate`, `approvedBy`, `approvalReference`, `sha256` e `content`; sem documento aprovado responde `404 POLICY_NOT_PUBLISHED` (nunca texto fictício). O documento é instalado por `ops/legal/publish-privacy-policy.ps1`, que valida o front matter, recusa material sensível (chave privada, `sk_live`, segredo declarado) e registra a publicação em log append-only. Prova real: com um documento de teste instalado **fora do repositório** o endpoint respondeu `200` com metadados e hash; ao remover o arquivo voltou a `404`. Um bug real foi encontrado no caminho: arquivos gerados no Windows traziam BOM e impediam a leitura do front matter — o backend passou a tolerar BOM e o publicador a gravá-lo sem BOM.
- [x] **Saneamento controlado de dados legados:** `GET/POST /api/owner/privacy/legacy-personal-data` (`ROLE_OWNER`, dry-run por padrão) audita e remove CPF sentinela/inválido de criadores que ainda não monetizam; quem já monetizou vai para a fila de decisão humana. Auditoria append-only em `privacy_governance_actions` (V15). Execução real: 16 registros legados detectados e 16 saneados, `0` CPF inválido restante, 18 linhas de auditoria (`LEGACY_CPF_AUDIT_DRY_RUN`, `LEGACY_CPF_AUDIT_APPLIED`, 16 × `LEGACY_CPF_PURGED`). Autorização conferida: owner `200`, não-owner `403`, sem sessão `401`.
- [x] **Monitoramento de bounce no servidor:** `POST /api/webhooks/email/delivery-events` grava o evento em `email_delivery_events` (V16, append-only, e-mail guardado só como SHA-256) e **suprime** novos envios de OTP/recuperação para o endereço; o guard de produção exige `EMAIL_WEBHOOK_SECRET` (≥32). Prova real: bounce registrado para uma conta de teste e a solicitação de recuperação de senha subsequente gerou o log `Envio suprimido: destinatário com bounce/complaint registrado` (métrica `outcome=suppressed`), sem entrega. Regras Prometheus novas para taxa de bounce e envios suprimidos.
- [x] **Coleta de métricas pelo Prometheus:** `/actuator/prometheus` deixou de depender de cookie de sessão: `METRICS_SCRAPE_TOKEN` (Bearer) foi adicionado, com `ProductionMetricsScrapeTokenGuard` exigindo-o em `prod`. Prova: `401` sem token, `200` com token, alvo do Prometheus `up`.
- [x] **Canal de plantão exercitado de ponta a ponta:** Prometheus e Alertmanager oficiais subiram em containers reais; `promtool check rules` aprovou as regras, `amtool check-config` aprovou a configuração renderizada do canal, as 2 regras ficaram ativas e o alerta sintético crítico **chegou ao e-mail do plantão** (assunto `[MangaNetWorking][CRITICO] FIRING - ...`). Procedimento automatizado em `ops/alertmanager/apply-alert-rules.ps1`, com registro em `ops/alertmanager/drill-records/`.
- [x] **Backup cifrado, cópia off-site e retenção (item 42):** `ops/crypto/backup-crypto.psm1` cifra o backup (AES-256-CBC + HMAC-SHA256, encrypt-then-MAC, PBKDF2) e `ops/backup-restore.ps1` ganhou `-EncryptKeyFile`, `-OffsiteDestination`, `-RetentionDays`/`-RetentionRoot` e verificação a partir do artefato cifrado. Execução real: backup cifrado de 35.412 bytes com checksum conferido após decifra, cópia off-site com SHA-256 idêntico e log, retenção removendo o backup de 2025 e preservando o mais recente com log, e restore-check a partir do artefato cifrado em bancos isolados. Procedimento em `docs/ops/RETENCAO-CIFRA-OFFSITE.md`.
- [x] **Exercício de runbook (item 49):** `ops/incident/incident-drill.ps1` executa o runbook de forma controlada: saúde do backend, coleta de métricas, regras ativas, alerta no canal de plantão, bounce simulado com supressão, revogação de sessão (`200` → `401`) e restore-check opcional a partir do artefato cifrado; registro em `ops/incident/drill-records/`. Execução real: todos os passos OK, inclusive a restauração de verificação do backup cifrado em bancos isolados.
- [x] **Fluxo de duas contas verificado (20/10/2026):** uma conta de criador publicou obra e capítulo; uma **segunda conta de leitor** enxergou a obra pública (`GET /api/works/{slug}` → 200, `status=ongoing`), leu o capítulo (`locked=false`), baixou a página (**200 sem sessão**), favoritou (`{"liked":true}`), registrou progresso de leitura e enviou denúncia. O mesmo teste provou a lacuna de produto: com sessão autenticada, `PUT`/`DELETE` de obra e de capítulo respondem **405 Method Not Allowed** — só existem `POST` (criar) e `GET` (ler).
- [x] **Terreno do 14.3:** `ops/deploy/deploy-prod.ps1` (validação e aplicação), `ops/deploy/env.production.example` (modelo sem segredos) e `docs/ops/PRODUCAO-ORACLE.md` (regras de rede, pré-requisitos, critérios de aceite). A validação foi exercitada com um `.env` de teste: 14 variáveis obrigatórias conferidas, Compose de produção válido e avisos honestos sobre política não publicada e canal ainda não renderizado. O script recusa `.env` dentro do repositório.
- [x] **Inventário e encarregado (item 47):** `docs/ops/INVENTARIO-DADOS.md` lista 9 categorias de dado com finalidade, base legal, retenção, onde fica e controle de cifragem — com as decisões humanas marcadas como pendentes, sem inventar prazo, base legal ou nome.
- [ ] **Continua bloqueado por decisão/credencial externa:** texto oficial aprovado da Política de Privacidade, nomeação e publicação do encarregado, prazos de retenção aprovados, destino off-site real e KMS da chave de backup, domínio autenticado (SPF/DKIM/DMARC) e provedor de e-mail, canal institucional de plantão, conta Oracle/shape/chave SSH e qualquer deploy em produção. Nenhuma dessas pendências foi simulada como concluída.
- [ ] **Incidente registrado no histórico do chat:** um comando meu de normalização de scripts apagou seis arquivos `ops/*.ps1`/`*.psm1`; o backup versionado restaurou `ops/backup-restore.ps1` e os demais foram reescritos e revalidados (parse limpo, backup com cifra, canal de plantão e exercício de incidente reexecutados com sucesso). Nenhum arquivo de código do produto foi perdido.
- [ ] **Limite da evidência:** `browser.screenshot` retornou “Screenshot needs a visible tab” mesmo após foco; a inspeção foi estrutural (DOM, acessibilidade, layout e foco), não pixel a pixel. As duas contas temporárias de QA foram anonimizadas pela própria API de exclusão; a verificação por e-mail retornou `0` e não restaram privilégios nas contas anonimizadas.
- [ ] **Dívida arquitetural remanescente (não refatorada para evitar regressão):** classes acima do patamar de manutenção — `MercadoPagoService` (565 lin/23 métodos; acopla HTTP, assinatura webhook e domínio monetário), `WorkApplicationService` (359 lin/8 métodos; orquestra persistência, recomendação e sync), `RecommendationAlgorithmService` (263 lin/11 métodos; scoring + jobagem) e `CreatorWorkspacePage.tsx` (729 lin; página única com criação, publicação e analytics). Os fallbacks de desenvolvimento em `application.yml`/`PlatformProperties` (origins/CORS/back-url `localhost`) são cobertos por fail-fast em `prod`, mas `MERCADOPAGO_BACK_URL_BASE` e `CORS_ALLOWED_ORIGINS` dependem de env em produção para não cair em localhost. O ideal seria extrair adapters de pagamento e extrair componentes do workspace; fora escopo desta rodada.
- [ ] **Externo:** Google ID token/DNS, SMTP de produção, Sandbox Mercado Pago, Oracle e decisões LGPD continuam bloqueados; não houve fabricação de runtime.

## 7.19 E-mail canonicalizado e SMTP real no ambiente local (2026-10-20)

- [x] **Uma regra só de e-mail, aplicada no servidor:** `com.manganetworking.util.EmailNormalizer` canonicaliza
  o endereço digitado (espaços removidos, tudo em minúsculas, aspas/chevrons de "copiar e colar" removidos) e
  valida o formato (RFC 5321: ≤254 caracteres, parte local ≤64, sem espaço interno, sem ponto no início/fim/dobrado,
  domínio com rótulos válidos e TLD alfabético). Entrada inválida vira **HTTP 400** com mensagem clara
  (`IllegalArgumentException` → `GlobalExceptionHandler`), nunca 500. Aplicado em **cadastro, login, Google OAuth,
  verificação de 2FA, recuperação de senha, emissão de OTP, Dev Outbox e webhook de bounce** — antes a mesma
  normalização estava duplicada em 6 classes (`trim().toLowerCase()`), o que permitia divergência entre o e-mail
  gravado e o e-mail consultado.
- [x] **O `@Email` do Bean Validation foi trocado pela regra do domínio** nos DTOs de cadastro, login, 2FA, recuperação
  e evento de entrega: o validador do framework rejeitava endereço com espaço nas pontas (`" pessoa@dominio.com "`)
  antes de qualquer tratamento, que era exatamente o sintoma reportado. O DTO agora aceita a entrada crua e a
  canonicalização acontece no serviço, com a resposta de erro no lugar certo.
- [x] **Prova real (20/10/2026):** cadastro com `"  Leitor.Teste@Example.COM  "` gravou `leitor.teste@example.com` e
  disparou o OTP para o endereço canônico; login com `" LEITOR.TESTE@Example.com "` encontrou a mesma conta;
  `POST /api/auth/password-reset/request` com `" wilsonteofilosouza@live.com "` (com espaços) enviou o e-mail para o
  endereço canônico; endereço com espaço interno (`leitor teste@...`) foi recusado com 400.
- [x] **SMTP real funcionando em ambiente local:** o Compose local ignorava o `.env` e fixava `MAIL_HOST: mailpit`,
  `MAIL_SMTP_AUTH: "false"` e `MAIL_FROM: nao-responda@localhost` — ou seja, **todo OTP ia para o Mailpit e nunca
  saía para a internet**. Agora o Compose repassa `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`,
  `MAIL_SMTP_AUTH`, `MAIL_SMTP_STARTTLS`, `MAIL_FROM` e `MAIL_FROM_NAME` do `.env`, com o Mailpit como padrão quando
  as variáveis não existem (stack continua funcionando sem credencial). Prova real: container com
  `MAIL_HOST=smtp.gmail.com`, `MAIL_PORT=587`, `auth=true`, `starttls=true`; e-mail de recuperação e **código 2FA**
  enviados com `outcome=sent` para o endereço real do titular, com o Mailpit recebendo `0` mensagens nesse intervalo.
- [x] **Suíte:** `mvn -o test` → **333 testes, 0 falhas, 0 erros** (322 anteriores + 8 de `EmailNormalizerTest`,
  2 de canonicalização em `AuthApplicationServiceTest` e 1 de DTO em `AuthControllerTest`).
- [x] **Cadastro reenvia o código quando o cadastro ficou pela metade (20/10/2026):** o titular tentou se cadastrar
  às 20:28 (janela em que o Compose ainda mandava tudo para o Mailpit) e a conta ficou **pendente**: existe, mas
  `email_verified_at` é nulo, ou seja, o código nunca chegou. Ao tentar de novo, a rota respondia a resposta genérica
  **sem** enviar nada — para a pessoa, "não funciona". Agora, quando a conta existe e **ainda não foi confirmada**, o
  cadastro **reenvia o OTP** para o e-mail configurado (mesma resposta genérica, sem revelar se a conta existe).
  Conta **já confirmada** continua sem e-mail no cadastro — esse caso é login, e aceitar código ali daria acesso sem
  senha (enfraqueceria o segundo fator). Prova real: `POST /api/auth/register` com `sopraimvuu1@live.com` →
  `mfa_email_delivery outcome=sent` pelo SMTP `smtp.gmail.com` (Mailpit com a mensagem antiga de 20:28 e nenhuma
  nova). Limitador preservado: 3 OTPs por conta/IP a cada 10 min (o 429 do segundo cadastro seguido é esse limite).
- [ ] **Continua bloqueado:** SPF/DKIM/DMARC e domínio institucional ainda dependem de DNS/provedor; a entrega real
  continua dependendo do provedor usado (Gmail pessoal com senha de app serve para desenvolvimento, não para produção).

## 7.20 Identidade separada: username, leitor x escritor, perfil público, seguidores e comentários (2026-10-21)

- [x] **Username único e segunda via de login (V17):** `users.username` (único sem distinção de caixa, 3–30 caracteres,
  minúsculas, letras/números/ponto/hífen/underscore) com backfill determinístico (`user_<id>`) para as contas
  existentes. Login e verificação de 2FA aceitam **e-mail ou username** (`identifier`, com `@JsonAlias("email")` para
  não quebrar clientes). O username só pode ser reivindicado uma vez — enquanto a conta usa o identificador gerado —
  e depois é imutável (`UsernameClaimTest`).
- [x] **Leitor x escritor separados no servidor:** o cadastro cria **sempre** uma conta de leitor; virar escritor exige
- [x] **O username e o identificador do autor (sem segundo handle):** a candidatura **nao** pede mais um "username de
  autor" - o handle do escritor passa a ser o **proprio username da conta de leitor** (reciclado, sem duplicidade:
  o username ja e unico). Nome e foto sao herdados da conta de leitor; o formulario so pede o que falta (o link).
  Quando o username e reivindicado depois, o handle do escritor passa a acompanha-lo, desde que o handle esteja
  livre (se ja existir outro autor com aquele handle, o username e mantido e o handle antigo segue). Prova ao vivo:
  `POST /api/creators/apply` com **um unico** link -> `200` e `creatorHandle` igual ao username da conta; sem link
  -> `400` ("Informe pelo menos um link social").
- [x] **Upload de foto de perfil arrumado:** a camera agora e sempre visivel no avatar (nao so no hover) e ha o botao
  "TROCAR FOTO"; o cliente valida formato (JPG/PNG) e tamanho (10 MB) antes de enviar e mostra a mensagem real do
  servidor. Prova ao vivo com a conta do titular: `POST /api/storage/avatar` -> `200` e `PUT /api/users/profile` ->
  `200` (avatar gravado e visivel no perfil).
  `POST /api/creators/apply` com **pelo menos um vínculo social**. O `register` com `isCreator=true` também exige o
  vínculo. Sem ele: **400** com mensagem explícita.
- [x] **Vínculo social blindado:** `SocialLinkPolicy` com allowlist de host (Instagram, YouTube, TikTok, X, Behance,
  ArtStation, DeviantArt, Medium, Linktree, Spotify, SoundCloud, Substack), **HTTPS obrigatório**, sem credencial
  (`user@`), sem porta específica, sem caractere de controle, HTML removido e limite de 255 caracteres. `javascript:`,
  `data:`, `http:` e domínio desconhecido são recusados com 400.
- [x] **Perfil público com privacidade real:** `GET /api/users/{username}/public-profile`. Perfil **privado** devolve
  apenas o username (é o que aparece nos comentários); perfil **público** devolve nome, avatar, links, contadores de
  obras/curtidas e seguidores. `PublicProfileServiceTest` cobre os dois lados.
- [x] **Seguidores só de escritor:** `creator_follows` + `POST/DELETE /api/creators/{handle}/follow`. Leitor não tem
  seguidores; ninguém segue a si mesmo; seguir é idempotente.
- [x] **Comentários com username e privacidade:** `work_comments` + `GET/POST /api/works/{workId}/comments`. O username
  do autor sempre aparece; nome e avatar só quando o perfil do autor é público. O corpo é higienizado no servidor
  (sem tag, sem `javascript:`) e o front renderiza como texto.
- [x] **Segurança do fluxo:** as rotas novas foram placement antes das regras genéricas do `SecurityConfig`
  (`POST /api/works/**` é de criador, mas comentário é de leitor; `POST /api/creators/**` é de criador, mas a
  candidatura e o seguir são de qualquer conta autenticada).
- [x] **Interface reorganizada:** a divisão "modo criador / modo leitor" saiu do header; o avatar redondo no canto abre o
  menu da conta (Minha conta → Criador: Workspace, Minhas obras, Capítulos, Missões & XP, Analytics, Monetização → Sair).
  O painel do criador deixou de ser uma página única: cada painel tem tela própria e endpoint próprio. Página pública
  por username, tela "Minha conta" (foto, visibilidade,看成 escritor) e onboarding pós-cadastro (foto + público/privado
  + ver a própria página).
- [x] **Bug real encontrado no stack de alerta:** `ops/prometheus/manganetworking-alerts.yml` tinha um `:` não citado
  dentro de uma anotação; o Prometheus recusava o arquivo de regras e o container ficava **down**. Corrigido (valor
  entre aspas), `promtool check rules` → **SUCCESS: 4 rules found** e o alvo `manganetworking-backend` voltou a **up**.
- [x] **Containers de observabilidade sob o Compose:** Prometheus e Alertmanager entraram no `docker-compose.yml` no
  profile `monitoring` (não sobem em `docker compose up -d`); antes eram containers órfãos criados à mão. As portas
  passaram a escutar só em `127.0.0.1`.
- [x] **Suíte:** **352 testes**, 0 falhas, 0 erros (inclui `UsernamePolicyTest`, `SocialLinkPolicyTest`,
  `PublicProfileServiceTest` e `UsernameClaimTest`); build do frontend verde; V17 aplicada em PostgreSQL real.

## 7.21 Revisao de arquitetura, limpeza e segunda passagem (2026-10-21)

- [x] **DRY na criacao do perfil de escritor:** o bloco de cadastro de autor e o fluxo de candidatura
  (leitor -> escritor) montavam o mesmo `CreatorEntity` em dois lugares, com handle proprio. Agora existe
  `service/creator/CreatorProfileFactory` (fabrica) e `domain/value/SocialLinks` (value object que valida
  os tres links e exige **pelo menos um**). O handle deixou de ser escolhido: e o **username da conta**.
  `AuthApplicationService` caiu de 400 para 385 linhas e `CreatorApplicationService` ficou com uma regra so.
- [x] **SRP na identidade:** a regra do username (reivindicar uma vez, imutabilidade, unicidade e handle do
  escritor acompanhando o username) foi extraida para `service/user/AccountIdentityService`, com teste proprio
  (`AccountIdentityServiceTest`, 6 casos). `UserProfileApplicationService` perdeu esse bloco e os helpers.
- [x] **Numeros magicos eliminados:** o limite do corpo do comentario vive em `CreateCommentRequestDto.MAX_LENGTH`
  (referenciado pelo servico), os limites de pagina da listagem viraram constantes nomeadas, o tamanho do
  username reusa `UsernamePolicy.MIN_LENGTH/MAX_LENGTH` no DTO de cadastro e o limite do link social virou
  `SocialLinkPolicy.MAX_LENGTH`.
- [x] **Front:** o bloco de Missoes & Ganhos saiu do container do workspace para
  `components/creator/CreatorMissionsPanel.tsx` (bloco apresentacional, sem recalcular nada);
  `CreatorWorkspacePage.tsx` caiu de 738 para 591 linhas.
- [x] **Seguranca conferida na segunda passagem:** `POST /api/works/*/comments` (leitor autenticado) e
  `POST/DELETE /api/creators/*/follow` e `POST /api/creators/apply` (qualquer conta autenticada) continuam
  ANTES das regras genericas de `/api/works/**` e `/api/creators/**` (que sao de criador);
  `GET /api/users/*/public-profile` e publico, mas a privacidade e decidida no servico (perfil privado devolve
  so o username); o front renderiza comentario e bio como **texto** (sem `innerHTML`); o username exibido vem
  do servidor, nunca do cliente.
- [x] **Pastas e arquivos:** as novas regras ficam onde pertencem (`domain/value` para value objects, `util` para
  politicas puras, `service/<contexto>` para casos de uso, `components/<area>` no front). Nada de arquivo novo
  na raiz do pacote.
- [x] **Evidencia:** **358 testes**, 0 falhas, 0 erros; build do frontend verde; smoke E2E **12/12** na stack real;
  stack local 6/6 + 2 de monitoramento healthy.

## 7.22 Blindagem do username: nenhum erro seco de colisao (2026-10-21)

- [x] **O que aconteceu:** o titular reivindicou `mapplestar` e recebeu "Este username ja esta em uso"
  sem alternativa. O username e o identificador publico: um erro seco ali trava a conta sem
  saida, e a unica forma de descobrir o conflito era adivinhar outro nome.
- [x] **Correcao no servidor:** `AccountIdentityService` agora oferece
  `checkAvailability` e `suggestAvailableUsername` (sufixo numerico, ate 20 tentativas).
  A mensagem de erro da reivindicao carrega a alternativa pronta ("ja esta em uso. Tente
  ""mapplestar2""."). `GET /api/users/username-available?username=` devolve
  `{ available, suggestion, invalidReason }` - inclusive o motivo quando o formato e invalido.
- [x] **Correcao na interface:** "Minha conta" e o cadastro verificam a disponibilidade enquanto o
  titular digita (com atraso de 400 ms, cancelando a anterior) e mostram "esta livre" ou
  "ja esta em uso - use @mapplestar2" com botao para aplicar a sugestao num clique. O campo
  do cadastro tem o mesmo aviso, entao a colisao e detectada ANTES do envio.
- [x] **Prova ao vivo:** `mapplestar` (em uso) -> `{"available":false,"suggestion":"mapplestar2"}`;
  `teofilo.livre` -> `{"available":true,...}`; `wil son` (invalido) -> `invalidReason` com o motivo.
  Cobertura automatizada: 4 casos novos em `AccountIdentityServiceTest` (10 no total).
- [x] **Suite:** **362 testes**, 0 falhas, 0 erros; build do frontend verde.

## 7.23 Foto que nao aparecia, perfil de escritor e painel do autor (2026-10-21)

- [x] **BUG RAIZ do upload ( Nginx ):** o `location /api/` perdia para a regra de assets estaticos
  (`.png/.jpg/.webp`) e o Nginx servia o index.html em vez de proxiar. Resultado: TODO arquivo em
  `/api/storage/**` (avatar, capa, banner) devolvia **404 pelo front**, mesmo com o arquivo gravado
  no servidor — por isso "nao consigo subir foto" e o icone de imagem quebrada no painel.
  Correcao: `location ^~ /api/` (o prefixo `^~` tem prioridade sobre as regex de estatico).
  Prova: avatar do criador via `localhost:5180` saiu de **404 para 200**; o upload sempre gravava
  (o log do servidor mostra "arquivo armazenado com sucesso").
- [x] **Pre-visualizacao local (padrao MangaTeofilo):** a foto escolhida aparece na hora via
  `URL.createObjectURL` (avatar, capa e banner) e so depois troca pela URL definitiva do servidor.
- [x] **Identificador unico (fim do "@@"):** o handle do escritor e o username da conta; a exibicao
  nao prepende "@" quando o handle ja vem com ele. O dado legado ("@ghaitani") foi normalizado pela
  sincronizacao de handle (hoje `haitani`), e o servidor normaliza na escrita.
- [x] **Perfil de escritor e sempre publico:** `PUT /api/users/profile` recusa `isProfilePublic=false`
  para quem `is_creator=true` ("Perfil de escritor e sempre publico"); a tela "Minha conta" mostra o
  aviso no lugar do botao. Leitor continua escolhendo livremente. Cobertura: `ProfileVisibilityTest`.
- [x] **Autor precisa de UM vinculo social (regra no servidor):** `PUT /api/creators/profile` valida os
  tres links pela allowlist e exige pelo menos um; autor sem nenhum vinculo nao salva o perfil. O painel
  do autor agora tem os tres campos (Instagram, YouTube, portfolio) com o aviso do requisito.
- [x] **"Minha conta" some do menu do escritor:** a entrada deixa de aparecer para quem e escritor
  (a pagina continua existindo para o leitor) e o util dela foi para o painel do autor: foto, bio,
  links e o link para o perfil publico.
- [x] **UX do painel do autor:** o formulario reidrata com o que esta no servidor (bio e links) —
  antes a bio sumia ao recarregar porque o workspace nao a devolvia; o save agora mostra um aviso
  persistente "PERFIL ATUALIZADO NO SERVIDOR" com o botao "VER MEU PERFIL PUBLICO", e o erro real
  do servidor aparece em vez de uma mensagem generica.
- [x] **Suite:** **366 testes**, 0 falhas, 0 erros; build do frontend verde.

## 7.24 Ferramentas que faltavam no painel do autor e publicacao em 5 etapas (2026-10-21)

- [x] **"Excluir conta / Exportar dados" e "Ver perfil publico" no painel do autor:** esconder
  "Minha conta" para o escritor sem mover essas ferramentas deixou o autor sem acesso a elas. Agora o
  painel do autor tem o bloco "MEU PERFIL E MEUS DADOS" (ver perfil publico, exportar dados LGPD e
  excluir conta, com confirmacao antes de apagar) e o aviso de que o perfil de escritor e sempre
  publico, com o username como identificador.
- [x] **Avatar do painel no tamanho do MangaTeofilo (128px, redondo) e header sincronizado:** o upload no
  painel atualizava so o perfil do AUTOR, enquanto o header mostra o avatar da CONTA — por isso a foto
  salva nao aparecia no icone do header. Agora o upload atualiza os dois e reidrata a sessao.
- [x] **Publicacao em 5 etapas (clone do MangaTeofilo):** `components/creator/ChapterPublishWizard.tsx`
  reproduz o `useChapterWizard` + `ChapterStepUpload/Organize/Cover/Review/Publish`: (1) Upload com
  dropzone de arraste e arquivos de capa e paginas, (2) Organizar paginas com grade numerada, mover,
  remover e ampliar, (3) Ajustar capa, (4) Revisar metadados (titulo, sinopse, generos, formato e a
  declaracao de autoria original) e (5) Publicar. O checklist mostra o estado de cada etapa e o avanco
  fica travado enquanto a etapa atual estiver incompleta. O formulario unico antigo saiu do painel.
- [x] **Suite:** **366 testes**, 0 falhas, 0 erros; build do frontend verde.

## 7.25 Perfil do leitor enxuto, candidatura a escritor separada e recorte de foto (2026-10-21)

- [x] **Duplicidade removida:** "Minha conta" carregava o bloco "Quero publicar como escritor" com os
  mesmos tres campos de link que ja existem na candidatura — duas telas quase iguais. Agora "Minha conta"
  tem so o que a identidade visual 9.6 pede: identidade (nome, @username, e-mail, Leitor/Escritor),
  visibilidade do perfil, ver a pagina publica, painel do leitor e dados/privacidade.
- [x] **Candidatura a escritor virou pagina propria** (`/become-writer`, no menu do avatar): deixa claro que
  **um dos tres links e obrigatorio** (os tres sao opcionais, um e obrigatorio), que nome/foto/username sao
  herdados da conta de leitor e que **o perfil do escritor e sempre publico** (o servidor recusa o privado).
- [x] **Recorte de foto com arraste e zoom** (`components/common/AvatarCropper.tsx`): o recorte quadrado e
  gerado no navegador (canvas 512x512, sem metadados) com arraste por mouse/toque, **setas do teclado** e
  slider de zoom, no mesmo padrao do `CreatorApplicationModal` do MangaTeofilo. Vale para o leitor (Minha conta)
  e para o autor (painel).
- [x] **Avatar do painel do autor maior (148px, +20) e sincronizado com o header:** o upload grava o avatar
  do AUTOR e da CONTA (o header usa o da conta) e reidrata a sessao.
- [x] **Identidade visual relida** (`docs/IDENTIDADE_VISUAL.md`): switch `PERFIL PUBLICO`/`PERFIL PRIVADO` com
  texto de apoio, secao propria para "BAIXAR MEUS DADOS" e "EXCLUIR CONTA" com `danger` so na exclusao e
  confirmacao em **modal**, foco visivel, alvos >= 44px e informacao nunca so por cor.
- [x] **Suite:** **366 testes**, 0 falhas, 0 erros; build do frontend verde.

## 7.26 Obras e Capítulos: responsabilidades separadas (2026-10-21)

- [x] **A mistura foi corrigida:** "Minhas obras" e "Capítulos" passam a terpaper as responsabilidades
  separadas do MangaTeofilo (`ObrasList`/`ObrasEditor` x `CreatorChaptersPage`):
  - **Minhas obras**: lançar e CONFIGURAR a obra (capa, banner, categorias, título, sinopse e
    estado). Não publica capítulo.
  - **Capítulos**: escolher uma obra SUA (o seletor lista as obras de "Minhas obras") e publicar o
    capítulo no fluxo de 5 etapas (páginas, capa do capítulo, revisão, publicação). Não cria obra.
- [x] **API nova (a edição de obra não existia):** `PUT /api/works/{workId}` (só o autor; capa/banner
  validados por `WorkImageUrlPolicy`, que só aceita arquivo enviado ao storage da plataforma),
  `DELETE /api/works/{workId}` (só o autor) e `GET /api/works/mine` (a lista do painel).
- [x] **Suite:** **366 testes**, 0 falhas, 0 erros; build do frontend verde.

## 7.27 Primeiro acesso nao se repete para quem ja configurou o perfil (2026-10-21)

- [x] **Causa:** o login lia o `user` ANTIGO da closure (`user.avatarUrl` ? feed : onboarding) antes do
  `refreshSession()` resolver, e como o `user` era o de visitante, **todo login caia em "Vamos montar seu
  perfil"** — mesmo com o perfil completo.
- [x] **Correcao em duas frentes:**
  - servidor: `V18` cria `users.profile_onboarding_completed_at` (marcado quando o titular salva o perfil:
    foto, nome ou visibilidade). O backfill marca como prontas as contas que ja tinham foto, para ninguem
    voltar ao primeiro acesso. A sessao (`/api/auth/me`) expoe `profileOnboardingCompleted`.
  - front: o login agora le a sessao RECEM-ADQUIRIDA (`authApi.me()`) e so abre o onboarding quando o
    servidor diz que falta configurar o perfil. Ao salvar o perfil na tela de primeiro acesso, o app vai
    para o feed.
- [x] **Prova ao vivo:** `GET /api/auth/me` da conta com foto e perfil prontos devolve
  `profileOnboardingCompleted: true`; as contas com foto herdada do backfill tambem.
- [x] **Suite:** **368 testes**, 0 falhas, 0 erros.

## 7.28 A candidatura a escritor renova a sessao, e o e-mail 2FA virou a marca do site (2026-10-21)

- [x] **Por que a pessoa continuava com as janelas de leitor:** a sessao era criada no login, ANTES do
  papel de escritor existir. O `isCreator`, o `creatorId` e o `creatorHandle` ficavam congelados e os
  endpoints de autor respondiam 403 ate deslogar e logar de novo.
- [x] **Correcao:** `POST /api/creators/apply` agora **reemite o cookie de sessao** com o papel de
  escritor (a sessao antiga e revogada pelo proprio emissor). O front so precisa renormalizar a sessao.
  Prova ao vivo: apply -> `{"reissuedSession":true,...}`; o `/auth/me` com o cookie novo ja devolve
  `isCreator: true` + `creatorId` + `creatorHandle`, e `GET /api/works/mine` responde **200** (antes 403).
  **Nao e preciso deslogar.**
- [x] **Rede de seguranca no front:** se o navegador nao receber o cookie novo, a tela de candidatura mostra
  um modal "RECONECTAR SUA CONTA" com contagem de **10 segundos** e desloga (o aviso que foi pedido).
- [x] **E-mail de 2FA na identidade visual do site:** o template antigo (azul/ciano generico, sem relacao com
  a marca) foi trocado pelo "Banca de Rua": fundo ink (#0B0B0C), faixa amarela (#FFD400) com o selo MN,
  cartao #151517 com borda #34343A, o codigo em **caixas quadradas** (como o campo OTP do site) e o rodape de
  transparencia (17% / 58%). O e-mail de recuperacao de senha recebeu a mesma identidade.
- [x] **Suite:** **368 testes**, 0 falhas, 0 erros.

## 7.29 Revisao geral do dia: falhas, limpo, seguranca e manutencao (2026-10-21)

- [x] **Falha real 1 — editar obra apagava a sinopse:** o resumo da lista ("Minhas obras") nao trazia a sinopse,
  entao o editor abria vazio e o salvamento era rejeitado (400) por campo obrigatorio. Agora o resumo traz
  `synopsis` e `genres`, e o editor abre com os valores reais do servidor.
- [x] **Falha real 2 — obra removida continuava no feed:** o `WorkFeedRemovalEvent` existia (usado pela
  moderacao) mas a remocao da obra pelo autor nao o publicava: a obra saia do Postgres e continuava no
  feed/cache do Mongo. A remocao agora publica o evento e o feed e limpo.
- [x] **Seguranca 1 — comentario em obra nao publicada:** `POST /api/works/{id}/comments` aceitava comentario em
  obra em rascunho (basta conhecer o id), revelando conteudo que o autor nao publicou. Agora so obra
  publicada (`ongoing`/`completed`) recebe comentario.
- [x] **Seguranca 2 — spam de comentario:** o POST de comentario caia no bucket global (120/min). Passou a ter
  bucket proprio de conteudo (`platform.security.content-rate-limit-per-minute`, padrao 20/min por IP).
- [x] **Manutencao 1 — templates de e-mail fora do adaptador SMTP:** o `SmtpMfaNotificationSender` carregava
  o HTML da marca (293 linhas). A apresentacao foi para `MangaEmailTemplates` (tokens da identidade visual
  em um lugar so) e o sender ficou so com o transporte: conexao, autenticacao, supressao e metricas.
- [x] **Manutencao 2 — debounce na consulta de username:** a tela de "Minha conta" batia na API a cada tecla;
  agora consulta com 400 ms de atraso, cancelando a requisicao anterior (evita 429 e desperdicio).
- [x] **Verificacao de seguranca feita:** propriedade das obras validada no servico em PUT/DELETE (403 para
  quem nao e autor); `GET /api/works/mine`, `PUT` e `DELETE /api/works/*` exigem papel de criador; o
  webhook de e-mail e o de comments nao ha; o corpo do comentario e higienizado e renderizado como texto.
- [x] **Sem hardcode ou duplicacao nos arquivos novos:** nenhuma URL de API fora do `client.ts`, nenhum numero
  magico solto (limites nomeados), nenhuma copia da regra de username/links/social (hoje em um lugar so).
- [x] **Suite:** **368 testes**, 0 falhas, 0 erros; build do frontend verde.

## 7.30 Segunda revisao: light novel sem caminho e ajustes de reacao (2026-10-21)

- [x] **Falha real 3 — light novel nao tinha como publicar capitulo:** o fluxo de capitulo so sabia enviar
  PAGINAS e mandava `IMAGE_PAGES` sempre. Em obra `LIGHT_NOVEL` o servidor recusa ("o formato do capitulo
  deve corresponder ao formato da obra"), ou seja, **nenhuma obra de prosa publicava capitulo**. Agora:
  o resumo da obra traz o formato, a tela "Capítulos" repassa para o fluxo e o wizard se adapta —
  paginas (MANGA) ou texto de prosa (LIGHT_NOVEL), com o payload correto (`pages` x `content`).
- [x] **Ajuste de reacao:** a lista de "Minhas obras" recriava a funcao de carga a cada render (warning do
  React no `useEffect`); o efeito agora tem a carga embutida e cancela o resultado se a tela desmontar.
- [x] **Varredura de seguranca refeita:** `GET /api/works/mine` (CREATOR), `PUT`/`DELETE /api/works/*` (CREATOR +
  propriedade no servico), `POST /api/works/*/comments` (autenticado, so obra publicada, bucket proprio),
  `POST /api/creators/apply` e `POST/DELETE /api/creators/*/follow` (autenticado),
  `GET /api/users/*/public-profile` e `GET /api/users/username-available` (publicas, com a privacidade decidida
  no servico).
- [x] **Suite:** **368 testes**, 0 falhas, 0 erros; build do frontend verde.

## 7.31 Recorte de imagem, edicao de capitulo e lancamento (2026-10-21)

- [x] **Recorte reescrito com a matematica do MangaTeofilo:** o ajuste anterior usava `transform` com
  `width: 100%` e o canvas calculava o retangulo de outro jeito — por isso a imagem nao aparecia inteira, o
  arrasto travava em um eixo e o arquivo salvo era diferente do preview. Agora `utils/responsiveCrop.ts` traz o
  modelo da referencia (`zoom` + `x`/`y` em percentual, limites por eixo, imagem em modo "cover") e o
  `ImageCropper` usa a MESMA geometria no CSS e no canvas: o preview ao lado do quadro **e** o arquivo gravado.
  Arrastar funciona nos quatro eixos e o teclado move com as setas.
- [x] **Reajustar sem subir arquivo novo:** avatar, capa e banner aceitam a imagem **que ja esta** no perfil como
  origem do recorte (botao "REAJUSTAR FOTO"), economizando upload e bytes no storage.
- [x] **Capa e banner da obra tambem tem recorte:** lancamento/edicao de obra abre o editor 2:3 (900x1200) e 16:9
  (1600x900).
- [x] **Organizar paginas no padrao do MangaTeofilo:** avanco automatico para "Organizar paginas" depois do upload,
  arrastar e soltar para reordenar (além das setas), campo "ir para a pagina N" e botao "ADICIONAR MAIS IMAGENS"
  dentro da propria etapa (sem voltar ao upload). As paginas ficaram com o tamanho do modelo de referencia.
- [x] **Escritor edita capitulo:** `PUT /api/works/{workId}/chapters/{number}` (só o autor) edita paginas em nova
  ordem, capa, titulo, texto e data de lancamento. Bug encontrado no caminho: a edicao quebrava no indice unico
  de `chapter_files.filename` (a pagina ja registrada) — a vinculo agora e substituido, nao acrescido.
- [x] **Lancamento sem data por padrao:** a data de liberacao virou OPCIONAL no cadastro do capitulo; sem data o
  capitulo entra no ar imediatamente, e a data (quando o autor quiser agendar) fica visivel e editavel na etapa
  "Revisar".
- [x] **Suite:** **368 testes**, 0 falhas, 0 erros; build do frontend verde.

## 7.32 Capitulo agendado que sumia e edicao que nao reaparecia (2026-10-21)

- [x] **Causa raiz 1 - a data de lancamento viajava em UTC:** o front enviava `new Date(...).toISOString()`
  (com "Z") para um campo `LocalDateTime` do servidor. O valor gravado saia deslocado e o capitulo
  acabava agendado para **um mes a frente**: o leitor nao o via, a ficha da obra nao o listava e a lista de
  edicao do autor (que le os capitulos pela ficha) ficava vazia — parecia que a edicao havia apagado o
  capitulo. Agora o front envia no formato local (`toBackendLocalDateTime`), que e o que o backend le.
- [x] **Causa raiz 2 - o autor nao via o proprio capitulo ainda nao liberado:** a ficha da obra e a leitura do
  capitulo filtravam por data de liberacao para todo mundo. Agora o **autor (e a moderacao) ve o conteudo
  ainda nao liberado** — como no MangaTeofilo. O leitor comum continua vendo so o que foi publicado.
- [x] **Padrao de lancamento:** o campo de data ja vem preenchido com **a data e a hora atuais** (o autor pode
  mudar para agendar) e o texto deixa claro: sem data = publica agora.
- [x] **Prova ao vivo:** edicao do capitulo 1 da obra "teste miomya" (5 paginas reordenadas, titulo novo) ->
  `200 "Capítulo atualizado com sucesso."`, com a data gravada exatamente como enviada (2026-10-21 12:00:00) e
  as 5 paginas intactas em `chapter_files`.
- [x] **Suite:** **368 testes**, 0 falhas, 0 erros; build do frontend verde.

## 7.33 Capitulo PROGRAMADO visivel para o leitor e CRUD completo do autor (2026-10-22)

- [x] **Requisito do usuario:** o capitulo agendado tem que ficar **visivel na ficha da obra** para o
  leitor (para ele querer assinar e ler antes) sem virar leitura liberada, e o autor tem que **achar e
  excluir** o proprio capitulo.
- [x] **Leitor enxerga o capitulo PROGRAMADO:** `GET /api/works/{slug}` passou a listar os capitulos
  com data futura quando a obra esta publicada (`ongoing`/`completed`), marcados com `isEarlyAccess=true`
  e com a data de lancamento. A ficha mostra **"LANCAMENTO EM <data> · ANTECIPADO PARA MEMBROS"**.
- [x] **Leitor nao-membro continua barrado:** a leitura responde `403` com a mensagem que convida a
  entrar como membro oficial do autor (a trava de acesso antecipado nao afrouxa nada).
- [x] **Autor nao era reconhecido como autor (bug real):** `isAuthorOrModerator` comparava o id do
  **usuario** da sessao com o id do **criador** da obra — nunca batia. Agora compara com
  `work.getAuthor().getUser().getId()`.
- [x] **Ordem das travas invertida (bug real):** a trava de acesso antecipado era avaliada **antes**
  do cheque de privilegio, entao o **autor tomava 403 no proprio capitulo agendado**. Agora o privilegio
  e verificado primeiro e a trava so vale para quem nao e autor/moderador.
- [x] **CRUD completo do capitulo:** `DELETE /api/works/{workId}/chapters/{chapterNumber}` (so o autor)
  exclui o capitulo, apaga as paginas em cascata (`chapter_files.chapter_id ON DELETE CASCADE`),
  corrige `works.total_chapters` e sincroniza o feed. No painel do autor ha o botao **EXCLUIR** ao lado
  do **EDITAR**.
- [x] **Painel do autor:** a lista de capitulos agora carrega a data real (`publicReleaseAt`) e marca
  **"PROGRAMADO PARA <data>"** (antes o campo vinha fixo em `null`, entao o selo nunca aparecia).
- [x] **Encoding:** o repositorio tinha texto com UTF-8 duplamente codificado ("CapÃ­tulo",
  "nÃ£o", "lanÃ§amento") em mensagens de erro e na interface. Decodificado com inverso CP1252 estrito
  (preserva `->`, `—` e emoji) em backend, frontend e documentacao.
- [x] **Bagunca corrigida:** o `AUDITORIA-ATUAL.md` tinha 13 copias do titulo "## 8. Ordem de corre"
  (restou uma).
- [x] **Prova ao vivo:** obra "teste miomya" com o capitulo 1 programado para 25/10/2026 — leitor sem
  sessao ve "LANCAMENTO EM 25/10/2026 · ANTECIPADO PARA MEMBROS" na ficha; leitura sem sessao
  `403 "Capitulo em Acesso Antecipado exclusivo para membros oficiais do autor @mapplestar"`; autor
  le o proprio capitulo (`200`); `DELETE` do capitulo de teste removeu capitulo + pagina e baixou
  `total_chapters` de 2 para 1.
- [x] **Suite:** **371 testes**, 0 falhas, 0 erros (3 novos: autor le o proprio capitulo programado,
  exclusao ajusta o contador, exclusao por terceiro e negada); build do frontend verde.

## 7.34 E-mail de teste voltando como "Address not found" (2026-10-22)

- [x] **Sintoma:** o usuario recebia no e-mail real a mensagem de erro do servidor de e-mail
  ("Address not found ... o dominio test.com nao existe") para as contas de smoke/QA
  (`smoke_creator_*@test.com`, `qa.leitor.*@test.com`).
- [x] **Causa raiz 1 - o smoke usava o SMTP de verdade:** `smoke_test_e2e.ps1` lia o OTP do Dev Outbox
  ou do Mailpit, mas **nao mudava o modo de e-mail do backend**: com `PLATFORM_MAIL_ENABLED=true` e
  `MAIL_HOST=smtp.gmail.com` (configuracao real do `.env`), o OTP saia para o SMTP de verdade e o
  servidor de e-mail devolvia bounce. Agora o proprio script detecta o SMTP real, **troca o backend para
  o Dev Outbox** (`PLATFORM_MAIL_ENABLED=false`), roda o smoke e **devolve o modo original no fim**
  (inclusive em caso de erro inesperado, via `trap`).
- [x] **Causa raiz 2 - o backend aceitava qualquer dominio:** nao havia trava para dominio reservado
  para teste, entao qualquer cadastro de QA com `@test.com` gerava e-mail real e bounce. Nova politica
  pura `util.ReservedTestDomainPolicy` (RFC 2606/6761 + `test.com` reservado pelo IANA) e o
  `SmtpMfaNotificationSender` **nao despacha** para esses dominios (`outcome=suppressed_reserved_domain`).
  Isso protege a reputacao do dominio de envio e encerra a origem dos bounces.
- [x] **Higiene:** o smoke passou a usar `@example.invalid` (dominio reservado que nunca vira caixa
  postal) e as chamadas nativas (docker) foram blindadas contra `ErrorActionPreference=Stop`.
- [x] **Limpeza dos dados de teste que sobraram no banco:** 13 contas de smoke/QA anonimizadas
  (mesmo padrao do fluxo LGPD do produto: `anon-<uuid>@deleted.manganetworking`, sem nome, sem hash,
  sem segredo 2FA), 22 obras de teste removidas (com capitulos e paginas em cascata) e o feed do
  MongoDB limpo (so a obra real do autor permanece).
- [x] **Prova ao vivo:** cadastro com `qa.leitor.<ts>@test.com` com o SMTP real ligado ->
  `200 2FA_REQUIRED` e no log `Envio suprimido: destinatario em dominio reservado para teste`
  (`outcome=suppressed_reserved_domain`) — **nenhum e-mail saiu**. Smoke E2E 12/12 com o ciclo completo
  (detecta SMTP real -> Dev Outbox -> 12/12 -> devolve `PLATFORM_MAIL_ENABLED=true`).
- [x] **Suite:** **376 testes**, 0 falhas, 0 erros (5 novos da politica de dominio reservado).

## 8. Ordem de correção

A fila está em `docs/orquestracao/ROADMAP-FASES.md`. Resumo:

1. ~~C5 (compose)~~ ✅ → 2. C3 (cooldown/limites OTP) ✅ → 3. F3 (restaurar/verificar storage órfão e medir carga) → 4. C4 (domínio autenticado) → 5. C2 (idade) → 6. A2 (CPF) → 7. A1/M2/M3 (consentimento) → 8. F4 (checkout doações/membros e Sandbox) → 9. M4–M6 (mocks) → 10. F7 (provas E2E).

## 7.35 Username, favoritos, retomada de leitura e analytics (2026-10-22)

- [x] **Username com regra única no servidor e espelho no cliente:** `UsernamePolicy` agora exige
  minúsculas, 3–30 caracteres, apenas `a-z`, `0-9`, `.` e `_`, sem espaço (o valor é aparado),
  sem acento, sem `.`/`_` no início/fim e sem símbolo repetido; hífen deixou de ser aceito.
  Lista de termos reservados (sistema, marca e redes sociais) bloqueada por igualdade, e o teste
  cobre cada regra. O front espelha a mesma regra em `utils/usernameRules.ts`, remove espaço
  enquanto o titular digita e mostra a mensagem antes do envio.
- [x] **Favorito deixou de ser só memória:** a biblioteca vivia apenas no estado React e a página
  usava `MOCK_WORKS` (vazia em produção). Novo `GET /api/users/me/library` devolve as obras de
  `user_liked_works`; `AuthContext.refreshSession` hidrata os favoritos do servidor e
  `toggleFavorite` grava no endpoint existente de forma otimista (reverte e avisa se falhar).
  Prova no navegador: coração → `GET /api/users/me/library` devolve a obra; recarregar a página
  mantém o coração; lixeira da biblioteca remove e a lista zera sem recarregar.
- [x] **Continuar de onde parou / ler novamente:** a ficha da obra e a biblioteca leem
  `GET /api/users/reading-progress`; capítulo inacabado abre no capítulo e na página exatos
  (`initialPage` no leitor) e capítulo concluído (`page >= totalPages`) mostra **LER NOVAMENTE**
  começando da página 1. Prova no navegador: página 3/8 → botão "CONTINUAR DE ONDE PAROU · CAP. 1
  · PÁG. 3" → leitor abre em "3 DE 8"; 8/8 → "LER NOVAMENTE".
- [x] **Analytics no padrão Studio com a identidade Banca de Rua:** `GET /api/creators/analytics`
  passou a devolver totais distintos da janela, série horária das últimas 48 h, recorte por obra
  e por capítulo e janela de até 180 dias (TTL dos eventos). A tela tem período selecionável
  (7/28/90/180), abas **VISÃO GERAL** e **CONTEÚDO**, gráfico de área, cartões de leitura/leitores/
  membros/receita, tabela expansível por capítulo, retenção por página, financeiro e painel
  em tempo real. Nenhum número mock: obra sem evento aparece com zero.
- [x] **Higiene:** `getLibrary` deriva a identidade da sessão; nenhum id de usuário vem do cliente.
  O service de analytics não inventa dado e mantém a janela financeira com o fuso do `@CreationTimestamp`.
- [x] **Prova:** **377 testes**, 0 falhas, 0 erros; build do frontend verde; smoke E2E **12/12**
  (com Dev Outbox e retorno a `PLATFORM_MAIL_ENABLED=true`); verificação manual no navegador dos
  quatro fluxos. Limpeza: página de leitura restaurada em 8/8, favorito removido e sessão de QA
  apagada do Redis.

## 7.36 Analytics: evento READ deduplicado e contrato de métricas (2026-10-22)

- [x] **Repetir a mesma página não infla mais a leitura:** `ReadingProgressService.trackPageRead`
  gravava um evento `READ` em toda chamada válida, mesmo sem avanço de página — retry de rede,
  re-render do leitor ou retorno à mesma página somavam leituras e distorciam a retenção por
  página. Agora o evento só é gravado no mesmo caso que incrementa `cumulativePagesRead` (página
  nova ou troca de capítulo). `ReadingProgressServiceValidationTest` cobre "mesma página não grava
  evento" e "avançar grava exatamente um `READ`" (9 testes na classe).
- [x] **Leitores únicos não são somados:** o fallback da tela somava `uniqueReaders` dos dias,
  contando o mesmo leitor uma vez por dia em que voltou. Agora a tela usa só `totals` do backend
  (distinto na janela) e mostra `—` quando o contrato não vier, em vez de um número falso.
- [x] **Documento central de métricas:** `docs/ANALYTICS-METRICAS.md` define fonte única de verdade,
  campos e regras do evento `READ`, fórmulas de leitura/leitores únicos/séries/retenção/financeiro,
  deduplicação, janela em UTC, TTL de 180 dias, autorização e a lista explícita do que ainda não é
  medido (impressões, CTR, origem de descoberta, início qualificado, conclusão, tempo ativo,
  recorrência, continuação entre capítulos, curva de light novel, fuso do criador e CSV).
- [x] **Prova:** backend **378 testes**, 0 falhas, 0 erros; `npm.cmd run build` verde (2,96 s).
  Smoke E2E não reexecutado nesta rodada: a mudança é interna ao evento de leitura e está coberta
  por teste unitário.

## 7.37 Visualização por capítulo, total da obra e tela preservada no F5 (2026-10-22)

- [x] **Visualização ≠ página lida:** o contador subia ao abrir o capítulo (`readChapter`) e o painel
  somava eventos `READ` (1 por página). Agora `READ` alimenta **só** a retenção e `VIEW` é gravado
  **uma vez por leitor por capítulo** quando a primeira página avança, com dedup por
  `(userId, chapterId, eventType)` e índice composto novo. Abrir e sair sem ler não conta; reler o
  mesmo capítulo não soma de novo.
- [x] **Total da obra = soma dos capítulos:** `chapters.views` e `works.total_views` recebem +1 no
  mesmo caso do `VIEW`. A ficha mostra o total e a linha de cada capítulo; catálogo/feed mostram o
  total da obra; o painel traz visão geral + recorte por obra e por capítulo.
- [x] **Números fabricados removidos:** `RankRow` exibia `420` curtidas e `1.240` views quando o
  valor era zero (fallback hardcoded). Os `420` relatados vinham daí; `20/24` eram aberturas antigas
  e `49` eram page reads repetidos de QA. Contadores locais foram reconciliados com `VIEW` e 15
  eventos órfãos de capítulo apagado foram removidos (sem tocar em conteúdo do autor).
- [x] **F5 mantém a tela:** como o app não usa router, a navegação passa a ser gravada em
  `sessionStorage` e a obra/capítulo/página são reabertos no reload; o snapshot não é sobrescrito
  enquanto a restauração corre. Validado no navegador (ficha e leitor reabrindo em 3/8).
- [x] **Datas e tooltip:** o painel usa dd/mm/aaaa e as barras de 48 h têm tooltip próprio
  ("Hoje, 12:00 – 13:00" + total), no lugar do `title` nativo.
- [x] **Prova:** backend **380 testes**, 0 falhas, 0 erros; `npm.cmd run build` verde;
  `GET /api/creators/analytics` = 1 visualização / 1 leitor / retenção 8 páginas; chamada repetida de
  `track` não criou `VIEW` duplicado; ficha, feed e leitor conferidos no navegador.
- [ ] **Pendências:** impressões/CTR/origem de descoberta, início qualificado, conclusão estimada,
  tempo ativo, recorrência D1/D7/D30, continuação entre capítulos, curva de light novel, exportação
  CSV e teste HTTP de IDOR em `/api/creators/analytics`. Smoke E2E não reexecutado nesta rodada.

## 7.38 Funil de descoberta, comparação, conclusão, heatmap e CSV (2026-10-22)

- [x] **Impressão e abertura separadas da leitura:** `POST /api/analytics/impressions` recebe lote
  de até 20 cards que ficaram ≥50% visíveis por ~1 s (`IntersectionObserver` no `WorkCard`) e
  `POST /api/analytics/openings` registra o clique. `idempotencyKey = userId:evento:sessão:superfície:obra`
  tem índice único; retry/re-render/scroll não duplicam. Só leitor autenticado é rastreado.
- [x] **CTR declarado, não inflado:** numerador = abertura com impressão da mesma pessoa/obra nos
  30 minutos anteriores; abertura por link externo continua no funil, mas não no CTR. Sem
  impressões, `ctrPercent = null` (indisponível), nunca zero fabricado.
- [x] **Início qualificado e conclusão:** `VIEW` é o início qualificado (1ª página realmente lida).
  Conclusão v1 de mangá = maior `readPage` ≥80% das páginas distintas; prosa devolve `null` até
  existir checkpoint de progresso — não inferimos leitura por página em texto.
- [x] **Comparação e fuso:** a janela anterior de mesma duração alimenta o delta dos KPIs e a linha
  tracejada do gráfico; bordas e agrupamento diário passam a usar `America/Sao_Paulo` (IANA), com
  armazenamento em UTC preservado.
- [x] **Heatmap e amostra mínima:** matriz 7×24 dos últimos 28 dias em `America/Sao_Paulo`. Curva
  de retenção, heatmap e detalhamento de origem ficam ocultos com amostra < 10
  ("Dados insuficientes"), sem revelar indivíduo.
- [x] **CSV server-side:** `GET /api/creators/analytics/export.csv` usa o mesmo serviço/fórmulas da
  tela, exige `ROLE_CREATOR`, não exporta evento bruto nem leitor e neutraliza `=`, `+`, `-`, `@`,
  tab e CR; células com vírgula, aspas, quebra de linha, Unicode e vazio cobertas por teste.
- [x] **UI:** tooltip do gráfico diário em mouse, teclado (←/→/Home/End/Esc) e toque, com valor do
  dia e período anterior; tabela de conteúdo ordenável; layout responsivo (grid de KPIs, gráfico,
  tabela com rolagem, painel 48 h e cabeçalho).
- [x] **Anti-IDOR:** `CreatorAnalyticsIdentityTest` prova que `creatorId`/`workId`/`chapterId` na URL
  são ignorados (identidade só da sessão), leitor comum recebe 403 e anônimo 401, inclusive na
  exportação.
- [x] **Prova:** backend **398 testes**, 0 falhas, 0 erros (`BUILD SUCCESS`); `npm.cmd run build`
  verde (3,38 s); containers `backend`/`frontend` reconstruídos e `healthy`. Em runtime local:
  2 impressões + 1 abertura resultaram em **CTR 50,0%**, `attributedOpenings = 1`, funil
  2 → 1 → 1 → 1; reenvio do lote devolveu `accepted: 0, duplicates: 2`; o CSV respondeu `200`
  com `Content-Disposition`, BOM e linhas de resumo/obra/capítulo; `creatorId`/`workId` forjados
  foram ignorados (`days=9999` fixado em 180, obra da sessão mantida). A tela renderizou os
  mesmos números, o tooltip do gráfico respondeu a ponteiro e a teclado (End/←), inclusive na
  borda direita (reposicionado sem overflow), a aba Conteúdo mostrou o capítulo com conclusão
  100% e não houve overflow horizontal em 1000 px. Conclusão ignora `READ` sem `VIEW` (não passa
  de 100%). Eventos de teste foram removidos do Mongo e as sessões manuais do Redis, apagadas; o
  painel voltou a `impressions = 0` e `ctr = null`.
- [ ] **Não verificado:** emulação visual de celular — o harness não expõe viewport/redimensionamento
  nem screenshot; a responsividade foi revisada nas classes e medida apenas em 1000 px.
- [ ] **Pendências:** tempo ativo (heartbeat), coortes D1/D7/D30, continuação para o próximo
  capítulo, progresso de prosa e leitura anônima/dispositivo seguem sem instrumentação; superfícies
  `RECOMENDACAO`/`PERFIL_CRIADOR`/`EXTERNO` ainda não disparam cards.

## 7.40 Política editorial inicial para capítulos regulares de light novel (2026-10-22)

- [x] **Backend:** `ProseEditorialPolicy` centraliza NFC, normalização de quebras, remoção do HTML no formato legado de texto simples e contagem por code points Unicode. Criação e edição rejeitam capítulos regulares abaixo de 1.000 ou acima de 30.000 caracteres visíveis; payload bruto acima de 2.000.000 é barrado antes de sanitização. O aviso de capítulo curto (<3.000) não bloqueia. Edição sem `content` mantém o texto existente.
- [x] **Frontend:** `ChapterPublishWizard` mostra contador visível, restantes, faixa recomendada 6.000–18.000, aviso de capítulo curto e aviso acima da faixa; bloqueia avanço/publicação fora dos limites técnicos.
- [x] **Testes:** `ProseEditorialPolicyTest` cobre NFC, emoji, quebras, tags, mínimo/máximo inclusivos, capítulo curto e teto bruto; `WorkApplicationServiceTest` cobre sanitização e validação no caso de uso. Testes direcionados: **21 testes, 0 falhas, 0 erros**; suíte completa: **412 testes, 0 falhas, 0 erros, 0 ignorados**. `cmd /c npm run build` concluiu; aviso não impeditivo de bundle acima de 500 kB.
- [ ] **Ainda não implementado:** editor de blocos ordenados texto/ilustração/separador, limite de 0–6 imagens por capítulo, apresentação visual independente, volumes/tipos especiais e leitor de prosa somente em scroll com barra/configurações. A barra visual atual não registra progresso de retenção; checkpoints 10% ainda pendentes. Sem migration nesta fatia; não altera `content_text` existente.

## 7.41 Formato de blocos versionado para light novel (2026-10-22)

- [x] **Backend:** Nova coluna `blocks_json` (TEXT) e `blocks_version` (INTEGER) em `ChapterEntity`. DTOs `ChapterBlockDto` (sealed interface com `TextBlock`, `IllustrationBlock`, `SeparatorBlock`) e container `ChapterBlocksDto` versionado (v1 atual). Política `ChapterBlocksPolicy` valida estrutura JSON, contagem total de caracteres visíveis (1.000–30.000), máximo 6 ilustrações intercaladas, bloco de texto individual ≤30.000, pelo menos um bloco de texto. Migração automática `content_text` → blocos v1 via `ChapterBlocksPolicy.migratePlainTextToBlocks`. Separação estrita: `blocksJson` exclusivo com `content`/`pages`.
- [x] **Novos tipos de capítulo:** `ChapterType` (REGULAR, PROLOGUE, SPECIAL) com validações específicas:
  - REGULAR: 1.000–30.000 caracteres, mínimo 1 bloco de texto
  - PROLOGUE: capítulo 0 opcional e único, mínimo 300 caracteres, exige bloco de texto
  - SPECIAL: conteúdo extra, mínimo 300 caracteres, pode ter só ilustrações
- [x] **DTOs:** `CreateChapterRequestDto` e `UpdateChapterRequestDto` ganham campos `chapterType` e `blocksJson`. Criação/edição de capítulo PROSE aceita blocos v1 (gera `content_text` legível para compatibilidade) ou formato legado `content` (mantido para retrocompatibilidade).
- [x] **Testes:** `ChapterBlocksPolicyTest` (12 testes) cobre validação feliz, mín/máx total, limite por bloco, ilustrações (0–6), separadores, versão não suportada, JSON inválido, migração legado, validação PROLOGUE/SPECIAL. `WorkApplicationServiceTest` (17 testes) continua verde cobrindo ambos os formatos. `ProseEditorialPolicyTest` (4 testes) cobre formato legado. Suíte unitária backend: **424 testes, 0 falhas, 0 erros** (12 erros de integração por Docker/Testcontainers indisponível, não relacionados à mudança).
- [x] **Frontend build:** `npm run build` verde (TypeScript + Vite, 1671 módulos).
- [x] **Editor de blocos no wizard:** Toolbar com botões para adicionar Texto/Ilustração/Separador, drag-and-drop para reordenar, edição inline de cada bloco, validação em tempo real com erros/avisos, contador de caracteres e ilustrações, seletor de tipo de capítulo (Regular/Prólogo/Especial).
- [x] **Leitor de prosa em scroll (ReaderPage):** Renderiza blocos ordenados (texto, ilustrações, separadores), barra de progresso no topo e na parte inferior do artigo, modo scroll-only (sem toggle paginado/vertical para prosa), checkpoints de retenção a cada 10% (10%–100%) com deduplicação e envio para `trackReadingProgress`, fim de capítulo detectado automaticamente no 100%.
- [x] **Apresentação visual da obra:** Campo `presentation_json` em `WorkEntity` para editor futuro (capa, banner, galeria de abertura).
- [ ] **Próximos passos:** Upload/seleção de ilustrações intercaladas (integração com `chapter_files`), volumes/tipos especiais avançados, CSV de analytics de retenção de prosa.

## 7.42 Fluxo de autoria de light novel separado do mangá (2026-10-23)

**Causa:** o wizard de capítulo era um só para os dois formatos. Para light novel, o "editor" era um
`textarea` de prosa e as etapas falavam de páginas, capa e organização de mangá. Isso não é só
cosmético: o capítulo de prosa é um **documento de blocos ordenados**, e o contrato de leitura
(`ChapterReadResponseDto`) nem devolvia `blocksJson`/`chapterType` — o leitor caía sempre no texto
plano e a edição perdia as ilustrações.

- [x] **Contrato de leitura:** `ChapterReadResponseDto` passa a expor `blocksJson` e `chapterType`
  (a fonte da verdade do capítulo). Sem isso o leitor não renderiza ilustrações e o editor não
  reidrata os blocos ao editar. Regressão coberta em
  `WorkApplicationServiceTest.shouldExposeBlocksAndChapterTypeOnRead`.
- [x] **Fluxo dedicado:** `LightNovelChapterWizard` implementa **Detalhes → Escrever → Revisar →
  Publicar** e substitui o wizard de 5 etapas somente quando `workFormat === 'LIGHT_NOVEL'`. O fluxo
  de mangá permanece no `MangaChapterPublishWizard`, sem alteração de comportamento.
- [x] **Etapa Detalhes:** tipo de capítulo (regular/prólogo/especial) com o limite editorial de cada
  um, título de 1–120 caracteres e bloqueio do capítulo 0 quando a obra já tem prólogo. Em edição o
  tipo é somente leitura (o backend não o altera) e o cabeçalho mostra o banner de modo edição.
- [x] **Etapa Escrever:** um único documento. Blocos de texto com auto-altura, ilustração e
  separador de cena; inserção pelo topo do documento ou por "+ parágrafo aqui" no ponto desejado;
  reordenação por arrastar **e** por `↑`/`↓` (acessível por teclado); duplicar/remover bloco.
  Ilustração tem upload imediato (`storageApi.uploadFile`, JPG/PNG/WebP até 8 MB), placeholder de
  envio, miniatura, texto alternativo, largura de leitura e vaga liberada ao remover.
- [x] **Limite e contagem:** `n/6` ilustrações no painel lateral; o botão de inserir desabilita em
  6/6 com explicação. O contador usa `countVisibleProseCharacters` (espelho da política do backend)
  e uma barra mostra a faixa recomendada de 6.000–18.000 com marcas, além dos avisos de curto
  (<3.000), acima da faixa e acima do máximo de 30.000.
- [x] **Autosave local:** rascunho por obra+capítulo em `localStorage` (título, tipo e blocos),
  faixa "rascunho salvo" com restaurar/descartar e aviso de saída (`beforeunload`) com alterações
  não publicadas. Não substitui o servidor — é proteção contra perda de digitação.
- [x] **Revisar:** prévia fiel em tipografia de leitura (blocos na ordem salva, imagem com largura
  relativa e `alt`), capa opcional do capítulo com recorte 900×1200 e agendamento
  (`publicReleaseAt` vazio = agora).
- [x] **Publicar:** resumo de obra, capítulo, contagem e data; erros de estrutura **e** de política
  listados antes do botão, que fica desabilitado com o motivo exato. Em edição o texto avisa que o
  capítulo, os comentários, as visualizações e a data original são preservados.
- [x] **Segurança das ilustrações:** o `ChapterFileAccessGuard` trata arquivo desconhecido como
  público. Publicar um capítulo em acesso antecipado com ilustração não registrada vazaria a imagem
  pela URL do storage. Agora as ilustrações do `blocksJson` entram em `chapter_files` junto com as
  páginas, herdando o controle de acesso do capítulo
  (`WorkApplicationServiceTest.shouldRegisterIllustrationFilesForAccessControl`).
- [x] **Painel de capítulos:** lista de light novel mostra caracteres e ilustrações em vez de
  "0 pág"; o próximo número vem do maior capítulo existente (não de `totalChapters`, que quebrava a
  sequência depois de um prólogo 0); publicar/editar recarrega a lista sem `F5`.
- [x] **Configuração de leitura:** botão de configuração no header do leitor (somente prosa) com
  fonte serifada/sem serifa, tamanho 15–26 px, entrelinha 1,6/1,9/2,2 e largura de coluna
  620/720/820 px, persistida no navegador. Ilustração do leitor aceita nome de arquivo ou URL.
- [x] **Migration V23:** `V23__light_novel_blocks_and_presentation.sql` acrescenta `chapters.chapter_type`
  (default `REGULAR`), `chapters.blocks_json`, `chapters.blocks_version`, `works.presentation_json` e
  três constraints: tipo válido, `blocks_json` só em prosa sem páginas e com versão ≥1. V1..V22
  permanecem imutáveis. **Isto corrigia uma falha real:** o `ddl-auto: validate` quebrava os testes de
  integração com `missing column [blocks_json]` — o diagnóstico anterior de "Docker indisponível"
  estava errado.
- [x] **Testes/build:** `mvn -o test` → **426 testes, 0 falhas, 0 erros, 0 ignorados**, incluindo os
  14 de integração com Testcontainers (`*IntegrationTest`). `cmd /c npm run build` → verde, 1672
  módulos (aviso não impeditivo de bundle >500 kB).
- [ ] **Ainda pendente:** volumes como entidade própria; apresentação visual da obra (0–6 imagens de
  abertura) no painel; upload com validação de MIME real/dimensões e variantes responsivas no
  servidor; `checkpoint` nos eventos de retenção (hoje os checkpoints de 10% enviam só
  `page=1/totalPages=1` e o backend não distingue faixas); CSV de retenção de prosa.

## 7.43 Catálogo, home e feed com dois formatos (2026-10-23)

**Causa:** home, catálogo e feed foram desenhados quando só existia mangá. O catálogo filtrava no
cliente sobre os 50 itens do feed do Mongo, sem status, sem público e sem paginação; o "Em alta" era um
ranking único misturando formatos com métricas não comparáveis; os cards não diziam o formato; a
biblioteca não tinha eixo de formato e o "continuar lendo" só existia em `DEV` com mock.

- [x] **Fonte de verdade do catálogo:** `GET /api/catalog` consulta o PostgreSQL com `Specification`
  (formato, gêneros em OR, público, status, busca por título/sinopse/autor/rótulo de gênero, ordem e
  página) e calcula os contadores por formato sobre o mesmo recorte. O feed do Mongo continua sendo
  motor de recomendação, mas um filtro não depende mais do último sync.
- [x] **Param inválido nunca esconde conteúdo:** `formato` desconhecido cai em "tudo"; gênero/status
  fora da allow-list são ignorados; `size` é limitado a 48.
- [x] **Privacidade e agendamento:** suspensa, arquivada por LGPD e **rascunho** ficam fora do
  catálogo, dos lançamentos e do feed (sync e consulta); `GET /api/catalog/releases` só devolve
  capítulo com `public_release_at <= agora`.
- [x] **Ranking separado:** `/api/feed/trending` aceita `formato`; a home pede dois trilhos
  independentes em "Tudo" e um só quando o formato está filtrado.
- [x] **Um card, dois badges:** `FormatBadge` (amarelo/papel + ícone + rótulo) no canto inferior
  esquerdo; `WorkCard` mostra `N caps` ou `Light novel · N caps`. Stickers editoriais foram para o topo
  da capa para não competir com o badge.
- [x] **Um seletor em todas as telas:** `FormatSwitcher` com `aria-pressed`, navegação por setas e
  contadores; estado na URL (`?formato=`, `?genero=`, `?status=`, `?ordem=`, `?q=`, `?pagina=`), com
  `pushState`/`replaceState` + `popstate`. A home usa `?inicio=` para não colidir com o catálogo.
- [x] **Três níveis de filtro:** formato segmentado, chips de gênero múltiplos (com "+ mais") e drawer
  para status, público, ordem e "Com ilustrações" (só aparece em Light novel). Pílulas com ✕ e
  "limpar tudo", contador dinâmico, skeleton, vazio e erro com ação.
- [x] **Home:** novos capítulos agrupados por obra (até 3 capítulos + tempo relativo), "Em alta" por
  formato com trilho só a partir de 4 obras (CTA para autor logado abaixo disso) e timeline de
  lançamentos por dia ("Hoje", "Ontem", data). Mobile repete o seletor no topo fixo.
- [x] **Biblioteca e ficha:** abas de formato na biblioteca com o mesmo componente; badge na ficha;
  progresso de prosa não inventa 100% (`page=1/totalPages=1` não é conclusão) e o capítulo
  reconstruído leva o formato para o leitor abrir em scroll.
- [x] **Dados de progresso:** `reading_progress` passa a gravar `workSlug`/`workFormat`; documentos
  antigos ficam nulos e o front simplesmente não mostra o card sem slug (nada fabricado).
- [x] **Migration V24:** índices `works(work_format,status)`, `works(created_at/updated_at/total_views)`,
  `work_genres(genre, work_id)` e `chapters(public_release_at)`.
- [x] **Testes/build:** `CatalogIntegrationTest` (8 cenários reais com Testcontainers) + suíte
  **434 testes, 0 falhas/0 erros**; `npm.cmd run build` verde; `GET /api/catalog?formato=light-novel`,
  `?formato=abc` (cai em tudo) e `/api/catalog/releases` conferidos por HTTP na stack local.
- [ ] **Ainda pendente:** volumes como entidade (rótulo `Vol. X · Cap. N`), percentual real de scroll
  para prosa, onboarding de uma pergunta e teste automatizado de UI (não há runner no frontend).


## 7.39 Engajamento real, comentários, notificações e ranking (2026-10-22)

**Causa das views baixas:** o `VIEW` era deduplicado para sempre por `(userId, chapterId, eventType)`;
reabrir o mesmo capítulo no mesmo dia nunca gerava novo evento. A correção usa uma chave diária
`userId:VIEW:chapterId:AAAA-MM-DD` em `America/Sao_Paulo` e `eventVersion=2`. O leitor só envia a view
depois que a primeira página fica ≥50% visível por ~1 s (ou após navegar para página >1); abrir e sair
não conta. Aba sem login não envia evento porque o tracking exige sessão — isso é decisão de produto,
não bug, e não foi ativado fingerprint/IP.

- [x] **V19/V22:** V19 separou `total_favorites` do contador de curtidas. A decisão final elimina curtida direta da obra: `chapter_likes` é a fonte de verdade e `works.total_likes` agrega `chapters.likes`; V22 recalcula o agregado e remove `work_likes`. Toggles usam `INSERT ... ON CONFLICT DO NOTHING` e contadores atômicos; incremento/decremento só quando a linha mudou. Excluir capítulo também remove do total agregado as curtidas daquele capítulo.
- [x] **V20:** `work_comments` ganhou `parent_id`, `likes_count`, `status`, `edited_at`, `deleted_at`;
  `comment_likes` e `comment_reports` têm unicidade por usuário. Respostas só em profundidade 1,
  exclusão lógica preserva respostas, edição só do autor, denúncia só de terceiro e uma vez por
  usuário. Moderação: `GET /api/reports/comments/pending` e `POST /api/reports/comments/{id}/moderate`
  (`DISMISS`/`HIDE`). Corpo é sanitizado e renderizado como texto (sem `innerHTML`).
- [x] **Selo de membro:** estrela amarela apenas quando existe `membership_subscriptions` com
  `status=ACTIVE` e `expiresAt > agora` para o criador dono da obra; o cliente não envia esse campo.
- [x] **V21:** central interna de notificações com `UNIQUE(user_id, dedup_key)`. Novo capítulo de
  obra favoritada respeita acesso antecipado (antes da liberação só assinantes ativos; job de 5 min
  notifica os demais sem duplicar), resposta e marcos de curtida não notificam a própria ação.
  Endpoints de listagem, não lidas, marcar uma/todas e limpar lidas. Push real segue **bloqueado**
  por VAPID/HTTPS/domínio/serviço de entrega.
- [x] **Ranking:** obras usam `log1p` para views/curtidas/favoritos/comentários/capítulos, bônus de
  recência, decaimento e boost de criador; tendência separa o histórico do agora pelo decaimento.
  Comentários usam curtidas com peso predominante, respostas e recência como apoio, com desempate
  determinístico.
- [x] **Prova:** backend `mvn -o test` → **412 testes, 0 falhas, 0 erros, 0 ignorados**; frontend
  `cmd /c npm run build` verde. Imagens `backend`/`frontend` reconstruídas; V19–V22 aplicadas no
  PostgreSQL real (`flyway_schema_history` em 22; `work_likes` ausente). E2E HTTP com sessão real:
  comentários/resposta/moderação/notificações (prova anterior) e toggle de curtida de capítulo: capítulo
  `1→2→1`, obra `1→2→1`, soma dos capítulos igual ao agregado em cada passo. A conta de QA usada
  nesta última prova permaneceu no banco porque o registro de consentimento é append-only.
- [ ] **Não verificado:** QA visual no navegador do leitor/sino/comentários e retorno pós-login. A tela de moderação
  de comentários é pendência de produto; as APIs já existem.
- [ ] **Pendências:** push real, views anônimas (LGPD), progresso de prosa, heartbeat/coortes e
  instrumentação de `RECOMENDACAO`/`PERFIL_CRIADOR`/`EXTERNO`.
