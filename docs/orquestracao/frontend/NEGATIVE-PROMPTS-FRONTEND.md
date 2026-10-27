# NEGATIVE PROMPTS & REGRAS DE DESIGN (FRONTEND WORKER)

> **Regra de Ouro para o OpenCode Frontend:** 
> Você NUNCA deve inventar estilos genéricos de IA, cores aleatórias ou layouts frouxos.
> Leia este documento antes de mexer em qualquer componente visual.

---

## 1. O que é ESTRITAMENTE PROIBIDO (Negative Checklist)

- ❌ **Proibido `rounded-xl`, `rounded-2xl`, `rounded-3xl`:** Cantos arredondados grandes estão terminantemente banidos. Use `rounded-[2px]` ou `rounded-none`. A única exceção é o avatar circular (`rounded-full`).
- ❌ **Proibido Sombras Suaves com Blur:** Nada de `shadow-lg`, `shadow-2xl` com blur translúcido. Use SOMBRAS DURAS (*hard shadow*): `box-shadow: 4px 4px 0 var(--drop)`.
- ❌ **Proibido Card dentro de Card:** Nada de colocar um card cinza dentro de outro card cinza. Use o componente `<Win>` ou seções chapadas de cor.
- ❌ **Proibido Gradientes Decorativos Roxos/Azuis:** A paleta é brutalista de rua: Preto-Nanquim (`#0B0B0C`), Amarelo (`#FFD400`), Papel Off-White (`#F4EFE3`) e Carimbo Vermelho (`#E8402F`).
- ❌ **Proibido Amarelo em Todo Lugar:** No máximo 2 blocos amarelos por tela e APENAS 1 botão CTA primário amarelo por viewport. O resto fica em outline.
- ❌ **Proibido Font Mono em Números e Metadados:** Nada de usar fonte de hacker/terminal em contadores de visualizações, capítulos ou perfil. Use **Archivo** com `font-variant-numeric: tabular-nums`. Fonte pixel (**Silkscreen**) é apenas para microrrótulos de janela.
- ❌ **Proibido Decorar o Leitor:** A tela `/ler/:id` é sagrada. O leitor webcomic deve ser 100% escuro, focado nas páginas do mangá, sem adesivos, texturas ou poluição.
- ❌ **Proibido Inventar Dados Financeiros ou Status:** O Frontend NUNCA calcula splits de receita, XP de missões ou validações financeiras. Ele apenas renderiza o que o backend liberou.
- ❌ **Proibido Alterar Contratos de API/Firebase:** Mantenha os hooks, queries e mutations existentes; altere apenas a casca visual e a experiência do usuário.

---

## 2. Assinatura do Relatório

Ao concluir a tarefa de frontend, o operário DEVE gerar o relatório assinado em:
`docs/orquestracao/frontend/relatorios/RELATORIO-XXX.md`

Com o rodapé oficial:
`Assinado por: OpenCode Frontend`
