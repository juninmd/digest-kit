import { createHash } from "node:crypto";

/** id estável de um item: hash do link. */
export const idFor = (link: string) => createHash("sha1").update(link).digest("hex");

/** Tira HTML e colapsa espaço; corta em `max` para não inflar o prompt. */
export function clean(raw: string | undefined, max = 500): string {
  return (raw ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Quebra o texto em pedaços que cabem no limite do Telegram (4096),
 * sempre em fim de linha — nunca no meio de uma palavra.
 */
export function splitMessage(text: string, max = 3800): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let buf = "";
  for (const line of text.split("\n")) {
    // Linha maior que o limite: quebra na força bruta, senão ela nunca cabe.
    if (line.length > max) {
      if (buf) {
        out.push(buf.trimEnd());
        buf = "";
      }
      for (let i = 0; i < line.length; ) {
        let end = Math.min(i + max, line.length);
        // Não separa um par substituto (emoji): recua se o corte cai após o high surrogate.
        const last = line.charCodeAt(end - 1);
        if (end < line.length && end - 1 > i && last >= 0xd800 && last <= 0xdbff) end--;
        out.push(line.slice(i, end));
        i = end;
      }
      continue;
    }
    if (buf && buf.length + line.length + 1 > max) {
      out.push(buf.trimEnd());
      buf = "";
    }
    buf += `${line}\n`;
  }
  if (buf.trim()) out.push(buf.trimEnd());
  return out;
}

/** Lista numerada dos itens, do jeito que o modelo lê melhor. */
export function formatItems(
  items: { source: string; title: string; summary: string | null; link: string }[],
): string {
  return items
    .map(
      (it, i) =>
        `${i + 1}. [${it.source}] ${it.title}\n   ${it.summary ?? ""}\n   ${it.link}`,
    )
    .join("\n\n");
}
