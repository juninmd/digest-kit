import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runAgent } from "../src/agent/cli.ts";
import { createStore } from "../src/storage/store.ts";
import type { AgentDeps, ParsedFeedItem, Store, Topic } from "../src/types.ts";

const topic: Topic = {
  name: "cli-teste",
  title: "CLI",
  emoji: "🧪",
  subject: "teste",
  systemPrompt: "seja breve",
  feeds: [{ name: "Feed A", url: "https://a.example/rss" }],
};

const items: ParsedFeedItem[] = [
  { title: "Notícia 1", link: "https://a.example/1" },
  { title: "Notícia 2", link: "https://a.example/2" },
];

interface Harness {
  logs: string[];
  sent: string[];
  closed: () => number;
  store: Store;
  deps: AgentDeps;
}

function harness(overrides: Partial<AgentDeps> = {}): Harness {
  const logs: string[] = [];
  const sent: string[] = [];
  const inner = createStore(":memory:");
  let closes = 0;
  // close() vira contador: o teste precisa ler o banco depois que o runAgent "fecha".
  const store: Store = { ...inner, close: () => void closes++ };
  return {
    logs,
    sent,
    store,
    closed: () => closes,
    deps: {
      config: { dbPath: ":memory:", telegramToken: "", telegramChatIds: [] },
      store,
      fetchFeed: async () => items,
      chat: async () => "digest gerado",
      send: async (text) => void sent.push(text),
      now: () => new Date("2026-08-20T12:00:00Z"),
      log: (m) => logs.push(m),
      ...overrides,
    },
  };
}

describe("runAgent", () => {
  let stdout: ReturnType<typeof spyOn>;
  let stderr: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stdout = spyOn(console, "log").mockImplementation(() => {});
    stderr = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = 0;
  });

  test("sem argumento: coleta, envia e fecha o store", async () => {
    const h = harness();
    await runAgent(topic, h.deps, []);
    expect(h.sent).toHaveLength(1);
    expect(h.store.pendingItems(10)).toHaveLength(0);
    expect(h.closed()).toBe(1);
  });

  test("--ingest só coleta", async () => {
    const h = harness();
    await runAgent(topic, h.deps, ["--ingest"]);
    expect(h.sent).toHaveLength(0);
    expect(h.store.pendingItems(10)).toHaveLength(2);
    expect(h.closed()).toBe(1);
  });

  test("--digest --dry-run não envia nem marca", async () => {
    const h = harness();
    await runAgent(topic, h.deps, ["--ingest"]);
    await runAgent(topic, h.deps, ["--digest", "--dry-run"]);
    expect(h.sent).toHaveLength(0);
    expect(h.store.pendingItems(10)).toHaveLength(2);
  });

  test("--status mostra a fila sem buscar feed, chamar IA ou enviar", async () => {
    let touched = 0;
    const h = harness({
      fetchFeed: async () => {
        touched++;
        return items;
      },
      chat: async () => {
        touched++;
        return "x";
      },
    });
    await runAgent(topic, { ...h.deps, fetchFeed: async () => items }, ["--ingest"]);
    h.store.markDigested([h.store.pendingItems(1)[0]!.id]);
    h.logs.length = 0;

    await runAgent(topic, h.deps, ["--status"]);
    expect(h.logs).toEqual([
      "[status] cli-teste: 1 pendentes, 1 enviados, 2 no total",
      "[status] última coleta: 2026-08-20T12:00:00.000Z",
    ]);
    expect(touched).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(h.closed()).toBe(2);
  });

  test("--status com banco vazio e com store sem stats()", async () => {
    const empty = harness();
    await runAgent(topic, empty.deps, ["--status"]);
    expect(empty.logs).toEqual([
      "[status] cli-teste: 0 pendentes, 0 enviados, 0 no total",
      "[status] última coleta: nunca",
    ]);

    const h = harness();
    const legacy: Store = {
      insertItem: h.store.insertItem,
      pendingItems: h.store.pendingItems,
      markDigested: h.store.markDigested,
      close: h.store.close,
    };
    await runAgent(topic, { ...h.deps, store: legacy }, ["--status"]);
    expect(h.logs).toEqual(["[status] cli-teste: o store injetado não implementa stats()"]);
  });

  test("erro no ciclo ainda fecha o store e chega a quem chamou", async () => {
    const h = harness({
      send: async () => {
        throw new Error("telegram fora");
      },
    });
    await expect(runAgent(topic, h.deps, [])).rejects.toThrow("telegram fora");
    expect(h.closed()).toBe(1);
    expect(h.store.pendingItems(10)).toHaveLength(2);
  });

  test("argumento desconhecido sai com código 2 sem abrir nada", async () => {
    const h = harness();
    await runAgent(topic, h.deps, ["--digets"]);
    expect(process.exitCode).toBe(2);
    expect(stderr.mock.calls[0]?.[0]).toContain("Argumento desconhecido: --digets");
    expect(h.closed()).toBe(0);
    expect(h.store.pendingItems(10)).toHaveLength(0);
  });

  test("--help imprime o uso, incluindo --status", async () => {
    const h = harness();
    await runAgent(topic, h.deps, ["--help"]);
    const usage = String(stdout.mock.calls[0]?.[0]);
    expect(usage).toContain("--status");
    expect(usage).toContain("--dry-run");
    expect(h.closed()).toBe(0);
  });
});
