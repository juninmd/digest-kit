import Parser from "rss-parser";
import type { Config, FetchFeedFn } from "../types.ts";

// Vários feeds (Open Library, alguns portais) recusam requisição sem User-Agent.
// Sem número de versão: ele já tinha ficado para trás uma vez ("0.2" na 0.4).
const USER_AGENT = "digest-kit (+https://github.com/juninmd/digest-kit)";

interface Validators {
  etag?: string;
  lastModified?: string;
}

/**
 * Leitor de RSS/Atom padrão. Injetável: os testes passam outro no lugar.
 * Guarda ETag/Last-Modified por URL: no `--loop` a ingestão roda a cada 30 min
 * e a maioria dos feeds não mudou, então a resposta é um 304 vazio em vez do
 * XML inteiro baixado e parseado de novo.
 */
export function createFetchFeed(config: Config, fetchImpl: typeof fetch = fetch): FetchFeedFn {
  const parser = new Parser();
  const validators = new Map<string, Validators>();

  return async (feed) => {
    const seen = validators.get(feed.url);
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    };
    if (seen?.etag) headers["If-None-Match"] = seen.etag;
    if (seen?.lastModified) headers["If-Modified-Since"] = seen.lastModified;

    const res = await fetchImpl(feed.url, {
      headers,
      redirect: "follow",
      ...(config.feedTimeoutMs > 0 ? { signal: AbortSignal.timeout(config.feedTimeoutMs) } : {}),
    });
    // Nada novo desde a última leitura: os itens já estão no banco.
    if (res.status === 304) return [];
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const parsed = await parser.parseString(await res.text());
    const etag = res.headers.get("etag") ?? undefined;
    const lastModified = res.headers.get("last-modified") ?? undefined;
    if (etag || lastModified) validators.set(feed.url, { etag, lastModified });
    return parsed.items ?? [];
  };
}
