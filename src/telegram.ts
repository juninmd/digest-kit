import { redact } from "./ai.ts";
import { splitMessage } from "./text.ts";
import type { Config, SendFn } from "./types.ts";

/**
 * Envia Markdown para todos os chats configurados, quebrando no limite do Telegram.
 * Sem token/chat configurado, cai para o console — o agente continua utilizável em dev.
 * Lança se nenhum chat recebeu a mensagem inteira: o digest então mantém os itens pendentes.
 */
export function createSend(
  config: Config,
  log: (msg: string) => void = console.log,
  fetchImpl: typeof fetch = fetch,
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
    });

  async function deliver(chatId: string, chunk: string): Promise<boolean> {
    let res = await post(chatId, chunk, true);
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
    let delivered = 0;
    for (const chatId of config.telegramChatIds) {
      try {
        let ok = true;
        for (const chunk of splitMessage(text)) {
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
