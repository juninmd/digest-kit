// Bounds the scan so a long looping answer cannot turn extraction into O(n²) work.
const MAX_CANDIDATES = 50;

/**
 * Models often wrap JSON in prose that has its own braces; a greedy
 * `/\{[\s\S]*\}/` then spans both and fails to parse. Returns the widest
 * parseable object starting at the earliest `{`, or null.
 */
export function extractJsonObject(text: string): string | null {
  let budget = MAX_CANDIDATES;
  for (let start = text.indexOf("{"); start >= 0; ) {
    for (let end = text.lastIndexOf("}"); end > start; ) {
      if (budget-- <= 0) return null;
      const candidate = text.slice(start, end + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        end = text.lastIndexOf("}", end - 1);
      }
    }
    start = text.indexOf("{", start + 1);
  }
  return null;
}
