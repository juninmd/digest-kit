import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/agent/config.ts";
import { createFetchFeed } from "../src/sources/feeds.ts";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Um</title><link>https://a/1</link></item></channel></rss>`;

describe("createFetchFeed", () => {
  test("reenvia ETag/Last-Modified e trata 304 como nada novo", async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      seen.push(headers);
      if (headers["If-None-Match"] === '"v1"') return new Response(null, { status: 304 });
      return new Response(RSS, { headers: { etag: '"v1"', "last-modified": "Tue, 17 Nov 2026 10:00:00 GMT" } });
    }) as unknown as typeof fetch;
    const fetchFeed = createFetchFeed(loadConfig({}, {}), fetchImpl);
    const feed = { name: "f", url: "https://a/rss" };
    expect((await fetchFeed(feed)).map((i) => i.title)).toEqual(["Um"]);
    expect(await fetchFeed(feed)).toEqual([]);
    expect(seen[1]?.["If-Modified-Since"]).toBe("Tue, 17 Nov 2026 10:00:00 GMT");
  });

  test("status de erro lança para o agente registrar o feed como falho", async () => {
    const fetchImpl = (async () => new Response("x", { status: 503 })) as unknown as typeof fetch;
    await expect(createFetchFeed(loadConfig({}, {}), fetchImpl)({ name: "f", url: "https://a" })).rejects.toThrow("503");
  });
});
