# TASK-SECURITY-001 — Correção de Vulnerabilidades em WorkApplicationService

**Data:** 2026-11-18  
**Prioridade:** 🔴 CRÍTICA — Segurança  
**Escopo:** Backend · `WorkApplicationService.java`  
**Dependências:** Nenhuma. Pode ser executada imediatamente.

---

## Contexto

Auditoria do `WorkApplicationService.java` revelou dois bugs de segurança independentes:

1. **URLs sem sanitização em `createWork`** — risco de path traversal / SSRF via URL de capa/banner
2. **Obras em DRAFT visíveis para qualquer usuário autenticado** — violação de privacidade do autor

---

## Bug #1 — `createWork`: CoverUrl/BannerUrl sem `WorkImageUrlPolicy`

### Localização
```
WorkApplicationService.java · método createWork() · linhas 220-221
```

### Código atual (ERRADO)
```java
work.setCoverUrl(dto.coverUrl().trim());
work.setBannerUrl(dto.bannerUrl() != null ? dto.bannerUrl().trim() : null);
```

### Referência (método `updateWork` — JÁ CORRETO)
```java
work.setCoverUrl(WorkImageUrlPolicy.cover(dto.coverUrl()));
work.setBannerUrl(dto.bannerUrl() != null && !dto.bannerUrl().isBlank()
        ? WorkImageUrlPolicy.banner(dto.bannerUrl())
        : null);
```

### Correção exigida
Substituir as duas linhas em `createWork` pela mesma lógica de `updateWork`:

```java
work.setCoverUrl(WorkImageUrlPolicy.cover(dto.coverUrl()));
work.setBannerUrl(dto.bannerUrl() != null && !dto.bannerUrl().isBlank()
        ? WorkImageUrlPolicy.banner(dto.bannerUrl())
        : null);
```

> [!CAUTION]
> Sem essa correção, um criador malicioso pode passar qualquer URL arbitrária como `coverUrl` na criação da obra, podendo apontar para domínios externos ou URLs com path-traversal que passam pela validação do frontend mas não pelo backend.

---

## Bug #2 — `assertWorkVisible`: DRAFT visível para todos os usuários autenticados

### Localização
```
WorkApplicationService.java · método assertWorkVisible() · linhas 272-285
```

### Código atual (ERRADO)
```java
private void assertWorkVisible(WorkEntity work) {
    if (work != null && work.getStatus() == WorkStatus.ARCHIVED_LGPD) {
        throw new ResourceNotFoundException("Obra não encontrada.");
    }
    if (work == null || work.getStatus() != WorkStatus.SUSPENDED) {
        return; // ← BUG: retorna sem checar DRAFT, HIATUS, etc.
    }
    // ... verifica autor/moderador APENAS para SUSPENDED
}
```

**Por que é um bug:** A condição `work.getStatus() != WorkStatus.SUSPENDED` é `true` para todos os status que NÃO são `SUSPENDED` (incluindo `DRAFT`, `HIATUS`, `ONGOING`). Para `DRAFT`, o método retorna imediatamente na linha `return`, liberando acesso a qualquer usuário autenticado — incluindo leitores comuns que não deveriam ver obras não publicadas.

### Regra de negócio (do `docs/product-manifesto-completo.md`)
- **DRAFT**: obra criada mas ainda não publicada. **Visível apenas ao próprio autor e moderadores.**
- **ONGOING / HIATUS / COMPLETED**: obra pública — visível a qualquer usuário.
- **SUSPENDED**: suspensa por moderação — visível apenas a autor e moderadores.
- **ARCHIVED_LGPD**: removida — não existe (lança 404).

### Correção exigida

```java
private void assertWorkVisible(WorkEntity work) {
    // 1. Obras removidas por LGPD são invisíveis para todos
    if (work != null && work.getStatus() == WorkStatus.ARCHIVED_LGPD) {
        throw new ResourceNotFoundException("Obra não encontrada.");
    }

    // 2. Obras em DRAFT só são visíveis ao autor e moderadores
    if (work != null && work.getStatus() == WorkStatus.DRAFT) {
        SessionService.UserSession session = SecurityContextUtils.getCurrentSession().orElse(null);
        boolean isModerator = session != null && session.isModerator();
        UUID sessionCreatorId = session != null ? session.creatorId() : null;
        boolean isAuthor = sessionCreatorId != null && work.getAuthor() != null
                && sessionCreatorId.equals(work.getAuthor().getId());
        if (!isAuthor && !isModerator) {
            throw new ResourceNotFoundException("Obra não encontrada.");
            // Lança 404 (não 403) para não revelar a existência da obra ao público
        }
        return;
    }

    // 3. Obras suspensas: autor e moderadores veem, o resto recebe 403
    if (work == null || work.getStatus() == WorkStatus.SUSPENDED) {
        SessionService.UserSession session = SecurityContextUtils.getCurrentSession().orElse(null);
        boolean isModerator = session != null && session.isModerator();
        UUID sessionCreatorId = session != null ? session.creatorId() : null;
        boolean isAuthor = sessionCreatorId != null && work != null && work.getAuthor() != null
                && sessionCreatorId.equals(work.getAuthor().getId());
        if (!isAuthor && !isModerator) {
            throw new AccessDeniedException("Esta obra está suspensa cautelarmente e indisponível.");
        }
    }
    // 4. Qualquer outro status (ONGOING, HIATUS, COMPLETED) é público → passa
}
```

> [!IMPORTANT]
> Para DRAFT, a exceção deve ser `ResourceNotFoundException("Obra não encontrada.")` — não `AccessDeniedException` — para não revelar ao público a existência de obras em rascunho.

---

## Critérios de Aceite

- [ ] `createWork()` chama `WorkImageUrlPolicy.cover()` e `WorkImageUrlPolicy.banner()` para sanitizar as URLs de capa e banner
- [ ] `assertWorkVisible()` lança `ResourceNotFoundException` ao tentar acessar obra com status `DRAFT` como usuário não-autor e não-moderador
- [ ] `assertWorkVisible()` mantém o comportamento atual para `SUSPENDED` (AccessDeniedException) e `ARCHIVED_LGPD` (ResourceNotFoundException)
- [ ] Obras com status `ONGOING`, `HIATUS`, `COMPLETED` continuam acessíveis publicamente
- [ ] `mvn test` → 453/453 ✅ (nenhum teste existente pode regredir)
- [ ] Se necessário, adicionar testes de integração para os dois cenários DRAFT:
  - Leitor comum tentando acessar obra DRAFT → 404
  - Autor da obra acessando obra DRAFT → 200

---

## Padrões Obrigatórios

- Sem Lombok desnecessário nas linhas modificadas (métodos `private`)
- Sem alterar assinatura de métodos públicos
- Sem extrair para nova classe — a correção é cirúrgica dentro de `WorkApplicationService.java`
- O bloco `SessionService.UserSession session = ...` pode ser extraído para método privado `resolveSession()` se o operário preferir evitar duplicação, **desde que o comportamento final seja idêntico**

---

## Arquivos a Modificar

| Arquivo | Ação |
|---------|------|
| `backend/src/main/java/com/manganetworking/service/work/WorkApplicationService.java` | Corrigir `createWork()` (linhas 220-221) e `assertWorkVisible()` (linhas 272-285) |

> [!NOTE]
> **NÃO modificar** `ChapterApplicationService.java` — foi auditado e está correto: `createChapter` já usa `WorkImageUrlPolicy.cover()` na linha 185, e `updateChapter` também na linha 278.

---

## Relatório

Após implementar, criar:
`docs/orquestracao/backend/relatorios/RELATORIO-TASK-SECURITY-001.md`

Conteúdo mínimo do relatório:
- Linhas exatas modificadas em `WorkApplicationService.java`
- Resultado de `mvn test`
- Assinatura: `Assinado por: OpenCode Backend`

---

*Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)*
