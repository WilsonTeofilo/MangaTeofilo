- Identidade separada (21/10/2026): V17 adiciona `users.username` (único, imutável depois de escolhido, com
  backfill `user_<id>`), `users.sex`, `creator_follows` e `work_comments`. Login e 2FA aceitam e-mail **ou** username.
  Cadastro cria sempre leitor; virar escritor exige `POST /api/creators/apply` com pelo menos um vínculo social
  (allowlist de host + HTTPS obrigatório, sem `javascript:`/`data:`/credencial/porta).
  `GET /api/users/{username}/public-profile` respeita a privacidade (perfil privado devolve só o username). Seguidores só
  de escritor; comentários mostram o username e escondem o resto quando o perfil é privado. Front: header sem a divisão
  "modo criador/leitor" (menu do avatar), painel do criador em telas separadas (workspace, obras, capítulos, missões,
  analytics, monetização), tela "Minha conta" e onboarding pós-cadastro. Bug real do stack de alerta corrigido: anotação
  YAML com `:` não citado derrubava o Prometheus (`promtool` → 4 regras, alvo `up`); Prometheus e Alertmanager
  passaram para o profile `monitoring` do Compose. Suíte: **412 testes, 0 falhas, 0 erros**.

# ROADMAP DE FASES — MangaNetWorking

> **Documento único de execução.** Substitui as pastas `backend/tasks/`, `frontend/tasks/` e os relatórios por worker.
> Estado verificado em 20/10/2026, contra o working tree real. Onde não houve execução, está marcado **NÃO VERIFICADO**.

Legenda: ✅ pronto · 🟡 parcial · 🔴 bloqueado/pendente · ⏸️ fora do escopo atual

---

## 0. Visão em uma tela

| Fase | Entrega | Estado |
|---|---|---|
| **F0** | Infra Docker First (Postgres 16, Mongo 7, rede, volumes) | ✅ stack local validada |
| **F1** | Auth, 2FA por e-mail, Google OAuth, sessão, rate limit, força de senha e recuperação por link | 🟡 V12/V13/V14, Mailpit, concorrência/reenvio, throttle separado, origem e SMTP pós-commit validados; OTP Redis operacional; `ROLE_OWNER` introduzido sem concessão pelo cliente; faltam ID token Google real e DNS autenticado (#44, #46) |
| **F2** | Perfis de leitor e criador, avatar, biblioteca | ✅ privacidade server-side, links, bio, avatar integrado e cache privado verificados |
| **F3** | Obras, capítulos, storage e leitores de mangá/light novel | ✅ teste HTTP concorrente com imagem real; storage legado ainda contém referências órfãs |
| **F4** | Monetização, split 83/17 e 58/42, ledger, PIX | 🟡 checkout idempotente de doações/membros implementado; Sandbox e validação de ponta a ponta pendentes |
| **F5** | Frontend "Banca de Rua" e remoção de dados falsos | ✅ rotas públicas, reset, feed/catálogo/sobre/perfil e rotas autenticadas de criador/moderador inspecionadas; foco visível de 3 px e sem overflow horizontal (#40); captura pixel não produzida pela ferramenta nesta sessão |
| **F6** | LGPD e AppSec (consentimento, exclusão, maioridade, uploads) | 🟡 V11 invalida backfill inferido; reaceite, auditoria e hardening de auth/produção implementados; texto oficial da política ainda não fornecido/publicado |
| **F7** | QA, smoke E2E, CI e empacotamento de produção | ✅ build e smoke 12/12 locais; Compose de produção validado sem `.env`; CI remoto verde no PR #5 (run `39448285071`) |
| **F8** | Prontidão de produção (observabilidade, Redis, e-mail, backup) | 🟡 OTP/sessão/rate-limit observados em Redis real; backup/restore local executado com checksums; métricas/alertas, runbook, retenção/cifra, destino off-site e operação externa pendentes |

> **Nomenclatura:** F0–F8 é o mapa vigente. Menções a F9–F17 em itens históricos são a numeração legada de fases posteriores, preservada apenas como rastreabilidade; não são fases adicionais do estado atual.

---

## F0 — Infra Docker First

**Objetivo:** um comando sobe o ambiente inteiro e o backend conecta nos dois bancos.

**Estado real**
- Compose local usa `${POSTGRES_PASSWORD:-manga_dev_local_secure_2026}` e sobe Postgres, Mongo, Redis, Mailpit, backend e frontend; portas do host ficam limitadas a `127.0.0.1`.
- `docker compose up -d --build` construiu e iniciou a stack; os seis serviços (Postgres, Mongo, Redis, Mailpit, backend e frontend) ficaram `healthy`. O feed respondeu HTTP 200 diretamente e pelo proxy frontend.
- Em PostgreSQL 16/Mongo 7 descartáveis e isolados, o backend iniciou e Flyway aplicou as migrations com `success=true`. O volume local preexistente validou V1..V16; não foi apagado. A V13 foi corrigida para `VARCHAR(64)` antes da aplicação durável; a V14 acrescenta `users.is_owner`; o Hibernate `validate` subiu.
- `docker compose down` (sem `-v`) preservou volumes nomeados de Postgres, Mongo, Redis e uploads; a stack foi iniciada novamente.

**Aceite**
- [x] `${POSTGRES_PASSWORD:-...}` (ou `.env` obrigatório) no compose local.
- [x] `docker compose up -d` com Postgres e Mongo `healthy`.
- [x] Backend sobe aplicando V1..V16 em banco limpo e no volume local; `GET /api/feed` responde 200 e `validate` está verde.
- [x] `docker compose down` sem perda de volume.

---

## F1 — Auth, 2FA e e-mail

**Objetivo:** cadastro/login com senha e Google, 2FA obrigatório por e-mail, sessão em cookie e recuperação de senha.

**Estado real**
- Cadastro, login, `/auth/2fa/verify`, `/auth/me`, `/auth/logout` existem. Primeiro OTP `LOGIN` validado persiste `email_verified_at`; ID token Google só é aceito com claim `email_verified=true` e também pode confirmar contas legadas vinculadas.
- V12 adiciona a coluna de confirmação de e-mail; a migration está criada, mas ainda não pôde ser aplicada/verificada em PostgreSQL real nesta rodada porque Docker está inacessível.
- `TwoFactorAuthService` gera OTP de 6 dígitos, TTL 5 min, armazena apenas HMAC com chave `OTP_HMAC_SECRET`, vincula `LOGIN`/`STEP_UP_PIX` e invalida após uso único. Permite cinco falhas e bloqueia a 6ª tentativa. O cache segue em memória por instância.
- `MfaNotificationSender` possui adapter SMTP (`SmtpMfaNotificationSender`) e Mailpit no Compose local; envio, recebimento da mensagem e verificação do OTP foram exercitados ponta a ponta. A conta e a sessão Redis sintéticas foram removidas após o teste.
- `DevOutboxNotificationSender` agora só existe nos perfis `dev/test/local` e quando SMTP está desativado. `local` é o perfil padrão; Compose de produção exige SMTP configurado.
- Assunto do e-mail não contém o OTP; teste confirma que o código só aparece no corpo. SPF/DKIM/DMARC ainda dependem de domínio e provedor externos.
- `loginWithGoogle` valida o ID token no servidor, exige `GOOGLE_CLIENT_ID` e `email_verified`, e usa email/nome/avatar das claims; o DTO não aceita identidade declarada pelo cliente. Ainda não há teste com token Google válido real.
- `POST /api/auth/2fa/request` autenticado emite OTP `STEP_UP_PIX`; `/2fa/verify` consome apenas `LOGIN`, e troca de PIX consome apenas `STEP_UP_PIX`.
- Cooldown de 60 s e máximo de 3 emissões em 10 min por conta/IP estão implementados; Redis executa a aquisição atomicamente quando configurado. Desafios OTP usam adapter Redis atômico e compartilhado; a operação real foi observada na stack local (`mn:otp:issue`, `mn:password-reset:issue`, `mn:session`).
- Cadastro duplicado e solicitação de reset retornam resposta genérica; a versão da política vem de `PRIVACY_POLICY_VERSION` e o aceite é verificado/registrado no servidor.
- Limite de senha continua em 8–64 pontos de código Unicode, aceitando espaços, acentos, símbolos e emojis. Cadastro/reset mostram força Fraca/Média/Forte, critérios e botão acessível de mostrar/ocultar; somente Média/Forte passam pela regra do servidor. Login mantém validação de tamanho, sem o novo gate de força, para não bloquear credenciais legadas. A classificação é heurística e não substitui consulta a base completa de senhas vazadas. Novos hashes usam BCrypt sobre SHA-256/Base64; hashes BCrypt legados continuam válidos e são atualizados após login bem-sucedido.
- Jackson rejeita campos JSON desconhecidos globalmente; teste HTTP confirma que `twoFactorEnabled` e `role` são rejeitados antes de chegar ao serviço.
- Recuperação de senha usa link com token aleatório de 32 bytes; somente SHA-256 é persistido em `password_reset_tokens` (V13), com TTL configurável de 5–60 minutos (padrão 30), uso único e lock transacional. A origem `PUBLIC_FRONTEND_URL` precisa ser HTTPS (HTTP só em localhost), sem path/query; SMTP envia link. Sem SMTP, o adaptador local guarda link apenas nos perfis `dev/test/local`, disponível na Dev Outbox até expirar; endpoint não existe em produção. Resposta é genérica para conta existente/inexistente e falha de entrega não expõe detalhes. Um novo pedido rotaciona o token ativo; o throttle usa namespace `password-reset`; o SMTP roda após commit e falha de e-mail mantém o token válido. A redefinição aplica `PasswordPolicy`, mantém perfil/e-mail/2FA, invalida sessões e desafio OTP pendente e não autentica automaticamente. Rota SPA remove fragmento/token do endereço assim que capturado; meta referrer `no-referrer`.
- V12/V13 foram aplicadas em PostgreSQL real: V13 usa `token_hash VARCHAR(64)`, Hibernate `validate` subiu e o fluxo foi exercitado. Evidência de 20/10/2026: Mailpit E2E (pedido → link → nova senha → 2FA → `/me`), concorrência 204/401, rotação provada e suíte completa 322/0/0 com Docker.
- V14 (20/10/2026) adiciona `users.is_owner`, exposto apenas como `ROLE_OWNER` derivado no servidor. O proprietário herda as capacidades de moderação, mas `/api/owner/**` exige `ROLE_OWNER`; nenhum DTO de cadastro aceita `owner`/`role`. A conta administrativa real foi criada para o titular de `Wilsonteofilosouza@live.com` com senha forte fornecida por ele; a senha não foi registrada em código, log ou documento. O cadastro exigiu OTP de e-mail e as flags `is_owner=true`/`is_moderator=true` foram aplicadas no PostgreSQL. A sessão real retornou `isOwner=true` e `isModerator=true` em `/api/auth/me`; `/api/owner/ping` respondeu `404` (rota ainda ausente, mas autorizada), enquanto uma sessão não-proprietária recebeu `403`.
- Hardening desta rodada: login executa BCrypt também para e-mail inexistente/conta sem senha (reduz enumeração por tempo), `/auth/me` saiu do controller para um read model de serviço (inclui avatar e `isOwner`); o perfil `prod` recusa OTP HMAC padrão/curto e cookie sem `Secure`. O Compose exige `PUBLIC_FRONTEND_URL`, restringe CORS a essa origem por padrão e deriva a URL de retorno do Mercado Pago da mesma origem. `TRUST_FORWARDED_HEADERS` é configurável e habilitado atrás do Nginx, que acrescenta o IP real ao `X-Forwarded-For`.
- E-mail canonicalizado (20/10/2026): `com.manganetworking.util.EmailNormalizer` é a regra única (trim + minúsculas + aspas/chevrons removidos + validação RFC 5321) e está aplicado em cadastro, login, Google OAuth, 2FA, recuperação, OTP, Dev Outbox e webhook de bounce; o `@Email` do framework (que recusava `" pessoa@dominio.com "`) saiu dos DTOs e a resposta de endereço inválido agora é 400 no serviço. Prova: cadastro com `"  Leitor.Teste@Example.COM  "` gravou `leitor.teste@example.com` e disparou o OTP para o endereço canônico; login com caixa diferente encontrou a mesma conta; e-mail com espaço interno foi recusado com 400.
- SMTP real no ambiente local (20/10/2026): o Compose local fixava `MAIL_HOST: mailpit` e ignorava o `.env`, então **todo OTP ia só para o Mailpit**. Agora o Compose repassa `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_SMTP_AUTH`, `MAIL_SMTP_STARTTLS`, `MAIL_FROM` e `MAIL_FROM_NAME` do `.env`, mantendo o Mailpit como padrão quando as variáveis não existem. Prova real: container com `smtp.gmail.com:587`/auth/STARTTLS; e-mail de recuperação e **código 2FA** enviados com `outcome=sent` para o endereço do titular, com `0` mensagens no Mailpit no mesmo intervalo. Suíte: **333 testes, 0 falhas, 0 erros**.
- Cadastro com conta pendente reenvia o OTP (20/10/2026): conta que existe sem `email_verified_at` (cadastro que ficou pela metade porque o código não chegou) volta a receber o código pelo SMTP configurado, com a mesma resposta genérica. Conta já confirmada **não** recebe e-mail no cadastro — é login, e aceitar código ali permitiria entrar sem a senha. Prova real: `POST /api/auth/register` com `sopraimvuu1@live.com` → `mfa_email_delivery outcome=sent` em `smtp.gmail.com`.

**Aceite**
- [x] Entrega ponta a ponta ao Mailpit; adapter SMTP implementado e coberto por teste unitário; `DevOutbox` restrito a `dev/test/local`.
- [x] `From` com nome de exibição da marca.
- [ ] Domínio próprio autenticado (SPF/DKIM/DMARC), dependente de DNS/provedor.
- [x] Token Google verificado no servidor; e-mail/nome/avatar derivados das claims verificadas.
- [x] OTP armazenado como HMAC, vinculado a `purpose` (`LOGIN`, `STEP_UP_PIX`). Recuperação usa token de link distinto, não OTP.
- [x] `POST /api/auth/2fa/request` autenticado para emissão de step-up.
- [x] Step-up vinculado a `STEP_UP_PIX` e troca de PIX valida somente esse purpose.
- [x] Cooldown de 60 s e limite de 3 envios por 10 min por conta/IP implementados; Redis real observado na stack local.
- [x] Reenvio: 1 por 60 s, no máximo 3 por 10 min; cadastro/reset não revelam existência da conta.
- [x] Implementação do fluxo de recuperação por link: token com hash persistido, expiração e uso único, SMTP após commit, limite por conta/IP separado, senha oficial, revogação de sessões e OTP pendente; V13 aplicada.
- [x] Testes unitários de recuperação, endpoints MVC, adapter/composição SMTP e rejeição de TTL/origem insegura; suíte completa 322/0/0 com Docker.
- [x] Aplicar V12/V13 em PostgreSQL real, exercitar recuperação ponta a ponta no Mailpit e validar consumo concorrente do token: 204/401, rotação e suíte verdes.
- [x] Evidência de 20/10/2026: suíte backend completa **322 testes, 0 falhas, 0 erros, 0 ignorados**; build frontend já verde; container reconstruído para inspeção visual.
- [x] Posse do e-mail persistida após primeiro OTP de login válido; e-mail Google confirmado apenas pela claim verificada do ID token.
- [x] V12 aplicada e campo `email_verified_at` confirmado em Postgres real; V13 aplicada na sequência.
- [x] V14 aplicada em PostgreSQL real (`is_owner boolean NOT NULL DEFAULT false`); Hibernate `validate` verde; `SessionAuthenticationFilterTest` cobre `ROLE_OWNER` + `ROLE_MODERATOR`.
- [x] Criar a conta administrativa de `Wilsonteofilosouza@live.com` em 20/10/2026 após o titular fornecer senha que satisfaz a política; cadastro confirmado por OTP, flags aplicadas no PostgreSQL e sessão real com `isOwner=true`/`isModerator=true`. Nenhuma senha foi registrada em código, log ou documento.
- [x] Testes cobrem OTP expirado, reuso, 6ª tentativa, purpose trocado, token Google inválido e composição SMTP.
- [x] Payloads rejeitam campos não mapeados, incluindo tentativas de enviar papel ou estado de 2FA pelo cliente.
- [x] Senha 8–64 Unicode, confirmação no cadastro/reset e migração transparente de BCrypt legado; testes de política, Unicode e compatibilidade de hash.
- [x] Indicador Fraca/Média/Forte com critérios visíveis, senha fraca bloqueada no cadastro/reset no frontend e backend; olhos acessíveis para senha e confirmações. `PasswordPolicyTest`: 4/4; `AuthApplicationServiceTest`: 10/10, incluindo rejeição de cadastro fraco. Suíte completa em 20/10/2026: 322 testes, 0 falhas/erros. A força é heurística, não consulta serviço abrangente de senhas vazadas.

---

## F2 — Perfis de leitor e criador

**Objetivo:** leitor escolhe perfil público/privado; criador tem página pública com bio, redes e avatar; biblioteca de curtidas.

**Estado real**
- Entidades e endpoints de perfil/workspace existem; privacidade é persistida pelo frontend e bloqueada no serviço para visitante anônimo. Perfil público pode ser consultado sem sessão.
- URLs de Instagram/YouTube usam allow-list de hosts oficiais; portfólio aceita apenas HTTPS e rejeita credenciais/hosts locais.
- Bio remove tags HTML no backend. Serviços de perfil rejeitam avatar remoto e aceitam somente caminho JPEG normalizado gerado pelo endpoint.
- `POST /api/storage/avatar` exige sessão, decodifica a imagem no servidor, rejeita dimensões acima de 8192 px ou 16 MP, recorta/redimensiona para 512×512 e reencoda em JPEG, removendo metadados da imagem de origem.
- Exclusão LGPD anonimiza criador e arquiva obras (`archived_lgpd`).
- Upload de avatar integrado nas telas de leitor e criador; alterações só refletem após confirmação/persistência pelo backend. Respostas de perfil usam `Cache-Control: no-store`.
- O processador usa formatos decodificáveis pelo `ImageIO` (JPEG/PNG); WebP não está habilitado nesse fluxo.

**Aceite**
- [x] Perfil privado bloqueia terceiros no servidor (não só na UI).
- [x] URLs sociais validadas por allow-list de domínio e links externos limitados a HTTPS.
- [x] Avatar redimensionado/recodificado no servidor (não confiar no cliente); testes cobrem JPEG normalizado e imagem inválida.
- [x] Testes de ownership e de perfil privado.

---

## F3 — Obras, capítulos e leitor

**Objetivo:** metadados no Postgres, páginas no storage, progresso no Mongo, leitor vertical.

**Estado real**
- `chapter_files` (V4) e guard de acesso existem.
- Upload com MIME + magic bytes.
- `reading_progress` tem índice composto `userId + workId` e índices auxiliares.
- Detalhe público de obra publicada **mostra o capítulo programado** (com data e selo de acesso antecipado) para o leitor querer assinar e ler antes; a **leitura** continua bloqueada para quem não é membro. Obra `archived_lgpd` não aparece no detalhe e suas URLs antigas de página são bloqueadas pelo guard.
- Páginas são servidas por extensão MIME correta, `X-Content-Type-Options: nosniff` e conteúdo de capítulo sem cache público. GET de storage não consome o bucket de rate limit.
- Progresso não regride em requests fora de ordem e repetições da mesma página não incrementam o contador; índice composto único mantém um documento por `userId + workId`.
- Upload em lote limita 300 páginas; antes de persistir, o backend verifica dimensões (máximo 8192 px por lado e 16 MP) por metadata do decoder. Formatos sem leitor ImageIO configurado (incluindo WebP neste runtime) são rejeitados no lote.
- Migração V8 acrescenta `work_format` (`MANGA`/`LIGHT_NOVEL`) e `chapter_format` (`IMAGE_PAGES`/`PROSE`) sem alterar V1..V7. Capítulos em prosa existentes seguem legíveis como texto simples; a política de capítulo regular agora normaliza NFC, conta code points Unicode e valida 1.000–30.000 caracteres visíveis no backend em criação/edição. Front mostra contador, recomendação de 6.000–18.000 e aviso abaixo de 3.000. O limite de 2.000.000 caracteres brutos é apenas defesa de processamento, não tamanho editorial. **Formato de blocos versionado (v1) implementado**: `blocks_json` + `blocks_version` na entidade `ChapterEntity`, DTOs `ChapterBlockDto` (text/illustration/separator), política `ChapterBlocksPolicy` valida estrutura, total de caracteres (1.000–30.000), máximo 6 ilustrações intercaladas por capítulo; migração automática de `content_text` legado para blocos v1. **Tipos de capítulo**: `ChapterType` (REGULAR, PROLOGUE, SPECIAL) com validações específicas (prólogo = cap. 0 único, mínimo 300 chars; especial = mínimo 300 chars). **Editor de blocos** com toolbar, drag-and-drop, validação tempo real. **Leitor scroll-only** com barras de progresso e checkpoints 10% (10–100%). **Apresentação visual da obra**: `presentation_json` em `WorkEntity`. Ilustrações de abertura, volumes, CSV de analytics de retenção permanecem pendentes.
- **Fluxo de light novel separado do mangá (2026-10-23):** `LightNovelChapterWizard` substitui o wizard de 5 etapas apenas para `LIGHT_NOVEL`, em **Detalhes → Escrever → Revisar → Publicar**. Documento único de blocos com inserção por toolbar ou no ponto do texto, upload imediato da ilustração com `alt`, reordenação por arrastar e por teclado, limite `n/6`, autosave local com aviso de saída, prévia fiel, painel de erros e modo edição com banner. O mangá continua no `MangaChapterPublishWizard`, intocado. `ChapterReadResponseDto` passa a devolver `blocksJson` e `chapterType`; as ilustrações do capítulo são registradas em `chapter_files` (herdam o acesso antecipado em vez de vazar como arquivo público). O leitor de prosa ganhou configuração de leitura no header (fonte, tamanho, entrelinha, largura). **V23** cria as colunas (`chapters.chapter_type`, `blocks_json`, `blocks_version`, `works.presentation_json`) com constraints de formato: sem ela o `ddl-auto: validate` derrubava a aplicação e os testes de integração. Volumes, apresentação visual da obra, upload com validação de MIME real e `checkpoint` de retenção seguem pendentes.
- **Refatoração do Status de Obras para Enum de Domínio (WorkStatus) (2026-10-26):** `WorkStatus` (`DRAFT`, `ONGOING`, `COMPLETED`, `SUSPENDED`, `ARCHIVED_LGPD`) com métodos de domínio `isPublic()` e `isHidden()`, `@JsonCreator fromString` e `@JsonValue`. JPA Converter `WorkStatusConverter` (`autoApply = true`) tolerante a dados legados em lowercase (`ongoing`) e gravação canônica em uppercase (`ONGOING`). **V25** normaliza os registros existentes em PostgreSQL. Mapeadores do frontend em `apiMappers.ts` normalizados para case-insensitivity. Suíte: **433 testes, 0 falhas, 0 erros**.
- `ChapterFileAccessIntegrationTest` criou um capítulo publicado em PostgreSQL efêmero, gravou um JPEG real do projeto (`shito.jpg`, 1.060.446 bytes) no storage e serviu 100 GETs HTTP com concorrência 10: 100×200, MIME `image/jpeg`, bytes idênticos; medição final: duração total 723 ms, p50 46 ms, p95 190 ms, máximo 191 ms. O volume legado ainda contém referências órfãs; esse problema de dados não invalida a medição controlada.

**Aceite**
- [x] Status de obras gerenciado por enum tipado `WorkStatus` no domínio, converter JPA e migração V25, eliminando strings literais e comparações manuais.
- [x] Capítulo publicado aparece para todos; capítulo **programado** aparece na ficha (marcado como antecipado para membros) e só é lido por membro, autor ou moderação — `publicReleaseAt` nunca vaza o conteúdo para quem não é membro.
- [x] Páginas servidas com `Content-Type` correto, `nosniff` e sem cache compartilhado para páginas de capítulo.
- [x] Progresso idempotente por `userId + workId`.
- [x] Leitor não toma 429 ao virar capítulo (GET de storage fora do bucket; coberto por teste do filtro).
- [x] Quantidade máxima e dimensões de páginas validadas no servidor, com teste de regressão.
- [x] Teste HTTP concorrente com página real: 100/100 GETs retornaram 200, concorrência 10, bytes idênticos, p95 190 ms. Tentativa anterior contra referências órfãs do storage retornou 404; foi substituída pela integração controlada com arquivo real, sem alterar os dados órfãos.
- [x] Modelo de light novel/capítulos em prosa e leitura dedicada; preserva o fluxo de páginas de mangá (`WorkApplicationServiceTest`, 13 testes verdes).

---

## F4 — Monetização e financeiro

**Objetivo:** doações/membros 83/17, anúncios 58/42, VIP, ledger idempotente e PIX com step-up.

**Estado real**
- **Decomposição Modular de MercadoPagoService (2026-10-26):** Decomposta a classe monolítica em três especialistas desacoplados: `MercadoPagoWebhookValidator` (HMAC-SHA256, timing attack mitigation, janela de 15m), `MercadoPagoCheckoutService` (preferências Checkout Pro, persistência e locks) e `MercadoPagoPaymentProcessor` (processamento idempotente e conciliação). `MercadoPagoService` atua como fachada (Facade) enxuta mantendo 100% de compatibilidade.
- Split com `BigDecimal` e constantes de plataforma.
- Checkout VIP cria preferência persistida e só ativa após webhook assinado, aprovado, em BRL, com valor e referência conferidos; o ledger tem a chave única de idempotência.
- Os endpoints legados de VIP, doação e membro retornam `410 Gone`: não há crédito nem acesso antecipado sem checkout confirmado.
- V6 registra preferências de checkout. V7 adiciona auditoria PIX append-only; V8–V10 foram aplicadas ao Postgres local com `success=true` na stack reconstruída nesta rodada.
- Homologação Sandbox permanece pendente de credenciais de teste e URL pública de webhook.
- `updatePixKey` valida OTP vinculado a `STEP_UP_PIX`; existe endpoint autenticado para solicitar código. A troca grava tipo, ator, IP e sufixos mascarados na auditoria V7; trigger append-only bloqueia UPDATE/DELETE (integração PostgreSQL comprovada).
- `claimMissionReward` bloqueia avanço ao nível de monetização 2 quando não há data de nascimento ou quando a idade é menor que 18; há testes para ambos os casos. CPF novo pode ficar pendente sem sentinela; CPF inválido é rejeitado e checkout de apoio bloqueia criador sem identidade fiscal válida.
- Cadastro de criador valida CPF informado e armazena `null` quando ausente; V10 permite identidade fiscal pendente sem fabricar CPF. Checkout de apoio recusa criador sem CPF válido.
- V9 adiciona intents de checkout com chave única por pagador/produto, reutilização idempotente e vínculo de preferência; webhook valida referência, valor/moeda e registra o pagamento antes do ledger. A UI não calcula split, não ativa benefício antes da confirmação e não exibe saldo financeiro fictício fora de workspace carregado. Teste de regressão valida que retry reutiliza a preferência persistida; homologação Sandbox segue pendente.

**Aceite**
- [x] PIX só altera com OTP `STEP_UP_PIX` e registra evento append-only mascarado; migration e bloqueio de UPDATE/DELETE testados em PostgreSQL real.
- [x] Maioridade 18+ não opcional no avanço para nível 2; data ausente e menoridade bloqueadas por teste.
- [x] CPF ausente não é substituído por sentinela no cadastro; validação de dígitos verificadores e bloqueio do checkout de apoio sem CPF válido.
- [x] Webhook VIP idempotente por `payment_external_id` e assinatura HMAC.
- [x] Checkout idempotente para doações e Clube de Membros (V9; teste garante retry sem criar nova preferência). Homologação Sandbox pendente.
- [x] Split de doação e arredondamento `HALF_UP` cobertos por teste; R$ 0,05 divide em R$ 0,01 de taxa + R$ 0,04 líquido.
- [x] Nenhum saldo fictício na UI; valores financeiros dependem de workspace retornado pelo servidor, sem divisão de split no cliente.

---

## F5 — Frontend "Banca de Rua"

**Objetivo:** identidade visual consistente, sem dados fabricados e com estados de tela reais.

**Estado real**
- Tokens `--mn-*` aplicados nos componentes base.
- `SobrePage` agora apresenta a origem do projeto, o criador e Kokuin com texto revisado; usa apenas as duas fotos locais reaproveitadas do MangaTeofilo, com revelação circular por hover/toque, foco de teclado, respeito a movimento reduzido e layout responsivo.
- A página apresenta mangá e light novel como direção do produto, sem afirmar que a leitura em prosa já existe. O produto segue digital: sem loja, venda de obras/produtos físicos ou logística.
- 401 de `/auth/me` limpa identidade e deixa sessão deslogada; falhas de exportação/exclusão LGPD não simulam arquivo baixado nem exclusão local.
- Fixtures restantes de catálogo, leitor e workspace estão condicionadas a `import.meta.env.DEV`; não são publicadas como dados de produção. Showcase usa dados estáticos somente na rota interna de design.
- A página de perfil não inventa preço ou vencimento VIP: preço aparece no checkout; validade só aparece quando fornecida pelo backend.
- Build de produção executado: TypeScript + Vite, 1649 módulos, saída gerada com sucesso. Contraste dos tokens: paper/ink 17.15:1, mute/ink 8.00:1, yellow/ink 13.74:1, green/ink 11.03:1; `mute-paper`/paper 6.80:1. O token `--mn-mute` é remapeado para `--mn-mute-paper` em contextos `.mn-on-paper`/`.mn-on-yellow`; controles e seção amarela usam foco preto de alto contraste. As ocorrências atuais de mute permanecem em superfícies escuras.
- QA autenticado de 20/10/2026: mesa de moderação (2 denúncias reais) e workspace do criador foram abertos com sessões reais e OTP do Mailpit. O Tab real percorreu a moderação com outline de 3 px; no workspace, todos os focáveis visíveis apresentaram outline de 3 px. Nenhuma rota apresentou overflow horizontal (viewport 863 px; `scrollWidth == clientWidth`). Três campos do workspace (gênero, sinopse e biografia) receberam `htmlFor`/`id`; a captura pixel não pôde ser produzida porque a ferramenta reportou aba não visível.
- `XpBar.tsx` órfão.

**Aceite**
- [x] Sobre nós refeito com narrativa própria e somente as duas fotos/transição da página antiga.
- [x] Responsivo e acessível por teclado; transição respeita preferência por movimento reduzido.
- [x] Nenhum dado financeiro/identidade mock em rota de produção; valores de demo ficam condicionados a `import.meta.env.DEV`.
- [x] 401 leva a estado deslogado e nenhum arquivo/exclusão LGPD é simulado localmente.
- [x] Fixtures de demonstração nas telas de catálogo, perfil, leitor e workspace isoladas por `import.meta.env.DEV`.
- [x] `npm run build` verde; contraste dos tokens principais auditado.
- [x] Corrigir contraste contextual de `--mn-mute` em papel/amarelo e foco de controles em amarelo.
- [x] Concluir passe de teclado e layout em todas as rotas, incluindo criador/moderador (#40); captura pixel não produzida nesta sessão.

---

## F6 — LGPD e AppSec

**Objetivo:** consentimento, exclusão, maioridade, minimização e uploads seguros.

**Estado real**
- V5 criou `terms_accepted_at`, `privacy_policy_version`, `birth_date` e índice.
- Cadastro exige aceite da versão configurada; sessões antigas recebem 428 até reaceite, com tela de confirmação e endpoint autenticado.
- V11 substitui o backfill inferido da V5: limpa somente o padrão `terms_accepted_at = created_at` + versão `v1.0`, mantendo V5 imutável e exigindo aceite real na próxima interação.
- Eventos de consentimento e solicitações de exportação/exclusão são append-only; exportação inclui perfil, aniversário/visibilidade, consentimentos, favoritos, leitura e histórico financeiro.
- Exclusão revoga sessões, exige verificação da remoção física dos avatares, anonimiza usuário/criador, limpa mensagem livre de doação, arquiva obras e expurga progresso/eventos de engajamento do Mongo; ledger fica preservado.
- Magic bytes implementados para JPEG/PNG/WebP.
- Cookie `SameSite=Lax` + `Secure` configurável; filtros sem registro duplo.
- V10 remove a obrigatoriedade fiscal para criador em onboarding, sem CPF sentinela; foi aplicada no Postgres da stack e validada com `success=true`.
- **Gaps:** falta publicar/fornecer o texto oficial aprovado da Política de Privacidade (o endpoint divulga a versão, não o documento); ainda precisa de saneamento controlado de CPF sentinela legado. O achado histórico de OTP em texto puro foi corrigido em 2026-10-19 (ver F1 e auditoria).
- **Hardening de 20/10/2026:** o controller de auth não acessa mais `UserRepository`; `/auth/me` usa read model do serviço e devolve avatar/`isOwner`. Login desconhecido/sem senha executa BCrypt com hash descartável para reduzir enumeração por tempo. O perfil `prod` recusa OTP HMAC padrão, segredo com menos de 32 caracteres e cookie sem `Secure`. `TRUST_FORWARDED_HEADERS` é configurável; produção o habilita atrás do Nginx, que acrescenta o IP real ao `X-Forwarded-For`. A exclusão LGPD agora limpa privilégios (`is_owner`, `is_moderator`, `is_creator`, VIP), verificação de e-mail e nascimento; o feed e o recálculo agendado excluem `suspended` e `archived_lgpd`. Revisão não encontrou segredo de produção hardcoded; chaves de dev continuam com guardas de boot.

**Aceite**
- [x] Política versionada e reaceite server-side ao mudar versão (bloqueio 428); publicar o texto oficial segue pendente.
- [x] Backfill de V5 substituído por reaceite na V11; V5 não foi alterada.
- [x] Maioridade bloqueia monetização com `birthDate` nulo ou idade inferior a 18 no avanço para o nível 2.
- [x] CPF ausente não é substituído por valor fake; onboarding de apoio exige CPF válido.
- [x] Portabilidade (`GET /api/users/me/export`) e exclusão auditadas em eventos append-only; smoke validou exportação, exclusão e 401 após revogação.
- [x] Checklist técnico do `D:\Projetos\Generico\GUIA-LGPD-E-PRIVACIDADE.md` aplicado ao consentimento, DTOs, sessão, mídia, ledger e maioridade; publicar política aprovada ainda depende do titular do produto.

---

## F7 — QA, E2E e CI

**Objetivo:** provar o fluxo completo em stack real.

**Estado real**
- Última suíte em 20/10/2026: **322 testes, 0 falhas/erros, 0 ignorados**; Docker/Testcontainers disponíveis.
- Testes de integração reais verdes nesta rodada: V13/V14 aplicadas, recuperação concorrente, rotação de token, `ROLE_OWNER` e contexto Hibernate `validate`.
- Smoke E2E executado em stack real: 12/12 etapas passaram. Também exercitou consentimento, sessão Redis, step-up PIX, upload, obra/capítulo, rota financeira 410, exportação e exclusão. O script consulta o Dev Outbox quando o mail está desabilitado e, no stack atual com Mailpit, faz fallback para a API do Mailpit. **O smoke nunca dispara e-mail real:** se o backend estiver com SMTP de verdade, o próprio script troca para o Dev Outbox (`PLATFORM_MAIL_ENABLED=false`) e devolve o modo original no fim (também em caso de erro inesperado).
- Workflow em `.github/workflows/ci.yml` mantém gatilho `pull_request` e executa smoke em stack Docker. A execução `39364042018` (PR #4) falhou por tipo V13; após a correção e o ajuste da senha do smoke, o run `39448285071` do PR #5 ficou **verde nos quatro jobs**: backend, frontend, Docker e Smoke 12/12.

**Aceite**
- [x] `mvn -o test` verde em 20/10/2026: 322 testes, 0 falhas/erros, 0 ignorados (Docker disponível).
- [x] Stack saudável e migrations V1..V16 verificadas em PostgreSQL real; V13 e V14 aplicadas nesta rodada.
- [x] Smoke 12/12 com evidência local.
- [x] `npm run build` verde em 20/10/2026: 1649 módulos, TypeScript + Vite.
- [x] CI rodando em PR: run `39448285071` (PR #5) verde em backend, frontend, Docker e smoke 12/12. Sem merge automático.

---

## F8 — Prontidão de produção

**Estado real**
- Os adapters Redis para sessão, rate limit e desafios OTP existem; Compose local e de produção selecionam Redis. O profile `prod` falha no boot se algum deles estiver como `inmemory`; o `ProductionSecretsGuard` também recusa OTP HMAC padrão e cookie sem `Secure`.
- `TRUST_FORWARDED_HEADERS` agora é configurável por ambiente. O Compose de produção o habilita porque o backend só recebe tráfego do Nginx, que acrescenta o IP real ao `X-Forwarded-For`; o filtro usa o hop mais à direita e valida o literal de IP.
- Compose de produção exige autenticação Mongo e senha Redis; o backend recebe URI Mongo autenticada e senha Redis por ambiente.
- A suíte/smoke anterior comprovou sessão Redis no fluxo real; nesta rodada o Redis real foi observado com chaves `mn:session`, `mn:otp:issue` e `mn:password-reset:issue`. O boot do profile `prod` entre réplicas e failover ainda não foram executados. Fora do Compose, o default permanece `inmemory` para dev/test.
- Logs estruturados, contadores Micrometer de OTP/e-mail e regras Prometheus foram adicionados. Nesta rodada o stack de observabilidade foi subido de verdade (Prometheus + Alertmanager oficiais), as regras foram carregadas (`promtool check rules`: 2 regras), o canal de plantão foi validado (`amtool check-config`) e um alerta sintético chegou ao e-mail do canal.
- O backend só podia ser raspado por cookie de sessão; agora há token dedicado de coleta (`METRICS_SCRAPE_TOKEN`, `Authorization: Bearer`), exigido em `prod` pelo `ProductionMetricsScrapeTokenGuard`. Prova local: `/actuator/prometheus` devolve `401` sem token e `200` com token; alvo do Prometheus `up`.
- Script de backup com checksums e restore-check isolado foi executado nesta rodada: backup de Postgres, Mongo e storage, manifest com SHA-256 e restauração em banco Mongo/Postgres isolado. O script foi corrigido para Windows PowerShell 5.1 (sem `[IO.Path]::GetRelativePath`). Nesta rodada o backup passou a ser **cifrado em repouso** (AES-256-CBC + HMAC-SHA256), com cópia off-site conferida por SHA-256 e retenção por janela com log; o destino off-site real e o KMS continuam pendentes de decisão externa.
- Bounce/complaint de e-mail deixou de depender de integração manual: `POST /api/webhooks/email/delivery-events` grava o evento em `email_delivery_events` (append-only, e-mail só como SHA-256) e suprime novos envios de OTP/recuperação para o endereço. O guard de produção exige `EMAIL_WEBHOOK_SECRET`.

**Aceite**
- [x] Store distribuído de desafios OTP, TTL, purpose, uso único e verificação atômica; profile `prod` exige Redis para sessão, rate limit e OTP.
- [x] Teste Testcontainers cobre purpose, expiração, cinco tentativas e consumo concorrente único; nesta rodada os testes de integração rodaram com Docker real.
- [x] Prova operacional atual com Redis real: OTP, sessão e throttle observados; `prod` não aceita `inmemory`. Falta boot entre réplicas/failover.
- [x] Logs estruturados seguros, contadores Micrometer de OTP/e-mail e regras Prometheus versionadas.
- [x] Alertas ativos no ambiente local: regras carregadas no Prometheus, `amtool check-config` aprovado e alerta sintético entregue no canal de plantão (e-mail recebido). Falta o canal institucional real e a aprovação de quem é o plantão.
- [x] Script de backup e restore-check de Postgres, Mongo e storage com manifest/checksums e alvos de restore isolados; execução real 0 falhas, 17 usuários e V13 restaurados.
- [x] Cifra em repouso e cópia off-site com conferência de hash e retenção com log, executadas de verdade no ambiente local; resta o destino off-site real, o KMS e a aprovação de prazos.
- [x] Monitoramento de bounce implementado no servidor: webhook autenticado, registro append-only sem e-mail em claro e supressão automática de envios; o guard de produção exige `EMAIL_WEBHOOK_SECRET`. Falta o provedor real e o domínio autenticado (SPF/DKIM/DMARC).
- [ ] Encarregado/DPO, inventário completo de operações e prazos de retenção exigem definição/aprovação organizacional/legal; o modelo de inventário com as pendências marcadas está em `docs/ops/INVENTARIO-DADOS.md` e a auditoria de exportação/exclusão já existe.
- [x] Runbook de incidente e rotação de chaves documentado; exercício operacional automatizado (`ops/incident/incident-drill.ps1`) executado na stack local com registro em `ops/incident/drill-records/`; falta a validação do operador e a execução em produção.

**Próximo passo F8:** executar boot `prod` entre réplicas e failover Redis; fechar DNS/provedor SMTP, nomeação do encarregado e aprovação de retenção; repetir backup/restore, canal de plantão e exercício de incidente no host provisionado. O backup/restore local já foi executado com checksums, cifra, cópia off-site e retenção.

#### 13.2a — Entregabilidade em domínio de produção (bloqueada por DNS/provedor)

**Preparação local concluída:** adapter SMTP, remetente configurável por variáveis, envio de links de recuperação sem segredo no assunto, origem pública HTTPS obrigatória no Compose de produção (`PUBLIC_FRONTEND_URL`) e TTL de token configurável (`PASSWORD_RESET_TOKEN_TTL`, padrão `PT30M`, permitido entre 5 e 60 minutos). Nesta rodada o **mecanismo de publicação** da Política de Privacidade também ficou pronto: `GET /api/legal/privacy-policy` publica o texto oficial aprovado (com versão, vigência, aprovador, referência da aprovação e SHA-256) e responde `404 POLICY_NOT_PUBLISHED` enquanto o documento não estiver aprovado; a instalação é feita por `ops/legal/publish-privacy-policy.ps1`, que valida o front matter, recusa material sensível e registra a publicação em log append-only. O **saneamento controlado de CPF sentinela legado** também foi implementado e executado: `GET/POST /api/owner/privacy/legacy-personal-data` (`ROLE_OWNER`, dry-run por padrão) detectou 16 registros e removeu os 16 CPFs inválidos de quem ainda não monetiza, com auditoria append-only em `privacy_governance_actions` (V15). O monitoramento de bounce passou a ser nativo do servidor (webhook autenticado + supressão de envios, V16).

O que **continua bloqueado por decisão/credencial externa** (e não por código): o texto oficial aprovado da Política de Privacidade (aprovação jurídica), a nomeação e publicação do encarregado/DPO, os prazos de retenção aprovados, o destino off-site real e o KMS da chave de backup, o domínio autenticado (SPF/DKIM/DMARC) e o provedor de e-mail, e o canal institucional de plantão com os endereços reais.

#### 14.1 — Provisionamento de VM Ampere A1 (ARM64 / Ubuntu 22.04) — não iniciado

**Pendências externas:** acesso à conta Oracle Cloud, região/shape elegíveis e disponíveis, chave pública SSH autorizada e confirmação do IP/regras de rede. Nenhuma VM ou regra de firewall foi criada. **Ao provisionar**, expor somente SSH (22) e HTTP/HTTPS (80/443 conforme proxy TLS); manter Postgres, Mongo e Redis sem portas públicas. HTTPS deve ser definido antes de receber credenciais ou sessões reais.

#### 14.3 — Deploy e validação operacional em Oracle — não executados

Depois de provisionar: instalar Docker/Compose, criar `.env` fora do Git com chaves definitivas, executar a stack, validar healthchecks, migrações Flyway V1–V16 e smoke test. **Não** gerar nem armazenar aqui a chave AES de produção. Sem acesso autorizado à conta e ao host, **nenhum serviço foi implantado**, nenhuma migration foi aplicada em banco Oracle e nenhum backup/restore de produção foi testado. Nenhuma compra real ou ativação financeira de produção foi executada. O `.env` de produção conterá, no mínimo, as chaves já fail-fast guardadas pelo `ProductionSecretsGuard`: `OTP_HMAC_SECRET` (≥32 bytes, distinto do dev), `AES_SECRET_KEY` (256 bits), `COOKIE_SECURE=true`, `MAIL_*`, `PUBLIC_FRONTEND_URL` (HTTPS) e `SPRING_DATA_MONGODB_URI` com `authSource=admin`.

## Próximas ações calculadas

> **Ordem vigente em 20/10/2026:** Bloco A → Bloco B → Bloco C. O Bloco D (documentação) pode ocorrer em paralelo. A fila única abaixo é a fonte de escopo e aceite; os itens 1–31 registram o que já foi feito, e 32–57 detalham o fechamento.

### Bloco A — fechar o desenvolvimento local
| # | Fase | Entrega |
|---|---|---|
| 32 | F7 | ✅ CI de produção com `MAIL_*` fictícios; Compose validado sem `.env` localmente |
| 33 | F1/F0 | ✅ V12/V13 aplicadas em PostgreSQL real; `token_hash VARCHAR(64)` e `validate` verdes |
| 34 | F1 | ✅ Recuperação E2E no Mailpit; expirado/malformado/reutilizado cobertos por teste |
| 35 | F1 | ✅ Consumo concorrente do token: 204/401, apenas um vencedor |
| 36 | F1 | ✅ Reenvio com token ativo: rotação e invalidação do link anterior |
| 37 | F1/F8 | ✅ Throttle `password-reset` separado do OTP de login |
| 38 | F1 | ✅ `PUBLIC_FRONTEND_URL` sem path/query e link na rota real do SPA |
| 39 | F1 | ✅ Envio SMTP após commit; falha de e-mail não reverte o token |
| 40 | F5 | 🟡 Rotas públicas/reset e feed/catálogo/sobre/perfil autenticados; Tab real com foco visível; criador/moderador pendentes |
| 41 | F8 | 🟡 OTP/sessão/rate-limit reais observados no Redis; boot `prod` ainda não executado |
| 42 | F8 | 🟡 Backup/restore local executado com SHA-256 e bancos isolados; **cifra, cópia off-site e retenção com log verificados nesta rodada**; falta destino off-site real, KMS e prazos aprovados |
| 43 | F7 | ✅ Execução remota verde no PR #5: run `39448285071`, quatro jobs aprovados |
| 44 | F1 | 🔴 ID token Google válido em homologação pendente |

### Bloco B — segurança e governança
| # | Fase | Entrega |
|---|---|---|
| 45 | F8 | 🟡 Alertmanager e canal de plantão ativos **no ambiente local** (regras carregadas, `amtool` aprovado, alerta sintético entregue no e-mail); falta canal institucional e nomeação do plantão |
| 46 | F1/F8 | 🟡 Monitoramento de bounce implementado no servidor (webhook autenticado, supressão de envios, V16); falta provedor, domínio e SPF/DKIM/DMARC |
| 47 | F6/F8 | 🟡 Modelo de inventário e de encarregado pronto (`docs/ops/INVENTARIO-DADOS.md`); falta nomeação, publicação e aprovação de prazos |
| 48 | F6 | 🟡 Mecanismo de publicação da política e saneamento de CPF sentinela implementados e executados; falta o texto oficial aprovado |
| 49 | F8 | Exercício de incidente e rotação de chaves |
| 57 | F1/F6 | ✅ V14/`ROLE_OWNER` e hardening de auth/produção aplicados; conta DONO criada e verificada com sessão real (`isOwner=true`), sem registrar a senha |

### Bloco C — configuração externa
| # | Fase | Entrega |
|---|---|---|
| 50 | F4/13.4 | Mercado Pago Sandbox: credenciais, webhook HTTPS e pagamento de teste |
| 51 | F14/14.1 | Conta Oracle, VM Ampere, SSH e firewall |
| 52 | F14/14.3 | Deploy Oracle, `.env`, AES, V1–V16, healthchecks e smoke |
| 53 | F15 | Pages Function, `BACKEND_API_URL` e E2E front↔back |
| 54 | F16 | Chaves de produção do Mercado Pago, só após homologação |
| 55 | F17 | Analytics do criador e motor de Seasons |

### Bloco D — documentação
| # | Fase | Entrega |
|---|---|---|
| 56 | — | ✅ V1..V16, ADR-003/006, `README_SECRETS`, contagens atuais (322/0/0), nomenclatura F9–F17 legada, `ROLE_OWNER` e `SameSite=Lax` alinhados |

---

## Fila única (ordem de execução)

> Os itens **32–57** são a ordem vigente (Blocos A–D). Os itens **1–31** ficam como registro do que já foi entregue; **29–31** estão detalhados em #40 e #41–#43.

| # | Item | Fase | Escopo de código | Critério |
|---|---|---|---|---|
| 1 | Corrigir interpolação e completar compose local | F0 | `docker-compose.yml` | ✅ 6 serviços; portas locais; imagens construídas |
| 2 | Subir stack e validar migrações | F0 | - | ✅ Feed 200; V1..V16 no volume local e em Postgres limpo; volumes preservados |
| 3 | Verificar token Google no servidor | F1 | `AuthApplicationService`, `GoogleLoginRequestDto`, config | ✅ claims verificadas; token inválido rejeitado; teste direcionado verde |
| 4 | Homologar SMTP real + Mailpit | F1 | `SmtpMfaNotificationSender`, `application.yml`, compose | 🟡 Mailpit E2E do OTP confirmado; falta DNS autenticado (#46) |
| 5 | Endpoint de step-up OTP com purpose | F1/F4 | `AuthController`, `AuthApplicationService`, `TwoFactorAuthService` | ✅ `/2fa/request` autenticado; PIX aceita apenas código `STEP_UP_PIX` |
| 6 | OTP como HMAC + purpose | F1 | `TwoFactorAuthService` | ✅ HMAC constant-time; reuso e troca de purpose falham; chave de produção obrigatória |
| 7 | Maioridade obrigatória | F4/F6 | `CreatorApplicationService` + testes | ✅ data ausente e menoridade bloqueadas antes do nível 2 |
| 8 | CPF real no onboarding | F6 | `AuthApplicationService`, DTO | Sem CPF fake |
| 9 | Consentimento versionado e eventos auditáveis | F6 | V11, Auth, perfil e política | ✅ reaceite server-side; texto oficial da política pendente (#48) |
| 10 | Checkout para doações e membros | F4 | gateway, controllers, ledger, frontend | Sem crédito/acesso antes de webhook confirmado |
| 11 | Homologar Checkout VIP Sandbox | F4 | `.env`, túnel e webhook | Pagamento Sandbox ativa uma única vez (#50) |
| 12 | Remover mocks de produção | F5 | `CreatorWorkspacePage`, `AuthContext`, `App.tsx`, `BibliotecaPage` | Nenhum `MOCK_*` fora de DEV |
| 13 | Testes de integração + smoke | F7 | `smoke_test_e2e.ps1`, CI | 12/12 |
| 14 | Redis para sessão/rate limit | F8 | `SessionStore`, `RateLimitStore` | `SCAN`, Redis no compose local |
| 15 | Analytics do criador | F9 | `CreatorAnalyticsApplicationService`, `CreatorAnalyticsController`, `EngagementEventMongoRepository` | Série real por dia + retenção + líquido; 401 sem sessão |
| 16 | Season de 60 dias + boost | F9 | `SeasonService`, `SeasonRotationService`, `SecurityConfig` | Janela determinística; job diário idempotente; 401 sem sessão |
| 17 | Expor perfil público de leitor com privacidade server-side | F2 | `UserProfileController`, `SecurityConfig`, `UserProfileApplicationService` | ✅ visitante consulta perfil público; perfil privado nega terceiros |
| 18 | Validar links públicos de criador | F2 | `CreatorApplicationService`, `CreatorProfileUrlPolicy` | ✅ domínios sociais aprovados; HTTP/hosts falsos rejeitados |
| 19 | Redimensionar e recodificar avatar no servidor | F2 | storage/avatar pipeline | ✅ endpoint autenticado; limite/dimensões impostos; JPEG 512×512 e imagem inválida cobertos por teste |
| 20 | Vincular OTP ao purpose e armazenar HMAC | F1/F4 | MFA, Auth, PIX | ✅ consolidado com itens 5 e 6; login e step-up separados; chave de produção via `OTP_HMAC_SECRET`; 6ª tentativa bloqueada |
| 21 | Reenvio OTP com cooldown e limite por conta/IP | F1 | Auth/MFA e rate limit | ✅ código e testes locais; teste Redis real pendente (#41) |
| 22 | Listar capítulo programado na ficha e bloquear a leitura antecipada | F3 | `WorkApplicationService`, `ChapterFileAccessGuard` | ✅ futuro aparece marcado (antecipado para membros) e continua bloqueado para não-membro; arquivamento LGPD bloqueia detalhe e URL antiga |
| 23 | Limites de quantidade e dimensão das páginas + teste de carga | F3 | upload/leitor | ✅ 100 GETs com página real: 100×200, concorrência 10, p95 190 ms |
| 24 | Auditoria append-only da troca de PIX | F4 | V7, `CreatorApplicationService`, `CreatorController` | ✅ gravação mascarada e trigger de imutabilidade testados em PostgreSQL real |
| 25 | Sobre nós com história da plataforma e do criador | F5 | `SobrePage` e fotos locais | ✅ copy sem promessas de recursos ainda inexistentes; build frontend verde |
| 26 | Suporte a light novels em prosa | F3 | `WorkEntity`, capítulos, API e leitor | ✅ V8 separa `PROSE`/`IMAGE_PAGES`; testes preservam fluxo de mangá |
| 27 | Rejeitar campos JSON desconhecidos em DTOs | F1 | `application.yml`, `AuthControllerTest` | ✅ `twoFactorEnabled` e `role` extras retornam 400; serviço não é invocado |
| 28 | Medidor de força, visibilidade de senha e bloqueio de senhas fracas | F1/F5 | `PasswordInput`, `LoginPage`, `PasswordPolicy` | ✅ build verde; policy 4/4 e AuthApplicationServiceTest 10/10; suíte completa 300 sem falhas/erros (Docker disponível) |
| 29 | Fechar passe visual/teclado em todas as rotas | F5 | rotas/telas frontend | ✅ públicas/reset e feed/catálogo/sobre/perfil, mais criador/moderador; Tab/outline de 3 px e layout sem overflow; captura pixel não produzida; detalhado em #40 |
| 30 | Obter execução real do CI em PR | F7 | GitHub Actions/PR | ✅ PR #5/run `39448285071` verde nos quatro jobs; detalhado em #43 |
| 31 | Operar Redis OTP e backup/restore isolado | F8 | Testcontainers/Compose/scripts ops | 🟡 Redis real e restore local comprovados; boot `prod`/failover e retenção/cifra pendentes; detalhado em #41–#42 |
| 32 | Fornecer `MAIL_*` fictícios no job `docker-validation` | F7 | `.github/workflows/ci.yml` | ✅ Compose de produção valida sem `.env`; `docker compose config --quiet` local = 0 |
| 33 | Aplicar V12/V13 em PostgreSQL real e resolver `CHAR(64)` | F1/F0 | V13, `PasswordResetTokenEntity`, schema | ✅ Flyway aplicou V13; `character varying(64)`; Hibernate `validate` subiu |
| 34 | Recuperação E2E no Mailpit | F1 | `PasswordResetApplicationService`, Mailpit | ✅ pedido→link→nova senha→2FA→`/me`; expirado/malformado/reuso cobertos |
| 35 | Consumo concorrente do token | F1 | repositório/serviço de reset | ✅ duas confirmações concorrentes: 204 e 401; token removido |
| 36 | Reenvio com token ativo | F1 | serviço/controller de reset | ✅ rotação: hash anterior ausente, hash novo presente |
| 37 | Namespace próprio de throttle | F1/F8 | `OtpIssuanceLimiter` | ✅ `password-reset` não consome cota de OTP; teste de isolamento |
| 38 | Validar origem pública | F1 | config/`PasswordResetApplicationService` | ✅ rejeita path/query; link real do Mailpit aponta para `/reset-password#token=` |
| 39 | Enviar SMTP após commit | F1 | serviço de reset/notificação | ✅ envio via `afterCommit`; falha SMTP mantém token e resposta genérica |
| 40 | Passe visual/teclado F5 | F5 | rotas/telas frontend | ✅ públicas/reset e feed/catálogo/sobre/perfil; moderação e workspace do criador autenticados; outline 3 px; labels corrigidos no workspace; captura pixel não produzida |
| 41 | Prova operacional Redis | F8 | stores Redis, Compose | 🟡 OTP/sessão/rate-limit reais observados; boot `prod` e TTL/failover pendentes |
| 42 | Backup/restore real | F8 | `ops/backup-restore.ps1` | 🟡 backup, checksums e restore isolado executados; **cifra, cópia off-site e retenção com log verificados**; falta destino off-site real, KMS e prazos aprovados |
| 43 | CI remoto em PR | F7 | GitHub Actions/PR | ✅ PR #5/run `39448285071`: backend, frontend, Docker e smoke 12/12 verdes |
| 44 | Google válido em homologação | F1 | `AuthApplicationService`/config | 🔴 token real e DNS autenticado indisponíveis |
| 45 | Alertmanager/plantão | F8 | regras Prometheus/ops | 🟡 regras carregadas e alerta sintético entregue no canal local; falta canal institucional aprovado |
| 46 | SMTP de produção | F1/F8 | `.env`/DNS/provedor | 🟡 bounce monitorado e suprimido no servidor; falta SPF/DKIM/DMARC e provedor real, sem conta pessoal |
| 47 | DPO/inventário/retenção | F6/F8 | docs/ops | 🟡 modelo de inventário e encarregado pronto; falta decisão registrada e prazos aprovados |
| 48 | Política e CPF sentinela | F6 | docs/scripts | 🟡 mecanismo de publicação e saneamento executados (16 CPFs legados removidos, auditoria append-only); falta o texto oficial aprovado |
| 49 | Incidente/rotação | F8 | runbook | 🟡 exercício automatizado registrado na stack local; falta assinatura do operador e ensaio de rotação em produção |
| 50 | Sandbox Mercado Pago | F4/13.4 | `.env`, webhook | Pagamento teste ativa VIP uma vez; HMAC/valor/moeda conferidos |
| 51 | Oracle VM | F14/14.1 | infra | VM/SSH/firewall; bancos/Redis sem porta pública |
| 52 | Deploy Oracle | F14/14.3 | Compose/`.env` | Healthchecks, V1–V16 e smoke verdes |
| 53 | Cloudflare Function | F15 | `functions/api/[[path]].ts` | `/api/*`, cookies e uploads funcionam; sem fallback local em produção |
| 54 | Mercado Pago produção | F16 | secrets/webhook | Só após #50; chaves e webhook revisados |
| 55 | Analytics/Seasons | F17 | serviços/controllers | Série por dia, retenção, líquido; janela de 60 dias idempotente |
| 56 | Alinhamento documental | — | docs | Contradições listadas corrigidas; nenhum segredo exposto |
| 57 | Governança do proprietário | F1/F6 | V14, auth, sessão, segurança | ✅ `is_owner`/`ROLE_OWNER`, herança de moderação, hardening e conta DONO criada/verificada com sessão real; senha não registrada |
| 58 | CRUD do capítulo (criar, editar, excluir) e capítulo programado visível | F3 | `WorkApplicationService`, `WorkController`, `CreatorChaptersPage`, `WorkDetailPage` | ✅ capítulo agendado aparece na ficha com data; leitura só para membro/autor/moderação; autor exclui o próprio capítulo (cascata + contador + feed) com teste |

> **Pendente honesto:** o deploy real (Fase 13 "em produção") exige credenciais/infra que não estão nesta máquina; nada foi publicado. O job de rotação usa join em memória obras×eventos (adequado ao MVP, não a milhões de obras).

---

## Regra de atualização

Ao concluir um item, atualize **esta tabela** e `AUDITORIA-ATUAL.md` no mesmo commit. Não crie relatório paralelo.


### Rodada 2026-10-22 — experiência do leitor e analytics

| # | Fase | Entrega |
|---|---|---|
| 59 | F1/F2 | ✅ `UsernamePolicy` estrita (sem espaço/acento/hífen, sem símbolo repetido, reservados) + espelho no formulário; 377 testes verdes |
| 60 | F2/F3 | ✅ Biblioteca real (`GET /users/me/library`) com favorito persistido, "continuar de onde parou" na página exata e "ler novamente" ao concluir o capítulo |
| 61 | F9 | ✅ Analytics estilo Studio: período 7/28/90/180, visão geral + conteúdo por obra/capítulo, 48 h em tempo real e retenção real |
| 62 | F9 | ✅ Evento `READ` deduplicado por avanço de página (retry/re-render não inflam leitura), `uniqueReaders` só da janela (nunca soma dos dias) e `docs/ANALYTICS-METRICAS.md` com fonte de verdade, fórmulas e limites |
| 63 | F9/F3 | ✅ Visualização = leitor que leu a 1ª página do capítulo (`VIEW`, 1 por leitor/capítulo; abrir e sair não conta), total da obra = soma dos capítulos na ficha/feed/catálogo, cada capítulo mostra o próprio número, F5 mantém obra/capítulo/página, datas dd/mm/aaaa e tooltip de hora+total nas 48 h; 380 testes verdes |
| 64 | F9/F6 | ✅ Funil de descoberta instrumentado (`IMPRESSION` ≥50%/1s em lote idempotente + `OPEN` atribuído em 30 min), CTR honesto (nulo sem denominador), comparação com período anterior, conclusão de mangá ≥80% (prosa indisponível), heatmap 7×24 em `America/Sao_Paulo`, exportação CSV server-side com neutralização de fórmula, tooltip no gráfico diário (mouse/teclado/toque), layout mobile e teste HTTP anti-IDOR; 398 testes verdes |
| 65 | F2/F3 | ✅ Favorito/biblioteca é ação de estrela; curtidas existem somente por capítulo via `chapter_likes` (V19), e `works.total_likes` agrega os capítulos (V22 remove `work_likes`). Toggles idempotentes e contadores atômicos; `total_favorites` preserva o legado. View é 1 por leitor/capítulo/dia (`America/Sao_Paulo`) e só é enviada após a primeira página ficar visível; leitura em outro dia conta de novo. Apoio no fim do capítulo só aparece quando o autor é monetizado e o checkout está configurado |
| 66 | F3/F9 | ✅ Comentários separados por capítulo (V20): respostas em profundidade 1, curtidas, edição/exclusão lógica dos próprios, denúncia com dedup, fila de moderação (`DISMISS`/`HIDE`), paginação, ordenação estável, contadores e selo amarelo de assinante ativo calculado no servidor. Front no fim do capítulo (mangá e light novel); visitante vai para login/cadastro e retorna ao capítulo/comentários |
| 67 | F2/F9 | ✅ Central interna de notificações (V21): persistida, idempotente por `(user_id, dedup_key)`, não lidas, marcar uma/todas, limpar lidas com confirmação, paginação e destino que abre a obra. Eventos: novo capítulo de favorito (acesso antecipado respeitado + job de liberação), resposta e marcos de curtida (1/5/10/20/30/50/100). Push real continua **bloqueado** por VAPID/HTTPS/domínio e não foi simulado |
| 68 | F9 | ✅ Ranking de obras normalizado por `log1p` e decaimento; ranking de comentários separado (`curtidas × 2 + respostas × 0,5 − idade × 0,1`, desempate por data/id). Teste de normalização adicionado; suíte backend **412 testes, 0 falhas/0 erros** e frontend `npm.cmd run build` verde |
| 69 | F2/F3 | ✅ Sem curtida direta na obra: único botão de estrela salva favorito; ficha exibe curtidas/views por capítulo. Comentários só no capítulo, CTA visitante com retorno pós-login/onboarding para `#chapter-comments`; removido botão redundante de volta ao modo paginado no fim do scroll. V22 recalcula `works.total_likes` e remove `work_likes`; exclusão de capítulo subtrai as curtidas agregadas |
| 70 | F3/F5 | ✅ `ProseEditorialPolicy` (backend Java + frontend TS): NFC/code-point, mín 1.000, aviso 3.000, rec 6.000-18.000, máx 30.000; capítulo especial/prólogo mín 300; contador em tempo real no editor; 4/4 testes verdes |
| 71 | F5 | ✅ `AdOverlay` hardened: backdrop sem `onClick`, Escape bloqueado, 15 s cronometrados, fechar só pelo botão, cleanup de listeners após desmontagem |
| 72 | F5 | ✅ `SobrePage`: carousel editorial duotone P&B→amarelo (crossfade 4,2 s, pausa no hover), história do Kokuin/Kiraya/Moshiki, seção MANGÁ · LIGHT NOVEL · AUTORIAL, CTA preto-sobre-amarelo. Rota `about` no `App.tsx`; link SOBRE no `Header.tsx` (tipo union atualizado) |

> **Pendências honestas desta rodada:** as fatias 65–69 foram validadas por compilação, testes,
> build, migrations reais e E2E HTTP (comentário, resposta, curtida, notificação, edição/exclusão e toggle de curtida de capítulo com soma da obra).
> O QA **visual** no navegador (curtida, comentário, sino e retorno pós-login) não foi reexecutado após o rebuild. A
> moderação de comentários tem API e fila, mas ainda não tem tela dedicada no front. Push real,
> leitura anônima e progresso de prosa continuam bloqueados pelas decisões já registradas.

### Rodada 2026-10-23 — formato como primeiro eixo (catálogo, home, feed e biblioteca)

| # | Fase | Entrega |
|---|---|---|
| 73 | F3/F7 | ✅ `GET /api/catalog` (PostgreSQL, fonte de verdade): filtros de formato, gênero (OR), público, status, busca por obra/autor/gênero, ordenação, paginação e contadores por formato. Valor inválido de formato cai em "tudo" (nunca esconde obra). Suspensa, arquivada por LGPD e rascunho nunca aparecem; 8 testes de integração com Testcontainers |
| 74 | F3/F7 | ✅ `GET /api/catalog/releases`: timeline de capítulos **já públicos** (agendado não vaza), com formato, `chapterId`, contadores da obra; V24 cria índices de formato/status, ordenação, gênero e `public_release_at` |
| 75 | F3 | ✅ `/api/feed`, `/feed/trending` e `/feed/fresh` aceitam `formato` validado; `/api/users/me/library` e o progresso de leitura passam a expor `format`/`workSlug` (documentos antigos ficam nulos e o front trata) |
| 76 | F5 | ✅ `FormatSwitcher` único (Tudo/Mangá/Light novel) com `aria-pressed`, setas do teclado e contadores; `FormatBadge` com ícone + rótulo (amarelo = mangá, papel = novel); `WorkCard` unificado com metadados por formato |
| 77 | F5 | ✅ Catálogo em três níveis: formato segmentado, chips de gênero múltiplos e drawer (status, público, ordem, "Com ilustrações" só em novel); estado na URL (`?formato=&genero=&status=&ordem=&q=&pagina=`), pílulas com ✕, limpar tudo, contador dinâmico, skeleton/erro/vazio, paginação e CTA de cold start |
| 78 | F5 | ✅ Home com switcher (`?inicio=`), "Novos capítulos" agrupados por obra (até 3 capítulos + tempo relativo), "Em alta" separado por formato (rail só com ≥4 obras e CTA para autor logado), "Continuar lendo" com progresso real e timeline de lançamentos por dia. Biblioteca com as mesmas abas de formato; ficha com badge e leitor correto por capítulo |
| 79 | F7 | ✅ Verificação: `mvn -o test` **434 testes, 0 falhas/0 erros**; `npm.cmd run build` verde; stack recompilada; `GET /api/catalog` e `/api/catalog/releases` conferidos via HTTP real |

> **Pendências honestas (rodada 2026-10-23):** volumes ainda **não** são entidade do domínio, então o
> rótulo é `N caps` (o ponto de extensão `chapterLabel`/`Vol. X` está isolado); "Com ilustrações" filtra
> por `presentation_json` (apresentação ilustrada), não por ilustrações internas de capítulo; o progresso
> de prosa continua sem percentual real de scroll (o leitor envia `page=1/totalPages=1`), então a
> biblioteca/home mostram "cap. N · em andamento" em vez de inventar 100%; onboarding de uma pergunta
> não foi implementado; não há runner de teste no frontend (a verificação é `tsc` + build).


### Rodada 2026-10-26 — Higiene Arquitetural, Purga de Mocks e Decomposição SRP

| # | Fase | Entrega |
|---|---|---|
| 80 | F1/F3 | ✅ TASK-BACKEND-CLEANUP-001: Decomposição de WorkApplicationService em ChapterApplicationService, blindagem estrita de /api/auth/** no SecurityConfig, eliminação de retorno de @Entity nos controllers, tratamento de views no delete de capítulo e higienização de conversões em MercadoPagoService |
| 81 | F5 | ✅ TASK-FRONTEND-MOCKS-PURGE: Expurgo definitivo de mockData.ts em WorkDetailPage.tsx, CreatorWorkspacePage.tsx e ReaderProfilePage.tsx, eliminando dados fabricados em ambiente de desenvolvimento |
| 82 | F3/F5 | ✅ TASK-FRONTEND-DECOMPOSE-WIZARD: Decomposição de LightNovelChapterWizard.tsx (1.443 linhas) no hook useLightNovelEditor e submódulos em novel/, e desacoplamento de ReaderPage.tsx (1.129 linhas) em MangaReaderView, ProseReaderView, ReaderProseSettingsBar, ChapterEndPanel e useReaderTelemetry |
| 83 | F1/F3/F5 | ✅ AUDITORIA-PENTE-FINO: Blindagem de visibilidade cautelar em ChapterApplicationService.readChapter (obras suspensas/LGPD bloqueiam capítulos), injeção de ObjectMapper singleton em ReadingProgressService (evitando alocação massiva por view), fix de onClickFileInput em NovelBlockItem, eliminação de XSS em ProseReaderView sem dangerouslySetInnerHTML, harmonização de glifos de separadores (getSeparatorGlyph), blindagem de schema do localStorage (sanitizeRestoredBlocks), validação estrita de MIME types (JPEG/PNG/WebP) e unificação completa de design tokens CSS nos componentes do leitor |

> **Diagnóstico & Especificação:** ver docs/orquestracao/AUDITORIA-ARQUITETURA-REVISAO-GERAL.md para a análise completa linha a linha.

| 84 | F3/F7 | ✅ Refatoração de WorkStatus para Enum de Domínio: DRAFT, ONGOING, COMPLETED, SUSPENDED, ARCHIVED_LGPD com V25 Flyway, eliminando comparações manuais de string em repositórios, serviços e controllers |
| 85 | F4 | ✅ Decomposição Modular de MercadoPagoService (570 linhas) em classes especialistas: MercadoPagoWebhookValidator (HMAC-SHA256, timing attacks, replay 15 min), MercadoPagoCheckoutService (Checkout Pro, intents, locks) e MercadoPagoPaymentProcessor (ledger idempotente e conciliação) |
| 86 | F1/F3/F5 | ✅ Auditoria e Saneamento de Pontas Soltas: Correção de assertWorkAccessible em ChapterApplicationService unificado com isAuthorOrModerator(work, currentUserId), e expurgo de resíduos de MOCK_CHAPTERS e fallbackToMock em App.tsx |
| 87 | F7 | ✅ Verificação de Integridade Total: Suíte backend 437 testes, 0 falhas, 0 erros; frontend build verde em 2.34s; branches develop e main 100% alinhadas e com push efetuado |

---
| 88 | F5/F9 | ✔. Decomposição Modular de CreatorAnalyticsPage.tsx: Arquivo reduzido de 1.198 para 264 linhas. Extraídos subcomponentes isolados: StatCard.tsx, CreatorDailyChart.tsx, CreatorFunnelPanel.tsx, CreatorContentTable.tsx, CreatorRetentionCurve.tsx, CreatorAudienceHeatmap.tsx, CreatorRealtimeBars.tsx, CreatorRealtimeSidebar.tsx, CreatorDetailedWorksList.tsx e o custom hook useCreatorAnalyticsData.ts. |
| 89 | F3/F5 | ✔. Decomposição Modular de ChapterPublishWizard.tsx: Wizard monolítico reduzido de 742 para 28 linhas, delegando para MangaChapterWizard.tsx e passos atômicos em manga/ (MangaUploadStep, MangaOrganizeStep, MangaCoverStep, MangaReviewStep, MangaPublishStep) com hook especialista useMangaChapterEditor.ts. |
| 90 | F3/F5 | ✔. Modularização de WorkCommentsPanel.tsx: Reduzido de 545 para 195 linhas, extraindo CommentItem.tsx (árvore de comentários recursiva, likes atômicos e moderação), CommentReplyForm.tsx e o hook useWorkComments.ts, com expurgo total de cores soltas em prol de tokens CSS. |
| 91 | F5 | ✔. Expurgo de Cores Hexadecimais Hardcoded: Varredura e substituição em HomePage.tsx (57 ocorrências) e CatalogPage.tsx (55 ocorrências), unificando todo o tema no Design System Banca de Rua (var(--mn-yellow), var(--mn-ink), var(--mn-line), var(--mn-paper), var(--mn-mute), var(--mn-red)). |
| 92 | F3/F9 | ✔. Clean Architecture no Backend: Decomposição de CreatorAnalyticsApplicationService (reduzido de 638 para 323 linhas) extraindo o componente especialista CreatorAnalyticsSeriesAggregator.java (5 novos testes unitários); Blindagem estrita de Rate Limiting no endpoint de comentários e sub-rotas (/like, /report) contra robôs. |
| 93 | F7 | ✔. Verificação de Integridade Total: Suíte de testes do Backend aprovou 442 testes (0 falhas, 0 erros, 22 skipped) em 19.7s; Build do Frontend via Vite passou com sucesso em 2.36s. |

---

### Próximos Passos Planejados — Bloco F (Tokens de Autenticação, Observabilidade & Testes de Frontend)

| # | Fase | Entrega Planejada |
|---|---|---|
| 94 | F5 | 📌 **Unificação de Tokens na Autenticação & Header:** Substituição dos literais hexadecimais restantes em `LoginPage.tsx` (48), `RegisterPage.tsx` (32) e `Header.tsx` (38) consumindo as variáveis CSS da Banca de Rua (`var(--mn-*)`). |
| 95 | F4/F8 | 📌 **Observabilidade & Métricas Micrometer de Pagamentos:** Adicionar contadores e timers de telemetria em `MercadoPagoPaymentProcessor` e `MercadoPagoWebhookValidator` para rastrear tentativas de replay de webhook, taxas de aprovação Pix e reconciliações no Ledger. |
| 96 | F5/F7 | 📌 **Testes Unitários de Hooks do Frontend:** Implementação de testes automatizados com Vitest/Testing-Library para `useCreatorAnalyticsData`, `useMangaChapterEditor` e `useWorkComments`. |