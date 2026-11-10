/**
 * `Promise.allSettled` over `items.map(fn)`, but with at most `concurrency`
 * calls in flight. Results keep the input order; a rejection (or a synchronous
 * throw) is captured in its slot and never stops the other items.
 */
export async function mapSettled<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R> | R,
  concurrency: number = Number.POSITIVE_INFINITY,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  // NaN, 0 and negatives mean "one at a time", not "none": a bad setting must not stall the run.
  const workers = Math.min(items.length, concurrency >= 1 ? Math.floor(concurrency) : 1);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index] as T, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/**
 * Wraps `task` so a call made while the previous one is still running is
 * skipped instead of stacking up. For timers: a slow run must not overlap the
 * next tick and do the same work twice.
 */
export function skipWhileRunning(
  task: () => Promise<unknown>,
  onSkip?: () => void,
): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      onSkip?.();
      return;
    }
    running = true;
    try {
      await task();
    } finally {
      running = false;
    }
  };
}
