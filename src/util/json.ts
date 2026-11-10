// Bounds the scan so a long looping answer cannot turn extraction into O(n²) work.
const MAX_CANDIDATES = 50;

const QUOTE = 34;
const BACKSLASH = 92;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;

/**
 * Index of the quote that closes the string opened at `open`, or -1. Jumps
 * from quote to quote natively instead of visiting every character: string
 * values are most of the bytes in a model's JSON.
 */
function closingQuote(text: string, open: number): number {
  for (let close = text.indexOf('"', open + 1); close >= 0; close = text.indexOf('"', close + 1)) {
    let backslashes = 0;
    while (text.charCodeAt(close - 1 - backslashes) === BACKSLASH) backslashes++;
    // An even run of backslashes escapes itself, not the quote.
    if (backslashes % 2 === 0) return close;
  }
  return -1;
}

/**
 * Index of the `}` that closes the `{` at `start`, or -1. Braces inside string
 * literals do not count. If the text from `start` is valid JSON this is its
 * exact end, so one `JSON.parse` settles each candidate.
 */
function matchingBrace(text: string, start: number, lastClose: number): number {
  let depth = 0;
  for (let i = start; i <= lastClose; i++) {
    const code = text.charCodeAt(i);
    if (code === QUOTE) {
      i = closingQuote(text, i);
      if (i < 0) return -1;
    } else if (code === OPEN_BRACE) {
      depth++;
    } else if (code === CLOSE_BRACE && --depth === 0) {
      return i;
    }
  }
  return -1;
}

function parses(candidate: string): boolean {
  try {
    JSON.parse(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Models often wrap JSON in prose that has its own braces; a greedy
 * `/\{[\s\S]*\}/` then spans both and fails to parse. Returns the parseable
 * object starting at the earliest `{`, or null.
 */
export function extractJsonObject(text: string): string | null {
  // Nothing past the last `}` can close an object, so no scan goes beyond it.
  const lastClose = text.lastIndexOf("}");
  let start = text.indexOf("{");
  if (start < 0 || start > lastClose) return null;

  // Usual answer: one object, maybe fenced, no braces around it. The native
  // parser validates that span faster than any scan written here could.
  const widest = text.slice(start, lastClose + 1);
  if (parses(widest)) return widest;

  for (let budget = MAX_CANDIDATES; start >= 0 && start < lastClose; budget--) {
    if (budget <= 0) return null;
    const end = matchingBrace(text, start, lastClose);
    if (end >= 0) {
      const candidate = text.slice(start, end + 1);
      // The widest span already failed; do not parse the same text twice.
      if (candidate.length !== widest.length && parses(candidate)) return candidate;
    }
    start = text.indexOf("{", start + 1);
  }
  return null;
}
