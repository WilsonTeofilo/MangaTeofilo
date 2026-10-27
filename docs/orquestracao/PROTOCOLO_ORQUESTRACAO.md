# Protocolo Operacional — Fluxo Único

> **Modelo oficial:** um agente, um chat, visão full-stack.
> O modelo de múltiplas janelas/abas e de subagentes com handoff em arquivo foi **abolido**.
> Os arquivos de subagente (`.opencode/agents/`) foram movidos para `D:\Projetos\Generico\_legacy\manganetworking-agents\`.

---

## 1. Princípios

1. **Visão única:** a mesma janela enxerga backend, frontend, banco, Docker, segurança e LGPD. Isso elimina o descompasso que gerou o commit misto `f6a482f`.
2. **Foco cirúrgico:** cada rodada toca no máximo 2–3 arquivos de código, para não estourar cota nem espalhar regressão.
3. **Verificação real:** nada é declarado pronto sem saída de terminal (`mvn -o test`, `npm run build`, `docker compose up -d` + smoke).
4. **Sem burocracia de papel:** não criar `TASK-XXX.md`, `RELATORIO-XXX.md` ou `PARECER-XXX.md` por padrão. O histórico mora em `HISTORICO_TAREFAS.md`; o estado, em `ROADMAP-FASES.md`; os problemas, em `AUDITORIA-ATUAL.md`.
5. **Registro no mesmo lugar:** ao concluir um item, atualize o roadmap e a auditoria no mesmo commit.

---

## 2. Roteador de contexto por domínio

Use esta tabela para achar os arquivos de um fluxo sem varrer o repositório.

| Domínio | Backend | Frontend |
|---|---|---|
| Autenticação, 2FA e sessão | `service/auth/`, `service/mfa/`, `service/session/`, `config/security/` | `pages/LoginPage.tsx`, `api/authApi.ts`, `context/AuthContext.tsx` |
| LGPD e perfis | `service/user/UserProfileApplicationService.java`, `domain/relational/UserEntity.java` | `pages/Profile`, `api/userApi.ts` |
| Obras, capítulos e leitor | `service/work/`, `service/storage/`, `controller/WorkController.java` | `pages/ReaderPage.tsx`, `pages/WorkDetailPage.tsx` |
| Monetização e financeiro | `service/monetization/`, `service/creator/`, `controller/CreatorController.java` | `api/creatorApi.ts`, `pages/CreatorWorkspacePage.tsx` |
| Feed e descoberta | `service/recommendation/`, `service/creator/` | `pages/HomePage.tsx`, `pages/CatalogPage.tsx` |
| Infra e dados | `db/migration/`, `docker-compose.yml`, `application.yml` | `vite.config.ts`, `Dockerfile` |

---

## 3. Diretrizes de qualidade

- **Zero mocks/placeholders em produção:** dados de carteira, saldo e doações vêm da API; mock só atrás de `import.meta.env.DEV`.
- **Zero segredos em código:** chaves e senhas por variável de ambiente; `application.yml` sem default válido em produção.
- **Fail-fast em produção:** `AES_SECRET_KEY` e credenciais de e-mail ausentes derrubam o boot no perfil `prod`.
- **Transações:** mutação no Postgres com `@Transactional`; sincronização Mongo/evento só após commit (`AFTER_COMMIT`).
- **Segurança server-side:** papel, ownership, 2FA, preço e visibilidade nunca vêm do cliente.
- **Nomes que revelam intenção:** funções pequenas, sem número mágico, sem `try/catch` genérico (use `@RestControllerAdvice`).
- **DTO é `record`; entidade não cruza a fronteira da API.**

---

## 4. Fluxo de uma rodada (resumo)

```
1. Ler ROADMAP-FASES.md + AUDITORIA-ATUAL.md
2. Escolher 1 item da fila única
3. Inspecionar controller -> service -> repositório -> teste
4. Implementar a menor mudança + teste
5. Rodar mvn test / npm run build / smoke
6. Reportar em <=10 linhas (o que mudou, evidência, pendência)
7. Atualizar roadmap e auditoria
```

---

## 5. Proibido

- `git reset`, `rebase`, `amend`, `push --force`, `clean -fd` sem autorização explícita.
- Commit/push automático.
- Editar migração já aplicada (`V1..V13`).
- Declarar runtime concluído sem Docker real.
- Criar janelas/abas paralelas ou subagentes para o mesmo workspace.
