// Turns saved runs into a Markdown before/after table.
//
//   bun run bench:compare before.json after.json
//   bun run bench:compare --before b1.json b2.json b3.json --after a1.json a2.json a3.json
//
// With several runs per side, each case uses the median of its per-run medians:
// one noisy run (a busy host, a slow fsync) cannot decide the comparison.

import { readFileSync } from "node:fs";
import { type BenchResult, formatDuration } from "./harness.ts";

interface Report {
  results: BenchResult[];
}

function parseArgs(argv: string[]): { before: string[]; after: string[] } {
  if (!argv.includes("--before")) {
    const [before, after] = argv;
    return { before: before ? [before] : [], after: after ? [after] : [] };
  }
  const sides: { before: string[]; after: string[] } = { before: [], after: [] };
  let side: "before" | "after" = "before";
  for (const arg of argv) {
    if (arg === "--before") side = "before";
    else if (arg === "--after") side = "after";
    else sides[side].push(arg);
  }
  return sides;
}

const { before, after } = parseArgs(process.argv.slice(2));
if (!before.length || !after.length) {
  console.error("usage: bun run bench:compare <before.json> <after.json>");
  console.error("       bun run bench:compare --before <runs...> --after <runs...>");
  process.exit(2);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Case name -> median across runs, in the order the cases first appear. */
function load(paths: string[]): Map<string, number> {
  const perCase = new Map<string, number[]>();
  for (const path of paths) {
    const report = JSON.parse(readFileSync(path, "utf8")) as Report;
    for (const result of report.results) {
      const values = perCase.get(result.name) ?? [];
      values.push(result.medianNs);
      perCase.set(result.name, values);
    }
  }
  return new Map([...perCase].map(([name, values]) => [name, median(values)]));
}

const beforeByName = load(before);
const afterByName = load(after);

/** Below this ratio a difference is inside the run-to-run noise of a shared VM. */
const NOISE = 1.25;

function verdict(ratio: number): string {
  if (ratio >= NOISE) return `**${ratio.toFixed(2)}x faster**`;
  if (ratio <= 1 / NOISE) return `**${(1 / ratio).toFixed(2)}x slower**`;
  return "same (within noise)";
}

console.log("| Case | Before | After | Change |");
console.log("|---|---:|---:|---|");
for (const [name, beforeNs] of beforeByName) {
  const afterNs = afterByName.get(name);
  if (afterNs === undefined) continue;
  console.log(
    `| ${name} | ${formatDuration(beforeNs)} | ${formatDuration(afterNs)} | ${verdict(beforeNs / afterNs)} |`,
  );
}
for (const [name, afterNs] of afterByName) {
  if (!beforeByName.has(name)) console.log(`| ${name} | — | ${formatDuration(afterNs)} | new case |`);
}
