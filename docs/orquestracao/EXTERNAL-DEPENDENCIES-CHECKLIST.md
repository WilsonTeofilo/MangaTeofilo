# CHECKLIST DE DEPENDÊNCIAS EXTERNAS & HOMOLOGAÇÃO DE PRODUÇÃO

**Data:** 2026-11-20  
**Responsável:** Hermes (Tech Lead & Arquiteto Principal)  
**Status Geral:** 🔵 Bloqueado Externo (Aguardando Credenciais / Provisionamento do Titular)

Este documento centraliza e documenta formalmente o estado das dependências externas que não podem ser fabricadas ou simuladas de forma fictícia no código, cumprindo a diretriz de **Verdade antes de Narrativa**.

---

## 1. Sandbox Mercado Pago

### 1.1 O que já está 100% implementado e blindado no código:
- ✅ **Porta Desacoplada (`PaymentGatewayPort`):** O backend não acopla diretamente os serviços à SDK proprietária, respeitando a Clean Architecture (DIP / ADR-003).
- ✅ **Webhook Idempotente e Seguro:** Validação de assinatura HMAC com comparação timing-safe (`MessageDigest.isEqual`), protegendo contra timing attacks.
- ✅ **Deduplicação de Eventos:** Prevenção contra processamento duplo de transações e recarga indevida de moedas/VIP via `financial_ledger`.
- ✅ **Modo Mock Local:** Para desenvolvimento e testes locais (`dev`/`test`), os fluxos de checkout e webhook possuem mocks que simulam resposta com sucesso sem tocar na internet.

### 1.2 O que depende do Wilson / Ações Externas:
1. **Conta de Desenvolvedor no Mercado Pago:**
   - Acessar o painel de desenvolvedores do Mercado Pago.
   - Criar uma aplicação de testes (Sandbox).
2. **Obtenção de Credenciais de Sandbox:**
   - `MERCADOPAGO_ACCESS_TOKEN`: Token de teste (inicia com `TEST-...`).
   - `MERCADOPAGO_PUBLIC_KEY`: Chave pública de teste.
   - `MERCADOPAGO_WEBHOOK_SECRET`: Chave secreta configurada no painel de webhooks.
3. **Webhook Público para Teste Ponta a Ponta:**
   - Para receber os eventos do Mercado Pago no ambiente local de desenvolvimento, é necessário um túnel HTTPS temporário (ex.: ngrok, cloudflared ou localtunnel):
     ```bash
     cloudflared tunnel --url http://localhost:8085
     ```
   - Cadastrar a URL gerada no painel do Mercado Pago: `https://<seu-tunel>/api/monetization/webhook`.
4. **Execução do Pagamento de Teste:**
   - Usar os cartões de teste oficiais do Mercado Pago para simular aprovação de pagamento e ativação de VIP / Doação.

---

## 2. Oracle Cloud VM (OCI Infrastructure)

### 2.1 O que já está 100% preparado no repositório:
- ✅ **`docker-compose.yml` de Produção:**
  - Serviços configurados: PostgreSQL 16 com extensões (`pg_trgm`), MongoDB 7, Backend Spring Boot (multi-stage build), Frontend React (Nginx alpine com cache e compressão gzip), Prometheus e Grafana para observabilidade.
- ✅ **Healthchecks configurados:** Todos os containers possuem verificação de saúde e política de restart `unless-stopped`.
- ✅ **Isolamento de Redes:** Redes internas segregadas (`backend-net`, `db-net`) sem exposição pública direta das portas do PostgreSQL e MongoDB.
- ✅ **Variáveis de Ambiente:** Externalizadas em `.env` (com template em `.env.example`).

### 2.2 O que depende do Wilson / Ações Externas:
1. **Provisionamento da Instância OCI (Always Free Tier ou Superior):**
   - Criar Compute Instance (VM.Standard.A1.Flex com Ampere ARM ou VM.Standard.E2.1.Micro).
   - Sistema operacional recomendado: Ubuntu 24.04 LTS.
2. **Configuração de Rede e Firewall (VCN / Security Lists):**
   - Abrir portas no Ingress Rules da VCN:
     - `80/TCP` (HTTP - Let's Encrypt / Redirecionamento)
     - `443/TCP` (HTTPS)
     - `22/TCP` (SSH restrito)
3. **Instalação do Docker e Docker Compose na VM:**
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
   sudo usermod -aG docker ubuntu
   ```
4. **Alocação de IP Público Estático (Reserved IP) na OCI.**

---

## 3. Domínio, DNS e SMTP Transacional (SPF / DKIM / DMARC)

### 3.1 O que já está 100% implementado no backend:
- ✅ **Dev Outbox (`/api/dev/outbox`):** Em ambiente local/dev, e-mails de recuperação de senha e verificação de conta são capturados em memória/banco sem disparar e-mails reais.
- ✅ **Segurança de Tokens:** Tokens de recuperação de senha com hash SHA-256 no banco, expiração em 15 minutos e uso único.
- ✅ **Template HTML Transacional:** Layout responsivo com design system oficial da plataforma.

### 3.2 O que depende do Wilson / Ações Externas:
1. **Domínio Oficial:**
   - Registro do domínio da plataforma (ex.: `manganetworking.com` ou similar).
   - Apontamento do DNS (tipo A) para o IP público da VM na Oracle Cloud.
2. **Provedor de E-mail Transacional (SMTP):**
   - Criar conta em um serviço SMTP confiável (ex.: Resend, SendGrid, Amazon SES, Mailgun ou Brevo).
   - Obter credenciais de SMTP:
     - `SPRING_MAIL_HOST`
     - `SPRING_MAIL_PORT` (geralmente 587)
     - `SPRING_MAIL_USERNAME`
     - `SPRING_MAIL_PASSWORD`
3. **Configuração dos Registros de DNS de Entregabilidade:**
   - **SPF:** Registro TXT na raiz (ex.: `v=spf1 include:sendgrid.net ~all`).
   - **DKIM:** Registro CNAME ou TXT fornecido pelo provedor para assinatura criptográfica de cabeçalho.
   - **DMARC:** Registro TXT em `_dmarc.<dominio>` (ex.: `v=DMARC1; p=quarantine; pct=100;`).
   - *Nota:* Sem esses 3 registros, os e-mails transacionais de recuperação de senha cairão automaticamente na caixa de spam do Gmail/Outlook ou serão rejeitados.

---

## 4. Próximos Passos Recomendados

Quando o Wilson desejar avançar na homologação externa, o procedimento será:
1. Preencher o arquivo `.env` com as chaves reais de teste do Mercado Pago.
2. Rodar o teste com túnel ngrok/cloudflared.
3. Provisionar a VM na Oracle Cloud seguindo o passo 2.

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
