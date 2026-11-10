// Deterministic fixtures: a seeded PRNG, no network, no clock. Same bytes on every run.

/** mulberry32: small, fast, good enough to shape text; never use for crypto. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "tecnologia", "modelo", "empresa", "anunciou", "novo", "sistema", "dados", "segurança",
  "atualização", "versão", "plataforma", "desenvolvedores", "código", "aberto", "lançamento",
  "inteligência", "artificial", "mercado", "usuários", "serviço", "nuvem", "aplicação",
  "desempenho", "projeto", "equipe", "pesquisa", "resultado", "primeiro", "semana", "hoje",
  "também", "ainda", "entre", "sobre", "para", "com", "que", "uma", "dos", "mais", "como",
  "não", "após", "desde", "durante", "segundo", "relatório", "ferramenta", "recursos", "rede",
];

export function words(random: () => number, count: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(WORDS[Math.floor(random() * WORDS.length)]!);
  return out.join(" ");
}

/** Sentences with pt-BR casing and punctuation, about `chars` long. */
export function prose(random: () => number, chars: number): string {
  let out = "";
  while (out.length < chars) {
    const sentence = words(random, 8 + Math.floor(random() * 14));
    out += `${sentence[0]!.toUpperCase()}${sentence.slice(1)}. `;
  }
  return out.slice(0, chars).trimEnd();
}

/** Body markup the way feeds ship it: paragraphs, links, emphasis, entities. */
export function htmlBody(random: () => number, chars: number): string {
  let out = "";
  let n = 0;
  while (out.length < chars) {
    const text = prose(random, 180 + Math.floor(random() * 240));
    const link = `<a href="https://example.com/p/${n}?ref=feed" class="link">${words(random, 3)}</a>`;
    out += `<p class="body-text">${text}&nbsp;${link} <strong>${words(random, 2)}</strong></p>\n`;
    if (n % 4 === 3) out += `<ul><li>${words(random, 5)}</li><li>${words(random, 6)}</li></ul>\n`;
    n++;
  }
  return out;
}

export function articlePage(random: () => number, chars: number): string {
  const nav = Array.from(
    { length: 24 },
    (_, i) => `<li><a href="/secao/${i}">${words(random, 2)}</a></li>`,
  ).join("");
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${words(random, 7)}</title>
<meta property="og:site_name" content="Portal Exemplo">
<meta name="author" content="Redação">
<meta property="article:published_time" content="2026-08-20T10:00:00Z">
<style>.x{color:red}</style><script>window.dataLayer=[];function t(){return 1}</script>
</head><body>
<nav class="menu"><ul>${nav}</ul></nav>
<div class="ad-banner-top"><img src="/ad.png" alt=""><p>${words(random, 12)}</p></div>
<div id="cookie-consent"><p>${words(random, 20)}</p><button>OK</button></div>
<main><article><h1>${words(random, 8)}</h1>
<p class="lead">${prose(random, 220)}</p>
${htmlBody(random, chars)}
<h2>${words(random, 4)}</h2>
<pre><code>const total = itens.length;\nconsole.log(total);</code></pre>
${htmlBody(random, Math.floor(chars / 4))}
</article></main>
<aside class="sponsored-box"><p>${words(random, 30)}</p></aside>
<footer><p>${words(random, 40)}</p><svg viewBox="0 0 1 1"><path d="M0 0"/></svg></footer>
<script>t();</script>
</body></html>`;
}

export function rssXml(random: () => number, items: number): string {
  const entries = Array.from({ length: items }, (_, i) => {
    const day = String(1 + (i % 28)).padStart(2, "0");
    return `<item>
<title>${words(random, 9)}</title>
<link>https://feed.example.com/noticias/${i}?utm_source=rss</link>
<guid isPermaLink="false">post-${i}</guid>
<pubDate>Thu, ${day} Aug 2026 10:00:00 GMT</pubDate>
<description><![CDATA[${htmlBody(random, 500)}]]></description>
<content:encoded><![CDATA[${htmlBody(random, 2500)}]]></content:encoded>
</item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Feed de exemplo</title><link>https://feed.example.com</link>
<description>fixture</description>
${entries}
</channel></rss>`;
}

export interface FixtureFeedItem {
  title: string;
  link: string;
  contentSnippet: string;
  content: string;
  isoDate: string;
}

/**
 * What rss-parser hands the agent. Half the feeds are "full content": their
 * `contentSnippet` is the whole article as plain text, not a teaser.
 */
export function feedItems(
  random: () => number,
  feed: number,
  count: number,
  offset = 0,
): FixtureFeedItem[] {
  const fullContent = feed % 2 === 0;
  return Array.from({ length: count }, (_, i) => ({
    title: `${words(random, 8)} ${feed}-${offset + i}`,
    link: `https://feed${feed}.example.com/noticias/${offset + i}?utm_source=rss`,
    contentSnippet: prose(random, fullContent ? 4000 : 280),
    content: htmlBody(random, 600),
    isoDate: "2026-08-20T10:00:00.000Z",
  }));
}

/** An answer shaped like a real model reply: prose, fenced JSON, more prose. */
export function modelAnswer(random: () => number, trailingBraces: number): string {
  const payload = {
    title: words(random, 8),
    summary: prose(random, 900),
    tags: ["ia", "mercado", "código {aberto}"],
    items: Array.from({ length: 6 }, (_, i) => ({ id: i, text: prose(random, 120), ok: true })),
  };
  let tail = "Espero que ajude.";
  for (let i = 0; i < trailingBraces; i++) tail += ` Use o campo {${words(random, 1)}} se precisar.`;
  return `Claro, aqui está o objeto pedido:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\n${tail}`;
}

/** Unit-length vector: realistic for embedding models and valid for any metric. */
export function embedding(random: () => number, dimensions: number): Float32Array {
  const vector = new Float32Array(dimensions);
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    const value = random() * 2 - 1;
    vector[i] = value;
    norm += value * value;
  }
  const scale = 1 / Math.sqrt(norm);
  for (let i = 0; i < dimensions; i++) vector[i] = vector[i]! * scale;
  return vector;
}
