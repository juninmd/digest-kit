# 📬 @juninmd/digest-kit

O núcleo para agentes de digest — **RSS → SQLite → IA → Telegram** — como biblioteca.

Crie agentes autônomos de curadoria e resumo diário em minutos: coleta feeds RSS/Atom, deduplica itens em SQLite, resume e filtra via LLM (Ollama, OpenAI, Anthropic, Gemini ou compatíveis) e envia mensagens formatadas para canais/grupos do Telegram ou saída padrão.

## Instalação

Disponível no registro público do [npm](https://www.npmjs.com/package/@juninmd/digest-kit):

```bash
bun add @juninmd/digest-kit
```

Consumidores Node.js utilizando o subcaminho puro `./core`:

```bash
npm install @juninmd/digest-kit
```

## Uso Rápido

Um agente completo requer apenas dois arquivos:

```ts
// src/topic.ts
import { defineTopic } from "@juninmd/digest-kit";

export const topic = defineTopic({
  name: "tech-radar",
  title: "Tech Radar",
  emoji: "⚡",
  subject: "tecnologia e desenvolvimento de software",
  systemPrompt: "Você é um analista de tecnologia. Resuma as novidades de forma concisa em pt-BR...",
  feeds: [
    { name: "Hacker News", url: "https://hnrss.org/frontpage" },
    { name: "GitHub Blog", url: "https://github.blog/feed/" },
  ],
});
```

```ts
// src/index.ts
import { runAgent } from "@juninmd/digest-kit";
import { topic } from "./topic.ts";

await runAgent(topic);
```

### CLI Integrada

Ao executar seu agente via linha de comando:

```bash
bun run src/index.ts            # Executa um ciclo completo: ingestão + digest
bun run src/index.ts --ingest   # Apenas coleta novos itens dos feeds
bun run src/index.ts --digest   # Apenas resume os itens pendentes e envia
bun run src/index.ts --loop     # Mantém o processo ativo com os agendamentos cron
```

Exemplo prático funcional em [`examples/meu-agente`](examples/meu-agente).

## Configuração (Variáveis de Ambiente)

O Bun carrega arquivos `.env` automaticamente. Todas as opções possuem fallbacks seguros:

| Variável | Padrão | Descrição |
|---|---|---|
| `AI_PROVIDER` | `ollama` | Provedor de IA: `ollama`, `openai`, `anthropic`, `google` ou `compatible` |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | — | Configuração para `AI_PROVIDER=compatible` (LiteLLM, vLLM, Groq, OpenRouter) |
| `AI_TEMPERATURE` | `0.4` | Temperatura do modelo |
| `TELEGRAM_BOT_TOKEN` | — | Token do bot. Se omitido, o digest é impresso no console |
| `TELEGRAM_CHAT_IDS` | — | IDs dos chats/canais separados por vírgula (`TELEGRAM_CHAT_ID` também é aceito) |
| `CRON_INGESTION` | `*/30 * * * *` | Expressão cron para coleta dos feeds |
| `CRON_DIGEST` | `0 11 * * *` | Expressão cron para envio do resumo diário |
| `DB_PATH` | `./data/store.db` | Caminho do banco SQLite (`:memory:` aceito) |
| `MAX_ITEMS_PER_FEED` | `20` | Limite de itens coletados por feed em cada ciclo |
| `DIGEST_MAX_ITEMS` | `12` | Quantidade máxima de itens pendentes enviados por digest |
| `FEED_TIMEOUT_MS` | `12000` | Timeout para requisições de feed |
| `TZ_DISPLAY` / `LOCALE` | `America/Sao_Paulo` / `pt-BR` | Fuso horário e localização para formatação das datas |

## Garantias de Comportamento

- **Idempotência:** Cada link possui chave primária baseada em hash. Reprocessar feeds nunca duplica notícias.
- **Tolerância a falhas em feeds:** Feeds fora do ar geram alertas no log sem interromper a coleta dos demais (`Promise.allSettled`).
- **Fallback resiliente de IA:** Se o provedor de IA falhar ou retornar vazio, o digest entrega a lista bruta formatada para não perder o dia.
- **Consistência de envio:** Se a transmissão falhar, os itens não são marcados como digeridos e permanecem para a próxima tentativa.
- **Proteção contra estouro de limite:** Mensagens longas são fatiadas respeitando os limites da API do Telegram em quebras de linha.
- **Segurança de credenciais:** Erros capturados dos provedores passam por mascaramento (`redact()`) para evitar vazamento acidental de tokens e chaves.

## API Principal

```ts
defineTopic(topic): Topic          // Valida a estrutura e tipagem do tópico
runAgent(topic, deps?, argv?)      // Execução e CLI pronta
createAgent(topic, deps?): Agent   // Instância completa ({ ingest, digest, runOnce, startLoop, store, config })
```

### Injeção de Dependências

Todas as peças externas podem ser injetadas para testes ou customizações:

```ts
const agent = createAgent(topic, {
  config: { dbPath: ":memory:", digestMaxItems: 3 },
  fetchFeed: async (feed) => fixtures[feed.name],  // Mock sem rede
  chat: async (system, user) => "digest mock",     // Mock sem IA
  send: async (text) => { enviados.push(text); },   // Mock sem Telegram
  now: () => new Date("2026-08-20T12:00:00Z"),
});
```

Utilitários individuais também são exportados: `createStore`, `createChat`, `createSend`, `createFetchFeed`, `loadConfig`, `clean`, `idFor`, `splitMessage`, `formatItems`, `redact`.

---

### `@juninmd/digest-kit/core` — Suporte Agnóstico (Node.js & Bun)

Primitivas utilitárias e guardas de resiliência sem dependências de `bun:*`:

```ts
extractJsonObject(text)   // Extrai JSON válido gerado por LLMs envolvido em texto/fences
isSafeExternalUrl(url)    // Validador SSRF: bloqueia IPs privados, metadata de cloud e *.internal
isPollutedProse(text)     // Detecta vazamento de prompt, artefatos (<unk>, ) e texto corrompido
hasPromptLeak, hasModelArtifacts, hasEnglishSentence, looksGarbled
redact(text)              // Mascara chaves de API, Bearer tokens e tokens do Telegram
withRetry(fn, opts)       // Execução com backoff exponencial e predicado de erro
isRateLimitError(err)     // Identifica 429, RESOURCE_EXHAUSTED e rate limits comuns
runModelChain(models, call, { isEmpty, retry })  // Cadeia de fallback inteligente entre modelos
```

No Bun, `./core` resolve para `src/core.ts`. No Node.js, para `dist/core.js` + `.d.ts` (gerados no build).

## Desenvolvimento

```bash
bun install --frozen-lockfile
bun test          # Executa a suite de testes (sem efeitos colaterais)
bun run build     # Gera dist/ para compatibilidade com Node.js
bun run typecheck # Validação de tipos TypeScript
```

## Publicação

O fluxo de publicação é gerenciado pelo GitHub Actions via tags Git:

1. Atualize a versão no `package.json`.
2. Crie e envie a tag correspondente (`git tag vX.Y.Z && git push origin vX.Y.Z`).
3. O workflow [`.github/workflows/publish.yml`](.github/workflows/publish.yml) valida a tag, roda testes, builda os pacotes e publica automaticamente no npm utilizando `NPM_TOKEN`.
