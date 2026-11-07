import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  excerpt: string | null;
  siteName: string | null;
  publishedTime: string | null;
  contentMarkdown: string;
  charCount: number;
}

export interface ExtractArticleOptions {
  charThreshold?: number;
  fallbackToBody?: boolean;
  turndownOptions?: TurndownService.Options;
}

const STRIP_SELECTORS = [
  "script",
  "style",
  "iframe",
  "noscript",
  "svg",
  "nav",
  "footer",
  ".ad",
  '[class*="ad-banner"]',
  '[class*="sponsored"]',
  '[class*="sponsor"]',
  '[id*="cookie"]',
  '[class*="cookie"]',
];

/**
 * Extracts the primary article content and metadata from an HTML string,
 * removing boilerplate (nav, ads, footers, scripts) and converting the main
 * prose into clean Markdown suitable for LLM digestion.
 */
export function extractArticleFromHtml(
  html: string,
  options: ExtractArticleOptions = {},
): ExtractedArticle | null {
  if (!html || typeof html !== "string") return null;

  const rawHtml =
    html.includes("<html") || html.includes("<body")
      ? html
      : `<!DOCTYPE html><html><body>${html}</body></html>`;

  const { document } = parseHTML(rawHtml);

  // Pre-strip noise tags before Readability and Turndown
  for (const sel of STRIP_SELECTORS) {
    const nodes = document.querySelectorAll(sel);
    for (const node of nodes) {
      node.remove();
    }
  }

  const reader = new Readability(document as any, {
    charThreshold: options.charThreshold ?? 50,
  });

  const parsed = reader.parse();

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    ...options.turndownOptions,
  });

  turndown.remove(["script", "style", "iframe", "noscript"]);

  if (parsed?.content) {
    const textLen = parsed.textContent?.trim().length ?? 0;
    if (!options.charThreshold || textLen >= options.charThreshold) {
      const markdown = turndown.turndown(parsed.content).trim();
      if (markdown.length > 0) {
        return {
          title: parsed.title || null,
          byline: parsed.byline || null,
          excerpt: parsed.excerpt || null,
          siteName: parsed.siteName || null,
          publishedTime: parsed.publishedTime || null,
          contentMarkdown: markdown,
          charCount: markdown.length,
        };
      }
    }
  }

  if (options.fallbackToBody) {
    const target =
      document.querySelector("article") ??
      document.querySelector("main") ??
      document.querySelector("body");

    if (target?.innerHTML?.trim()) {
      const markdown = turndown.turndown(target.innerHTML).trim();
      if (markdown.length > 0) {
        const titleEl = document.querySelector("title");
        return {
          title: titleEl?.textContent?.trim() || null,
          byline: null,
          excerpt: null,
          siteName: null,
          publishedTime: null,
          contentMarkdown: markdown,
          charCount: markdown.length,
        };
      }
    }
  }

  return null;
}
