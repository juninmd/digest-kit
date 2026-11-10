/** Corpo de erro de provider às vezes ecoa a chave enviada. Nunca logamos isso cru. */
export function redact(text: string): string {
  return text
    .replace(/(sk-|xoxb-|ghp_|gho_)[A-Za-z0-9_-]{8,}/g, "$1***")
    .replace(/(bot)\d+:[A-Za-z0-9_-]+/g, "$1***")
    .replace(/(Bearer\s+)\S+/gi, "$1***")
    .replace(/("?(api[_-]?key|authorization|x-api-key)"?\s*[:=]\s*"?)[^"',\s]+/gi, "$1***")
    .slice(0, 500);
}
