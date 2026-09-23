export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  baseMs?: number;
  factor?: number;
  maxMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Delay before retry number `attempt` (1-based): base * factor^(attempt-1), capped. */
export function backoffDelay(
  attempt: number,
  { baseMs = 1000, factor = 2, maxMs = 30_000 }: RetryOptions = {},
): number {
  return Math.min(maxMs, baseMs * factor ** (attempt - 1));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { attempts = 3, isRetryable = () => true, onRetry, sleep = wait } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) throw err;
      const delayMs = backoffDelay(attempt, options);
      onRetry?.(attempt, err, delayMs);
      await sleep(delayMs);
    }
  }
}

const RATE_LIMIT = /\b429\b|RESOURCE_EXHAUSTED|RateLimitError|throttling_error|rate.?limit/i;

/** Provider-agnostic: SDK errors expose the status in different fields, or only in text. */
export function isRateLimitError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const status = (err as { status?: unknown; statusCode?: unknown }).status ??
      (err as { statusCode?: unknown }).statusCode;
    if (status === 429) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return RATE_LIMIT.test(message);
}
