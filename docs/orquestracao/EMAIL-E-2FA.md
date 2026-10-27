# E-mail, 2FA e Google OAuth — Plano de Implementação

> Resposta à pergunta: *como fazer o código 2FA chegar por e-mail com a marca MangaNetWorking, reaproveitando o que o projeto antigo fazia?*
> Plano histórico e referência arquitetural. O código SMTP/2FA descrito abaixo já existe. Em 2026-10-20, a recuperação de senha foi validada separadamente por link de uso único: V13 guarda apenas SHA-256 do token; `PASSWORD_RESET_TOKEN_TTL` aceita 5–60 min (padrão 30); `PUBLIC_FRONTEND_URL` precisa ser HTTPS (HTTP somente em localhost), sem path/query. V13 foi aplicada em PostgreSQL real com `token_hash VARCHAR(64)` e Hibernate `validate` subiu; o fluxo Mailpit (pedido → link → nova senha → 2FA → `/me`) foi exercitado; duas confirmações simultâneas produziram 204/401; o reenvio rotaciona o token ativo; o throttle usa o namespace `password-reset`, separado do OTP de login; o envio SMTP ocorre após commit. A suíte completa passou 291/0/0 com Docker. DNS autenticado, provedor de produção e ID token Google real continuam pendentes. OTP de login/step-up permanece independente.

---

## 1. Como o projeto antigo (MangaTeofilo) fazia

O que existe de verdade no código antigo:

- `functions/notifications/delivery.js` e `functions/system/auth.js` usam **nodemailer**.
- As credenciais vêm de secrets: `SMTP_HOST`, `SMTP_PORT` (default 465), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- O remetente era montado assim:

```js
function getSmtpFrom() {
  try { return SMTP_FROM.value(); }
  catch { return 'MangaTeofilo <drakenteofilo@gmail.com>'; }
}
```

- `sendMail({ from: getSmtpFrom(), to, subject, text, html })` — ou seja, o **nome de exibição** era "MangaTeofilo" e o endereço real continuava sendo `drakenteofilo@gmail.com`, a menos que o secret `SMTP_FROM` tivesse um alias verificado.
- O envio só acontecia para usuário com `emailVerified` e não desabilitado.

**Conclusão:** o que você viu com cara de `@mangateofilo` era o **display name** da marca (e possivelmente um alias "Enviar e-mail como" configurado na conta Gmail). Não existia um domínio próprio `mangateofilo.com` no código.

---

## 2. A verdade sobre remeter com o nome da marca

O Gmail **não permite** enviar como `algo@manganetworking.com` sem que você prove que controla o domínio. O `From:` precisa ser:

1. o próprio endereço autenticado (`drakenteofilo@gmail.com`); ou
2. um alias verificado na conta ("Enviar e-mail como") — inclusive outro Gmail; ou
3. um endereço de um domínio seu autorizado por SPF/DKIM no provedor.

Sem isso, o e-mail sai como `MangaNetWorking <drakenteofilo@gmail.com>`. Funciona, mas:
- aparece o Gmail pessoal para o usuário;
- tem risco de cair em spam;
- não escala (limite diário do Gmail, ~500 destinatários/dia na conta gratuita);
- pode ser suspenso pelo Google por envio automatizado.

---

## 3. Opções (recomendação em primeiro lugar)

| Opção | Como fica o remetente | Custo | Prós | Contras |
|---|---|---|---|---|
| **A. Provedor transacional + domínio próprio** (Resend, Brevo, AWS SES, Mailgun, SendGrid) | `MangaNetWorking <nao-responda@manganetworking.com>` | grátis até alguns milhares/mês | entregabilidade, métricas, webhooks de bounce, sem conta pessoal exposta | exige registrar/possuir o domínio e configurar DNS |
| **B. Google Workspace no domínio** | `MangaNetWorking <contato@manganetworking.com>` | ~US$ 6/usuário/mês | 100% Google, SMTP familiar, bom para suporte | pago; app password/OAuth para SMTP; limite diário |
| **C. Alias "Enviar como" no Gmail gratuito** | `MangaNetWorking <mangateofilo@gmail.com>` ou alias | grátis | rápido para testar | não usa domínio próprio; limite baixo; risco de bloqueio |
| **D. Só display name no Gmail atual** | `MangaNetWorking <drakenteofilo@gmail.com>` | grátis | zero configuração | expõe o Gmail pessoal; pior entregabilidade |

**Recomendação:** registrar o domínio da marca e usar **A** em produção, com **Mailpit no Docker** para desenvolvimento. Se você já tem conta Google Workspace, **B** também resolve bem.

> Point importante: **SPF, DKIM e DMARC** no DNS são o que faz o e-mail chegar na caixa de entrada. Sem isso, nem o melhor provedor salva.

---

## 4. Arquitetura no Spring Boot

O projeto já tem a fronteira certa: `MfaNotificationSender` (porta) + `DevOutboxNotificationSender` (adaptador de dev). Basta adicionar o adaptador real.

```
MfaNotificationSender (porta, existe)
├── DevOutboxNotificationSender   @Profile({"dev","test","local"})   (existe)
├── SmtpMfaNotificationSender     @Profile("!dev & !test & !local")  (novo)
└── (futuro) SesMfaNotificationSender / ResendMfaNotificationSender  (troca sem mexer no domínio)
```

**Fluxo correto do OTP (novo):**

```
register/login/google
   │
   ├─ grava intenção de 2FA e commita a transação
   │
   └─ AFTER_COMMIT ──> MfaSender.sendOtp(destination, code, purpose)
                          └─ SMTP/API do provedor (com retry e timeout)
```

Nunca enviar dentro do `@Transactional` (ver achado A5 da auditoria).

**Configuração (`application.yml`), tudo por variável de ambiente:**

```yaml
spring:
  mail:
    host: ${MAIL_HOST:}
    port: ${MAIL_PORT:587}
    username: ${MAIL_USERNAME:}
    password: ${MAIL_PASSWORD:}
    properties:
      mail.smtp.auth: true
      mail.smtp.starttls.enable: true
      mail.smtp.connectiontimeout: 5000
      mail.smtp.timeout: 5000
      mail.smtp.writetimeout: 5000
platform:
  mail:
    from-address: ${MAIL_FROM:}
    from-name: ${MAIL_FROM_NAME:MangaNetWorking}
```

Em `prod`, **fail-fast**: se `MAIL_HOST`/`MAIL_FROM` estiverem vazios, a aplicação não sobe (mesmo padrão do `AES_SECRET_KEY`).

**Dependência:** `spring-boot-starter-mail` + `spring-boot-starter-thymeleaf` (se for usar template HTML) ou montar HTML em string centralizada.

**Regras de ouro:**
- Nunca logar o OTP; o código só existe no banco/memória como **HMAC** e no e-mail.
- Template com marca, sem link rastreável e com aviso de "se não foi você, ignore".
- `From` com nome de exibição e `Reply-To` de suporte.
- Timeout curto e envio assíncrono para não travar o request.

---

## 5. Desenvolvimento local (sem gastar Gmail)

Adicionar **Mailpit** ao `docker-compose.yml`:

```yaml
  mailpit:
    image: axllent/mailpit:latest
    ports: ["1025:1025", "8025:8025"]   # SMTP e UI web
```

No perfil `dev`, apontar `MAIL_HOST=localhost`, `MAIL_PORT=1025`, `MAIL_USERNAME=`, `MAIL_PASSWORD=`, `MAIL_FROM=dev@manganetworking.local`. Você vê todos os e-mails em `http://localhost:8025`, sem enviar nada para fora.

### 5.1 Estado real em 20/10/2026 — Mailpit ou SMTP de verdade, é só o `.env`

O Compose local **não fixa mais** `MAIL_HOST: mailpit`: ele repassa do `.env` `MAIL_HOST`, `MAIL_PORT`,
`MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_SMTP_AUTH`, `MAIL_SMTP_STARTTLS`, `MAIL_FROM` e `MAIL_FROM_NAME`,
mantendo o Mailpit como padrão quando as variáveis não existem. Antes, o `.env` era ignorado e **todo OTP
ia só para o Mailpit** — o sintoma de "o 2FA não chega no meu e-mail".

```bash
# .env (fora do repositório, ver .gitignore)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=conta@gmail.com
MAIL_PASSWORD=senha-de-app-16-caracteres
MAIL_SMTP_AUTH=true
MAIL_SMTP_STARTTLS=true
MAIL_FROM=conta@gmail.com
MAIL_FROM_NAME=MangaNetWorking
PLATFORM_MAIL_ENABLED=true
```

Regras para o remetente:

- a conta do `MAIL_USERNAME` precisa ser a mesma do `MAIL_FROM` (ou um alias verificado no provedor);
  o Gmail recusa com `553 sender address mismatch` quando não são;
- use **senha de app** (16 caracteres) e não a senha da conta;
- `MAIL_FROM_NAME` é o nome de exibição, e não o remetente técnico;
- para testar **sem** SMTP real: deixe `MAIL_HOST` ausente/vazio no `.env` (cai no Mailpit) ou rode com
  `PLATFORM_MAIL_ENABLED=false` para usar a Dev Outbox (útil para automação: o `smoke_test_e2e.ps1` lê o OTP
  da Dev Outbox ou do Mailpit e **não** consegue ler a caixa de e-mail real).

Prova real em 20/10/2026: container com `smtp.gmail.com:587`, `auth=true` e `starttls=true`; e-mail de
recuperação de senha e **código 2FA** enviados com `outcome=sent` para o endereço do titular, com `0` mensagens
no Mailpit no mesmo intervalo.

O endpoint `/api/dev/outbox/latest` pode continuar existindo como conveniência, mas a fonte de verdade do teste é o Mailpit.

---

## 6. Segurança do 2FA (fechando os achados C3 e A3)

| Controle | Como |
|---|---|
| Código de 6 dígitos | `SecureRandom`, nunca `Math.random` |
| Armazenamento | HMAC-SHA-256(code, pepper) — nunca texto puro |
| Comparação | `MessageDigest.isEqual` (tempo constante) |
| TTL | 5 minutos |
| Uso único | remove no sucesso |
| Tentativas | 5, depois invalida |
| Propósito | `LOGIN` e `STEP_UP_PIX` vinculados à chave; código de um propósito não vale no outro. Recuperação de senha usa token de link, não um propósito OTP. |
| Reenvio | cooldown 60 s; máximo 3 por 10 min por conta |
| Rate limit | bucket estrito por IP além do bucket por conta |
| Anti-enumeração | resposta genérica em cadastro/recuperação |
| Auditoria | evento append-only com ator, IP, propósito e resultado |
| Alertas | métrica de falhas e bounce de e-mail |

**Step-up de PIX (C3):** criar `POST /api/auth/2fa/request` autenticado, que emite OTP com `purpose=STEP_UP_PIX`. O `PUT /api/creators/pix-key` passa a exigir apenas código desse propósito. Assim o usuário não precisa refazer login para trocar a chave.

---

## 7. Google OAuth do jeito certo (fechando o achado C1)

1. Frontend obtém o `id_token` do Google Identity Services.
2. Backend valida com `GoogleIdTokenVerifier`:
   - assinatura contra as chaves públicas do Google;
   - `audience` igual ao seu client ID;
   - `issuer` = `accounts.google.com`;
   - `expirationTime` válido.
3. Extrai `email`, `email_verified`, `name`, `picture` **das claims verificadas**.
4. Se a conta não existe, trata como cadastro: exige aceite de termos e data de nascimento **antes** de criar a sessão.
5. Dispara o 2FA obrigatório (Epic style) para o e-mail verificado.

Os campos `email`, `name` e `avatarUrl` do corpo atual devem ser **removidos ou ignorados**.

---

## 8. Passo a passo de implementação (fila)

| # | Passo | Arquivos |
|---|---|---|
| 1 | Adicionar `spring-boot-starter-mail` e propriedades `MAIL_*` | `pom.xml`, `application.yml` |
| 2 | Criar `SmtpMfaNotificationSender` com perfil de produção | `service/mfa/` |
| 3 | Restringir `DevOutboxNotificationSender` a dev/test/local | `service/mfa/`, `SecurityConfig` |
| 4 | Envio após commit (`@TransactionalEventListener`) + retry | `AuthApplicationService` |
| 5 | Mailpit no compose de dev | `docker-compose.yml` |
| 6 | OTP como HMAC + purpose + comparação constant-time | `TwoFactorAuthService` |
| 7 | Endpoint `POST /api/auth/2fa/request` (step-up) | `AuthController`, `AuthApplicationService` |
| 8 | Verificação do ID token Google | `AuthApplicationService`, `GoogleLoginRequestDto` |
| 9 | Templates de e-mail com a marca | `resources/templates/` |
| 10 | Auditoria de PIX e de 2FA | novo `audit_event` |
| 11 | Testes: OTP expirado/reuso/purpose, Google token inválido, SMTP fake | `src/test/` |
| 12 | Fail-fast de `MAIL_*` em `prod` | `PlatformProperties` |

---

## 9. Checklist de entregabilidade

- [ ] Domínio próprio registrado.
- [ ] SPF publicado (`v=spf1 include:...`).
- [ ] DKIM assinando.
- [ ] DMARC (`p=none` no início, depois `quarantine`).
- [ ] `From` com domínio próprio e nome `MangaNetWorking`.
- [ ] `Reply-To` de suporte.
- [ ] Link de descadastro em e-mails não transacionais.
- [ ] Monitoramento de bounce/spam (webhook do provedor).
- [ ] Teste de caixa real: Gmail, Outlook, Yahoo.

---

## 10. Custos aproximados

| Provedor | Free tier | Pago |
|---|---|---|
| Resend | 3.000 e-mails/mês, 100/dia | a partir de ~US$ 20 |
| Brevo | 300 e-mails/dia | a partir de ~US$ 9 |
| AWS SES | 3.000 mensagens/mês (no EC2) | US$ 0,10 por 1.000 |
| Google Workspace | não tem free | ~US$ 6/usuário/mês |

Para o volume atual (OTP de login), o free tier de qualquer um resolve. O que decide é a **entregabilidade** e não expor seu Gmail pessoal.
