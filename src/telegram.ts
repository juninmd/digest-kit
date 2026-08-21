import { splitMessage } from "./text.ts";
import type { Config, SendFn } from "./types.ts";

/**
 * Envia Markdown para todos os chats configurados, quebrando no limite do Telegram.
 * Sem token/chat configurado, cai para o console — o agente continua utilizável em dev.
 */
export function createSend(
  config: Config,
  log: (msg: string) => void = console.log,
): SendFn {
  return async (text) => {
    if (!config.telegramToken || !config.telegramChatIds.length) {
      log(`[telegram] não configurado — imprimindo no console:\n\n${text}`);
      return;
    }
    for (const chatId of config.telegramChatIds) {
      for (const chunk of splitMessage(text)) {
        const res = await fetch(
          `https://api.telegram.org/bot${config.telegramToken}/sendMessage`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: chunk,
              parse_mode: "Markdown",
              disable_web_page_preview: true,
            }),
          },
        );
        if (!res.ok) {
          // O token está na URL: nunca deixe o erro carregar a URL inteira.
          log(`[telegram] chat ${chatId} recusou (${res.status}): ${(await res.text()).slice(0, 200)}`);
        }
      }
    }
  };
}
