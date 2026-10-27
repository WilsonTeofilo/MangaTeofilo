# Runbook de produção — F8

Este runbook descreve procedimentos que ainda precisam ser homologados no provedor de produção. Não execute restauração sobre produção sem janela aprovada, backup recente e responsável acompanhando.

## Backup e restauração

- O operador executa `ops/backup-restore.ps1 -Mode Backup -BackupPath <novo-diretório> -ComposeFile docker-compose.prod.yml` (ou `docker-compose.yml` para dev) com Docker Compose disponível. O destino precisa ser novo; dumps Postgres/Mongo e uploads são copiados sem imprimir credenciais, e `manifest.json` guarda SHA-256.
- **Cifra, off-site e retenção (item 42):** acrescente `-EncryptKeyFile <chave fora do Git>` para gerar o artefato cifrado `*.mnbak` (AES-256-CBC + HMAC-SHA256, encrypt-then-MAC), `-OffsiteDestination <destino>` para a cópia verificada por SHA-256 (com log `offsite-copies.jsonl`) e `-RetentionDays`/`-RetentionRoot` para a janela de retenção (com log `retention-prune.jsonl`). O destino off-site exige artefato cifrado; a retenção nunca remove o backup mais recente. Procedimento completo em `docs/ops/RETENCAO-CIFRA-OFFSITE.md`.
- Para ensaio não destrutivo, use `-Mode RestoreCheck -BackupPath <diretório> -ComposeFile docker-compose.prod.yml` (ou `-EncryptedArtifact` + `-EncryptKeyFile` para conferir a partir do artefato cifrado). O script confere checksums e restaura bancos com nomes de staging; os uploads são copiados para uma pasta `restore-check-*`. Ele não apaga automaticamente o staging, para permitir inspeção e limpeza manual após aprovação.
- Nunca use `docker compose down -v` como procedimento de backup ou recuperação.
- Frequência, RPO/RTO, criptografia, retenção e evidência de restauração precisam ser definidos pelo responsável operacional; não há metas aprovadas no repositório.

## Segredos de infraestrutura

- O Compose de produção exige `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD` e `SPRING_DATA_MONGODB_URI` com autenticação e `authSource=admin`; credenciais com caracteres reservados devem ser URL-encoded na URI.
- Redis de produção exige `REDIS_PASSWORD`; não reutilize a senha do PostgreSQL/Mongo. Injete todas as credenciais por secret manager no deploy, não por arquivo versionado.
- MongoDB só cria o usuário root durante a inicialização de um volume vazio. Antes de apontar credenciais para um volume Mongo existente, crie/valide o usuário em janela controlada e teste autenticação; não remova nem recrie o volume para “fazer a senha pegar”.

## Incidente e rotação de chaves

1. Declare incidente, registre UTC, sistemas afetados, impacto conhecido e responsável; preserve logs/auditoria sem copiar OTPs, senhas, tokens ou conteúdo privado para tickets.
2. Contenha: suspenda credenciais comprometidas, restrinja tráfego ou desabilite a integração afetada; não desligue nem limpe volumes antes de preservar evidência.
3. Rotacione a credencial no provedor/cofre e nos serviços consumidores: `AES_SECRET_KEY`, `OTP_HMAC_SECRET`, credenciais SMTP, `MERCADOPAGO_*`, credenciais de banco e Redis, conforme o tipo de exposição. Planeje compatibilidade/decriptação antes de trocar AES; uma troca simples pode tornar dados existentes ilegíveis.
4. Para rotação de `OTP_HMAC_SECRET`, invalide os desafios pendentes (TTL máximo de cinco minutos) ou aguarde a expiração antes da troca coordenada entre réplicas.
5. Para sessão/Redis, revogue sessões suspeitas; confirme que todas as réplicas usam os mesmos stores e segredos. Registre quem aprovou e validou a troca.
6. Restaure em staging, valide saúde, migrações, autenticação e integridade dos arquivos antes de qualquer cutover. Faça post-mortem com causa, escopo, ações e prazos de retenção aprovados.

## Alertas e e-mail

- Regras Prometheus em `ops/prometheus/manganetworking-alerts.yml` cobrem falha de entrega MFA, elevação de OTP inválido/bloqueado, elevação de bounce e volume de envios suprimidos. O Prometheus oficial e o Alertmanager oficial sobem com `ops/alertmanager/start-local-alerting.ps1`; o canal de plantão é renderizado de `ops/alertmanager/alertmanager.yml.template` e validado com `amtool check-config` por `ops/alertmanager/apply-alert-rules.ps1`, que também injeta um alerta sintético e comprova a entrega no e-mail.
- O backend só libera `/actuator/prometheus` para `ROLE_MODERATOR` ou para o token dedicado `METRICS_SCRAPE_TOKEN` (Bearer), exigido pelo `ProductionMetricsScrapeTokenGuard` no perfil `prod`.
- `MfaNotificationSender` registra sucesso/falha com campos estruturados e destinatário mascarado. O provedor SMTP deve ser configurado com TLS, domínio autenticado SPF/DKIM/DMARC e webhook/relatório de bounce com assinatura e política de retry. Provedor e endpoint ainda não foram escolhidos/configurados.
- Bounce/complaint chegam em `POST /api/webhooks/email/delivery-events` (segredo `EMAIL_WEBHOOK_SECRET` no header `X-Email-Webhook-Secret`). O evento é gravado em `email_delivery_events` (append-only, e-mail guardado só como SHA-256) e o endereço passa a ser suprimido: novos OTPs e links de recuperação para ele deixam de ser enviados. O guard de produção recusa o boot sem `EMAIL_WEBHOOK_SECRET`.
- A verificação do canal e o exercício do runbook ficam automatizados em `ops/alertmanager/apply-alert-rules.ps1` e `ops/incident/incident-drill.ps1`, que gravam o registro em `ops/alertmanager/drill-records/` e `ops/incident/drill-records/`.

## Privacidade e governança

- O sistema registra operações de exportação/exclusão em auditoria append-only. Isso não substitui o registro completo de operações de tratamento da LGPD.
- A organização deve nomear e publicar o contato do encarregado/DPO, aprovar finalidade/base legal, categorias, compartilhamentos, prazos de retenção e canal dos titulares. Não inventar nome, prazo ou base legal no código. O modelo do inventário e do canal está em `docs/ops/INVENTARIO-DADOS.md`, com as decisões pendentes marcadas explicitamente.
- A Política de Privacidade é publicada por procedimento controlado: `ops/legal/publish-privacy-policy.ps1` valida o front matter (versão, vigência, aprovador, referência da aprovação), recusa material sensível, calcula o SHA-256, instala o documento e registra a publicação em `ops/legal/publication-log.jsonl`. O backend publica `GET /api/legal/privacy-policy` e responde `404 POLICY_NOT_PUBLISHED` enquanto o texto oficial não estiver aprovado — ver `ops/legal/README.md`.
- Dados legados: o saneamento de CPF sentinela/inválido roda no servidor (`GET/POST /api/owner/privacy/legacy-personal-data`, `ROLE_OWNER`, dry-run por padrão) e cada ação é registrada em `privacy_governance_actions` (append-only). Criador já monetizado não é saneado automaticamente: vai para a fila de decisão humana.
- Após aprovação, automatizar jobs de retenção por dataset e configurar alertas de falha.

## Pendências de aceite

- Operar backup e restore-check em ambiente real isolado, validar integridade e medir RPO/RTO. **Feito no ambiente local (20/10/2026):** backup real com artefato cifrado verificado, cópia off-site conferida por SHA-256, retenção aplicada com log e restauração de verificação a partir do artefato cifrado em bancos isolados. Falta repetir no host de produção.
- Escolher storage externo cifrado e política de retenção aprovada. **Preparado:** `docs/ops/RETENCAO-CIFRA-OFFSITE.md`; falta o destino real, o KMS e a aprovação de prazos.
- Provisionar domínio/provedor SMTP autenticado, bounces e canal operacional de alertas. **Preparado:** canal de plantão validado ponta a ponta em ambiente local (Prometheus → Alertmanager → e-mail), token de coleta de métricas e webhook de bounce com supressão; falta domínio, provedor, endereços reais e aprovação de quem é o plantão.
- Nomear encarregado/DPO e aprovar inventário e política de retenção com responsável legal/produto. **Modelo pronto:** `docs/ops/INVENTARIO-DADOS.md`; a nomeação e a publicação continuam sendo decisão humana.
- Executar exercício de incidente e registrar evidência assinada pelo operador. **Exercício automatizado:** `ops/incident/incident-drill.ps1` (saúde, coleta de métricas, canal de plantão, bounce, revogação de sessão e restauração opcional), com registro em `ops/incident/drill-records/`; falta a assinatura do responsável e a execução em produção.
