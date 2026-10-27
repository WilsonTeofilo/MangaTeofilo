# ARQUITETURA DE SEGURANÇA, CRIPTOGRAFIA DE DADOS EM REPOUSO & CONFORMIDADE LGPD

**Projeto:** MangaNetWorking / MangaTeofilo  
**Data:** 26/10/2026  
**Status:** Auditado & Blindado para Produção  
**Classificação:** Segurança da Informação & Governança de Dados (LGPD)  

---

## 1. Visão Geral da Ameaça & Objetivo

Em conformidade estrita com a **Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD)** e com os padrões **OWASP Application Security Verification Standard (ASVS)**, a plataforma foi blindada contra cenários catastróficos de vazamento de dados:
> **Cenário de Ameaça:** Se um atacante obtiver acesso físico, dump direto do banco de dados (ex.: dump SQL do PostgreSQL) ou backup não autorizado, **os dados pessoais sensíveis e financeiros dos usuários e criadores permanecerão 100% ilegíveis e indecifráveis**.

---

## 2. Camadas de Proteção Criptográfica

### 2.1 Criptografia em Repouso no Nível de Aplicação (Application-Level Encryption)
Para dados que precisam ser recuperados pela plataforma (ex.: repasse financeiro de PIX e conferência fiscal de CPF):

* **Algoritmo:** `AES-256-GCM` (`AES/GCM/NoPadding`).
* **Vetor de Inicialização (IV):** Gerado via `SecureRandom` criptográfico com **12 bytes** a cada gravação individual. Nenhuma chave/registro compartilha o mesmo IV, eliminando qualquer vetor de ataque de repetição.
* **Tag de Autenticação:** **128 bits**, garantindo integridade criptográfica. Qualquer tentativa de alteração manual de bits no banco (bit-flipping attack) resulta em falha de autenticação e rejeição imediata pelo conversor.
* **Conversor JPA:** [`AesCryptoConverter.java`](file:///D:/Projetos/MangaNetWorking/backend/src/main/java/com/manganetworking/config/security/AesCryptoConverter.java).
* **Campos Blindados com AES-256-GCM:**
  1. `CreatorEntity.documentCpf`: CPF do titular do canal (Dado Pessoal Regulado).
  2. `CreatorEntity.pixKey`: Chave PIX do criador (Dado Financeiro).
  3. `UserEntity.twoFactorSecret`: Segredo do autenticador de segundo fator (Credencial Crítica).

### 2.2 Blindagem de Chaves Mestras em Produção (`ProductionSecretsGuard`)
Para evitar a vulnerabilidade crítica de subir em produção com chave default ou fraca:
* O componente [`ProductionSecretsGuard.java`](file:///D:/Projetos/MangaNetWorking/backend/src/main/java/com/manganetworking/config/security/ProductionSecretsGuard.java) é acionado com `@Profile("prod")` e **aborta imediatamente o boot da aplicação** (`IllegalStateException`) se:
  * A variável `AES_SECRET_KEY` estiver vazia, indefinida ou for igual à chave mock de desenvolvimento.
  * O tamanho da chave for inferior a 32 bytes (256 bits).
  * `OTP_HMAC_SECRET` for o valor padrão ou tiver menos de 32 bytes.
  * `COOKIE_SECURE` for `false` (inviabiliza tráfego HTTP puro).
  * `EMAIL_WEBHOOK_SECRET` for inferior a 32 caracteres.

### 2.3 Hashing Criptográfico Unidirecional (One-Way Hashing)
Para credenciais que nunca precisam ser recuperadas em texto claro:
* **Senhas de Usuários:** Hashing com `BCrypt` com fator de trabalho e proteção Unicode via [`UnicodeAwarePasswordEncoder.java`](file:///D:/Projetos/MangaNetWorking/backend/src/main/java/com/manganetworking/config/security/UnicodeAwarePasswordEncoder.java).
* **Tokens de Redefinição de Senha:** O token enviado ao titular via e-mail tem entropia de 256 bits. O banco armazena exclusivamente `SHA-256(token)` em [`PasswordResetTokenEntity.java`](file:///D:/Projetos/MangaNetWorking/backend/src/main/java/com/manganetworking/domain/relational/PasswordResetTokenEntity.java) com expiração estrita de 30 minutos.
* **Desafios 2FA (OTP):** Códigos efêmeros de 6 dígitos gerados via `SecureRandom`, assinados com `HmacSHA256(secret, user + purpose + otp)` e armazenados no Redis com TTL de 5 minutos e contadores de bloqueio anti-força bruta.

---

## 3. Conformidade Estrita com a LGPD (Direitos do Titular)

| Artigo da LGPD | Princípio / Direito | Implementação Técnica na Plataforma |
|---|---|---|
| **Art. 6º, III** | **Minimização de Dados** | A tabela `creator_pix_key_audit` armazena apenas a máscara de 8 caracteres (`previousKeyMask`, `newKeyMask`), nunca a chave inteira. IPs e User-Agents de consentimento são truncados para evitar supercoleta. |
| **Art. 6º, VII** | **Segurança** | Criptografia AES-256-GCM para dados em repouso e TLS obrigatório em trânsito. |
| **Art. 18, II** | **Direito de Acesso / Exportação** | Endpoint `GET /api/users/me/export` via `UserProfileApplicationService.exportUserData(userId)`, gerando DTO completo com dados cadastrais e histórico de leitura em formato aberto. |
| **Art. 18, VI** | **Direito ao Esquecimento / Anonimização** | Método `UserProfileApplicationService.deleteUserAccountLgpd(userId)`: remove fisicamente arquivos de mídia do disco, altera e-mail para `anon-{uuid}@deleted.manganetworking`, nome para "Usuário Removido (LGPD)", anula hashes e dados de nascimento, revoga privilégios e expurga 100% da telemetria de leitura do MongoDB. |
| **Art. 7º, I / Art. 8º** | **Consentimento & Auditoria** | Tabela `privacy_consent_events` registra a versão da política aceita, propósito e carimbo de data/hora imutável. |

---

## 4. Requisitos Obrigatórios de Infraestrutura em Produção (Runbook)

1. **PostgreSQL:**
   * A string `SPRING_DATASOURCE_URL` deve incluir parâmetros estritos de TLS: `?sslmode=require` ou `?sslmode=verify-full`.
   * Habilitar TDE (Transparent Data Encryption) no provedor de nuvem (AWS RDS, GCP Cloud SQL ou Supabase).
2. **MongoDB:**
   * `SPRING_DATA_MONGODB_URI` com `tls=true&tlsAllowInvalidCertificates=false`.
3. **Redis:**
   * Conexão via protocolo `rediss://` com autenticação por senha e TLS ativado.
4. **Variáveis de Ambiente Mandatórias (Segredos de Produção):**
   * `AES_SECRET_KEY`: String aleatória de 32 a 64 caracteres gerada via `openssl rand -base64 32`.
   * `OTP_HMAC_SECRET`: String aleatória de pelo menos 32 caracteres.
   * `COOKIE_SECURE`: `true`.
   * `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET`: Credenciais de produção do Mercado Pago.

---

Assinado por: Hermes (Tech Lead & Arquiteto Principal)