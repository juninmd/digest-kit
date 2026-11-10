import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as core from "../src/core.ts";
import * as root from "../src/index.ts";
// Type-only surface of 0.4.0: `bun run typecheck` fails if any of these names disappears.
import type {
  AiProvider as CoreAiProvider,
  ChatFn as CoreChatFn,
  Config as CoreConfig,
  ExtractArticleOptions as CoreExtractArticleOptions,
  ExtractedArticle as CoreExtractedArticle,
  ModelChainOptions,
  RetryOptions,
} from "../src/core.ts";
import type {
  Agent,
  AgentDeps,
  AiProvider,
  ChatFn,
  Config,
  DigestEvent,
  DigestOptions,
  ExtractArticleOptions,
  ExtractedArticle,
  Feed,
  FetchFeedFn,
  Item,
  Mode,
  NewItem,
  Parsed,
  ParsedFeedItem,
  SendFn,
  Store,
  Topic,
  VectorMatch,
  VectorStore,
  VectorStoreOptions,
} from "../src/index.ts";

export type PublicTypes040 = [
  Agent, AgentDeps, AiProvider, ChatFn, Config, DigestEvent, DigestOptions, ExtractArticleOptions,
  ExtractedArticle, Feed, FetchFeedFn, Item, Mode, NewItem, Parsed, ParsedFeedItem, SendFn, Store,
  Topic, VectorMatch, VectorStore, VectorStoreOptions, CoreAiProvider, CoreChatFn, CoreConfig,
  CoreExtractArticleOptions, CoreExtractedArticle, ModelChainOptions<string, string>, RetryOptions,
];

const SRC = resolve(import.meta.dir, "../src");
const IMPORT = /(?:^|\n)\s*(?:import|export)\b[^;'"]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** Every module reachable from `entry` through static or dynamic imports. */
function importGraph(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (graph.has(file)) continue;
    const specifiers = [...readFileSync(file, "utf8").matchAll(IMPORT)].map(
      (m) => (m[1] ?? m[2] ?? m[3])!,
    );
    graph.set(file, specifiers);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) queue.push(join(dirname(file), specifier));
    }
  }
  return graph;
}

describe("fronteira do ./core (roda em Node)", () => {
  const graph = importGraph(join(SRC, "core.ts"));

  test("o grafo de imports foi realmente percorrido", () => {
    const files = [...graph.keys()].map((f) => relative(SRC, f));
    expect(files).toContain("core.ts");
    expect(files).toContain("util/text.ts");
    expect(files).toContain("util/retry.ts"); // só alcançado via ai/chain.ts
  });

  test("nada alcançável a partir de core.ts importa bun:*", () => {
    const offenders = [...graph].flatMap(([file, specifiers]) =>
      specifiers.filter((s) => s.startsWith("bun:") || s === "bun").map((s) => `${relative(SRC, file)} -> ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  test("nada alcançável a partir de core.ts mora em storage/ (o diretório bun:sqlite)", () => {
    const offenders = [...graph.keys()].map((f) => relative(SRC, f)).filter((f) => f.startsWith("storage/"));
    expect(offenders).toEqual([]);
  });
});

describe("API pública: nada da 0.4.0 some", () => {
  // Lista congelada dos exports de runtime da 0.4.0. Só cresce.
  const ROOT_040 = [
    "ModelChainError", "USAGE", "backoffDelay", "clean", "createAgent", "createChat",
    "createFetchFeed", "createSend", "createStore", "createVectorStore", "defineTopic",
    "extractArticleFromHtml", "extractJsonObject", "formatItems", "hasEnglishSentence",
    "hasModelArtifacts", "hasPromptLeak", "idFor", "isPollutedProse", "isRateLimitError",
    "isSafeExternalUrl", "loadConfig", "loadSqliteVec", "looksGarbled", "parseArgs", "redact",
    "runAgent", "runModelChain", "splitMessage", "withRetry",
  ];
  const CORE_040 = [
    "ModelChainError", "backoffDelay", "clean", "createChat", "extractArticleFromHtml",
    "extractJsonObject", "formatItems", "hasEnglishSentence", "hasModelArtifacts", "hasPromptLeak",
    "idFor", "isPollutedProse", "isRateLimitError", "isSafeExternalUrl", "looksGarbled", "redact",
    "runModelChain", "splitMessage", "withRetry",
  ];

  test("entrada raiz mantém todos os exports", () => {
    expect(ROOT_040.filter((name) => !(name in root))).toEqual([]);
  });

  test("entrada ./core mantém todos os exports", () => {
    expect(CORE_040.filter((name) => !(name in core))).toEqual([]);
  });

  test("tudo que o ./core exporta também sai pela raiz", () => {
    expect(Object.keys(core).filter((name) => !(name in root))).toEqual([]);
  });
});
