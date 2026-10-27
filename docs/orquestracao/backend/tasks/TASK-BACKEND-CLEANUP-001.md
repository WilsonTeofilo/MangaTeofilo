# TASK-BACKEND-CLEANUP-001: Refatoração SRP, Blindagem Auth e Higiene Anti-Hardcoded

> **Data:** 26 de Outubro de 2026  
> **Responsável:** OpenCode Backend  
> **Supervisão:** Hermes (Tech Lead & Arquiteto)  
> **Status:** Aberto para Execução  

---

## 1. Objetivo Técnico
Refatorar a camada de serviços e segurança do Backend para cumprir rigorosamente o Princípio da Responsabilidade Única (SRP), eliminar exposição indevida de entidades JPA, blindar as rotas de autenticação no Spring Security e sanitizar conversões e magic numbers em pagamentos.

---

## 2. Requisitos de Implementação

### 2.1. Decomposição de `WorkApplicationService` (SRP)
- Criar a classe `com.manganetworking.service.work.ChapterApplicationService` dedicada exclusivamente ao ciclo de vida de capítulos.
- Mover para `ChapterApplicationService`:
  - `createChapter(UUID creatorId, UUID workId, CreateChapterRequestDto dto)`
  - `updateChapter(UUID creatorId, UUID workId, Integer number, UpdateChapterRequestDto dto)`
  - `deleteChapter(UUID creatorId, UUID workId, Integer number)`
  - `readChapter(String slug, Integer chapterNumber, UUID currentUserId)`
  - Dependências relacionadas a capítulos (`ChapterRepository`, `ChapterFileRepository`, `ChapterBlocksPolicy`).
- `WorkApplicationService` deve focar exclusivamente no agregado `Work` (criação, edição, listagem, exclusão de obras e `presentation_json`).
- Ajustar os endpoints de `WorkController` para injetar e delegar as operações de capítulos diretamente ao `ChapterApplicationService`.

### 2.2. Eliminação de Retorno de `@Entity` JPA
- Nos métodos de criação e atualização de obras e capítulos, substituir o retorno de `WorkEntity` e `ChapterEntity` por DTOs imutáveis (`WorkDetailsResponseDto` e `ChapterReadResponseDto` ou `ChapterSummaryDto`).
- Nenhum controller deve expor referências gerenciadas pelo Hibernate diretamente no body de resposta.

### 2.3. Blindagem Fina de Rotas em `SecurityConfig.java`
- Substituir o wildcard aberto `.requestMatchers("/api/auth/**").permitAll()` por regras explícitas:
  ```java
  .requestMatchers(
      "/api/auth/register",
      "/api/auth/login",
      "/api/auth/google",
      "/api/auth/2fa/verify",
      "/api/auth/policy",
      "/api/auth/password-reset/**"
  ).permitAll()
  .requestMatchers(
      "/api/auth/me",
      "/api/auth/logout",
      "/api/auth/2fa/request"
  ).authenticated()
  ```

### 2.4. Higiene em `MercadoPagoService.java`
- Substituir os magic numbers `new BigDecimal("2.00")` e `new BigDecimal("10000.00")` por constantes estáticas de classe:
  ```java
  private static final BigDecimal MIN_SUPPORT_AMOUNT_BRL = new BigDecimal("2.00");
  private static final BigDecimal MAX_SUPPORT_AMOUNT_BRL = new BigDecimal("10000.00");
  ```
- Padronizar conversões de valores monetários garantindo duas casas decimais com `RoundingMode.HALF_EVEN`.

### 2.5. Consistência de Views na Exclusão de Capítulo
- Em `deleteChapter`, ao remover um capítulo com visualizações acumuladas, decrementar também as views correspondentes do agregado `works.total_views`:
  ```java
  if (removedViews > 0) {
      workRepository.decrementTotalViewsBy(work.getId(), removedViews);
  }
  ```

---

## 3. Critérios de Aceite
- [ ] `ChapterApplicationService` criado e testado unitariamente.
- [ ] `WorkApplicationService` refatorado e reduzido em pelo menos 40% das linhas.
- [ ] Nenhum método público de serviço retorna `@Entity` para controllers.
- [ ] `SecurityConfig` bloqueia chamadas não autenticadas para `/api/auth/2fa/request` com 401/403.
- [ ] Constantes nomeadas utilizadas em `MercadoPagoService`.
- [ ] Suíte completa `mvn -o test` executada com **100% de sucesso (>= 434 testes verdes, 0 falhas, 0 erros)**.

---

*Assinado por: Hermes (Tech Lead & Arquiteto)*
