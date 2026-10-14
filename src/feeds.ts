import Parser from "rss-parser";
import type { Config, FetchFeedFn } from "./types.ts";

/** Leitor de RSS/Atom padrão. Injetável: os testes passam outro no lugar. */
export function createFetchFeed(config: Config): FetchFeedFn {
  const parser = new Parser({
    timeout: config.feedTimeoutMs,
    // Vários feeds (Open Library, alguns portais) recusam requisição sem User-Agent.
    headers: { "User-Agent": "digest-kit/0.2 (+https://github.com/juninmd/digest-kit)" },
  });
  return async (feed) => {
    const parsed = await parser.parseURL(feed.url);
    return parsed.items ?? [];
  };
}
