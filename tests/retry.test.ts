import { describe, expect, test } from "bun:test";
import { ModelChainError, runModelChain } from "../src/chain.ts";
import { backoffDelay, isRateLimitError, withRetry } from "../src/retry.ts";

const noSleep = async () => {};

describe("withRetry", () => {
  test("retries until success and reports each delay", async () => {
    const delays: number[] = [];
    let calls = 0;
    const out = await withRetry(
      async () => {
        if (++calls < 3) throw new Error("boom");
        return "ok";
      },
      { baseMs: 100, sleep: noSleep, onRetry: (_a, _e, ms) => delays.push(ms) },
    );
    expect(out).toBe("ok");
    expect(delays).toEqual([100, 200]);
  });

  test("stops at the attempt limit and rethrows the last error", async () => {
    let calls = 0;
    const run = withRetry(
      async () => {
        calls++;
        throw new Error(`fail ${calls}`);
      },
      { attempts: 2, sleep: noSleep },
    );
    await expect(run).rejects.toThrow("fail 2");
    expect(calls).toBe(2);
  });

  test("does not retry errors the predicate rejects", async () => {
    let calls = 0;
    const run = withRetry(
      async () => {
        calls++;
        throw new Error("400 bad request");
      },
      { isRetryable: isRateLimitError, sleep: noSleep },
    );
    await run.catch(() => {});
    expect(calls).toBe(1);
  });

  test("caps the backoff", () => {
    expect(backoffDelay(10, { baseMs: 1000, maxMs: 5000 })).toBe(5000);
  });
});

describe("isRateLimitError", () => {
  test("reads status fields and provider messages", () => {
    expect(isRateLimitError(Object.assign(new Error("x"), { statusCode: 429 }))).toBe(true);
    expect(isRateLimitError(new Error("RESOURCE_EXHAUSTED: quota"))).toBe(true);
    expect(isRateLimitError(new Error("litellm.RateLimitError: try again in 300 seconds"))).toBe(
      true,
    );
    expect(isRateLimitError(new Error("500 internal"))).toBe(false);
    expect(isRateLimitError(new Error("port 4290 closed"))).toBe(false);
  });
});

describe("runModelChain", () => {
  test("falls back on error and on empty result, skipping duplicates", async () => {
    const seen: string[] = [];
    const out = await runModelChain(
      ["a", "b", "a", "c"],
      async (m) => {
        seen.push(m);
        if (m === "a") throw new Error("down");
        return m === "b" ? "" : `from ${m}`;
      },
      { isEmpty: (t) => !t },
    );
    expect(out).toBe("from c");
    expect(seen).toEqual(["a", "b", "c"]);
  });

  test("retries a rate-limited model before moving on", async () => {
    let calls = 0;
    const out = await runModelChain(
      ["a"],
      async () => {
        if (++calls < 3) throw new Error("429 Too Many Requests");
        return "ok";
      },
      { retry: { attempts: 6, sleep: noSleep } },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  test("throws with every failure when the chain is exhausted", async () => {
    const run = runModelChain(["a", "b"], async (m) => {
      throw new Error(`${m} down`);
    });
    const err = await run.catch((e) => e);
    expect(err).toBeInstanceOf(ModelChainError);
    expect(err.message).toContain("b down");
    expect(err.failures).toHaveLength(2);
  });

  test("an empty model list fails instead of returning undefined", async () => {
    await expect(runModelChain([], async () => "x")).rejects.toThrow(ModelChainError);
  });
});
