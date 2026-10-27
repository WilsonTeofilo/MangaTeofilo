# POLÍTICA DE BACKUP E DISASTER RECOVERY — MangaNetWorking

**Versão:** 1.0  
**Data:** 27 de outubro de 2026  
**Elaborado por:** Hermes (Tech Lead / Gerente / Arquiteto)  
**Item Roadmap:** #42 — Backup/Restore Real / Off-site / KMS / Retenção  
**Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## 1. Objetivos

- **RPO (Recovery Point Objective):** Máximo 24 horas de perda de dados.
- **RTO (Recovery Time Objective):** Máximo 4 horas para restaurar o serviço em caso de desastre total.
- **Conformidade LGPD:** Backups de dados pessoais devem seguir os mesmos critérios de segurança e retenção da política de privacidade.

---

## 2. Escopo dos Backups

| Sistema | Banco de Dados | Frequência | Retenção |
|---|---|---|---|
| **PostgreSQL** (dados principais: users, works, chapters) | `manganetworking_prod` | Diário (02:00 UTC-3) | 30 dias diário / 90 dias semanal / 365 dias mensal |
| **MongoDB** (conteúdo de capítulos, telemetria) | `manganetworking_mongo` | Diário (03:00 UTC-3) | 30 dias diário / 90 dias semanal |
| **Redis** (sessões, OTP, rate limit) | Snapshot RDB | A cada 6 horas | 7 dias (dados voláteis) |
| **Arquivos de Upload** (capas, páginas manga, PDFs) | Armazenamento de objetos (S3/R2) | Versionamento contínuo S3 | 90 dias versões deletadas |

---

## 3. Destino Off-site

| Tier | Destino | Protocolo | Criptografia |
|---|---|---|---|
| **Primário (on-site)** | Volume Docker local / NAS | Filesystem local | AES-256 envelope (KMS) |
| **Secundário (off-site)** | **Cloudflare R2** ou **AWS S3** (bucket isolado) | HTTPS / S3 API | SSE-KMS (chave gerenciada pelo provedor) + criptografia de cliente (AES-256-GCM) |
| **Terciário (cold storage)** | AWS Glacier / Cloudflare R2 Infrequent Access | S3 Glacier API | Idem secundário |

---

## 4. Criptografia de Backups (KMS Envelope Encryption)

### 4.1 Arquitetura

```
[Dump PostgreSQL / MongoDB]
        ↓
[Compressão GZIP]
        ↓
[Criptografia AES-256-GCM com Data Encryption Key (DEK)]
        ↓
[DEK criptografado com Key Encryption Key (KEK) — AWS KMS / Cloudflare KMS]
        ↓
[Upload para S3/R2 com metadados: sha256, versão, timestamp, encrypted-dek]
```

### 4.2 Rotação de Chaves

- **KEK:** Rotação anual ou imediatamente após suspeita de comprometimento.
- **DEK:** Gerada nova para cada backup individual (garantia de *key isolation*).
- **Armazenamento da KEK:** Exclusivamente no KMS do provedor cloud. **Nunca em disco local ou repositório Git.**

---

## 5. Script de Backup (ops/backup-restore.ps1)

O script existente em `ops/backup-restore.ps1` implementa:

1. `pg_dump` com formato custom para PostgreSQL
2. `mongodump` para MongoDB
3. Cálculo de SHA-256 dos dumps
4. Verificação de integridade
5. Upload para destino off-site (parâmetro `-OffsiteDestination`)
6. Registro em log append-only

**Execução manual:**
```powershell
# Dry-run (simulação sem upload real)
.\ops\backup-restore.ps1 -DryRun

# Backup completo com upload para R2
.\ops\backup-restore.ps1 -OffsiteDestination "s3://manganetworking-backups-prod" -RetentionDays 30

# Restauração isolada (ambiente de homologação)
.\ops\backup-restore.ps1 -Restore -BackupId "backup-20261027-020000" -TargetEnv staging
```

---

## 6. Simulação de Restore (Executada em 2026-10-27)

Backup e restore foram validados localmente com bancos isolados:

| Etapa | Status | Evidência |
|---|---|---|
| `pg_dump` do banco `manganetworking_dev` | ✅ Concluído | SHA-256 registrado |
| Restauração em banco isolado `_restore_test` | ✅ Concluído | Contagem de registros idêntica |
| `mongodump` e `mongorestore` isolado | ✅ Concluído | Coleções validadas |
| Cálculo SHA-256 e verificação de integridade | ✅ Concluído | Checksums aprovados |
| Upload off-site real | ⚠️ **Pendente** | Aguarda conta R2/S3 de produção |
| Criptografia KMS real | ⚠️ **Pendente** | Aguarda provisionamento KMS |
| Restauração de backup cifrado | ⚠️ **Pendente** | Depende do item acima |

---

## 7. Política de Retenção

| Frequência | Retenção | Responsável pela Limpeza |
|---|---|---|
| **Diária** | 30 dias | Script automatizado (cron diário) |
| **Semanal** (segunda-feira) | 90 dias | Script automatizado (cron semanal) |
| **Mensal** (1º dia) | 365 dias | Script automatizado (cron mensal) |
| **Anual** (1º de janeiro) | 7 anos (Código Civil) | Revisão manual + DPO |

> **LGPD — Atenção:** Backups contendo dados pessoais identificáveis devem ser incluídos nas solicitações de exclusão (Art. 18, IV). O processo de "anonimização de backup" deve ser documentado e executado no prazo de 30 dias corridos após solicitação de exclusão.

---

## 8. Checklist de Produção — Backup Off-site

- [ ] Conta AWS S3 ou Cloudflare R2 criada com bucket isolado (`manganetworking-backups-prod`)
- [ ] Política de bucket configurada: acesso restrito a IAM role do servidor de backup
- [ ] KMS configurado: KEK criada no AWS KMS ou Cloudflare KMS
- [ ] Script `ops/backup-restore.ps1` testado com credenciais de produção
- [ ] Cron job configurado no servidor de produção (02:00 e 03:00 UTC-3)
- [ ] Primeiro backup completo de produção executado e SHA-256 registrado
- [ ] Teste de restauração de produção em ambiente de homologação executado
- [ ] Retenção automatizada validada (limpeza de backups antigos)
- [ ] DPO notificado sobre a política de retenção e ciclo de vida de dados pessoais em backup

---

## 9. Disaster Recovery

### 9.1 Cenários e Procedimentos

| Cenário | Procedimento | RTO Estimado |
|---|---|---|
| Falha de container único | Reiniciar via Docker Compose (`docker compose restart <serviço>`) | 5 min |
| Falha de servidor inteiro | Provisionar nova VM, executar `docker compose up -d` | 1 hora |
| Corrupção de banco de dados | Restaurar último backup diário no banco isolado; validar; promover | 2–4 horas |
| Comprometimento de segurança | Isolar servidor, revogar chaves, restaurar de backup pré-comprometimento | 4–8 horas |
| Perda total do datacenter | Provisionar em cloud alternativa com backups off-site | < 4 horas (se R2/S3 configurado) |

---

*Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)*
