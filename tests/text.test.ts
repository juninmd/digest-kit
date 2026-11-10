import { describe, expect, test } from "bun:test";
import { clean, formatItems, idFor, splitMessage } from "../src/util/text.ts";
import { redact } from "../src/util/redact.ts";

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

  // Implementação original, mantida como oráculo: a passada única tem de dar o mesmo texto.
  const reference = (raw: string | undefined, max = 500) =>
    (raw ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);

  test("casos de borda batem com a implementação por regex", () => {
    const inputs = [
      "", " ", "<>", "a<>b", "a < b", "a < b > c", "<<b>>", "<", ">", "a<b", "<b", "<b>", "a>b",
      "&nbsp;", "&nbsp", "&nb<i>sp;", "<a title='&nbsp;'>x</a>", "&&nbsp;&", "a&amp;b", "&nbsp;&nbsp;a",
      "  a  ", "\n\ta\u00a0b\u2003c\ufeff", "a\u200bb", "<p>\n</p>", "<p>a</p><p>b</p>", "a<br/>b",
      "x<!-- c -->y", "1 < 2 e 3 > 2", "<p", "fim <", "a\u0085b", "a\u001fb",
      "aaa bbb ccc", "a b c d e", "aaa  bbb", "aaa bbb ", " aaa bbb", "aaa <i>bbb</i> ccc", "aaa &nbsp;bbb", "aaa &b",
    ];
    for (const input of inputs) {
      for (const max of [0, 1, 2, 3, 4, 5, 6, 7, 8, 500, 2.9, Number.POSITIVE_INFINITY, -1, -3, Number.NaN]) {
        expect([input, max, clean(input, max)]).toEqual([input, max, reference(input, max)]);
      }
    }
  });

  test("texto aleatório bate com a implementação por regex", () => {
    // LCG com semente fixa: o teste é determinístico.
    let seed = 42;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const alphabet = ["<", ">", "&", "&nbsp;", "nbsp;", " ", "  ", "\n", "\t", "\u00a0", "a", "b", "é", "<p>", "</p>", "<br/>", ";", "<a href=\"x\">", "palavra", "1", "\u3000"];
    for (let round = 0; round < 3000; round++) {
      let input = "";
      for (let i = next(40); i > 0; i--) input += alphabet[next(alphabet.length)];
      const max = [1, 2, 3, 7, 20, 500][next(6)]!;
      expect([input, max, clean(input, max)]).toEqual([input, max, reference(input, max)]);
    }
  });

  test("para de ler assim que o limite enche (entrada enorme, saída pequena)", () => {
    const huge = `${"palavra ".repeat(200_000)}<fim>`;
    expect(clean(huge, 20)).toBe(reference(huge, 20));
  });

  test("muitos '<' sem '>' não degeneram em custo quadrático", () => {
    const hostile = "a<".repeat(200_000);
    const started = performance.now();
    expect(clean(hostile, Number.POSITIVE_INFINITY)).toBe(hostile);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("não corta um emoji ao meio no limite", () => {
    // "ab" + 😀 (par substituto): cortar em 3 deixaria meio emoji.
    expect(clean("ab😀cd", 3)).toBe("ab");
    expect(clean("ab😀cd", 4)).toBe("ab😀");
    expect(clean("ab 😀cd", 4)).toBe("ab");
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

  test("linha de tamanho exato não gera pedaço vazio", () => {
    const parts = splitMessage(`${"a".repeat(300)}\nb`, 300);
    expect(parts).toEqual(["a".repeat(300), "b"]);
  });

  test("fatiamento não corta par substituto (emoji) ao meio", () => {
    const parts = splitMessage("😀".repeat(200), 301);
    expect(parts.join("")).toBe("😀".repeat(200));
    for (const p of parts) {
      expect(p.length).toBeGreaterThan(0);
      expect(p.length).toBeLessThanOrEqual(301);
      const last = p.charCodeAt(p.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
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

describe("redact", () => {
  test("masks Telegram bot tokens in API URLs", () => {
    const out = redact("POST https://api.telegram.org/bot123456789:AAH-abc_DEF123456/sendMessage failed");
    expect(out).not.toContain("AAH-abc_DEF123456");
  });
  test("masks bearer tokens", () => {
    expect(redact("Authorization: Bearer eyJhbGciOi.xyz")).not.toContain("eyJhbGciOi");
    expect(redact("got header bearer abc.def.ghi")).not.toContain("abc.def.ghi");
  });
});
