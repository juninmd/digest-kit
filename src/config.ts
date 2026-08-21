import type { AiProvider, Config } from "./types.ts";

const num = (v: string | undefined, d: number) => {
  const n = v === undefined || v === "" ? Number.NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

const list = (v: string | undefined) =>
  (v ?? "")
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
    aiProvider: (env.AI_PROVIDER ?? "ollama") as AiProvider,
    aiBaseUrl: env.AI_BASE_URL ?? "",
    aiKey: env.AI_API_KEY ?? "",
    aiModel: env.AI_MODEL ?? "",
    aiTemperature: num(env.AI_TEMPERATURE, 0.4),
    aiMaxTokens: num(env.AI_MAX_TOKENS, 2048),

    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
    ollamaModel: env.OLLAMA_MODEL ?? "llama3.2",
    openaiKey: env.OPENAI_API_KEY ?? "",
    openaiModel: env.OPENAI_MODEL ?? "gpt-4o-mini",
    anthropicKey: env.ANTHROPIC_API_KEY ?? "",
    anthropicModel: env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    geminiKey: env.GEMINI_API_KEY ?? "",
    geminiModel: env.GEMINI_MODEL ?? "gemini-2.5-flash",

    telegramToken: env.TELEGRAM_BOT_TOKEN ?? "",
    telegramChatIds: list(env.TELEGRAM_CHAT_IDS ?? env.TELEGRAM_CHAT_ID),

    cronIngestion: env.CRON_INGESTION ?? "*/30 * * * *",
    cronDigest: env.CRON_DIGEST ?? "0 11 * * *",

    dbPath: env.DB_PATH ?? "./data/store.db",
    maxItemsPerFeed: num(env.MAX_ITEMS_PER_FEED, 20),
    digestMaxItems: num(env.DIGEST_MAX_ITEMS, 12),
    feedTimeoutMs: num(env.FEED_TIMEOUT_MS, 12000),
    timezone: env.TZ_DISPLAY ?? "America/Sao_Paulo",
    locale: env.LOCALE ?? "pt-BR",
  };
  return { ...base, ...overrides };
}
