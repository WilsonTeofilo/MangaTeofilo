# GUIA DE DNS E E-MAIL DE PRODUÇÃO — MangaNetWorking

**Versão:** 1.0  
**Data:** 27 de outubro de 2026  
**Elaborado por:** Hermes (Tech Lead / Gerente / Arquiteto)  
**Item Roadmap:** #46 — SMTP de Produção / SPF / DKIM / DMARC  
**Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## 1. Objetivo

Garantir a entregabilidade de e-mails transacionais do MangaNetWorking em produção, protegendo o domínio contra spoofing e phishing, e respeitando os requisitos do **Google Postmaster**, **Microsoft JMRP** e das normas brasileiras de privacidade (LGPD, Art. 6º — Segurança).

---

## 2. Provedor de E-mail Transacional Recomendado

| Critério | Recomendado | Alternativo |
|---|---|---|
| Provedor | **Brevo (SendinBlue)** ou **Mailgun** | Amazon SES |
| Protocolo de envio | SMTP (porta 587, STARTTLS) | API HTTP |
| Volume esperado | < 5.000 e-mails/mês no início | Escalar conforme crescimento |
| Custo estimado | Plano gratuito até 300/dia | Pago a partir de volume |

> **Regra de segurança:** NUNCA usar conta pessoal (Gmail, Outlook) como SMTP de produção. Isso viola os ToS dos provedores e bloqueia e-mails transacionais.

---

## 3. Registros DNS Obrigatórios

### 3.1 SPF (Sender Policy Framework)

O SPF autoriza quais servidores podem enviar e-mails em nome do domínio.

```dns
# Substitua <ip-do-servidor> pelo IP do servidor de produção
# Substitua <provedor-include> pelo include do provedor (ex: brevo.com, mailgun.org)
manganetworking.com. IN TXT "v=spf1 ip4:<ip-do-servidor> include:<provedor-include> ~all"
```

**Regras:**
- Use `~all` (softfail) durante transição; migre para `-all` (hardfail) após validação de 30 dias.
- Máximo de 10 lookups DNS no SPF (violação causa falha na validação).

### 3.2 DKIM (DomainKeys Identified Mail)

O DKIM assina criptograficamente o conteúdo dos e-mails enviados.

```dns
# Gerar par de chaves RSA 2048-bit:
# openssl genrsa -out dkim_private.pem 2048
# openssl rsa -in dkim_private.pem -pubout -out dkim_public.pem

# Registro TXT no DNS (substituir <chave-pública-base64> com a chave gerada):
mail._domainkey.manganetworking.com. IN TXT "v=DKIM1; k=rsa; p=<chave-pública-base64>"
```

**Boas práticas:**
- Selector recomendado: `mail` (permite rotação posterior com `mail2`, `mail3`).
- Rotação de chave: **a cada 12 meses** ou imediatamente após suspeita de comprometimento.
- Armazenar `dkim_private.pem` em cofre de secrets (Vault, AWS Secrets Manager) — **nunca no repositório**.

### 3.3 DMARC (Domain-based Message Authentication, Reporting & Conformance)

O DMARC define o que fazer com e-mails que falham SPF/DKIM e coleta relatórios de entregabilidade.

```dns
_dmarc.manganetworking.com. IN TXT "v=DMARC1; p=quarantine; sp=reject; pct=100; rua=mailto:dmarc-relatorios@manganetworking.com; ruf=mailto:dmarc-falhas@manganetworking.com; fo=1; adkim=s; aspf=s"
```

**Política de implantação progressiva:**

| Fase | Política | Prazo |
|---|---|---|
| 1 — Monitoramento | `p=none` | 2 semanas |
| 2 — Quarentena parcial | `p=quarantine; pct=25` | 2 semanas |
| 3 — Quarentena total | `p=quarantine; pct=100` | 2 semanas |
| 4 — Rejeição plena | `p=reject` | Definitivo |

### 3.4 MX Records

```dns
manganetworking.com. IN MX 10 mail.manganetworking.com.
```

---

## 4. Variáveis de Ambiente de Produção

Adicionar ao `ops/deploy/env.production.example`:

```env
# ── E-MAIL TRANSACIONAL ──────────────────────────────────────────────────
MAIL_HOST=smtp.brevo.com
MAIL_PORT=587
MAIL_USERNAME=<api-login-brevo>
MAIL_PASSWORD=<api-key-brevo-do-vault>
MAIL_FROM=noreply@manganetworking.com
MAIL_FROM_NAME=MangaNetWorking

# ── DOMÍNIO ─────────────────────────────────────────────────────────────
APP_BASE_URL=https://manganetworking.com
ALLOWED_ORIGINS=https://manganetworking.com

# ── WEBHOOK DE BOUNCE ────────────────────────────────────────────────────
# Configurar no painel do provedor para chamar:
# POST https://manganetworking.com/api/webhooks/mail/bounce
BOUNCE_WEBHOOK_SECRET=<gerar-com-openssl-rand-hex-32>
```

---

## 5. Configuração do Webhook de Bounce (Item #46)

O backend já possui o endpoint `POST /api/webhooks/mail/bounce` implementado (V16 do roadmap). Para ativar em produção:

1. No painel do provedor (Brevo/Mailgun), configurar webhook para eventos:
   - `hard_bounce` → suprime endereço permanentemente
   - `soft_bounce` (≥ 3 vezes) → suprime temporariamente
   - `spam_complaint` → suprime e notifica moderação

2. Configurar o segredo `BOUNCE_WEBHOOK_SECRET` idêntico no `.env` de produção e no painel do provedor.

3. Testar com evento sintético:
```bash
curl -X POST https://manganetworking.com/api/webhooks/mail/bounce \
  -H "X-Bounce-Secret: <BOUNCE_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"email":"teste-bounce@example.invalid","event":"hard_bounce","timestamp":"2026-10-27T12:00:00Z"}'
```

---

## 6. Checklist de Go-Live de E-mail

- [ ] Provedor de e-mail transacional contratado e conta ativa
- [ ] Registro SPF publicado e testado (ferramenta: `dig TXT manganetworking.com`)
- [ ] Par de chaves DKIM 2048-bit gerado; chave privada em cofre de secrets
- [ ] Registro DKIM publicado e testado (ferramenta: MXToolbox DKIM Lookup)
- [ ] DMARC em `p=none` (monitoramento) por 2 semanas
- [ ] Relatórios DMARC sendo recebidos e analisados
- [ ] DMARC escalado para `p=reject` após 6 semanas
- [ ] Webhook de bounce configurado e testado
- [ ] Variáveis de produção salvas no Vault (nunca em `.env` commitado)
- [ ] Teste de envio de OTP, reset de senha e confirmação de cadastro em produção

---

*Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)*
