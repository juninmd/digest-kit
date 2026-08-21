# 📬 @juninmd/digest-kit

O núcleo dos agentes de digest — **RSS → SQLite → IA → Telegram** — como biblioteca.

`saude-diaria`, `cve-radar`, `vagas-dev`, `concursos-br`, `ciencia-hoje`, `leis-radar`,
`cursos-free` e `role-radar` têm hoje o mesmo `src/` **byte a byte**; só mudam `topic.ts`,
`package.json` e o README. Este pacote é esse `src/` extraído: corrigir um bug de parsing ou
trocar de provider de IA passa a ser uma bump de versão em vez de oito PRs iguais.

## Uso

Um agente inteiro cabe em dois arquivos:

```ts
// src/topic.ts
import { defineTopic } from "@juninmd/digest-kit";

export const topic = defineTopic({
  name: "cve-radar",
  title: "CVE Radar",
  emoji: "🛡️",
  subject: "vulnerabilidades e segurança de software",
  systemPrompt: "Você é um analista de segurança... (regras do digest)",
  feeds: [
    { name: "NVD", url: "https://nvd.nist.gov/feeds/xml/cve/misc/nvd-rss.xml" },
    { name: "CISA KEV", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml" },
  ],
});
```

```ts
// src/index.ts
import { runAgent } from "@juninmd/digest-kit";
import { topic } from "./topic.ts";

await runAgent(topic);
```

CLI que vem de graça:

```bash
bun run src/index.ts            # um ciclo: ingest + digest
bun run src/index.ts --ingest   # só coleta
bun run src/index.ts --digest   # só resume e envia
bun run src/index.ts --loop     # fica de pé com os dois crons
```

Exemplo completo rodando em [`examples/meu-agente`](examples/meu-agente) — como ele mora dentro
do próprio pacote, resolve o `@juninmd/digest-kit` por `paths` no tsconfig em vez de instalar.

## Configuração (env)

Bun carrega `.env` sozinho. **Os nomes são os mesmos dos agentes atuais** — migrar não muda
nenhum Secret do cluster.

| var | padrão | o quê |
|---|---|---|
| `AI_PROVIDER` | `ollama` | `ollama` · `openai` · `anthropic` · `google` · `compatible` |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | — | usados por `compatible`: qualquer gateway OpenAI-compatible (LiteLLM, vLLM, Groq) |
| `AI_TEMPERATURE` | `0.4` | |
| `TELEGRAM_BOT_TOKEN` | — | sem token, o digest sai no console |
| `TELEGRAM_CHAT_IDS` | — | lista separada por vírgula (`TELEGRAM_CHAT_ID` também é aceito) |
| `CRON_INGESTION` | `*/30 * * * *` | |
| `CRON_DIGEST` | `0 11 * * *` | |
| `DB_PATH` | `./data/store.db` | `:memory:` funciona |
| `MAX_ITEMS_PER_FEED` | `20` | |
| `DIGEST_MAX_ITEMS` | `12` | |
| `FEED_TIMEOUT_MS` | `12000` | |
| `TZ_DISPLAY` / `LOCALE` | `America/Sao_Paulo` / `pt-BR` | formato da data no cabeçalho |

O provider `compatible` é a novidade em relação ao template antigo: aponta direto para o
gateway LiteLLM sem fingir que é Ollama.

## Garantias de comportamento

Cobertas por teste, não por boa intenção:

- **Idempotência** — o mesmo link nunca entra duas vezes (`PRIMARY KEY` no hash do link).
- **Um feed fora do ar não derruba o ciclo** — `Promise.allSettled`, o feed morto vira log.
- **IA fora do ar não custa o digest do dia** — cai para a lista bruta formatada.
- **Envio que falha não marca item como enviado** — o item volta no próximo digest.
- **Mensagem grande é quebrada no limite do Telegram** sempre em fim de linha.
- **Chave nunca vaza em log** — corpo de erro de provider passa por `redact()`.

## API

```ts
defineTopic(topic): Topic          // valida o tópico
runAgent(topic, deps?, argv?)      // CLI pronta (é o index.ts inteiro do agente)
createAgent(topic, deps?): Agent   // { ingest, digest, runOnce, startLoop, store, config }
```

`deps` existe para teste e para casos fora da curva — tudo é injetável:

```ts
const agent = createAgent(topic, {
  config: { dbPath: ":memory:", digestMaxItems: 3 },
  fetchFeed: async (feed) => fixtures[feed.name],  // sem rede
  chat: async (system, user) => "digest falso",     // sem IA
  send: async (text) => { enviados.push(text); },   // sem Telegram
  now: () => new Date("2026-08-20T12:00:00Z"),      // data estável
});
```

Peças avulsas também são exportadas: `createStore`, `createChat`, `createSend`,
`createFetchFeed`, `loadConfig`, `clean`, `idFor`, `splitMessage`, `formatItems`, `redact`.

## Migrando um agente existente

1. `bun add @juninmd/digest-kit` (ou `"file:../digest-kit"` enquanto não publicar).
2. `src/config/topic.ts` → `src/topic.ts`, trocando o objeto solto por `defineTopic({...})`.
3. `src/index.ts` vira as três linhas do exemplo acima.
4. Apague `src/{ai,db,digest,ingest,telegram}.ts` e `src/config/env.ts`.
5. Os `.env` e Secrets do cluster continuam válidos — nenhum nome de variável mudou.

Resultado por agente: **~450 linhas a menos**, mesmo comportamento.

> O `DB_PATH` não muda de schema: a tabela `items` é idêntica à do template, então o SQLite
> que já está no volume continua sendo lido sem migração.

## Desenvolvimento

```bash
bun install
bun test          # 38 testes
bunx tsc --noEmit
```

Os testes não tocam rede, IA nem Telegram — tudo passa por `deps` e por `:memory:`.
