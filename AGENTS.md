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
bun test                      # Testes (159 specs, sem rede nem side effects)
bun run typecheck             # Verificação de tipos (src, tests e bench)
bun run build                 # Gera dist/core.js e dist/core.d.ts
bun run bench                 # Benchmark dos caminhos quentes (sem rede)
```

Não há script de lint. Exemplo local sem credenciais: `DB_PATH=:memory: bun run example -- --ingest`.

## Estrutura
- `src/index.ts` (entrada Bun) e `src/core.ts` (entrada `./core`, Node).
- `src/agent/` orquestração e CLI; `src/sources/` feeds e extração de HTML; `src/storage/` SQLite e vetores; `src/ai/` chat, cadeia de modelos e filtros de prosa; `src/delivery/` Telegram; `src/util/` primitivas puras.
- `bench/` benchmark reprodutível; método e números em `docs/BENCHMARK.md`.

## Gates de CI
- `validate.yml` (PR e push em `main`): reusable `base-actions` de validação, com auditoria de dependências e varredura de segredos.
- `security.yml` (push em `main`, semanal, manual): reusable `base-actions` de security scan (Gitleaks).
- `publish.yml` (tag `v*`): typecheck, test, build e `npm publish`.

## Não fazer
- Importar `bun:*` em módulos reexportados por `src/core.ts` (o subpath `./core` roda em Node). `bun:sqlite` só entra em `src/storage/`; `tests/architecture.test.ts` falha se o grafo de `core.ts` alcançar `bun:*` ou `storage/`.
- Remover ou renomear export de `src/index.ts`/`src/core.ts`: a lista da 0.4.0 está congelada em `tests/architecture.test.ts`. Membro novo em interface que o consumidor implementa (`Store`, `Config`, `AgentDeps`) entra como opcional.
- Afirmar ganho de desempenho sem rodar `bun run bench` antes e depois.
- Commitar `.env`, tokens ou chaves; o `.gitignore` já cobre `.env` e `data/`.

## Regras de Publicação
- Registry: npm público (`https://registry.npmjs.org/`).
- Scope: `@juninmd` com `"access": "public"`.
- Workflow CI/CD: `.github/workflows/publish.yml` acionado por tag `v*` exigindo segredo `NPM_TOKEN`.
- A tag do Git deve coincidir exatamente com a chave `version` do `package.json`.

<!-- base-actions-main-policy -->
## GitHub Actions — padrão obrigatório (@main)

- Referencie as actions internas sempre pelo branch, nunca por SHA:
  - `uses: juninmd/base-actions/<action>@main`
  - `uses: juninmd/base-actions/.github/workflows/<arquivo>.yml@main`
- Não fixe `@<sha>` em `juninmd/base-actions`: a atualização é centralizada no
  `main` e passa a valer no próximo run.
- PRs cujos checks não iniciam por billing/spending limit são mesclados pelo bot central
  `juninmd/base-actions/.github/workflows/auto-merge-billing-blocked.yml`.
  Para impedir o merge automático de um PR, aplique a label `do-not-merge`.