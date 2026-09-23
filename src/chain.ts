import { type RetryOptions, isRateLimitError, withRetry } from "./retry.ts";

export interface ModelChainOptions<M, T> {
  /** An empty result moves to the next model without retrying the same one. */
  isEmpty?: (result: T) => boolean;
  /** Per-model retry; defaults to one attempt, retrying only rate limits when raised. */
  retry?: RetryOptions;
  onFallback?: (model: M, reason: unknown) => void;
}

export class ModelChainError extends Error {
  constructor(
    message: string,
    readonly failures: { model: unknown; reason: unknown }[],
  ) {
    super(message);
    this.name = "ModelChainError";
  }
}

/** Tries each model in order; returns the first non-empty result. */
export async function runModelChain<M, T>(
  models: readonly M[],
  call: (model: M) => Promise<T>,
  { isEmpty = () => false, retry, onFallback }: ModelChainOptions<M, T> = {},
): Promise<T> {
  const failures: { model: unknown; reason: unknown }[] = [];
  for (const model of new Set(models)) {
    try {
      const result = await withRetry(() => call(model), {
        attempts: 1,
        isRetryable: isRateLimitError,
        ...retry,
      });
      if (!isEmpty(result)) return result;
      failures.push({ model, reason: "empty" });
      onFallback?.(model, "empty");
    } catch (err) {
      failures.push({ model, reason: err });
      onFallback?.(model, err);
    }
  }
  const last = failures.at(-1)?.reason;
  const detail = last instanceof Error ? last.message : String(last ?? "no models");
  throw new ModelChainError(`All ${failures.length} models failed; last: ${detail}`, failures);
}
