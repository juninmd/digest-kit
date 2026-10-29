import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/args.ts";

describe("parseArgs", () => {
  test("sem argumento é um ciclo único", () => {
    expect(parseArgs([])).toEqual({ mode: "once", dryRun: false });
  });

  test("reconhece cada modo", () => {
    expect(parseArgs(["--ingest"])).toEqual({ mode: "ingest", dryRun: false });
    expect(parseArgs(["--digest"])).toEqual({ mode: "digest", dryRun: false });
    expect(parseArgs(["--loop"])).toEqual({ mode: "loop", dryRun: false });
    expect(parseArgs(["-h"])).toEqual({ mode: "help", dryRun: false });
  });

  test("--dry-run vale com --digest e com o ciclo único", () => {
    expect(parseArgs(["--digest", "--dry-run"])).toEqual({ mode: "digest", dryRun: true });
    expect(parseArgs(["--dry-run"])).toEqual({ mode: "once", dryRun: true });
  });

  test("recusa argumento desconhecido em vez de rodar um ciclo", () => {
    expect(parseArgs(["--digets"])).toEqual({ error: "Argumento desconhecido: --digets" });
  });

  test("recusa dois modos ao mesmo tempo", () => {
    expect("error" in parseArgs(["--ingest", "--digest"])).toBe(true);
  });

  test("recusa --dry-run onde não há envio", () => {
    expect("error" in parseArgs(["--ingest", "--dry-run"])).toBe(true);
    expect("error" in parseArgs(["--loop", "--dry-run"])).toBe(true);
  });
});
