import { createHash } from "node:crypto";

/** id estável de um item: hash do link. */
export const idFor = (link: string) => createHash("sha1").update(link).digest("hex");

const TEXT = 0;
const SPACE = 1;
const TAG_OPEN = 2;
const ENTITY = 3;

/** Classe de cada code unit Latin-1: uma leitura de tabela no lugar de várias comparações. */
const LATIN1_CLASS = new Uint8Array(256);
for (const code of [9, 10, 11, 12, 13, 32, 160]) LATIN1_CLASS[code] = SPACE;
LATIN1_CLASS[60] = TAG_OPEN; // <
LATIN1_CLASS[38] = ENTITY; // &

/** Resto do conjunto do `\s` do JavaScript, fora do Latin-1. */
function isWideWhitespace(code: number): boolean {
  return (
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function classify(code: number): number {
  if (code < 256) return LATIN1_CLASS[code]!;
  return isWideWhitespace(code) ? SPACE : TEXT;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Uma passada só, que para assim que `limit` caracteres de saída existem.
 * Equivale a `replace(/<[^>]+>/g, " ")`, `replace(/&nbsp;/g, " ")`,
 * `replace(/\s+/g, " ")`, `trim()` e `slice(0, limit)`, mas sem varrer (nem
 * copiar quatro vezes) um artigo inteiro para guardar 500 caracteres.
 */
function collapse(raw: string, limit: number): string {
  const length = raw.length;
  let out = "";
  let pendingSpace = false;
  // Vira false no primeiro "<" sem ">" adiante: sem isso, texto cheio de "<" seria O(n²).
  let mayCloseTag = true;
  let i = 0;
  while (i < length) {
    const kind = classify(raw.charCodeAt(i));
    if (kind === SPACE) {
      pendingSpace = true;
      i++;
      continue;
    }
    if (kind === TAG_OPEN && mayCloseTag) {
      const close = raw.indexOf(">", i + 1);
      if (close < 0) {
        mayCloseTag = false;
      } else if (close > i + 1) {
        pendingSpace = true;
        i = close + 1;
        continue;
      }
      // "<>" e "<" sem fechamento não são tag: seguem como texto.
    } else if (kind === ENTITY && raw.startsWith("&nbsp;", i)) {
      pendingSpace = true;
      i += 6;
      continue;
    }

    let end = i + 1;
    while (end < length && classify(raw.charCodeAt(end)) === TEXT) end++;
    // Espaço só entra entre dois trechos de texto: é isso que faz o papel do trim().
    if (pendingSpace && out.length > 0) out += " ";
    pendingSpace = false;
    const room = limit - out.length;
    if (end - i >= room) {
      const cut = i + room;
      // Não corta um par substituto (emoji) ao meio: meio emoji vira U+FFFD ao gravar.
      if (room > 0 && isHighSurrogate(raw.charCodeAt(cut - 1)) && isLowSurrogate(raw.charCodeAt(cut))) {
        return (out + raw.slice(i, cut - 1)).trimEnd();
      }
      return out + raw.slice(i, cut);
    }
    out += raw.slice(i, end);
    i = end;
  }
  return out;
}

/** Tira HTML e colapsa espaço; corta em `max` para não inflar o prompt. */
export function clean(raw: string | undefined, max = 500): string {
  if (!raw) return "";
  // `max` negativo ou NaN mantém o contrato de `String.prototype.slice(0, max)`.
  if (!(max >= 0)) return collapse(raw, Number.POSITIVE_INFINITY).slice(0, max);
  const limit = Math.trunc(max);
  return limit === 0 ? "" : collapse(raw, limit);
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
        if (end < line.length && end - 1 > i && isHighSurrogate(last)) end--;
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
