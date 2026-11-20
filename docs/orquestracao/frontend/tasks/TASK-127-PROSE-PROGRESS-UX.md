# TASK-127 — UX de Progresso e Retomada de Leitura em Prosa (Light Novel)

**Prioridade:** P1  
**Módulo:** Frontend (Reader + Library + Home)  
**Dependência:** `TASK-PROSE-PROGRESS-001` (Backend aceitando `page <= totalPages` em `PROSE`)  
**Objetivo:** Integrar o envio do progresso real (percentual 1 a 100) no leitor de Light Novel, permitir a retomada suave do scroll onde o leitor parou, e exibir a barra e percentual de progresso na Biblioteca e na Home.

---

## 1. Contexto

Até então, o leitor de prosa enviava estaticamente `page: 1, totalPages: 1`. Como resultado:
- A Biblioteca exibia apenas o rótulo genérico `EM ANDAMENTO` sem barra de progresso.
- Ao reabrir a obra pela biblioteca, o leitor sempre abria no topo (scroll 0%).
- O backend não registrava retenção percentual.

---

## 2. Requisitos de Implementação

### 2.1 Em `src/components/reader/useReaderTelemetry.ts`
- No efeito de qualificação inicial de leitura em prosa:
  - Enviar `page: 1, totalPages: 100` (ou o progresso atual se já iniciado).
- No handler de scroll de prosa (linhas 127–148):
  - Ao atingir os checkpoints (10%, 20%, ..., 100%):
    ```ts
    userApi.trackReadingProgress({
      workId,
      chapterId,
      page: Math.max(1, progress),
      totalPages: 100,
    }).catch(() => {});
    ```

### 2.2 Em `src/components/reader/useReaderState.ts`
- Suporte à retomada de leitura em prosa (`initialPage`):
  - Se `chapterFormat === 'PROSE'` e `initialPage > 1`:
    - Quando o conteúdo de prosa estiver carregado (`proseBlocks.length > 0` ou `proseContent`), calcular a posição de scroll proporcional e posicionar o leitor:
      ```ts
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll > 0) {
        window.scrollTo({ top: (maxScroll * initialPage) / 100, behavior: 'auto' });
        initialPageAppliedRef.current = chapter.id;
      }
      ```

### 2.3 Em `src/components/library/LibraryWorkCard.tsx`
- Permitir barra de progresso e percentual na Light Novel:
  - Se `card.progress` existir:
    - O percentual é derivado de `(card.page / card.totalPages) * 100`.
    - Renderizar a barra de progresso inferior também para `isLn`.
    - No rodapé do card: exibir `CAP. {number} · {percent}%` (ou `CONCLUÍDO` se finalizado).

### 2.4 Em `src/components/home/HomeContinueReading.tsx`
- Exibir a porcentagem real para Light Novel, mantendo coerência visual com obras de mangá.

---

## 3. Critérios de Aceite

- [ ] Telemetria de prosa envia `page: progress, totalPages: 100` nos checkpoints.
- [ ] Leitor de prosa rola para a posição proporcional ao ser aberto com `initialPage > 1`.
- [ ] Card de biblioteca exibe barra de progresso e percentual para obras LN com histórico.
- [ ] `npm run test:run` passa com todos os testes verdes.
- [ ] `npm run build` passa sem erros de tipagem TypeScript.
- [ ] Gerar relatório `docs/orquestracao/frontend/relatorios/RELATORIO-TASK-127.md`.

---

Assinado por: Hermes (Tech Lead / Gerente / Arquiteto)
