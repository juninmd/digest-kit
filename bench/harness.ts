// Minimal timing harness: no dependency, monotonic clock, median of many samples.

export interface BenchCase<C = unknown> {
  name: string;
  /** Built once per case, outside the timed region. */
  setup?: () => C | Promise<C>;
  /** Runs before every timed call, outside the timed region. Forces one call per sample. */
  beforeEach?: (ctx: C) => void | Promise<void>;
  run: (ctx: C) => unknown;
  teardown?: (ctx: C) => void | Promise<void>;
}

export interface BenchResult {
  name: string;
  /** Median time of one call, in nanoseconds. */
  medianNs: number;
  minNs: number;
  /** Interquartile range over the median: how noisy the samples were. */
  spread: number;
  samples: number;
  callsPerSample: number;
}

export interface BenchOptions {
  samples: number;
  /** Target duration of one sample for calls timed in a batch. */
  sampleMs: number;
  warmupMs: number;
}

export const DEFAULT_OPTIONS: BenchOptions = { samples: 25, sampleMs: 20, warmupMs: 150 };

/** Kept alive so the JIT cannot prove a benchmarked call is dead code. */
export let blackhole: unknown;

const now = (): number => Bun.nanoseconds();

function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

function summarize(name: string, perCallNs: number[], callsPerSample: number): BenchResult {
  const sorted = [...perCallNs].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  return {
    name,
    medianNs: median,
    minNs: sorted[0]!,
    spread: (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / median,
    samples: sorted.length,
    callsPerSample,
  };
}

async function timeBatch<C>(c: BenchCase<C>, ctx: C, calls: number, isAsync: boolean): Promise<number> {
  const start = now();
  if (isAsync) {
    for (let i = 0; i < calls; i++) blackhole = await c.run(ctx);
  } else {
    // Synchronous cases stay in a tight loop: awaiting each call would add a microtask hop.
    for (let i = 0; i < calls; i++) blackhole = c.run(ctx);
  }
  return now() - start;
}

export async function runCase<C>(c: BenchCase<C>, options: BenchOptions): Promise<BenchResult> {
  const ctx = (c.setup ? await c.setup() : undefined) as C;
  try {
    if (c.beforeEach) {
      // State must be rebuilt before each call, so each sample is exactly one call.
      const perCall: number[] = [];
      const warmups = 3;
      for (let i = 0; i < warmups + options.samples; i++) {
        await c.beforeEach(ctx);
        const start = now();
        blackhole = await c.run(ctx);
        const elapsed = now() - start;
        if (i >= warmups) perCall.push(elapsed);
      }
      return summarize(c.name, perCall, 1);
    }

    const probe = c.run(ctx);
    const isAsync = probe instanceof Promise;
    blackhole = await probe;

    let calls = 1;
    for (;;) {
      const elapsed = await timeBatch(c, ctx, calls, isAsync);
      if (elapsed >= options.sampleMs * 1e6 || calls >= 1 << 24) break;
      calls *= 2;
    }
    const warmupEnd = now() + options.warmupMs * 1e6;
    while (now() < warmupEnd) await timeBatch(c, ctx, calls, isAsync);

    const perCall: number[] = [];
    for (let i = 0; i < options.samples; i++) {
      perCall.push((await timeBatch(c, ctx, calls, isAsync)) / calls);
    }
    return summarize(c.name, perCall, calls);
  } finally {
    await c.teardown?.(ctx);
  }
}

export function formatDuration(ns: number): string {
  if (ns < 1e3) return `${ns.toFixed(1)} ns`;
  if (ns < 1e6) return `${(ns / 1e3).toFixed(2)} µs`;
  if (ns < 1e9) return `${(ns / 1e6).toFixed(2)} ms`;
  return `${(ns / 1e9).toFixed(2)} s`;
}
