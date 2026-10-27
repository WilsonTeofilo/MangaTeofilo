# Identidade Visual e Design System — MangaNetWorking

> **Para o Anti Gravity:** leia este arquivo inteiro, junto com `README.md`, `PLANO_DE_FASES.md` e `docs/PROMPT_ANTIGRAVITY.md`, **antes** de alterar qualquer arquivo do `frontend/`.
> Este documento **substitui** a diretriz antiga do README ("fiel à estética dark golden e tempestuosa da MangaTeofilo") e define a nova direção visual oficial.
> **Escopo desta tarefa: somente frontend.** Não altere contratos de API, backend, banco, regras financeiras, regras de Seasons ou regras de LGPD. O visual muda; o comportamento do produto não.

---

## 0. Resumo em 30 segundos

**Conceito: "Banca de Rua / Fliperama do Mangá Independente".**
O site em volta é panfleto de rua + computador antigo + adesivo + placar de fliperama. O mangá (as capas e as páginas) é o protagonista colorido dentro dessa moldura. Ao olhar, a pessoa deve pensar "cena independente", não "festa à fantasia dos anos 90" e não "template de SaaS escuro".

**Pilares**
1. **Amarelo é superfície, não tempero.** Blocos inteiros de amarelo chapado alternando com blocos de preto-nanquim.
2. **Tipografia como imagem.** Títulos condensados enormes, entrelinha colada, às vezes cortados pela borda do bloco.
3. **Linguagem de adesivo e de janela antiga.** Contorno grosso, sombra dura deslocada, barra de título com `×`, selos levemente rotacionados.
4. **Seasons são um jogo.** Os 4 níveis de criador viram patches/adesivos colecionáveis, com barra de XP em blocos e missões como quests.
5. **A leitura é sagrada.** O Modo Leitor é limpo, escuro e sem decoração. A bagunça controlada vive só nas telas de descoberta.

---

## 1. O que está errado hoje (diagnóstico a corrigir)

Resultado da análise das telas atuais (Feed, Catálogo, Perfil do Leitor). Cada item tem correção nas seções seguintes.

| # | Problema atual | Correção |
|---|---|---|
| 1 | Quatro "vozes" tipográficas que não conversam (condensada Impact-like, sans genérica, monoespaçada, caixa-alta larga no perfil). | Sistema de 4 fontes com papéis fixos (seção 4). Mono sai do corpo e das métricas. |
| 2 | Monoespaçada em metadados ("4 capítulos", "9920 views") dá cara de terminal de dev. | Metadados em Archivo com `tabular-nums`; pixel font só em rótulos curtos. |
| 3 | Todo bloco é retângulo arredondado, borda fina, fundo cinza-escuro, mesmo peso. Há card dentro de card. | Hierarquia por bloco de cor, borda 2px, raio mínimo, sombra dura. Proibido card dentro de card. |
| 4 | Nenhuma linguagem de mangá/rua: sem painéis, calhas, halftone, faixas, adesivos. | Texturas e formas da seção 7. |
| 5 | Amarelo em tudo (nav, CTA, números, estrelas, badges, links, outlines); verde e roxo soltos sem sistema. | Amarelo vira bloco + 1 CTA primário por tela. Sistema de badges fechado (seção 8.4). |
| 6 | Hero horizontal com foto; mangá é vertical. A capa 2:3 só aparece pequena. | Hero com capa vertical em destaque (seção 9.1). |
| 7 | O "tempestuoso" do README não existe. | Faixas diagonais, halftone e granulação (seção 7). |
| 8 | Badge "EM LANÇAMENTO" em todos os cards do catálogo. | Badge só aparece quando diferencia (seção 8.4). |
| 9 | Botão "Ver Obra" repetido em todo card + estrela ao lado. | Card inteiro é o link. Favoritar é um ícone sobre a capa. |
| 10 | Títulos truncados em 1 linha ("KOKUIN: A Chama do..."). | Até 2 linhas, `line-clamp-2`, título completo em `title`/tooltip. |
| 11 | Texto minúsculo cinza sobre preto (tagline, rodapé, aviso do perfil). | Mínimo 12px e contraste ≥ 4.5:1 (seção 12). |
| 12 | Perfil: 4 tiles com o mesmo peso ("Ativo" e "abr. 2026" gritam igual aos números); "Status público" repete o badge de visibilidade; handle entre parênteses em mono. | Um número de destaque + metadados discretos (seção 9.6). |
| 13 | Larguras de container diferentes entre Feed, Catálogo e Perfil; logo desalinhada da borda do conteúdo. | Um único container e grid (seção 6). |
| 14 | Header mostra "Entrar / Cadastro" e avatar logado ao mesmo tempo. | Header dirigido pelo estado de sessão (deslogado: CTA; logado: avatar). |
| 15 | Logo = "M" em quadrado amarelo arredondado (ícone de app genérico). | Nova logo (seção 3). |
| 16 | Fotos aleatórias de hotlink como capas. | Componente `<Cover>` com fallback gerado e marcação de placeholder (seção 11). |

---

## 2. Marca

- **Nome de exibição:** `MANGANETWORKING` (uma palavra no texto corrido: "MangaNetWorking").
- **Assinatura (opcional, pequena e legível):** `por MangaTeofilo Editorial`. Mínimo 12px, contraste ≥ 4.5:1.
- **Posicionamento em uma frase:** "A banca digital do mangá independente: leia, apoie e descubra quem faz."
- **Voz:** direta, de rua, curta, em pt-BR. Gíria leve e natural, sem forçar. Nada de "Olá! Seja bem-vindo!".

**Exemplos de microcopy**
- Botão principal de leitura: `LER AGORA`
- Continuar lendo: `Parou na pág. 12. Bora?`
- Estado vazio da biblioteca: `Nada por aqui ainda. Favorita uma obra e ela cai aqui.`
- Erro 404: `Página não encontrada. Nem o mascote achou.`
- Season: `SEASON 01 · FALTAM 23 DIAS`
- Early access: `Cap. 5 liberado para membros. Público em 3 dias.`
- Aviso legal no upload: `Só obra original. Pirataria = banimento.`

---

## 3. Logo e Mascote

### 3.1 Logo
- **Wordmark empilhado:** `MANGA` sobre `NETWORKING`, fonte **Bowlby One**, caixa-alta.
- **Tratamento de adesivo:** preenchimento amarelo `#FFD400`, contorno interno preto de 3px, e **borda externa off-white de 5px** (efeito die-cut de adesivo) com sombra dura preta/amarela conforme o fundo.
- **Rotação:** −2° no header grande e no hero; **0°** em tamanhos pequenos (favicon, header mobile).
- **Símbolo (monograma):** `MN` dentro de um **balão de fala quadrado com um canto cortado** (formato de painel de mangá). Substitui o "M" em quadrado arredondado.
- **Entregáveis em `frontend/src/assets/brand/`:** `logo-wordmark.svg`, `logo-symbol.svg`, `logo-mono-ink.svg`, `logo-mono-paper.svg`, `favicon.svg`. Tudo em SVG, com texto convertido em path.
- **Área de respiro:** altura de uma letra "M" em volta. **Tamanho mínimo:** 24px de altura para o símbolo, 96px de largura para o wordmark.
- **Proibido:** sombra suave, gradiente, rotação acima de 3°, esticar, trocar as cores da paleta.

### 3.2 Mascote
- **Conceito:** um **tinteiro (nanquim) com uma pena (bico de pena) saindo como antena**, olhos de cartoon, braços finos. Nome provisório: **"Nanquim"**.
- **Original obrigatório.** Não copie o mascote das referências (computador de tênis do "Space Coders") nem qualquer personagem existente. Sem personagens de mangá/anime/jogos de terceiros.
- **Estilo:** contorno grosso preto, preenchimento chapado (preto, amarelo, off-white), borda de adesivo off-white. Sem gradientes.
- **Onde aparece:** estados vazios, 404, carregamento, conclusão de Season, onboarding. **Nunca** sobre a leitura nem no Modo Leitor.
- **Poses mínimas (SVG):** neutro, apontando, comemorando, dormindo/vazio, erro.
- **Fase inicial:** o agente pode gerar uma versão SVG simples e funcional marcada `<!-- PLACEHOLDER: substituir por arte final -->`. A arte final deve ser feita por ilustrador.

---

## 4. Tipografia

Quatro fontes, papéis fixos. **Todas self-hosted via `@fontsource`** (o projeto roda local, sem depender de CDN externo). Subsets `latin` e `latin-ext`. **Verificar que `ã õ ç é ê â í ó ú` renderizam em todas as fontes** antes de fechar.

| Papel | Fonte | Pacote | Uso |
|---|---|---|---|
| **Display** | **Anton** | `@fontsource/anton` | Títulos de página, títulos de card, ranking, nav, botões. Sempre caixa-alta. |
| **Logo/Adesivo** | **Bowlby One** | `@fontsource/bowlby-one` | Wordmark, selos grandes, patches de nível. Nunca em parágrafo. |
| **Corpo/UI** | **Archivo** (variável) | `@fontsource-variable/archivo` | Parágrafos, formulários, metadados, números (`font-variant-numeric: tabular-nums`). |
| **Sistema/Pixel** | **Silkscreen** | `@fontsource/silkscreen` | Somente microrrótulos em caixa-alta: barra de título de janela, "SEASON 01", "LV.2". **Mínimo 12px.** Nunca em texto de leitura. |

**Escala**

| Token | Tamanho | Linha | Fonte | Uso |
|---|---|---|---|---|
| `display-xl` | `clamp(56px, 9vw, 128px)` | 0.88 | Anton | Título do hero, números do ranking |
| `display-l` | `clamp(40px, 6vw, 72px)` | 0.92 | Anton | Título de seção-bloco |
| `display-m` | 40px | 0.95 | Anton | Título de página interna |
| `title` | 24px | 1.0 | Anton | Título de card/janela |
| `card-title` | 20px | 1.05 | Anton | Título de obra no card (2 linhas) |
| `body-l` | 18px | 1.6 | Archivo 400 | Sinopse no hero |
| `body` | 16px | 1.6 | Archivo 400 | Padrão |
| `small` | 14px | 1.5 | Archivo 500 | Metadados |
| `micro` | 12px | 1.2 | Silkscreen | Rótulos de sistema (`letter-spacing: .08em`) |

**Regras**
- Anton: sempre `text-transform: uppercase`, `letter-spacing: .01em`, **nunca abaixo de 18px**.
- Entrelinha colada nos títulos grandes é intencional. Permitido cortar parte do título com `overflow: hidden` em **elementos decorativos**; **nunca** cortar o título de uma obra a ponto de perder informação.
- Remover toda `font-mono`/monoespaçada existente em metadados e perfil.

---

## 5. Cores

### 5.1 Tokens (fonte da verdade: variáveis CSS)

| Token | Hex | Papel |
|---|---|---|
| `--mn-ink` | `#0B0B0C` | Fundo principal (preto-nanquim) e texto sobre amarelo/papel |
| `--mn-ink-2` | `#151517` | Superfície elevada no escuro |
| `--mn-ink-3` | `#212125` | Superfície destacada / hover no escuro |
| `--mn-line` | `#34343A` | Bordas discretas no escuro |
| `--mn-paper` | `#F4EFE3` | Off-white de papel (texto no escuro, superfícies claras, borda de adesivo) |
| `--mn-paper-2` | `#E4DDCB` | Papel sombreado |
| `--mn-yellow` | `#FFD400` | Cor da marca: blocos, CTA primário |
| `--mn-yellow-press` | `#E0B800` | Estado pressed/hover do amarelo |
| `--mn-red` | `#E8402F` | Carimbo/hanko: selos, "NOVO", alertas, early access |
| `--mn-mute` | `#A9A59A` | Texto secundário sobre ink (≥ 7:1) |
| `--mn-mute-paper` | `#55524A` | Texto secundário sobre paper/yellow |
| `--mn-ok` | `#3DDC84` | **Somente** feedback de sistema (sucesso). Nunca decorativo |

### 5.2 Regras de uso
- **Proporção por tela:** ink ≈ 60%, amarelo + paper ≈ 30%, vermelho ≤ 5%.
- **No máximo 2 blocos amarelos grandes por viewport**, mais o CTA primário. O resto fica quieto.
- **1 CTA primário amarelo por tela.** Ações secundárias são outline paper/ink.
- Texto sobre amarelo: **sempre `--mn-ink`**. Nunca branco, nunca cinza.
- Vermelho nunca em texto corrido; só selos, badges, linhas de alerta.
- **Verde e roxo atuais saem.** `GRÁTIS` e `MEMBROS` passam a usar o sistema de badges (8.4).

### 5.3 Contexto claro/escuro (sombra e borda mudam conforme o fundo)
Sombra preta some no fundo preto. Por isso duas variáveis contextuais:

```css
:root, .mn-on-dark   { --edge: var(--mn-line);  --drop: var(--mn-paper); --fg: var(--mn-paper); --fg-mute: var(--mn-mute); }
.mn-on-yellow, .mn-on-paper { --edge: var(--mn-ink); --drop: var(--mn-ink); --fg: var(--mn-ink); --fg-mute: var(--mn-mute-paper); }
```

---

## 6. Layout, espaçamento, bordas e sombras

- **Container único:** `max-width: 1200px`, padding lateral 16px (mobile) / 24px (desktop). **Todas as páginas e o header usam o mesmo container.** A logo alinha na borda esquerda do conteúdo.
- **Grid:** 12 colunas, gutter 16px (mobile) / 24px (desktop). Escala de espaço em múltiplos de 4px (4, 8, 12, 16, 24, 32, 48, 64, 96).
- **Seções-bloco:** cada seção grande é uma faixa de largura total com cor própria (ink, yellow ou paper), separadas por **corte diagonal** (`clip-path`) ou **faixa de fita** (seção 7).
- **Bordas:** `2px solid var(--edge)`. **Raio: `0` por padrão, `2px` no máximo.** Exceção: avatar e selos circulares.
- **Sombra dura (drop):** `box-shadow: 4px 4px 0 var(--drop)` (6px em elementos grandes). **Nunca blur.**
- **Interação (hover/active):**
  - hover: `transform: translate(-2px,-2px); box-shadow: 6px 6px 0 var(--drop)`
  - active: `transform: translate(2px,2px); box-shadow: 0 0 0 var(--drop)`
  - transição `120ms steps(2)` (sensação de pixel, sem suavizar).
- **Proibido:** card dentro de card, sombra suave, gradiente decorativo, vidro/blur, raio > 4px.

---

## 7. Texturas e elementos gráficos

```css
/* Halftone (meio-tom) — use em fundo de hero e faixas, opacidade baixa */
.mn-halftone { background-image: radial-gradient(var(--mn-ink) 1.2px, transparent 1.7px); background-size: 8px 8px; opacity: .18; }

/* Faixas diagonais de aviso/fita */
.mn-stripes { background: repeating-linear-gradient(-45deg, var(--mn-ink) 0 10px, transparent 10px 20px); }

/* Granulação (grão de papel/xerox) — inline, sem imagem externa */
.mn-grain::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .07; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}

/* Corte diagonal entre seções */
.mn-cut { clip-path: polygon(0 0, 100% 0, 100% calc(100% - 28px), 0 100%); }

/* Foto editorial P&B com duotone amarelo */
.mn-duotone { filter: grayscale(1) contrast(1.15); mix-blend-mode: multiply; background: var(--mn-yellow); }
```

- **Fita/ticker (marquee):** faixa amarela com texto Anton ink (`NOVO CAPÍTULO • SEASON 01 • APOIE QUEM FAZ •`) entre seções. Velocidade lenta. **Respeitar `prefers-reduced-motion`** (parar a animação).
- **Símbolos soltos** (`{ } * ✕ :)`) como textura em fundo de bloco, `opacity .25`, nunca sobre texto.
- **Adesivos decorativos:** 1 a 3 por tela, rotação ±3°, `aria-hidden`, nunca cobrindo conteúdo ou botão.
- **Desempenho:** texturas via CSS/SVG inline; sem imagens grandes de fundo.

---

## 8. Componentes

Crie em `frontend/src/components/ui/` e use em **todas** as telas. Não reimplemente por página.

### 8.1 Botões — `<Button variant>`
- `primary`: fundo `--mn-yellow`, texto ink, borda 2px ink, drop 4px, Anton 16px caixa-alta, `min-height: 44px`.
- `secondary`: transparente, borda 2px `--fg`, texto `--fg`.
- `ghost`: sem borda, sublinhado no hover.
- `danger`: fundo `--mn-red`, texto paper.
- Estados: hover/active conforme seção 6; `focus-visible` conforme seção 12; `disabled` com `opacity .5` e sem sombra.
- **Um único `primary` por tela.**

### 8.2 Janela — `<Win title>` (substitui os cards cinza)
```html
<article class="mn-win">
  <header class="mn-win__bar">
    <span class="mn-micro">CONTINUAR_LENDO.EXE</span>
    <span class="mn-win__ctrl" aria-hidden="true">×</span>   <!-- botão real só se for dispensável -->
  </header>
  <div class="mn-win__body">…</div>
</article>
```
- Barra de título 28px, fundo `--mn-yellow` com texto ink (Silkscreen 12px), borda 2px, `×` num quadrado de 18px com borda.
- Corpo: fundo `--mn-ink-2` (no escuro) ou `--mn-paper` (em bloco amarelo).
- Usos: Continuar Lendo, Missões, Perfil, Biblioteca, Resumo de Season. **Máximo 2 janelas por tela.**

### 8.3 Card de obra — `<WorkCard>`
- Capa **2:3** (`aspect-ratio: 2/3`), `object-fit: cover`, borda 2px, drop 4px.
- **O card inteiro é um `<a>`.** Sem botão "Ver Obra".
- Ícone de favoritar (coração) **sobre a capa**, canto superior direito, 44×44, com `aria-pressed`.
- Título: Anton 20px, **até 2 linhas** (`line-clamp-2`), `title` com o nome completo.
- Linha de metadados: `por <autor> · <N> caps` em Archivo 14px (`--fg-mute`).
- Badges: no máximo **2**, sobre a capa, canto inferior esquerdo (regras em 8.4).
- Hover: capa sobe 2px/2px e drop cresce.

### 8.4 Sistema de badges/selos — `<Sticker kind>`
Formato de selo (levemente rotacionado ±2°, borda 2px, Silkscreen 12px). **Só aparece quando diferencia.**

| `kind` | Aparece quando | Visual |
|---|---|---|
| `new` | capítulo publicado há < 7 dias | fundo `--mn-red`, texto paper |
| `members` | capítulo/obra em Early Access (`now < publicReleaseAt`) | fundo ink, borda yellow, texto yellow, cadeado |
| `free` | capítulo liberado ao público **e** a obra tem capítulos de membros (para distinguir) | fundo paper, texto ink |
| `complete` | obra concluída | fundo yellow, texto ink |
| `hiatus` | obra em hiato | fundo ink-3, texto paper |

- **Removidos:** "EM LANÇAMENTO" universal, verde `GRÁTIS` e roxo `MEMBROS` atuais.
- Regra de ouro: se **todos** os itens da lista teriam o mesmo badge, **nenhum** exibe.

### 8.5 Ranking "Em Alta" — `<RankRow>`
- Numeral gigante em Anton (`display-xl` reduzido para ~72px na lista): `1` preenchido amarelo; `2`, `3`, `4…` apenas contorno (`-webkit-text-stroke: 2px var(--mn-yellow); color: transparent`).
- Ao lado: capa pequena 2:3 (48×72), título (Anton 20px), autor, e `9.920 views · 1.483 likes` em Archivo 14px tabular.
- Linhas separadas por linha 2px `--mn-line`, **sem cards individuais**.

### 8.6 Patch de nível — `<LevelPatch level>`
Adesivos colecionáveis dos 4 níveis de criador (regras de negócio ficam no README, não mudam):

| Nível | Nome | Forma | Cor | Ícone pixel |
|---|---|---|---|---|
| 1 | Estreante | círculo | paper | broto |
| 2 | Em Ascensão | escudo | yellow | seta para cima |
| 3 | Destaque Editorial | estrela de 8 pontas | red | holofote/megafone |
| 4 | Mestre da Temporada | selo duplo | ink com contorno yellow | coroa |

- Fonte: Bowlby One para o número (`LV.2`) e Silkscreen para o rótulo.
- Níveis ainda não conquistados: versão **silhueta** (contorno tracejado, `opacity .5`) com cadeado.
- **Badge cosmético "Criador da Temporada" (Nível 2+):** carimbo retangular vermelho, rotação −4°, texto `CRIADOR DA TEMPORADA · S01`. Aparece no card da obra e no perfil público.

### 8.7 Barra de XP — `<XpBar value max>`
- 10 a 20 blocos quadrados; os preenchidos em amarelo, os vazios em `--mn-ink-3`.
- Animação de preenchimento com `steps()`, não suave. Respeitar `prefers-reduced-motion`.
- Rótulo Silkscreen: `XP 340/500`.

### 8.8 Quest — `<QuestCard>` (missões semanais)
- Dentro de `<Win title="QUEST_SEMANAL.EXE">`.
- Lista com checkbox quadrado (✓ pixel), nome da missão, recompensa (`+15% descoberta por 48h`) e prazo.
- Missões: Consistência, Diálogo, Retenção (definições no README).
- **Transparência financeira:** quando o Nível 4 reduz a taxa, exibir texto claro e sem enfeite enganoso: `Taxa reduzida: 17% → 10% por 15 dias (termina em DD/MM)`.

### 8.9 Formulários
- Inputs: fundo `--mn-ink-2`, borda 2px `--mn-line`, foco com borda paper + drop yellow, `min-height: 44px`, label sempre visível acima (Archivo 14px 600).
- Erro: borda `--mn-red` + mensagem em texto (não só cor), com ícone.
- **Campo OTP do 2FA:** 6 caixas quadradas de 52×60px, Anton 32px, borda 2px, a ativa com drop amarelo. Suportar colar o código inteiro e `autocomplete="one-time-code"`.
- **Declaração de autoria original (publicação):** checkbox grande dentro de uma caixa estilo contrato com carimbo: `DECLARO QUE ESTA OBRA É ORIGINAL E MINHA.` com link para os Termos. Bloqueia envio se desmarcado.

### 8.10 Feedback e estados
- **Toast:** janela pequena (`<Win>` compacta) no canto inferior; sucesso usa `--mn-ok` só no ícone.
- **Loading:** barra de progresso em blocos + mascote dormindo; skeletons em `--mn-ink-2` com listras sutis, sem shimmer suave.
- **Vazio:** mascote + 1 frase + 1 ação.
- **Erro de rede:** mascote "erro" + botão `TENTAR DE NOVO`.

### 8.11 Denúncia
- Botão discreto (`ghost`, ícone de bandeira) na ficha da obra e no leitor.
- Modal em `<Win title="DENUNCIAR.EXE">` com motivos: Violação de direitos autorais · Conteúdo pornográfico/hentai · Abuso ou plágio. Texto de apoio: `Resposta em até 24h.`

---

## 9. Telas

### 9.1 Feed e Lançamentos (home)
Ordem das seções (todas no mesmo container):
1. **Hero (bloco amarelo, `.mn-cut`, `.mn-halftone`, `.mn-grain`):**
   - Esquerda: selo `DESTAQUE AGORA` (sticker), título da obra em `display-xl`, sinopse em `body-l` (máx. 3 linhas), botões `LER AGORA` (primary) e `VER OBRA` (secondary).
   - Direita: **capa vertical 2:3 grande**, rotação 2°, borda 2px, drop 8px, com 1 a 2 recortes de painel ao fundo e faixas diagonais.
   - Carrossel: indicadores quadrados (não bolinhas), troca por botão e teclado; **sem autoplay** (ou autoplay pausável e desligado com `prefers-reduced-motion`).
2. **Fita/ticker** em amarelo.
3. **Em Alta Agora (bloco ink):** `<RankRow>` ×5, título de seção Anton `display-l`, link `VER TODOS`.
4. **Continuar Lendo:** uma única `<Win>` com capa 48×72, título, `Capítulo 4 · pág. 12`, botão `CONTINUAR` (primary) e `Ficha da obra` (ghost). Se não há progresso, a seção some.
5. **Novos Capítulos (bloco paper ou ink):** grade de `<WorkCard>` (2 colunas mobile, 4 desktop), badge `new`/`members` conforme 8.4.
6. **Seasons (bloco amarelo):** chamada para criadores com os 4 `<LevelPatch>` e CTA `VIRAR CRIADOR`.
7. **Rodapé.**

### 9.2 Catálogo
- Cabeçalho em bloco amarelo: título `CATÁLOGO` em `display-l`, busca (input grande) e botão Filtros.
- **Chips de gênero:** retângulos de 2px, ativo = fundo ink e texto yellow (ou o inverso em bloco amarelo). Rolagem horizontal no mobile.
- Grade de `<WorkCard>`. Sem badges se todos forem iguais (8.4).
- Estado vazio com mascote.

### 9.3 Ficha da obra
- Capa 2:3 grande à esquerda, título `display-m`, autor (link `/@handle`), gêneros como chips, sinopse, botões `LER DO COMEÇO` / `CONTINUAR`, favoritar, apoiar (`DOAR` / `SER MEMBRO`).
- Lista de capítulos em linhas (não cards): número em Anton, título, data, selo `members`/`new`, progresso.
- Capítulos em Early Access exibem contagem regressiva e selo; o clique abre CTA de membro (o bloqueio real é 403 no servidor, a UI só reflete).
- Botão `DENUNCIAR` discreto.

### 9.4 Leitor (Modo Leitor) — regras rígidas
- Fundo `--mn-ink` puro, **sem textura, sem halftone, sem fita, sem mascote, sem adesivo**.
- Páginas centralizadas em coluna (webtoon) com largura máxima de leitura (≈ 800px) e **sem borda nem sombra** nas páginas.
- Barra superior e inferior mínimas, auto-ocultáveis; amarelo **somente** na barra de progresso e no botão de próximo capítulo.
- **Anúncio (a cada 30 páginas):** bloco discreto, claramente rotulado `PUBLICIDADE`, **sem causar salto de layout** (altura reservada) e sem imitar página do mangá.
- Teclado: setas/espaço navegam; foco visível.

### 9.5 Criadores (listagem)
- Grade de **cartões de criador**: avatar com borda de adesivo, nome, `@handle`, `<LevelPatch>` do nível atual, nº de obras. Sem exibir nada sensível (CPF/PIX nunca).
- Destaque fixo do Nível 4 no topo em bloco amarelo.

### 9.6 Perfil do Leitor
- Cabeçalho: avatar grande com borda de adesivo; nome em `display-m`; `@wils` em Archivo 600 (sem parênteses, sem mono); `Membro desde abr. 2026` em `small`.
- **Um número de destaque:** `2` + `OBRAS CURTIDAS` em `display-xl`. Os demais (`0 autores apoiados`, `cadastro`) viram uma linha de metadados discretos.
- **Removidos:** tile "Status público" (redundante) e tile "Ativo".
- **Visibilidade:** um *switch* com rótulo `PERFIL PÚBLICO` / `PERFIL PRIVADO` e texto de apoio claro. Perfil privado visto por terceiros mostra um estado de bloqueio (mascote + `Este perfil é privado`).
- Biblioteca pública: grade de `<WorkCard>` compacto com `Parou na pág. 12 do Cap. 3` e botão `CONTINUAR`.
- Texto de aviso do perfil: Archivo 14px com contraste ≥ 4.5:1 (hoje é itálico mono ilegível).
- Links de privacidade: `BAIXAR MEUS DADOS` e `EXCLUIR CONTA` (Fase 3 / LGPD) em seção própria, com `danger` apenas na exclusão e confirmação em modal.

### 9.7 Perfil do Criador (`/@handle`)
- Faixa de cabeçalho amarela com avatar, nome, bio pública, links sociais (apenas os permitidos), `<LevelPatch>` e carimbo "Criador da Temporada" quando houver.
- Abas: `OBRAS` · `SOBRE` · `APOIAR`.
- **Nunca renderizar CPF/PIX**, nem em placeholder.

### 9.8 Painel do Criador (Season)
- Topo: `SEASON 01 · FALTAM N DIAS` (Silkscreen), `<XpBar>`, `<LevelPatch>` atual e o próximo.
- `<Win title="QUEST_SEMANAL.EXE">` com as 3 missões.
- `<Win title="GANHOS.EXE">` com doações, membros, anúncios e a divisão real (83/17, ou 90/10 quando o Nível 4 estiver ativo, com data de término). Valores vindos **do servidor**.

### 9.9 Login / Cadastro / 2FA
- Duas colunas no desktop: esquerda = bloco amarelo com mascote e frase; direita = formulário ink.
- Escolha de papel (Leitor/Escritor) em **dois botões grandes de seleção** (card selecionável com borda amarela).
- 2FA com o campo OTP de 8.9. Mensagem clara na 5ª tentativa falha (bloqueio).
- Em dev, o painel "Dev Outbox" aparece como `<Win title="DEV_OUTBOX.EXE">` **somente em perfil não-prod**.

### 9.10 Rodapé
- Bloco ink com borda superior amarela 2px; colunas: Plataforma, Criadores, Legal (Termos, Privacidade, DPO `privacidade@manganetworking.com.br`, Denúncia).
- Linha de transparência (legível, ≥ 12px, ≥ 4.5:1): `17% de taxa sobre membros e doações · 58% dos anúncios vão para o autor · sem intermediários`.
- `© 2026 MangaNetWorking. Obras originais protegidas.`

### 9.11 Navegação
- **Desktop:** logo à esquerda; itens Anton 16px; item ativo = bloco amarelo com texto ink (não só sublinhado); CTA `ENTRAR / CADASTRO` primary (deslogado) ou avatar (logado). Botão `MODO LEITOR` como secondary.
- **Mobile:** header enxuto + **barra inferior fixa** com Feed, Catálogo, Criadores, Biblioteca, Perfil (ícones + rótulo Silkscreen 12px, alvo ≥ 44px).

---

## 10. Movimento

- Duração curta (120–180ms) com `steps(2–4)`; nada de easing suave nem parallax.
- Entradas de seção: nenhuma animação obrigatória. Permitido: adesivo "carimba" (scale 1.15 → 1, 160ms) ao aparecer.
- Marquee e animações contínuas: **desligadas** em `prefers-reduced-motion: reduce`.

---

## 11. Imagens e capas

- As fotos aleatórias atuais são **placeholders**. Marque cada uma com `data-placeholder="true"` e centralize no componente `<Cover>`.
- `<Cover src title>`: se não houver `src` ou ela falhar, gerar **capa de fallback** em CSS/SVG (fundo yellow/paper/red alternando por hash do título, título em Anton, halftone) em vez de imagem quebrada.
- Em produção só entram uploads validados do `LocalFileStorageService` (JPEG/PNG/WebP). **Sem hotlink de terceiros.**
- Capas sempre com as cores originais. O tratamento P&B/duotone vale só para fotos editoriais da própria plataforma, nunca para capas de obras.
- Sem personagens ou obras de terceiros em nenhum mock, exemplo ou fallback.

---

## 12. Acessibilidade (obrigatório)

- Contraste mínimo **4.5:1** para texto normal, **3:1** para texto grande e elementos de interface.
  - `--mn-ink` sobre `--mn-yellow`: ≈ 13:1 (ok).
  - `--mn-mute` sobre `--mn-ink`: ≈ 8:1 (ok). `--mn-mute-paper` sobre paper: ≈ 7:1 (ok).
  - Verificar qualquer combinação nova antes de usar.
- **Foco visível:** `:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px }` com `--focus: var(--mn-paper)` no escuro e `--focus: var(--mn-ink)` em bloco amarelo/paper.
- Texto mínimo 12px; corpo 16px; alvos de toque ≥ 44×44px.
- Informação nunca só por cor (erro, estado de badge, status).
- Elementos decorativos (adesivos, símbolos, mascote ornamental, ticker) com `aria-hidden="true"`.
- Imagens de capa com `alt` = título da obra; `<Cover>` decorativa em lista usa `alt=""` quando o título está ao lado.
- Navegação 100% por teclado; ordem de foco lógica; carrossel com controles acessíveis.
- Respeitar `prefers-reduced-motion` e `prefers-contrast`.

---

## 13. Implementação técnica

### 13.1 Dependências (somente estas)
```
npm i @fontsource/anton @fontsource/bowlby-one @fontsource/silkscreen @fontsource-variable/archivo
```
Sem CDN externo, sem biblioteca de componentes pesada. Ícones: reutilize o que já existe no projeto; se precisar de pixel icons, crie SVGs próprios em `src/assets/icons/`.

### 13.2 Tokens — `frontend/src/styles/tokens.css` (importar em `index.css`)
```css
:root {
  --mn-ink:#0B0B0C; --mn-ink-2:#151517; --mn-ink-3:#212125; --mn-line:#34343A;
  --mn-paper:#F4EFE3; --mn-paper-2:#E4DDCB;
  --mn-yellow:#FFD400; --mn-yellow-press:#E0B800;
  --mn-red:#E8402F; --mn-mute:#A9A59A; --mn-mute-paper:#55524A; --mn-ok:#3DDC84;

  --font-display:"Anton","Impact",sans-serif;
  --font-logo:"Bowlby One","Anton",sans-serif;
  --font-body:"Archivo Variable","Archivo",system-ui,sans-serif;
  --font-pixel:"Silkscreen",monospace;

  --radius:2px; --bw:2px; --shadow:4px 4px 0 var(--drop); --shadow-lg:8px 8px 0 var(--drop);
  --focus:var(--mn-paper);
}
body { background:var(--mn-ink); color:var(--mn-paper); font-family:var(--font-body); }
```
(Mais as classes de contexto `.mn-on-dark/.mn-on-yellow/.mn-on-paper` da seção 5.3 e as utilidades da seção 7.)

### 13.3 Tailwind
**Primeiro verifique a versão instalada** (`frontend/package.json`).
- **Tailwind v3:** estenda `theme.extend` com `colors` (`ink`, `paper`, `yellow`, `red`, `mute`), `fontFamily` (`display`, `logo`, `body`, `pixel`), `borderRadius.DEFAULT: '2px'`, `boxShadow` (`hard`, `hard-lg`) apontando para as variáveis acima.
- **Tailwind v4:** use `@theme { --color-ink: …; --font-display: …; }` no CSS.
- Remover/neutralizar utilitários antigos que reintroduzem cantos arredondados grandes (`rounded-xl`, `rounded-2xl`) nas telas migradas.

### 13.4 Estrutura sugerida
```
frontend/src/
  styles/tokens.css, textures.css
  components/ui/ Button, Win, Sticker, WorkCard, RankRow, LevelPatch, XpBar, QuestCard, Cover, Field, OtpInput, Toast, Marquee
  assets/brand/ logo-*.svg, mascot-*.svg
  pages/ (migrar uma por vez)
```

---

## 14. Plano de execução (fatias verticais, cada uma buildando e testável)

Use a mesma legenda do `PLANO_DE_FASES.md` (`[ ]`, `[~]`, `[x]`). **Não bloqueie as Fases 3 a 6 do plano de produto**; este trabalho é transversal e não muda contratos de API.

- [ ] **V0 — Baseline.** Rodar `npm run build` e anotar o estado atual (versão do Tailwind, componentes existentes, rotas). Fazer commit/branch `feat/identidade-visual`. Criar `docs/decisions/ADR-005-identidade-visual.md` resumindo a decisão (conceito, fontes, tokens, o porquê).
- [ ] **V1 — Fundação.** Instalar fontes, criar `tokens.css`, `textures.css`, configurar Tailwind, aplicar fontes e fundo global, remover mono. *Aceite:* build passa; todas as telas mantêm funcionalidade; tipografia nova aplicada globalmente.
- [ ] **V2 — Componentes base.** `Button`, `Win`, `Sticker`, `Cover`, `Field`, `OtpInput`, `LevelPatch`, `XpBar` com uma página interna de showcase (`/dev/design-system`, **apenas fora de prod**). *Aceite:* todos os estados (hover, active, focus, disabled, erro) visíveis no showcase.
- [ ] **V3 — Header, navegação e rodapé.** Header dirigido por sessão, container único, barra inferior mobile, rodapé novo. *Aceite:* alinhamento idêntico em Feed/Catálogo/Perfil; sem avatar + "Entrar" simultâneos.
- [ ] **V4 — Feed e Catálogo.** Hero com capa vertical, ticker, `RankRow`, `Win` de continuar lendo, `WorkCard` novo, badges por regra, chips de gênero. *Aceite:* nenhum "Ver Obra" repetido; títulos em até 2 linhas; badges só quando diferenciam.
- [ ] **V5 — Perfis (leitor e criador) e Biblioteca.** Layout da seção 9.6/9.7, switch de visibilidade, estado privado. *Aceite:* nenhum dado sensível em tela pública; contraste verificado.
- [ ] **V6 — Auth.** Login/Cadastro/2FA com OTP em 6 caixas e `DEV_OUTBOX.EXE` só em não-prod. *Aceite:* fluxo completo de 2FA continua funcionando.
- [ ] **V7 — Leitor.** Regras da seção 9.4. *Aceite:* sem texturas/mascote no leitor; anúncio sem layout shift; foco e teclado ok.
- [ ] **V8 — Seasons UI.** Painel do criador (9.8) com `QuestCard`, `LevelPatch`, `XpBar`, divisão financeira vinda do servidor. *Aceite:* nenhum cálculo financeiro no frontend.
- [ ] **V9 — Polimento e acessibilidade.** Passada de contraste, foco, `prefers-reduced-motion`, responsividade (360px, 768px, 1280px), performance (sem imagens pesadas de fundo). Atualizar `README.md` (seção 6, trecho de Frontend) e `PROMPT_ANTIGRAVITY.md` para apontar para este documento.

---

## 15. Checklist de aceite final (visual)

- [ ] Nenhuma `font-mono`/monoespaçada em metadados, perfis ou números.
- [ ] Apenas 4 famílias de fonte carregadas, todas self-hosted, com acentos corretos.
- [ ] Todas as páginas usam o mesmo container e a logo alinha com o conteúdo.
- [ ] Nenhum card dentro de card; nenhum raio > 4px (exceto avatar/selo circular); nenhuma sombra com blur.
- [ ] 1 CTA primário amarelo por tela; amarelo como bloco, não em todo detalhe.
- [ ] Nenhum "EM LANÇAMENTO" universal; badges só quando diferenciam; verde/roxo antigos removidos.
- [ ] Card de obra inteiro clicável, título em até 2 linhas, favoritar sobre a capa.
- [ ] Hero com capa vertical 2:3 em destaque.
- [ ] Perfil do leitor com 1 número de destaque, sem tiles redundantes, handle sem parênteses em mono.
- [ ] Modo Leitor limpo (sem textura/mascote/adesivo), anúncio sem layout shift.
- [ ] Contraste ≥ 4.5:1 em todo texto; texto ≥ 12px; foco visível; reduced-motion respeitado.
- [ ] `<Cover>` com fallback; imagens placeholder marcadas; zero obra/personagem de terceiros.
- [ ] CPF/PIX não aparecem em nenhuma tela pública.
- [ ] `npm run build` e testes existentes passando; nenhuma mudança em backend/API.

---

## 16. O que NÃO fazer

- Não copiar o logo, o mascote, o texto ou as composições das referências (cartazes amarelos e "Space Coders"). Elas inspiram **linguagem**, não conteúdo. O texto dos cartazes de referência é lixo gerado por IA e não deve ser usado.
- Não usar personagens, nomes ou arte de mangás/animes/jogos de terceiros.
- Não introduzir loja, produtos físicos, frete ou POD em nenhum elemento visual (o escopo é 100% digital).
- Não calcular split financeiro, taxas, níveis ou missões no frontend. A UI só exibe o que o servidor devolve.
- Não decorar o Modo Leitor.
- Não usar pixel font para parágrafos, nem Press Start 2P.
- Não esconder informação legal (taxas, termos, DPO) em texto ilegível.
