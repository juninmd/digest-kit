import { describe, expect, test } from "bun:test";
import { clean, formatItems, idFor, splitMessage } from "../src/text.ts";
import { redact } from "../src/ai.ts";

describe("clean", () => {
  test("tira HTML e colapsa espaço", () => {
    expect(clean("<p>oi   <b>mundo</b></p>\n\n")).toBe("oi mundo");
  });

  test("resolve &nbsp;", () => {
    expect(clean("a&nbsp;b")).toBe("a b");
  });

  test("corta no limite", () => {
    expect(clean("x".repeat(900)).length).toBe(500);
  });

  test("undefined vira string vazia", () => {
    expect(clean(undefined)).toBe("");
  });
});

describe("idFor", () => {
  test("é estável para o mesmo link", () => {
    expect(idFor("https://a.com/1")).toBe(idFor("https://a.com/1"));
  });

  test("difere entre links", () => {
    expect(idFor("https://a.com/1")).not.toBe(idFor("https://a.com/2"));
  });
});

describe("splitMessage", () => {
  test("texto curto sai inteiro", () => {
    expect(splitMessage("oi")).toEqual(["oi"]);
  });

  test("respeita o limite e quebra em fim de linha", () => {
    const text = Array.from({ length: 50 }, (_, i) => `linha ${i} ${"x".repeat(50)}`).join("\n");
    const parts = splitMessage(text, 300);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(300);
    // nenhuma linha pode ter sido partida no meio
    expect(parts.join("\n").split("\n").length).toBe(text.split("\n").length);
  });

  test("linha maior que o limite é fatiada na força bruta", () => {
    const parts = splitMessage("y".repeat(1000), 300);
    expect(parts.length).toBe(4);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(300);
  });
});

describe("formatItems", () => {
  test("numera e inclui fonte e link", () => {
    const out = formatItems([
      { source: "Feed A", title: "Título", summary: "resumo", link: "https://a.com" },
    ]);
    expect(out).toContain("1. [Feed A] Título");
    expect(out).toContain("https://a.com");
  });
});

describe("redact", () => {
  test("mascara chave em corpo de erro", () => {
    expect(redact('{"error":"invalid key sk-abcdefgh12345"}')).toContain("sk-***");
  });

  test("mascara campo api_key", () => {
    expect(redact('{"api_key": "supersecreto123"}')).not.toContain("supersecreto123");
  });
});
