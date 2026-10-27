# MangaTeofilo — Manifesto do Produto e Especificação Completa

> Documento oficial de reconstituição brutal do produto MangaTeofilo.
> Reconstruído a partir do código-fonte (React 19, Cloud Functions, RTDB rules, Storage rules e docs operacionais).
> Host de produção: `shitoproject-ed649.web.app` | Package: `shitoreact`

---

## 1. O que é o MangaTeofilo

O **MangaTeofilo** é uma plataforma web brasileira de mangá/webcomic autoral: um ecossistema integrado para **descobrir, ler, acompanhar autores, publicar obras, imprimir mangás físicos sob demanda e monetizar**.

Nasceu em torno da obra institucional **Shito / Kokuin: Herança do Abismo** (universo KOKUIN COLLECTION) e evoluiu para um hub multi-criador onde:
- Leitores consomem capítulos gratuitamente ou com acesso antecipado.
- Mangakás independentes publicam, ganham audiência e monetizam.
- A equipe administrativa opera conteúdo, aprovações, loja física e fluxos financeiros.

**Stack Tecnológica:**
- **Front-end:** React 19, Vite, React Router 7.
- **Back-end & BaaS:** Firebase Auth, Firebase Realtime Database (RTDB), Firebase Storage, Google Cloud Functions (Node.js).
- **Gateway de Pagamento:** Mercado Pago (Webhooks idempotentes com HMAC timing-safe).

---

## 2. Os Três Papéis do Sistema (Shells Mutuamente Excludentes)

| Papel | Identificação no Sistema | O que faz / Onde opera |
|---|---|---|
| **Leitor (`user`)** | Conta padrão no Firebase Auth | Lê, favorita obras, comenta em capítulos, segue criadores, compra na loja e apoia/assina autores. |
| **Criador (`creator` / mangaká)** | RTDB `usuarios/{uid}.role: mangaka` | Publica obras e capítulos, gerencia perfil público de autor, cumpre missões, acessa workspace e (se aprovado) opera loja e recebe monetização. Opera em `/creator`. |
| **Admin (`admin` / staff)** | Claims e registro em `admins/registry/*` | Painel operacional com permissões granulares de moderação, catálogo, loja, avatares e financeiro. Opera em `/admin`. |

> **Regra de Ouro:** Staff e Criador são excludentes na navegação: a equipe gerencia a plataforma em `/admin`; o mangaká produz e administra sua obra em `/creator`.

---

## 3. As 9 Camadas do Sistema

### 3.1. Conta, Identidade & Perfil
- **Autenticação:** E-mail + código (passwordless), senha, Google Auth. Proteção com rate limit em Cloud Functions.
- **Cadastro:** Nome, `@username` único (reservado e validado em `usernames/*`), data de nascimento obrigatória (proteção de menoridade), avatar inicial.
- **Catálogo de Avatares:** Avatares públicos gratuitos da plataforma vs avatares VIP/Premium. Staff gerencia o catálogo (upload de WebP, substituição e migração de URLs antigas).
- **Avatar do Criador:** Upload com crop profissional (900×1200 → WebP 250–400 KB no Storage). Capa pública gerada com foto nítida sobre fundo desfocado.
- **Perfil do Leitor:** Handle público, gênero, dados de entrega com preenchimento automático por CEP (integração ViaCEP), preferências de push (social + promocional).
- **Roteamento de Handles:** Rotas `/@user` e `/:user` resolvem diretamente para a vitrine pública de um criador ou de um leitor.
- **Moderação de Conta:** Banimento bloqueia navegação geral e redireciona forçadamente para `/perfil` e `/login` (leitura bloqueada via modal).

### 3.2. Experiência de Leitura (Core B2C)
- **Home (`/`):** Hero dinâmico, ranking de descoberta (views, likes, comentários + boosts de carreira e missões), bloco "Continuar Lendo" (histórico local no navegador) e vitrine institucional KOKUIN.
- **Catálogo & Obras (`/works` e `/work/:slug`):** Busca por título/tags, sinopse completa, gêneros, ficha técnica, lista ordenada de capítulos, botão de seguir autor e favoritar.
- **Leitor Webcomic (`/ler/:id`):** 
  - Visualizador vertical contínuo ou horizontal página a página.
  - Zoom dinâmico (50% a 200%).
  - Ações no rodapé: like no capítulo, compartilhamento, seguir autor e atalho para o próximo capítulo.
  - Seção de comentários em tempo real (criar, curtir, excluir próprios comentários).
  - **Trava de Lançamento Antecipado:** Se o capítulo possui `publicReleaseAt` no futuro com flag de antecipado, leitores gratuitos veem o card de espera. **Apenas membros daquele criador (ou admins) desbloqueiam o acesso.**

### 3.3. CMS do Autor & Processamento de Mídia
- **Gestão de Obras:** Título, sinopse (50 a 600 caracteres), metadados SEO (título customizado, meta description, keywords), até 3 gêneros e 5 tags, status da obra (Em Lançamento, Completo, Em Hiato), geração de slug.
- **Mídia da Obra:**
  - Capa vertical 3:4 (1200×1600).
  - Banner horizontal 16:9 (1600×900).
  - Pipeline: Arquivos JPG/PNG/WebP de até 1,2 MB passam por crop interativo (zoom, pan, máscara) e são convertidos para WebP otimizado (~500 KB) em `obras/{uid}/{obra}` no Storage.
- **Wizard de Publicação de Capítulos (5 Passos):**
  1. *Upload:* Capa do capítulo + lote de páginas.
  2. *Organização:* Reordenar páginas arrastando, trocar página avulsa, excluir, preview de leitura.
  3. *Crop de Capa:* Enquadramento 16:9 da capa do capítulo.
  4. *Metadados:* Título, número do capítulo, data de liberação pública e flag de antecipado para membros.
  5. *Publicação:* Salvar como rascunho ou publicar imediatamente.
- **Substituição Cirúrgica:** Permite trocar uma página já publicada sem quebrar o capítulo; o arquivo anterior é expurgado do Storage.
- **Exclusão em Cascata com Auditoria:**
  - Excluir capítulo apaga nó no RTDB, capa e todas as imagens em `paginasStoragePaths`. Se executado por staff, motivo é obrigatório e dispara notificação interna ao autor.
  - Excluir obra remove todos os capítulos vinculados, pastas em `obras/` e `manga/`. Na biblioteca do leitor, a obra passa a figurar como "excluída".

### 3.4. Programa de Criadores (Workspace & Compliance)
- **Acesso ao Programa (`/creators`):** Landing informativa com transição para onboarding do autor.
- **Onboarding em Etapas:**
  1. Perfil público do autor (nome artístico, foto, bio, redes sociais).
  2. Criação da primeira obra.
  3. Publicação do primeiro capítulo.
  4. Configuração de apoio/membership (ou opção "Apenas Publicar").
  5. Loja do autor (opcional, destravada apenas com monetização ativa).
- **Publicar vs. Monetizar:**
  - *Apenas Publicar:* Liberado imediatamente após submissão do onboarding.
  - *Monetizar (Dinheiro Real):* Exige maioridade (18+), nome legal completo (mínimo 3 palavras), CPF válido, chave PIX e aceite dos termos legais. Entra na fila de análise manual do staff.
  - *Menor de idade:* Pode publicar e construir público normalmente, mas tem o painel financeiro bloqueado.
- **Workspace do Mangaká:** Painel central com gestão de obras, lista de seguidores, métricas de retenção por página, painel de crescimento e missões.

### 3.5. Os Dois "Motores" de Crescimento do Criador
O sistema separa intencionalmente carreira permanente de engajamento temporário:

#### A) Nível de Carreira (Permanente — `creators/{uid}/stats`)
Baseado no volume acumulado de seguidores, visualizações e curtidas:
- **Nível 0 (Iniciante):** Libera publicação de obras e capítulos.
- **Nível 1 (Em Ascensão - 100 seguidores / 5k views / 50 likes):** Ganha vitrine leve na Home e acesso ao modo vitrine do Print-on-Demand.
- **Nível 2 (Monetizado - 200 seguidores / 10k views / 80 likes):** Desbloqueia a permissão de solicitar monetização real (doações, membros e loja com repasse). Abre modal especial de celebração.
- **Nível 3 (Destaque - 400 seguidores / 80k views / 80 likes):** Peso máximo no algoritmo de ranking do catálogo.

#### B) Ciclo de Missões de Engajamento (Temporário — 5 Fases)
Orquestrado 100% pelo servidor em `functions/creatorEngagementCycleServer.js`:
- Fase 1: 2 missões | Fases 2–3: 3 missões | Fases 4–5: 5 missões (pool avançado).
- Tipos de missão: publicar capítulo novo, metas de novos likes/views/seguidores no período, responder comentários de leitores, manter streak de 7 dias ativo.
- **Recompensa:** Concluir uma fase concede **Boost no Feed (de 1.2x até 2.2x)** por um período de **6h a 72h**, além de selo temporário de destaque. Ao finalizar a Fase 5, o ciclo reinicia na Fase 1 mantendo os bônus ativos até a expiração.

### 3.6. Estrutura Financeira (Três Eixos Independentes)
O sistema não mistura receitas globais com repasses individuais:
1. **Premium da Plataforma (~R$ 23 / 30 dias):** Remove anúncios globais da plataforma, destrava avatares VIP exclusivos e concede desconto em itens da loja. **Não dá acesso aos capítulos antecipados de criadores.**
2. **Apoio Direto ao Autor (Doações / Gorjetas):** Tiers predefinidos (*Café R$ 7,99*, *Marmita R$ 19,00*, *Lendário R$ 35,00*) + campo de valor livre. Checkout registra o `creatorId` de atribuição e credita em `creatorData/{creatorId}/payments`.
3. **Membership do Criador (Assinatura de Membro):** Exclusiva para as obras daquele mangaká específico, desbloqueando acesso imediato aos capítulos antecipados.

**Segurança Financeira:**
- Processamento via Mercado Pago.
- Ledger contábil idempotente indexado por `paymentId` (evita processamento duplo em webhooks).
- Reembolsos, cancelamentos e chargebacks debitam automaticamente o ledger como ajuste negativo.
- Obras ou produtos órfãos caem no `PLATFORM_LEGACY_CREATOR_UID` (receita retida pela plataforma, sem repasse automático acidental).

### 3.7. Loja Oficial & Mangá Físico (Print-on-Demand / POD)
- **Loja de Produtos:** Mangás impressos, roupas, adesivos e colecionáveis; destaque para a "KOKUIN COLLECTION". Suporte a frete fixo ou dinâmico, cupons e desconto VIP para assinantes Premium.
- **Print-on-Demand (POD) — Três Modos Operacionais:**
  | Modo | Exibição no Catálogo | Beneficiário Financeiro | Envio / Destino |
  |---|---|---|---|
  | **Venda na Plataforma** | Sim | Criador da obra (requer monetização ativa) | Produzido e despachado direto ao leitor comprador |
  | **Vitrine / Promo** | Sim | Apenas a plataforma | Exemplares institucionais / promocionais |
  | **Encomenda Pessoal** | Não | Nenhum (criador paga o custo de tiragem) | Entregue no endereço do próprio autor |
- **Formatos Gráficos Suportados:** Tankobon padrão e Meio-Tankobon. Upload e validação de PDF do miolo (até 55 MB) e PDF/WebP da capa (até 8 MB).

### 3.8. Painel Administrativo do Staff (`/admin`)
- **Controle RBAC Granular:** Permissões segmentadas por operador (gestão de obras, aprovação de capítulos, catálogo de avatares, banner de promoções, moderação da loja, pedidos físicos e revogação de sessões ativas).
- **Mesa de Chefes:** Aprovação manual de novos criadores, homologação de dados bancários/PIX para saques e gerenciamento da equipe.
- **Operação de Backoffice:** Painel de auditoria de webhooks, reconciliação financeira de repasses, shells de pré-renderização para SEO (`workPageShell`, `chapterReaderShell`) e monitoramento de integridade via Firebase App Check.

### 3.9. Governança de Infraestrutura & Segurança
- **Domínios RTDB (`database.rules.json`):** Isolamento entre dados de cliente, paths de contadores públicos e nós sensíveis graváveis exclusivamente por Cloud Functions.
- **Políticas de Storage (`storage.rules`):** Capas públicas com leitura aberta; arquivos POD e PDFs de miolo restritos a sessões autenticadas; bloqueio absoluto de arquivos executáveis e vetores SVG (prevenção contra XSS armazenado).
- **Separação de Nomenclatura:**
  - `auth.uid`: Chave canônica de identidade.
  - `userId`: Autor de postagens e comentários.
  - `creatorId`: Titular monetário da obra/produto.
- **Allowlist Canônica de Staff:** Centralizada em `shared/platformStaffAllowlist.json` com sincronização automática para as regras de segurança do Firebase via script dedicado.

---

## 4. Síntese do Sistema
O **MangaTeofilo** foi arquitetado como uma fusão de:
$$\text{Estúdio Autoral} + \text{Leitor Webcomic} + \text{Patreon / Apoia.se} + \text{Loja Virtual} + \text{Gráfica POD}$$
tendo a obra Kokuin como base institucional, ferramentas profissionais de crop/CMS e um funil rigoroso de conformidade legal e níveis de carreira antes de permitir qualquer repasse financeiro.
