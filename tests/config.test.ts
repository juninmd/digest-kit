import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

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
});
