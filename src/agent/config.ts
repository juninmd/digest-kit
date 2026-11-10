import type { AiProvider, Config } from "../types.ts";

export const DEFAULT_FEED_CONCURRENCY = 8;

const readNumber = (value: string | undefined, fallback: number): number => {
  const n = value === undefined || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Contagens e limites: inteiro >= 1. Zero, negativo ou lixo voltam ao padrão —
 * `DIGEST_MAX_ITEMS=-1` virava `LIMIT -1` no SQLite, que significa "sem limite".
 */
const readCount = (value: string | undefined, fallback: number): number => {
  const n = Math.floor(readNumber(value, fallback));
  return n >= 1 ? n : fallback;
};

/** Duração em ms: 0 é válido (desliga o limite); negativo volta ao padrão. */
const readDuration = (value: string | undefined, fallback: number): number => {
  const n = readNumber(value, fallback);
  return n >= 0 ? n : fallback;
};

const readList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Resolve a configuração a partir do ambiente (Bun carrega .env sozinho).
 * Os nomes de variável são os mesmos dos agentes antigos — migração é drop-in.
 */
export function loadConfig(
  overrides: Partial<Config> = {},
  env: Record<string, string | undefined> = process.env,
): Config {
  const base: Config = {
    // Vazio (`AI_PROVIDER=` no .env) conta como não definido; um nome errado é
    // mantido como veio para o createChat recusar com uma mensagem clara.
    aiProvider: (env.AI_PROVIDER?.trim().toLowerCase() || "ollama") as AiProvider,
    aiBaseUrl: env.AI_BASE_URL ?? "",
    aiKey: env.AI_API_KEY ?? "",
    aiModel: env.AI_MODEL ?? "",
    aiTemperature: readNumber(env.AI_TEMPERATURE, 0.4),
    aiMaxTokens: readCount(env.AI_MAX_TOKENS, 2048),
    aiTimeoutMs: readDuration(env.AI_TIMEOUT_MS, 300_000),

    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
    ollamaModel: env.OLLAMA_MODEL ?? "llama3.2",
    openaiKey: env.OPENAI_API_KEY ?? "",
    openaiModel: env.OPENAI_MODEL ?? "gpt-4o-mini",
    anthropicKey: env.ANTHROPIC_API_KEY ?? "",
    anthropicModel: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    geminiKey: env.GEMINI_API_KEY ?? "",
    geminiModel: env.GEMINI_MODEL ?? "gemini-2.5-flash",

    telegramToken: env.TELEGRAM_BOT_TOKEN ?? "",
    telegramChatIds: readList(env.TELEGRAM_CHAT_IDS ?? env.TELEGRAM_CHAT_ID),

    cronIngestion: env.CRON_INGESTION ?? "*/30 * * * *",
    cronDigest: env.CRON_DIGEST ?? "0 11 * * *",

    dbPath: env.DB_PATH ?? "./data/store.db",
    maxItemsPerFeed: readCount(env.MAX_ITEMS_PER_FEED, 20),
    digestMaxItems: readCount(env.DIGEST_MAX_ITEMS, 12),
    feedTimeoutMs: readDuration(env.FEED_TIMEOUT_MS, 12000),
    feedConcurrency: readCount(env.FEED_CONCURRENCY, DEFAULT_FEED_CONCURRENCY),
    timezone: env.TZ_DISPLAY ?? "America/Sao_Paulo",
    locale: env.LOCALE ?? "pt-BR",
  };
  return { ...base, ...overrides };
}
