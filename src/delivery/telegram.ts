import { redact } from "../util/redact.ts";
import { splitMessage } from "../util/text.ts";
import type { Config, SendFn } from "../types.ts";

/** A API do Telegram responde em milissegundos; meio minuto parado é conexão morta. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Teto da espera pedida num 429; mais que isso o digest falha e tenta no próximo ciclo. */
const MAX_RETRY_AFTER_S = 30;

/**
 * Envia Markdown para todos os chats configurados, quebrando no limite do Telegram.
 * Sem token/chat configurado, cai para o console — o agente continua utilizável em dev.
 * Lança se nenhum chat recebeu a mensagem inteira: o digest então mantém os itens pendentes.
 */
export function createSend(
  config: Config,
  log: (msg: string) => void = console.log,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): SendFn {
  const post = (chatId: string, text: string, markdown: boolean) =>
    fetchImpl(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(markdown ? { parse_mode: "Markdown" } : {}),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  /** 429 do Telegram traz `parameters.retry_after` (s): espera uma vez e reenvia. */
  async function retryAfter(res: Response): Promise<number> {
    try {
      const body = (await res.clone().json()) as { parameters?: { retry_after?: number } };
      const s = Number(body.parameters?.retry_after);
      return Number.isFinite(s) && s > 0 ? Math.min(s, MAX_RETRY_AFTER_S) : 1;
    } catch {
      return 1;
    }
  }

  async function deliver(chatId: string, chunk: string): Promise<boolean> {
    let res = await post(chatId, chunk, true);
    if (res.status === 429) {
      const wait = await retryAfter(res);
      log(`[telegram] chat ${chatId}: limite de envio — nova tentativa em ${wait}s`);
      await sleep(wait * 1000);
      res = await post(chatId, chunk, true);
    }
    if (res.status === 400) {
      // Quase sempre é Markdown inválido vindo do LLM: o texto ainda vale entregar.
      log(`[telegram] chat ${chatId}: Markdown recusado — reenviando como texto simples`);
      res = await post(chatId, chunk, false);
    }
    if (res.ok) return true;
    // O token está na URL: nunca deixe o erro carregar a URL inteira.
    log(`[telegram] chat ${chatId} recusou (${res.status}): ${redact(await res.text()).slice(0, 200)}`);
    return false;
  }

  return async (text) => {
    if (!config.telegramToken || !config.telegramChatIds.length) {
      log(`[telegram] não configurado — imprimindo no console:\n\n${text}`);
      return;
    }
    const chunks = splitMessage(text);
    let delivered = 0;
    for (const chatId of config.telegramChatIds) {
      try {
        let ok = true;
        for (const chunk of chunks) {
          ok = await deliver(chatId, chunk);
          if (!ok) break;
        }
        if (ok) delivered++;
      } catch (err) {
        // Um chat com erro de rede não pode impedir a entrega aos demais.
        log(`[telegram] chat ${chatId}: falha de rede: ${redact(String(err))}`);
      }
    }
    if (!delivered) throw new Error("telegram: nenhum chat recebeu a mensagem completa");
  };
}
