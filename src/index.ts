// Bun entry: everything in ./core.ts plus the pieces that need bun:sqlite.
export { createAgent, defineTopic } from "./agent/agent.ts";
export { type Mode, type Parsed, parseArgs, USAGE } from "./agent/args.ts";
export { runAgent } from "./agent/cli.ts";
export { loadConfig } from "./agent/config.ts";
export {
  backoffDelay,
  clean,
  createChat,
  type ExtractArticleOptions,
  type ExtractedArticle,
  extractArticleFromHtml,
  extractJsonObject,
  formatItems,
  hasEnglishSentence,
  hasModelArtifacts,
  hasPromptLeak,
  idFor,
  isPollutedProse,
  isRateLimitError,
  isSafeExternalUrl,
  looksGarbled,
  mapSettled,
  ModelChainError,
  redact,
  runModelChain,
  splitMessage,
  withRetry,
} from "./core.ts";
export { createSend } from "./delivery/telegram.ts";
export { createFetchFeed } from "./sources/feeds.ts";
export { createStore } from "./storage/store.ts";
export {
  createVectorStore,
  type Embedding,
  loadSqliteVec,
  type VectorDistanceMetric,
  type VectorEntry,
  type VectorMatch,
  type VectorStore,
  type VectorStoreOptions,
} from "./storage/vector.ts";
export type {
  Agent,
  AgentDeps,
  AiProvider,
  ChatFn,
  Config,
  DigestEvent,
  DigestOptions,
  Feed,
  FetchFeedFn,
  Item,
  NewItem,
  ParsedFeedItem,
  SendFn,
  SqliteStore,
  Store,
  StoreStats,
  Topic,
} from "./types.ts";
