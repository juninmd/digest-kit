import { describe, expect, it } from "bun:test";
import { extractJsonObject } from "../src/json.ts";

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
  });
});
