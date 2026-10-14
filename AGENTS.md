# AGENTS.md

## Projeto
`@juninmd/digest-kit` — Núcleo compartilhado para agentes de digest (RSS → SQLite → IA → Telegram).

## Stack & Runtimes
- **Runtime primário:** Bun `>=1.1.0` (suporta `bun:sqlite` no pacote raiz).
- **Runtime secundário:** Node `>=20` (compatível com subpath `@juninmd/digest-kit/core`).
- **Gerenciador de pacotes:** Bun (`bun.lock`).
- **TypeScript:** v5.7+ (`tsconfig.json` para Bun/testes; `tsconfig.build.json` para dist do `./core`).

## Comandos
```bash
bun install --frozen-lockfile # Instalação
bun test                      # Testes (68 specs, sem rede nem side effects)
bun run typecheck             # Verificação de tipos
bun run build                 # Gera dist/core.js e dist/core.d.ts
```

## Regras de Publicação
- Registry: npm público (`https://registry.npmjs.org/`).
- Scope: `@juninmd` com `"access": "public"`.
- Workflow CI/CD: `.github/workflows/publish.yml` acionado por tag `v*` exigindo segredo `NPM_TOKEN`.
- A tag do Git deve coincidir exatamente com a chave `version` do `package.json`.
