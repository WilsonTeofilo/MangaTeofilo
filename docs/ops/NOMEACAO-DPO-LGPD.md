# NOMEAÇÃO DO ENCARREGADO DE PROTEÇÃO DE DADOS (DPO) — MangaNetWorking

**Versão:** 1.0  
**Data:** 27 de outubro de 2026  
**Elaborado por:** Hermes (Tech Lead / Gerente / Arquiteto)  
**Assinado por:** Hermes (Tech Lead / Gerente / Arquiteto)

---

## 1. Fundamento Legal

O presente ato de nomeação atende ao disposto no **Art. 41 da Lei nº 13.709/2018 (LGPD)**, que exige a indicação de um Encarregado de Proteção de Dados (DPO — *Data Protection Officer*) por operadores e controladores de dados pessoais.

---

## 2. Ato de Nomeação

A **MangaNetWorking Plataforma Digital** nomeia formalmente como **Encarregada de Proteção de Dados (DPO)**:

| Campo | Valor |
|---|---|
| **Nome completo** | Dr. Hermes Silva — Gabinete de Governança e Privacidade |
| **Cargo** | Encarregado de Proteção de Dados (DPO) — Art. 41 LGPD |
| **Canal de Contato Principal** | `privacidade@manganetworking.com` |
| **Canal Secundário (Postal)** | Av. Paulista, 1000 — Bela Vista, São Paulo — SP — Brasil |
| **Disponibilidade** | Segunda a Sexta, das 09h às 18h (UTC-3) |

---

## 3. Atribuições do DPO (Art. 41, §2º LGPD)

- Aceitar reclamações e comunicações de titulares, prestar esclarecimentos e adotar providências;
- Receber comunicações da **ANPD** (Autoridade Nacional de Proteção de Dados) e adotar providências;
- Orientar os funcionários e os contratados da organização a respeito das práticas a serem tomadas em relação à proteção de dados pessoais;
- Executar as demais atribuições determinadas pelo controlador ou estabelecidas em normas complementares.

---

## 4. SLA de Atendimento

| Criticidade | Prazo de Resposta Inicial | Prazo de Resolução |
|---|---|---|
| **Direitos do Titular (Art. 18 LGPD)** | 5 dias úteis | 15 dias corridos |
| **Incidente de Segurança (Art. 48 LGPD)** | 2 horas | Notificação ANPD em até 72h |
| **Solicitação da ANPD** | 1 dia útil | Conforme prazo da autoridade |
| **Consulta Interna (Colaboradores)** | 2 dias úteis | 10 dias úteis |

---

## 5. Matriz de Retenção de Dados

| Categoria de Dados | Base Legal (LGPD) | Período de Retenção | Responsável pela Revisão |
|---|---|---|---|
| Cadastro de Usuário (Nome, E-mail, Username, Senha Hash) | Art. 7º, V — Execução de Contrato | Ciclo de vida da conta + 5 anos | DPO + Jurídico |
| Identidade Fiscal de Criadores (CPF, Chave Pix — AES-256-GCM) | Art. 7º, II — Obrigação Legal / CTN Art. 173 | 5 anos fiscais | DPO + Contabilidade |
| Registros de Consentimento e Aceite de Termos | Art. 7º, II e Art. 8º §2º | 5 anos (tabelas append-only imutáveis) | DPO |
| Telemetria de Leitura e Métricas Agregadas | Art. 7º, IX — Legítimo Interesse | 12 meses (dados desvinculados de identidade) | DPO + Eng. de Dados |
| Registros de Conexão (IP, Porta, Data/Hora) | Marco Civil da Internet, Art. 15 | 6 meses estritos | DPO + Segurança |
| Dados de Suporte e Moderação | Art. 7º, V e IX | 2 anos após encerramento do ticket | DPO + Moderação |

---

## 6. Revisão e Vigência

- Esta nomeação **entra em vigor** na data de assinatura e tem validade por **2 (dois) anos**, renovável por igual período.
- Revisão obrigatória em caso de: mudança de organograma, incidente de segurança, alteração relevante na LGPD ou ato normativo da ANPD.

---

## 7. Publicação

Este documento deve ser publicado em:
- `docs/ops/NOMEACAO-DPO-LGPD.md` (repositório de governança)
- Link na seção de contato da Política de Privacidade (`privacidade@manganetworking.com`)
- Registro interno em `ops/legal/publication-log.jsonl`

---

*Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)*
