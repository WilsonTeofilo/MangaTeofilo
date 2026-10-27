# TASK-FRONTEND-MOCKS-PURGE: Expurgo de Mocks e Eliminação de Dados Fabricados

> **Data:** 26 de Outubro de 2026  
> **Responsável:** OpenCode Frontend  
> **Supervisão:** Hermes (Tech Lead & Arquiteto)  
> **Status:** Aberto para Execução  

---

## 1. Objetivo Técnico
Eliminar completamente qualquer importação e uso de dados fictícios (`mockData.ts`) em páginas e fluxos de produção/desenvolvimento da aplicação React, garantindo que o sistema exiba apenas dados reais retornados pelo Backend ou estados vazios legítimos (`EmptyState`), em estrita conformidade com a nossa Bíblia de Engenharia.

---

## 2. Requisitos de Implementação

### 2.1. `WorkDetailPage.tsx`
- Remover o import de `MOCK_CHAPTERS` e `MOCK_CREATORS`.
- Remover as condições que injetam capítulos ou autores falsos baseados em `import.meta.env.DEV`:
  ```tsx
  // REMOVER:
  const mockCreator = import.meta.env.DEV ? MOCK_CREATORS[...] : undefined;
  // REMOVER:
  const source = chapters.length > 0 ? realChapters : import.meta.env.DEV ? MOCK_CHAPTERS : [];
  ```
- Se a obra não possuir capítulos cadastrados, renderizar o estado de feedback limpo: `"Nenhum capítulo publicado ainda para esta obra."` com CTA apropriado.

### 2.2. `CreatorWorkspacePage.tsx`
- Remover o import de `MOCK_CREATORS`.
- Eliminar o fallback:
  ```tsx
  // REMOVER:
  const creator = import.meta.env.DEV ? MOCK_CREATORS['creator-teofilo'] : undefined;
  ```
- O componente deve depender 100% dos dados vindos de `GET /api/creators/workspace`. Em caso de carregamento, exibir Skeleton; se o usuário não for criador, exibir mensagem de bloqueio/candidatura.

### 2.3. `ReaderProfilePage.tsx`
- Remover o import de `MOCK_WORKS`.
- Substituir a linha que filtra `MOCK_WORKS` por consumo da biblioteca real via `userApi.getLibrary()`.
- Exibir a lista de favoritos com os dados retornados do servidor ou a mensagem: `"Você ainda não adicionou obras à sua biblioteca."`.

### 2.4. `useCatalogWorks.ts`
- Revisar o hook e garantir que toda a listagem de catálogo seja suprida pela nova API `GET /api/catalog` e pelo hook `useCatalog`, descontinuando o uso de dados locais mockados.

---

## 3. Critérios de Aceite
- [ ] `mockData.ts` não é importado em `WorkDetailPage.tsx`, `CreatorWorkspacePage.tsx`, `ReaderProfilePage.tsx` nem `useCatalogWorks.ts`.
- [ ] O leitor e o criador enxergam apenas dados 100% autênticos provenientes do PostgreSQL/MongoDB.
- [ ] Ausência de dados resulta em componentes de `EmptyState` estilizados no design system "Banca de Rua".
- [ ] `npm run build` conclui sem erros de tipagem TypeScript ou imports quebrados.

---

*Assinado por: Hermes (Tech Lead & Arquiteto)*
