import { describe, expect, it } from "bun:test";
import { extractJsonObject } from "../src/util/json.ts";

describe("extractJsonObject", () => {
  it("skips braces in the prose before the JSON", () => {
    const text =
      'Formato pedido {groups}: {"groups":[{"theme":"IA","itemIdx":[0]}]}';
    expect(JSON.parse(extractJsonObject(text) ?? "")).toEqual({
      groups: [{ theme: "IA", itemIdx: [0] }],
    });
  });

  it("skips braces in the prose after the JSON", () => {
    const text = '{"groups":[]}\nObs.: ignore {isto}.';
    expect(extractJsonObject(text)).toBe('{"groups":[]}');
  });

  it("gives up after a bounded number of candidates", () => {
    expect(extractJsonObject("{".repeat(500) + "}".repeat(500))).toBeNull();
  });

  it("unwraps a markdown fence", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("returns null when nothing parses", () => {
    expect(extractJsonObject("sem json aqui")).toBeNull();
    expect(extractJsonObject('{"a": }')).toBeNull();
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject("}{")).toBeNull();
    expect(extractJsonObject('{"a":1')).toBeNull();
  });

  it("ignores braces and escaped quotes inside string values", () => {
    const json = '{"a":"}{ \\" } \\\\","b":{"c":"{"}}';
    expect(extractJsonObject(`antes ${json} depois {x}`)).toBe(json);
    expect(JSON.parse(json)).toEqual({ a: '}{ " } \\', b: { c: "{" } });
  });

  it("finds the object even when many braces follow it", () => {
    // The previous backwards scan spent its whole budget on these and returned null.
    const text = `{"ok":true} ${"use {campo}. ".repeat(80)}`;
    expect(extractJsonObject(text)).toBe('{"ok":true}');
  });

  it("recovers the object after an unbalanced brace in the prose", () => {
    expect(extractJsonObject('abre { e nunca fecha: {"a":1}')).toBe('{"a":1}');
  });

  // Previous implementation, kept as an oracle: whenever it found an object,
  // the single-scan version must return the very same substring.
  function reference(text: string): string | null {
    let budget = 50;
    for (let start = text.indexOf("{"); start >= 0; ) {
      for (let end = text.lastIndexOf("}"); end > start; ) {
        if (budget-- <= 0) return null;
        const candidate = text.slice(start, end + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          end = text.lastIndexOf("}", end - 1);
        }
      }
      start = text.indexOf("{", start + 1);
    }
    return null;
  }

  it("agrees with the previous implementation on random input", () => {
    let seed = 7;
    const next = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const pieces = ["{", "}", '"', "\\", '"a"', ":", "1", ",", " ", "[", "]", '{"k":"v"}', '{"n":{"m":[1,{"z":"}"}]}}', "texto", "\n", '"}"', "{}"];
    let found = 0;
    for (let round = 0; round < 4000; round++) {
      let text = "";
      for (let i = next(14); i > 0; i--) text += pieces[next(pieces.length)];
      const expected = reference(text);
      const actual = extractJsonObject(text);
      if (expected !== null) {
        found++;
        expect([text, actual]).toEqual([text, expected]);
      } else if (actual !== null) {
        // Only allowed to find more than before, never something unparseable.
        expect(() => JSON.parse(actual)).not.toThrow();
      }
    }
    expect(found).toBeGreaterThan(500);
  });
});
