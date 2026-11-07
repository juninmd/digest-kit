import { describe, expect, test } from "bun:test";
import { extractArticleFromHtml } from "../src/extract.ts";

describe("extractArticleFromHtml", () => {
  const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Deep Dive into AI Agents - Tech Blog</title>
  <meta name="author" content="Alice Smith">
  <meta name="description" content="Exploring modern agentic workflows.">
  <script src="/tracker.js"></script>
  <style>.ad { display: block; }</style>
</head>
<body>
  <header>
    <nav><a href="/">Home</a><a href="/about">About</a><button>Subscribe</button></nav>
  </header>
  <div class="cookie-banner">Accept all cookies <button>OK</button></div>
  <aside class="sidebar">Recent articles list...</aside>

  <main>
    <article>
      <h1>Deep Dive into AI Agents</h1>
      <p class="byline">By Alice Smith | Nov 7, 2026</p>
      <div class="ad">SPONSORED LINK</div>
      <p>Autonomous agents are software systems that leverage large language models to orchestrate multi-step tasks across diverse tools.</p>
      <h2>Key Building Blocks</h2>
      <ul>
        <li><strong>Memory:</strong> Short and long-term state.</li>
        <li><strong>Planning:</strong> Task breakdown.</li>
      </ul>
      <p>Here is an example code block:</p>
      <pre><code class="language-typescript">const agent = createAgent();
await agent.run();</code></pre>
      <p>This demonstrates the fundamental design principle of separating planning from execution.</p>
    </article>
  </main>

  <footer>
    <p>&copy; 2026 Tech Blog Inc. <a href="/terms">Terms</a></p>
  </footer>
</body>
</html>
`;

  test("extracts article content and metadata while removing boilerplate", () => {
    const article = extractArticleFromHtml(SAMPLE_HTML);
    expect(article).not.toBeNull();
    if (!article) return;

    expect(article.title).toBe("Deep Dive into AI Agents");
    expect(article.byline).toBe("Alice Smith");
    expect(article.contentMarkdown).toContain("Autonomous agents are software systems");
    expect(article.contentMarkdown).toContain("## Key Building Blocks");
    expect(article.contentMarkdown).toContain("-   **Memory:**");
    expect(article.contentMarkdown).toContain("const agent = createAgent();");

    // Must remove noise
    expect(article.contentMarkdown).not.toContain("Subscribe");
    expect(article.contentMarkdown).not.toContain("Accept all cookies");
    expect(article.contentMarkdown).not.toContain("Recent articles list");
    expect(article.contentMarkdown).not.toContain("SPONSORED LINK");
    expect(article.contentMarkdown).not.toContain("Terms");
    expect(article.charCount).toBe(article.contentMarkdown.length);
  });

  test("handles empty or non-string input safely", () => {
    // @ts-expect-error test invalid types
    expect(extractArticleFromHtml(null)).toBeNull();
    // @ts-expect-error test invalid types
    expect(extractArticleFromHtml(undefined)).toBeNull();
    expect(extractArticleFromHtml("")).toBeNull();
  });

  test("respects charThreshold and falls back to body when enabled", () => {
    const shortHtml = `
<html>
<head><title>Simple Notice</title></head>
<body>
  <p>The office is closed today due to weather.</p>
</body>
</html>
`;
    // charThreshold 100 rejects the 42-char paragraph
    const withoutFallback = extractArticleFromHtml(shortHtml, {
      charThreshold: 100,
      fallbackToBody: false,
    });
    expect(withoutFallback).toBeNull();

    const withFallback = extractArticleFromHtml(shortHtml, {
      charThreshold: 100,
      fallbackToBody: true,
    });
    expect(withFallback).not.toBeNull();
    expect(withFallback?.title).toBe("Simple Notice");
    expect(withFallback?.contentMarkdown).toBe("The office is closed today due to weather.");
  });

  test("strips script, style, and iframe tags even if present in body content", () => {
    const htmlWithTags = `
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <article>
    <h1>Clean Article</h1>
    <p>This is clean text with enough words to be recognized as a valid article paragraph.</p>
    <script>alert('bad');</script>
    <style>body { color: red; }</style>
    <iframe src="https://evil.com"></iframe>
    <noscript>Enable JS</noscript>
    <p>This is another valid paragraph with sufficient length to pass the threshold.</p>
  </article>
</body>
</html>
`;
    const res = extractArticleFromHtml(htmlWithTags, { fallbackToBody: true });
    expect(res).not.toBeNull();
    expect(res?.contentMarkdown).toContain("This is clean text");
    expect(res?.contentMarkdown).not.toContain("alert");
    expect(res?.contentMarkdown).not.toContain("color: red");
    expect(res?.contentMarkdown).not.toContain("evil.com");
    expect(res?.contentMarkdown).not.toContain("Enable JS");
  });

  test("handles partial HTML fragments without html or body tags", () => {
    const fragment = "<p>Claude Code <b>2.3</b> adds hooks and plugins.</p>";
    const res = extractArticleFromHtml(fragment, {
      fallbackToBody: true,
      charThreshold: 0,
    });
    expect(res).not.toBeNull();
    expect(res?.contentMarkdown).toBe("Claude Code **2.3** adds hooks and plugins.");
  });
});
