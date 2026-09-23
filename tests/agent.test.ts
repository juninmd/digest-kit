import { beforeEach, describe, expect, test } from "bun:test";
import { createAgent, defineTopic } from "../src/agent.ts";
import { createStore } from "../src/store.ts";
import type { AgentDeps, ParsedFeedItem, Topic } from "../src/types.ts";

const topic: Topic = defineTopic({
  name: "teste",
  title: "Teste",
  emoji: "🧪",
  subject: "assunto de teste",
  systemPrompt: "seja breve",
  feeds: [
    { name: "Feed A", url: "https://a.example/rss" },
    { name: "Feed B", url: "https://b.example/rss" },
  ],
});

const item = (n: number): ParsedFeedItem => ({
  title: `Notícia ${n}`,
  link: `https://a.example/${n}`,
  contentSnippet: `<p>resumo ${n}</p>`,
  isoDate: "2026-08-20T10:00:00Z",
});

interface Harness {
  sent: string[];
  prompts: { system: string; user: string }[];
  logs: string[];
  deps: AgentDeps;
}

function harness(
  feedItems: Record<string, ParsedFeedItem[]>,
  chatImpl?: (system: string, user: string) => Promise<string>,
): Harness {
  const sent: string[] = [];
  const prompts: { system: string; user: string }[] = [];
  const logs: string[] = [];
  return {
    sent,
    prompts,
    logs,
    deps: {
      config: { dbPath: ":memory:", telegramToken: "", telegramChatIds: [] },
      store: createStore(":memory:"),
      fetchFeed: async (feed) => feedItems[feed.name] ?? [],
      chat: async (system, user) => {
        prompts.push({ system, user });
        return chatImpl ? chatImpl(system, user) : "digest gerado";
      },
      send: async (text) => {
        sent.push(text);
      },
      now: () => new Date("2026-08-20T12:00:00Z"),
      log: (m) => logs.push(m),
    },
  };
}

describe("ingest", () => {
  test("grava itens novos de todos os feeds", async () => {
    const h = harness({ "Feed A": [item(1), item(2)], "Feed B": [item(3)] });
    const agent = createAgent(topic, h.deps);
    expect(await agent.ingest()).toBe(3);
  });

  test("é idempotente: rodar de novo não duplica", async () => {
    const h = harness({ "Feed A": [item(1), item(2)] });
    const agent = createAgent(topic, h.deps);
    await agent.ingest();
    expect(await agent.ingest()).toBe(0);
  });

  test("descarta item sem link ou sem título", async () => {
    const h = harness({
      "Feed A": [item(1), { title: "sem link" }, { link: "https://a.example/x" }],
    });
    const agent = createAgent(topic, h.deps);
    expect(await agent.ingest()).toBe(1);
  });

  test("um feed quebrado não derruba os outros", async () => {
    const h = harness({ "Feed B": [item(9)] });
    const agent = createAgent(topic, {
      ...h.deps,
      fetchFeed: async (feed) => {
        if (feed.name === "Feed A") throw new Error("502 Bad Gateway");
        return [item(9)];
      },
    });
    expect(await agent.ingest()).toBe(1);
    expect(h.logs.some((l) => l.includes('feed "Feed A" falhou'))).toBe(true);
  });

  test("respeita maxItemsPerFeed", async () => {
    const h = harness({ "Feed A": [item(1), item(2), item(3), item(4)] });
    const agent = createAgent(topic, {
      ...h.deps,
      config: { ...h.deps.config, maxItemsPerFeed: 2 },
    });
    expect(await agent.ingest()).toBe(2);
  });

  test("limpa o HTML do resumo antes de gravar", async () => {
    const h = harness({ "Feed A": [item(1)] });
    const agent = createAgent(topic, h.deps);
    await agent.ingest();
    expect(agent.store.pendingItems(10)[0]?.summary).toBe("resumo 1");
  });
});

describe("digest", () => {
  let h: Harness;

  beforeEach(() => {
    h = harness({ "Feed A": [item(1), item(2)] });
  });

  test("sem itens pendentes não envia nada", async () => {
    const agent = createAgent(topic, h.deps);
    expect(await agent.digest()).toBeNull();
    expect(h.sent).toHaveLength(0);
  });

  test("monta cabeçalho com emoji, título e data local", async () => {
    const agent = createAgent(topic, h.deps);
    await agent.ingest();
    await agent.digest();
    expect(h.sent[0]).toStartWith("*🧪 Teste — 20/08/2026*");
    expect(h.sent[0]).toContain("digest gerado");
  });

  test("o prompt do usuário carrega os itens e o assunto", async () => {
    const agent = createAgent(topic, h.deps);
    await agent.ingest();
    await agent.digest();
    expect(h.prompts[0]?.system).toBe("seja breve");
    expect(h.prompts[0]?.user).toContain("assunto de teste");
    expect(h.prompts[0]?.user).toContain("Notícia 1");
  });

  test("itens enviados não voltam no digest seguinte", async () => {
    const agent = createAgent(topic, h.deps);
    await agent.ingest();
    await agent.digest();
    expect(await agent.digest()).toBeNull();
  });

  test("IA fora do ar ainda entrega a lista bruta", async () => {
    const broken = harness({ "Feed A": [item(1)] }, async () => {
      throw new Error("503 model unavailable");
    });
    const agent = createAgent(topic, broken.deps);
    await agent.ingest();
    await agent.digest();
    expect(broken.sent[0]).toContain("https://a.example/1");
    expect(broken.logs.some((l) => l.includes("IA falhou"))).toBe(true);
  });

  test("resposta vazia da IA também cai para a lista bruta", async () => {
    const empty = harness({ "Feed A": [item(1)] }, async () => "");
    const agent = createAgent(topic, empty.deps);
    await agent.ingest();
    await agent.digest();
    expect(empty.sent[0]).toContain("Notícia 1");
  });

  test("falha no envio não marca os itens como enviados", async () => {
    const agent = createAgent(topic, {
      ...h.deps,
      send: async () => {
        throw new Error("telegram fora");
      },
    });
    await agent.ingest();
    await expect(agent.digest()).rejects.toThrow("telegram fora");
    expect(agent.store.pendingItems(10)).toHaveLength(2);
  });

  test("respeita digestMaxItems", async () => {
    const agent = createAgent(topic, {
      ...h.deps,
      config: { ...h.deps.config, digestMaxItems: 1 },
    });
    await agent.ingest();
    await agent.digest();
    expect(h.prompts[0]?.user).not.toContain("Notícia 1\n");
    expect(agent.store.pendingItems(10)).toHaveLength(1);
  });
});

describe("defineTopic", () => {
  test("recusa tópico sem feed", () => {
    expect(() =>
      defineTopic({ ...topic, feeds: [] }),
    ).toThrow("nenhum feed configurado");
  });
});

describe("startLoop", () => {
  test("schedules both crons and the returned stop releases them", () => {
    const h = harness({});
    const agent = createAgent(topic, h.deps);
    const stop = agent.startLoop();
    expect(h.logs.some((l) => l.includes("agente ativo"))).toBe(true);
    expect(() => stop()).not.toThrow();
  });
});
