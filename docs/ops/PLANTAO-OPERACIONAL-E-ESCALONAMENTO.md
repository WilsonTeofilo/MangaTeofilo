# PLANTÃO OPERACIONAL E ESCALAMENTO — MangaNetWorking

**Versão:** 1.0  
**Data:** 27 de outubro de 2026  
**Elaborado por:** Hermes (Tech Lead / Gerente / Arquiteto)  
**Item Roadmap:** #45 — Alertmanager / Canal Institucional / Nomeação de Plantão  
**Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## 1. Objetivo

Definir o **protocolo formal de plantão operacional**, a política de escalamento de incidentes e os canais de notificação institucionais para garantia de disponibilidade e resposta a incidentes no ambiente de produção MangaNetWorking.

---

## 2. Equipe de Plantão (On-Call)

| Nível | Responsável | Canal de Contato | Disponibilidade |
|---|---|---|---|
| **L1 — Plantão Primário** | Engenheiro de Plantão (rotativo) | `plantao@manganetworking.com` / PagerDuty | 24/7 |
| **L2 — Tech Lead** | Hermes Silva | `hermes@manganetworking.com` | Seg–Sex 09h–22h; Urgência 24/7 |
| **L3 — Diretoria** | CTO / Diretor de Tecnologia | `diretoria-ti@manganetworking.com` | Urgência 24/7 |

**Rotação de plantão:** Semanal, com handoff toda segunda-feira às 09h00 (UTC-3).  
**Contato de emergência:** Definir canal no PagerDuty / Opsgenie apontando para `plantao@manganetworking.com`.

---

## 3. Configuração do Alertmanager

### 3.1 Canais de Notificação (já configurados localmente)

```yaml
# ops/monitoring/alertmanager.yml — receptores de produção a configurar:

receivers:
  - name: 'plantao-email'
    email_configs:
      - to: 'plantao@manganetworking.com'
        from: 'alertmanager@manganetworking.com'
        smarthost: 'smtp.brevo.com:587'
        auth_username: '<api-login>'
        auth_password: '<api-key-do-vault>'
        send_resolved: true

  - name: 'slack-ops'
    slack_configs:
      - api_url: '<SLACK_WEBHOOK_URL>'
        channel: '#ops-alertas'
        title: '{{ .CommonAnnotations.summary }}'
        text: '{{ .CommonAnnotations.description }}'
        send_resolved: true

  - name: 'pagerduty-l1'
    pagerduty_configs:
      - routing_key: '<PAGERDUTY_INTEGRATION_KEY>'
        description: '{{ .CommonAnnotations.summary }}'
        severity: '{{ .CommonLabels.severity }}'
```

### 3.2 Regras de Roteamento

```yaml
route:
  group_by: ['alertname', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'plantao-email'

  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-l1'
      continue: true

    - match:
        severity: warning
      receiver: 'slack-ops'
```

---

## 4. Política de Escalamento

### 4.1 Fluxo de Escalamento

```
[Alerta Disparado pelo Alertmanager]
        ↓ 0 min
[L1 — Plantão Primário notificado via e-mail + PagerDuty]
        ↓ +15 min (sem ack ou resolução)
[L1 escalado → Notificação ao L2 Tech Lead]
        ↓ +30 min (sem resolução)
[L2 escalado → Notificação ao L3 Diretoria]
        ↓ +60 min (sem resolução)
[Criação de Bridge de Incidente — War Room]
```

### 4.2 Tabela de SLA por Severidade

| Severidade | Critério | SLA Ack | SLA Resolução | Escalamento Automático |
|---|---|---|---|---|
| **CRITICAL** | Serviço fora do ar; perda de dados | 5 min | 2 horas | L1 → L2 em 15min; L2 → L3 em 30min |
| **HIGH** | Degradação severa; erro > 5% | 15 min | 4 horas | L1 → L2 em 30min |
| **WARNING** | Anomalia detectada; tendência de degradação | 30 min | 8 horas | Registro de ticket; revisão na daily |
| **INFO** | Evento informativo; métrica de tendência | Sem SLA | Sem SLA | Nenhum |

---

## 5. Alertas Ativos Configurados (Prometheus)

Os seguintes alertas já estão configurados em `ops/monitoring/alert-rules.yml`:

| Alerta | Condição | Severidade |
|---|---|---|
| `BackendDown` | `up{job="mangaNetworking-backend"} == 0` por 2min | critical |
| `FrontendDown` | `probe_success{job="frontend"} == 0` por 2min | critical |
| `HighErrorRate` | `rate(http_server_requests_seconds_count{status=~"5.."}[5m]) > 0.05` | high |
| `HighLatency` | `http_server_requests_seconds_p95 > 2.0` por 5min | warning |
| `DatabaseConnectionPoolExhausted` | `hikaricp_connections_active / hikaricp_connections_max > 0.9` | high |
| `RedisDown` | `redis_up == 0` por 2min | critical |
| `DiskSpaceLow` | `node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.1` | warning |
| `MongoDown` | `mongodb_up == 0` por 2min | high |

---

## 6. Alerta Sintético (Teste de Canal)

Para validar que o canal de notificação está funcionando, executar mensalmente:

```powershell
# Dispara alerta sintético no Alertmanager e verifica entrega no canal
$payload = '[{"labels":{"alertname":"TesteSinteticoPlantao","severity":"warning","service":"teste"},"annotations":{"summary":"Teste sintetico de canal de plantao","description":"Este alerta valida o canal de notificacao operacional. Nenhuma acao necessaria."}}]'
Invoke-RestMethod -Uri 'http://localhost:9093/api/v2/alerts' -Method Post -Body $payload -ContentType 'application/json'
Write-Host "Alerta sintetico disparado. Verificar recepcao em plantao@manganetworking.com"
```

---

## 7. Checklist de Produção — Canal Institucional

- [ ] Conta de e-mail `plantao@manganetworking.com` criada no provedor corporativo
- [ ] Conta de e-mail `alertmanager@manganetworking.com` criada para envio de alertas
- [ ] Canal `#ops-alertas` criado no Slack/Teams institucional
- [ ] Webhook do Slack configurado em `SLACK_WEBHOOK_URL` no Vault
- [ ] Conta PagerDuty/Opsgenie criada com integration key no Vault
- [ ] Rotação de plantão configurada (escala semanal documentada)
- [ ] Teste de alerta sintético executado e entrega confirmada em todos os canais
- [ ] Runbook de incidentes revisado e assinado pelo operador de plantão

---

## 8. Runbook de Incidente (Resumo)

Ver runbook completo em `ops/incident/RUNBOOK-INCIDENTE.md`.

**Fluxo resumido para o L1:**
1. Receber alerta via e-mail / PagerDuty
2. Acessar o dashboard Grafana: `http://grafana.manganetworking.com`
3. Verificar Prometheus: `http://prometheus.manganetworking.com`
4. Executar diagnóstico inicial (ver seção do serviço afetado no Runbook)
5. Registrar o incidente no sistema de tickets (GitHub Issues / Linear)
6. Acionar L2 se não resolvido em 15 minutos

---

*Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)*
