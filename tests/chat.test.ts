import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../src/agent/config.ts";
import { createChat } from "../src/ai/chat.ts";
import type { Config } from "../src/types.ts";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Troca o fetch global por um dublê: nada de rede. */
function stubFetch(reply: (call: Captured) => Response | Promise<Response>): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const call: Captured = {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      signal: init.signal,
    };
    calls.push(call);
    return reply(call);
  }) as unknown as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const config = (overrides: Partial<Config>) => loadConfig(overrides, {});

describe("createChat", () => {
  test("ollama é o padrão e fala o protocolo OpenAI", async () => {
    const calls = stubFetch(() => json({ choices: [{ message: { content: "  oi  " } }] }));
    const chat = createChat(config({ ollamaBaseUrl: "http://localhost:11434/v1/" }));
    expect(await chat("sys", "user")).toBe("oi");
    expect(calls[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0]?.headers.authorization).toBe("Bearer ollama");
    expect(calls[0]?.body).toEqual({
      model: config({}).ollamaModel,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "user" },
      ],
      temperature: 0.4,
      max_tokens: 2048,
    });
  });

  test("cadeia de fallback: erro no principal passa ao próximo modelo e informa o uso", async () => {
    const usage: unknown[] = [];
    const calls = stubFetch((call) =>
      (call.body as { model: string }).model === "a"
        ? json({ error: "boom" }, 500)
        : json({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }),
    );
    const chat = createChat(
      config({ aiProvider: "compatible", aiBaseUrl: "http://gw/v1", aiModel: "a", aiFallbackModels: ["b"] }),
      { onUsage: (u) => usage.push(u) },
    );
    expect(await chat("s", "u")).toBe("ok");
    expect(calls.map((c) => (c.body as { model: string }).model)).toEqual(["a", "b"]);
    expect(usage).toEqual([{ provider: "compatible", model: "b", inputTokens: 10, outputTokens: 3 }]);
  });

  test("litellm e compatible usam a URL, a chave e o modelo do gateway", async () => {
    const calls = stubFetch(() => json({ choices: [{ message: { content: "ok" } }] }));
    await createChat(
      config({ aiProvider: "litellm", aiBaseUrl: "http://litellm.test/v1", aiKey: "k1", aiModel: "cloud/auto" }),
    )("s", "u");
    await createChat(
      config({ aiProvider: "compatible", aiBaseUrl: "https://gw.example/v1", aiKey: "k2", aiModel: "m" }),
    )("s", "u");
    expect(calls.map((c) => c.url)).toEqual([
      "http://litellm.test/v1/chat/completions",
      "https://gw.example/v1/chat/completions",
    ]);
    expect(calls.map((c) => c.headers.authorization)).toEqual(["Bearer k1", "Bearer k2"]);
    expect(calls.map((c) => c.body.model)).toEqual(["cloud/auto", "m"]);
  });

  test("provedores diretos (openai, anthropic, google) são recusados sem chamar ninguém", async () => {
    const calls = stubFetch(() => json({}));
    for (const p of ["openai", "anthropic", "google"]) {
      await expect(createChat(config({ aiProvider: p as Config["aiProvider"] }))("s", "u")).rejects.toThrow(
        `AI_PROVIDER desconhecido: "${p}"`,
      );
    }
    expect(calls).toHaveLength(0);
  });

  test("compatible sem base URL ou modelo falha antes de qualquer requisição", async () => {
    const calls = stubFetch(() => json({}));
    await expect(createChat(config({ aiProvider: "compatible" }))("s", "u")).rejects.toThrow("AI_BASE_URL");
    await expect(
      createChat(config({ aiProvider: "compatible", aiBaseUrl: "https://gw.example" }))("s", "u"),
    ).rejects.toThrow("AI_MODEL");
    expect(calls).toHaveLength(0);
  });

  test("provider desconhecido é recusado em vez de cair no Ollama local", async () => {
    const calls = stubFetch(() => json({}));
    const chat = createChat(config({ aiProvider: "opnai" as Config["aiProvider"] }));
    await expect(chat("s", "u")).rejects.toThrow('AI_PROVIDER desconhecido: "opnai"');
    expect(calls).toHaveLength(0);
  });

  test("resposta sem conteúdo vira string vazia (o agente cai para a lista bruta)", async () => {
    stubFetch(() => json({}));
    expect(await createChat(config({}))("s", "u")).toBe("");
  });

  test("erro do provider sai com status e sem a chave", async () => {
    stubFetch(() => new Response('{"error":"bad key sk-abcdef1234567890"}', { status: 401 }));
    const chat = createChat(
      config({ aiProvider: "litellm", aiBaseUrl: "http://gw/v1", aiModel: "m", aiKey: "sk-abcdef1234567890" }),
    );
    const error = await chat("s", "u").catch((e: Error) => e);
    expect(String(error)).toContain("AI 401");
    expect(String(error)).not.toContain("abcdef1234567890");
  });

  test("toda requisição leva um sinal de timeout; AI_TIMEOUT_MS=0 desliga", async () => {
    const calls = stubFetch(() => json({ choices: [{ message: { content: "ok" } }] }));
    await createChat(config({}))("s", "u");
    await createChat(config({ aiTimeoutMs: 0 }))("s", "u");
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[1]?.signal).toBeUndefined();
  });

  test("provider que não responde é abortado no tempo configurado", async () => {
    stubFetch(
      (call) =>
        new Promise<Response>((resolve, reject) => {
          call.signal?.addEventListener("abort", () => reject(call.signal?.reason));
          // Sem o timeout a resposta chegaria aqui e o teste falharia, em vez de travar a suíte.
          setTimeout(() => resolve(json({ choices: [{ message: { content: "tarde demais" } }] })), 1500);
        }),
    );
    const started = performance.now();
    await expect(createChat(config({ aiTimeoutMs: 20 }))("s", "u")).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
