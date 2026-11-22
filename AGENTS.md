# AGENTS.md

`@juninmd/digest-kit`: shared core for digest agents (RSS → SQLite → AI → Telegram).

## Stack

- Primary runtime: Bun `>=1.1.0` (the root package uses `bun:sqlite`).
- Secondary runtime: Node `>=20` (the `@juninmd/digest-kit/core` subpath runs on Node).
- Package manager: Bun (`bun.lock`).
- TypeScript 5.7+. `tsconfig.json` covers Bun and tests; `tsconfig.build.json` builds the `./core` dist.

## Commands

```bash
bun install --frozen-lockfile   # install
bun test                        # tests: no network, no side effects
bun run typecheck               # type check src, tests and bench
bun run build                   # emits dist/core.js and dist/core.d.ts
bun run bench                   # hot-path benchmark: no network
```

There is no lint script. A local example with no credentials: `DB_PATH=:memory: bun run example -- --ingest`.

## Structure

- `src/index.ts` (Bun entry) and `src/core.ts` (`./core` entry, Node).
- `src/agent/`: orchestration and CLI. `src/sources/`: feeds and HTML extraction. `src/storage/`: SQLite and vectors. `src/ai/`: chat, model chain and prose filters. `src/delivery/`: Telegram. `src/util/`: pure primitives.
- `bench/`: reproducible benchmark. Method and numbers are in `docs/BENCHMARK.md`; past runs are in `bench/results/`.
- `examples/meu-agente/`: a local example agent.

## Conventions

- CI gates:
  - `validate.yml` (PRs and pushes to `main`): reusable validation from `base-actions`, with a dependency audit and a secret scan.
  - `security.yml` (pushes to `main`, weekly, manual): reusable security scan (Gitleaks).
  - `publish.yml` (tags `v*`): type check, test, build and `npm publish`.
- Publishing: public npm registry (`https://registry.npmjs.org/`), scope `@juninmd` with `"access": "public"`. `publish.yml` needs the `NPM_TOKEN` secret. The Git tag must match the `version` in `package.json` exactly.
- GitHub Actions: <!-- base-actions-main-policy -->
  - Reference internal actions by branch, never by SHA: `uses: juninmd/base-actions/<action>@main` and `uses: juninmd/base-actions/.github/workflows/<file>.yml@main`.
  - Do not pin `@<sha>` for `juninmd/base-actions`; updates are centralized on `main`.
  - PRs whose checks do not start because of billing or spending limits are auto-merged by `juninmd/base-actions/.github/workflows/auto-merge-billing-blocked.yml`. Apply the `do-not-merge` label to block that.

## Gotchas

- Do not import `bun:*` in modules re-exported by `src/core.ts`, because the `./core` subpath runs on Node. `bun:sqlite` belongs only in `src/storage/`. `tests/architecture.test.ts` fails if the `core.ts` graph reaches `bun:*` or `storage/`.
- Do not remove or rename exports of `src/index.ts` or `src/core.ts`. The 0.4.0 export list is frozen in `tests/architecture.test.ts`. A new member of an interface that consumers implement (`Store`, `Config`, `AgentDeps`) must be optional.
- Do not claim a performance gain without running `bun run bench` before and after the change.
- Do not commit `.env`, tokens or keys. `.gitignore` covers `.env*` (except `.env.example`) and `data/`.
