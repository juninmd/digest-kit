import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";
import { createSend } from "../src/telegram.ts";

interface Call {
  chatId: string;
  parseMode?: string;
}

/** fetch dublê: decide o status por chamada; nada de rede. */
function fakeFetch(status: (call: Call, n: number) => number | Error) {
  const calls: Call[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { chat_id: string; parse_mode?: string };
    const call = { chatId: body.chat_id, parseMode: body.parse_mode };
    calls.push(call);
    const s = status(call, calls.length);
    if (s instanceof Error) throw s;
    return new Response(s === 200 ? "{}" : "erro", { status: s });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const config = (chats: string[]) =>
  loadConfig({ telegramToken: "123:abc", telegramChatIds: chats }, {});

describe("createSend", () => {
  test("400 com Markdown é reenviado como texto simples", async () => {
    const f = fakeFetch((c) => (c.parseMode ? 400 : 200));
    const logs: string[] = [];
    await createSend(config(["1"]), (m) => logs.push(m), f.impl)("*quebrado");
    expect(f.calls.map((c) => c.parseMode)).toEqual(["Markdown", undefined]);
    expect(logs.some((l) => l.includes("texto simples"))).toBe(true);
  });

  test("nenhum chat recebeu: lança para o digest manter os itens pendentes", async () => {
    const f = fakeFetch(() => 500);
    const send = createSend(config(["1", "2"]), () => {}, f.impl);
    await expect(send("oi")).rejects.toThrow("nenhum chat");
  });

  test("erro de rede em um chat não impede os outros", async () => {
    const f = fakeFetch((c) => (c.chatId === "1" ? new Error("ECONNRESET") : 200));
    const logs: string[] = [];
    await createSend(config(["1", "2"]), (m) => logs.push(m), f.impl)("oi");
    expect(f.calls.map((c) => c.chatId)).toEqual(["1", "2"]);
    expect(logs.some((l) => l.includes("chat 1"))).toBe(true);
  });

  test("o log de erro de rede não vaza o token", async () => {
    const f = fakeFetch(() => new Error("falhou https://api.telegram.org/bot123:abc/sendMessage"));
    const logs: string[] = [];
    const send = createSend(config(["1"]), (m) => logs.push(m), f.impl);
    await expect(send("oi")).rejects.toThrow();
    expect(logs.join("\n")).not.toContain("123:abc");
  });

  test("sem token imprime no console e não lança", async () => {
    const logs: string[] = [];
    await createSend(loadConfig({}, {}), (m) => logs.push(m))("oi");
    expect(logs[0]).toContain("não configurado");
  });
});
