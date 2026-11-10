import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/agent/config.ts";

describe("loadConfig", () => {
  test("usa os padrões com ambiente vazio", () => {
    const c = loadConfig({}, {});
    expect(c.aiProvider).toBe("ollama");
    expect(c.digestMaxItems).toBe(12);
    expect(c.cronDigest).toBe("0 11 * * *");
  });

  test("lê as variáveis dos agentes antigos (migração drop-in)", () => {
    const c = loadConfig(
      {},
      {
        AI_PROVIDER: "anthropic",
        TELEGRAM_CHAT_IDS: " 111 , 222 ,",
        DIGEST_MAX_ITEMS: "5",
        DB_PATH: "./data/x.db",
      },
    );
    expect(c.aiProvider).toBe("anthropic");
    expect(c.telegramChatIds).toEqual(["111", "222"]);
    expect(c.digestMaxItems).toBe(5);
    expect(c.dbPath).toBe("./data/x.db");
  });

  test("aceita TELEGRAM_CHAT_ID no singular", () => {
    expect(loadConfig({}, { TELEGRAM_CHAT_ID: "999" }).telegramChatIds).toEqual(["999"]);
  });

  test("número inválido cai no padrão em vez de virar NaN", () => {
    expect(loadConfig({}, { DIGEST_MAX_ITEMS: "abc" }).digestMaxItems).toBe(12);
    expect(loadConfig({}, { FEED_TIMEOUT_MS: "" }).feedTimeoutMs).toBe(12000);
  });

  test("override em código vence o ambiente", () => {
    expect(loadConfig({ digestMaxItems: 3 }, { DIGEST_MAX_ITEMS: "50" }).digestMaxItems).toBe(3);
  });
  test("contagem zero, negativa ou fracionária não vira limite quebrado", () => {
    // -1 chegava ao SQLite como LIMIT -1 (sem limite); 0 zerava a ingestão.
    expect(loadConfig({}, { DIGEST_MAX_ITEMS: "-1" }).digestMaxItems).toBe(12);
    expect(loadConfig({}, { MAX_ITEMS_PER_FEED: "0" }).maxItemsPerFeed).toBe(20);
    expect(loadConfig({}, { MAX_ITEMS_PER_FEED: "7.9" }).maxItemsPerFeed).toBe(7);
    expect(loadConfig({}, { FEED_CONCURRENCY: "0" }).feedConcurrency).toBe(8);
  });

  test("lê FEED_CONCURRENCY e AI_TIMEOUT_MS, com padrões", () => {
    const defaults = loadConfig({}, {});
    expect(defaults.feedConcurrency).toBe(8);
    expect(defaults.aiTimeoutMs).toBe(300_000);
    const c = loadConfig({}, { FEED_CONCURRENCY: "3", AI_TIMEOUT_MS: "0" });
    expect(c.feedConcurrency).toBe(3);
    expect(c.aiTimeoutMs).toBe(0); // 0 desliga o limite
    expect(loadConfig({}, { AI_TIMEOUT_MS: "-5" }).aiTimeoutMs).toBe(300_000);
  });

  test("AI_PROVIDER vazio é o padrão; caixa e espaços são normalizados", () => {
    expect(loadConfig({}, { AI_PROVIDER: "" }).aiProvider).toBe("ollama");
    expect(loadConfig({}, { AI_PROVIDER: " OpenAI " }).aiProvider).toBe("openai");
  });
});
