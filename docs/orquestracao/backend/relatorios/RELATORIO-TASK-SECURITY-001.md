# RELATÓRIO — TASK-SECURITY-001: Correção de Vulnerabilidades em WorkApplicationService

**Data:** 2026-11-18  
**Executor:** OpenCode Backend  
**Tech Lead:** Hermes (Tech Lead / Gerente / Arquiteto)  
**Escopo:** `WorkApplicationService.java` (sanitização de URLs de capa/banner e controle de visibilidade de obras em DRAFT)

---

## 1. Contexto e Problemas Resolvidos

Auditoria de segurança identificou duas vulnerabilidades críticas em `WorkApplicationService.java`:
1. **Bug #1 — URLs sem sanitização em `createWork`**: `coverUrl` e `bannerUrl` eram persistidos diretamente sem validação de política de armazenamento, permitindo URLs externas ou fora do padrão do storage (`/api/storage/<uuid>.<ext>`).
2. **Bug #2 — Obras em DRAFT expostas publicamente**: O método `assertWorkVisible` verificava apenas o status `SUSPENDED` para autor/moderador e liberava retorno antecipado (`return`) para qualquer outro status diferente de `ARCHIVED_LGPD`, tornando obras em rascunho (`DRAFT`) indevidamente visíveis para qualquer leitor ou visitante anônimo.

---

## 2. Modificações Efetuadas

### Arquivo: `backend/src/main/java/com/manganetworking/service/work/WorkApplicationService.java`

#### Bug #1 — Sanitização de Capa e Banner em `createWork` (Linhas 220-223)
```java
// ANTES:
work.setCoverUrl(dto.coverUrl().trim());
work.setBannerUrl(dto.bannerUrl() != null ? dto.bannerUrl().trim() : null);

// DEPOIS:
work.setCoverUrl(WorkImageUrlPolicy.cover(dto.coverUrl()));
work.setBannerUrl(dto.bannerUrl() != null && !dto.bannerUrl().isBlank()
        ? WorkImageUrlPolicy.banner(dto.bannerUrl())
        : null);
```

#### Bug #2 — Restrição de Visibilidade para Obras em DRAFT (Linhas 279-291)
```java
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
```

---

## 3. Ajustes nos Testes e Cobertura Adicionada

### Adequação de Testes Legados à Nova Política de URL
Com a aplicação estrita de `WorkImageUrlPolicy.cover()` em `createWork`, URLs fictícias de testes (`https://cdn.exemplo/capa.png` e `https://storage.local/capa.jpg`) foram atualizadas para o padrão de storage da plataforma (`/api/storage/11111111-1111-1111-1111-111111111111.png` / `.jpg`) nos seguintes arquivos:
- `CatalogIntegrationTest.java` (linha 279)
- `ChapterFileAccessIntegrationTest.java` (linha 225)
- `FeedSyncIntegrationTest.java` (linha 253)
- `WorkApplicationServiceTest.java` (linhas 89 e 117)

### Novos Testes Automatizados Implementados
Adicionados em `WorkApplicationServiceTest.java`:
1. `shouldRejectInvalidCoverUrlOnCreateWork()`: Garante lançamento de `FilePolicyException` para URLs fora da política em `createWork`.
2. `shouldHideDraftWorkFromAnonymousViewer()`: Garante lançamento de `ResourceNotFoundException` (404) quando visitante anônimo tenta acessar obra em `DRAFT`.
3. `shouldHideDraftWorkFromOtherUser()`: Garante 404 quando usuário autenticado que não é autor nem moderador tenta acessar obra em `DRAFT`.
4. `shouldAllowAuthorToViewDraftWork()`: Garante acesso bem-sucedido (200) para o autor criador da obra em `DRAFT`.
5. `shouldAllowModeratorToViewDraftWork()`: Garante acesso bem-sucedido (200) para moderador.

---

## 4. Resultado da Execução dos Testes (`mvn test`)

```
[INFO] Results:
[INFO] 
[INFO] Tests run: 458, Failures: 0, Errors: 0, Skipped: 0
[INFO] 
[INFO] ------------------------------------------------------------------------
[INFO] BUILD SUCCESS
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  01:16 min
[INFO] Finished at: 2026-11-18T16:32:43-03:00
[INFO] ------------------------------------------------------------------------
```

- Total de testes executados: **458**
- Falhas: **0**
- Erros: **0**
- Regressões: **0**

---

## 5. Critérios de Aceite Verificados

- [x] `createWork()` chama `WorkImageUrlPolicy.cover()` e `WorkImageUrlPolicy.banner()` para sanitizar as URLs de capa e banner
- [x] `assertWorkVisible()` lança `ResourceNotFoundException` ao tentar acessar obra com status `DRAFT` como usuário não-autor e não-moderador
- [x] `assertWorkVisible()` mantém o comportamento para `SUSPENDED` (`AccessDeniedException`) e `ARCHIVED_LGPD` (`ResourceNotFoundException`)
- [x] Obras com status `ONGOING`, `HIATUS`, `COMPLETED` continuam acessíveis publicamente
- [x] `mvn test` → 458/458 ✅ (zero quebras / zero regressões)
- [x] Testes de unidade adicionados para todos os cenários DRAFT e validação de URL de capa

---

Assinado por: OpenCode Backend
