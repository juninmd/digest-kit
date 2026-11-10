import Parser from "rss-parser";
import type { Config, FetchFeedFn } from "../types.ts";

/** Leitor de RSS/Atom padrão. Injetável: os testes passam outro no lugar. */
export function createFetchFeed(config: Config): FetchFeedFn {
  const parser = new Parser({
    timeout: config.feedTimeoutMs,
    // Vários feeds (Open Library, alguns portais) recusam requisição sem User-Agent.
    // Sem número de versão: ele já tinha ficado para trás uma vez ("0.2" na 0.4).
    headers: { "User-Agent": "digest-kit (+https://github.com/juninmd/digest-kit)" },
  });
  return async (feed) => {
    const parsed = await parser.parseURL(feed.url);
    return parsed.items ?? [];
  };
}
