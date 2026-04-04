# Auditorias opcionais (exports mortos)

Este repositório mistura Vite (`src/`), Cloud Functions (`functions/`) e módulos `shared/`. Ferramentas como **knip** ou **ts-prune** tendem a marcar ficheiros de Functions como «não usados» se só indexarem `src/`.

Comandos úteis quando quiseres uma passagem manual:

```bash
npx knip --entry src/main.jsx --project "src/**/*.{js,jsx}"
npx ts-prune -p tsconfig.json
```

Interpretar resultados com critério: muitos exports são API pública interna (reutilização futura) ou entradas só do Firebase.
