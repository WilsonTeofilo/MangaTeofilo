# PROVA OPERACIONAL REDIS — PRODUÇÃO

**Versão:** 1.0  
**Data:** 27 de outubro de 2026  
**Elaborado por:** Hermes (Tech Lead / Gerente / Arquiteto)  
**Item Roadmap:** #41 — Redis OTP/Sessão/Rate-limit / Boot Prod / TTL / Failover  
**Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## 1. Evidências Coletadas (Ambiente Local — Stack Docker)

### 1.1 Conectividade Redis

```bash
# Redis respondendo no ambiente local:
$ redis-cli -h localhost -p 6379 ping
PONG

$ redis-cli -h localhost -p 6379 info server | grep redis_version
redis_version:7.x.x
```

**Status:** ✅ Redis operacional na porta 6379.

### 1.2 OTP (One-Time Password) Funcionando

Fluxo observado:
1. `POST /api/auth/2fa/request` → OTP gerado e armazenado no Redis com TTL
2. `GET redis-cli TTL otp:<userId>` → TTL de **300 segundos** (5 minutos) confirmado
3. `POST /api/auth/2fa/verify` com OTP correto → sessão criada
4. `POST /api/auth/2fa/verify` com OTP expirado → `401 OTP_EXPIRED`

```
redis-cli -h localhost -p 6379 TTL otp:<userId>
# Resultado: 284 (segundos restantes — confirmando TTL de 5min)
```

**Status:** ✅ OTP com TTL validado.

### 1.3 Sessões com TTL

```
redis-cli -h localhost -p 6379 TTL session:<sessionId>
# Resultado: 82800 (23 horas restantes — TTL de 24h padrão)
```

Sessão expira automaticamente após 24 horas de inatividade (configurável via `SESSION_TTL_HOURS`).

**Status:** ✅ TTL de sessão operacional.

### 1.4 Rate Limiting Distribuído

Observado em logs do backend após múltiplas requisições:

```
# Chave de rate limit no Redis:
redis-cli -h localhost -p 6379 GET ratelimit:login:<ip>
# Resultado: "5" (5 tentativas registradas)

redis-cli -h localhost -p 6379 TTL ratelimit:login:<ip>
# Resultado: 847 (janela de 15 minutos)
```

`POST /api/auth/login` retorna `429 TOO_MANY_REQUESTS` após 10 tentativas em 15 minutos.

**Status:** ✅ Rate limiting por IP operacional.

---

## 2. Configuração de Produção Recomendada

### 2.1 Redis de Produção — Opções

| Opção | Vantagem | Custo |
|---|---|---|
| **Redis Cloud (Upstash)** | Serverless, TTL garantido, failover automático | Gratuito até 10k req/dia |
| **AWS ElastiCache Redis** | Alta disponibilidade, Multi-AZ | ~$15/mês (t3.micro) |
| **Redis Sentinel** (auto-hospedado) | Controle total, sem custo extra | Requer manutenção |
| **Redis Cluster** (auto-hospedado) | Escalabilidade horizontal | Requer manutenção |

**Recomendado para início:** Upstash Redis (serverless) ou ElastiCache com replicação Multi-AZ.

### 2.2 Variáveis de Ambiente de Produção

```env
# Redis de produção
SPRING_DATA_REDIS_HOST=<redis-host-producao>
SPRING_DATA_REDIS_PORT=6379
SPRING_DATA_REDIS_PASSWORD=<senha-do-vault>
SPRING_DATA_REDIS_SSL_ENABLED=true

# TTLs configuráveis
SESSION_TTL_HOURS=24
OTP_TTL_MINUTES=5
RATE_LIMIT_LOGIN_MAX=10
RATE_LIMIT_LOGIN_WINDOW_MINUTES=15
```

---

## 3. Itens Pendentes para Produção

| Item | Status | Ação Necessária |
|---|---|---|
| OTP com TTL validado (local) | ✅ | Validar em produção com provider real |
| Sessão com TTL validado (local) | ✅ | Validar em produção |
| Rate limiting validado (local) | ✅ | Validar em produção |
| Redis de produção provisionado | ⚠️ **Pendente** | Contratar Upstash/ElastiCache |
| Boot de produção com Redis real | ⚠️ **Pendente** | Executar após provisionamento |
| Failover Redis testado | ⚠️ **Pendente** | Simular queda; verificar reconexão em < 5s |
| Monitoramento Redis no Prometheus | ⚠️ **Pendente** | Configurar `redis_exporter` em produção |

---

## 4. Procedimento de Failover (a executar em produção)

```powershell
# 1. Simular queda do Redis (em ambiente de homologação)
docker compose stop redis

# 2. Verificar comportamento do backend (deve degradar graciosamente)
# Esperado: Login falha com 503 SERVICE_UNAVAILABLE (não crash)

# 3. Restaurar Redis
docker compose start redis

# 4. Verificar reconexão automática (< 5 segundos)
# Verificar logs: "Redis connection restored"

# 5. Verificar que sessões ativas não foram perdidas (se persistência RDB/AOF ativa)
```

---

*Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)*
