// Turns two saved runs into a Markdown before/after table.
//
//   bun run bench:compare bench/results/baseline.json bench/results/after.json

import { readFileSync } from "node:fs";
import { type BenchResult, formatDuration } from "./harness.ts";

interface Report {
  runtime: string;
  cpu: string;
  results: BenchResult[];
}

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: bun run bench:compare <before.json> <after.json>");
  process.exit(2);
}

const load = (path: string): Report => JSON.parse(readFileSync(path, "utf8")) as Report;
const before = load(beforePath);
const after = load(afterPath);
const afterByName = new Map(after.results.map((r) => [r.name, r]));

/** Below this ratio a difference is inside the run-to-run noise of a shared VM. */
const NOISE = 1.15;

function verdict(ratio: number): string {
  if (ratio >= NOISE) return `**${ratio.toFixed(2)}x faster**`;
  if (ratio <= 1 / NOISE) return `**${(1 / ratio).toFixed(2)}x slower**`;
  return "same (within noise)";
}

console.log("| Case | Before (median) | After (median) | Change |");
console.log("|---|---:|---:|---|");
for (const b of before.results) {
  const a = afterByName.get(b.name);
  if (!a) continue;
  console.log(
    `| ${b.name} | ${formatDuration(b.medianNs)} | ${formatDuration(a.medianNs)} | ${verdict(b.medianNs / a.medianNs)} |`,
  );
}
for (const a of after.results) {
  if (!before.results.some((b) => b.name === a.name)) {
    console.log(`| ${a.name} | — | ${formatDuration(a.medianNs)} | new case |`);
  }
}
