// Runtime-agnostic entry: no bun:* imports, safe to load from Node.
// tests/architecture.test.ts walks this import graph and fails on any bun:* or storage/ import.
export { ModelChainError, type ModelChainOptions, runModelChain } from "./ai/chain.ts";
export { createChat } from "./ai/chat.ts";
export {
  hasEnglishSentence,
  hasModelArtifacts,
  hasPromptLeak,
  isPollutedProse,
  looksGarbled,
} from "./ai/prose.ts";
export {
  type ExtractArticleOptions,
  type ExtractedArticle,
  extractArticleFromHtml,
} from "./sources/extract.ts";
export type { AiProvider, ChatFn, Config } from "./types.ts";
export { mapSettled } from "./util/concurrency.ts";
export { extractJsonObject } from "./util/json.ts";
export { isSafeExternalUrl } from "./util/net.ts";
export { redact } from "./util/redact.ts";
export { backoffDelay, isRateLimitError, type RetryOptions, withRetry } from "./util/retry.ts";
export { clean, formatItems, idFor, splitMessage } from "./util/text.ts";
