# GUIA DE RECICLAGEM DE FRONTEND: O QUE APROVEITAR DO MANGATEOFILO

> **Visão Técnica:** O código existente em `src/` possui fluxos de negócio maduros, integrações robustas com Firebase/Storage e rotas bem estruturadas.
> O que precisa ser substituído é a **"casca visual"** (as cores antigas, cantos arredondados frouxos e falta de identidade), aplicando o novo Design System **"Banca de Rua / Fliperama"**.

---

## 1. O Mapa do Tesouro: O que Reciclar por Tela

| Tela / Módulo | Onde mora o código hoje | O QUE RECICLAR (Lógica de Ouro) | O QUE SUBSTITUIR (Visual Novo) |
|---|---|---|---|
| **Home & Descoberta** | `src/pages/Home/` | Lógica de ranking por engajamento, query de vitrines KOKUIN, histórico local "Continuar Lendo". | Remover hero horizontal com foto genérica; criar hero com capa vertical 2:3, ticker amarelo (`Marquee`) e `<Win title="CONTINUAR_LENDO.EXE">`. |
| **Leitor Webcomic** | `src/pages/Leitor/` | Visualizador vertical contínuo/horizontal, atalhos de teclado, zoom (50% a 200%), trava de antecipado e sistema de comentários em tempo real. | Deixar 100% limpo e escuro (`#0B0B0C`). Remover qualquer decoração ou poluição visual. Foco total nas páginas. |
| **Catálogo & Obras** | `src/pages/Mangas/` | Filtros combinados de tags/gêneros, busca por título, geração de slugs e ficha técnica. | Substituir cards cinzas com "Ver Obra" pelo novo `<WorkCard>` (card inteiro clicável, sombra dura 4px, favoritar direto na capa, badges fechados). |
| **CMS do Mangaká** | `src/pages/Criador/` | **Wizard de Publicação em 5 Passos:** Upload de lotes, reordenação drag-and-drop de páginas, crop interativo para WebP, metadados e salvamento em rascunho. | Envelopar o wizard em janelas estilo retrô/adesivo `<Win>`, botões com Anton e paleta nanquim/amarelo. |
| **Auth & Cadastro** | `src/pages/Auth/` | Passwordless (código por e-mail), Google Auth, rate-limit client-side e fluxo de 2FA. | Formulário com `<Field>`, OTP em 6 caixas de texto com estilo brutalista e caixa `DEV_OUTBOX.EXE` (fora de prod). |
| **Perfil do Leitor** | `src/pages/Perfil/` | Integração ViaCEP para auto-preenchimento, upload de avatar com crop, favoritos e preferências. | Remover os 4 tiles repetitivos cinzas; deixar 1 número em destaque (obras lidas) e metadados discretos em Archivo. |
| **Checkout & Loja** | `src/pages/Loja/` | Fluxo de Preferences API do Mercado Pago, carrinho, cálculo de frete e status de pedido. | Design de cupom fiscal/adesivo de banca de rua. |

---

## 2. Passo a Passo da Refatoração Segura

Ao receber uma ordem de serviço de Frontend:

1. **Passo 1: Preservar os Componentes Lógicos:**
   * NUNCA reescreva hooks customizados (`useAuth`, `useReader`, `useCreatorStats`) ou rotas do `App.jsx`.
   * Mantenha o gerenciamento de estado e os efeitos (`useEffect`) intactos.

2. **Passo 2: Injetar os Novos Componentes de UI (`src/components/ui/`):**
   * Substitua botões HTML crus por `<Button variant="primary">`.
   * Substitua caixas cinzas genéricas por `<Win title="TITULO.EXE">`.
   * Use `<Cover>` com fallback para capas de mangá.

3. **Passo 3: Higienizar Classes CSS Antigas:**
   * Elimine `rounded-xl`, `rounded-2xl`, `bg-gray-900`, `text-purple-400`.
   * Aplique os tokens oficiais de `tokens.css` (`--mn-ink`, `--mn-yellow`, `--mn-paper`, `--mn-red`).

4. **Passo 4: Validação:**
   * Rode a compilação de tipagem / linter (`npm.cmd run build` ou `npx.cmd vite build`).
   * Verifique se as interações de clique, scroll e envio continuam disparando as funções originais.
