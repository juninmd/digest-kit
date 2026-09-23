import type { ChatFn, Config } from "./types.ts";

/**
 * Chat single-shot com o provider configurado.
 * "compatible" cobre qualquer gateway OpenAI-compatible (LiteLLM, vLLM, Groq, OpenRouter).
 */
export function createChat(config: Config): ChatFn {
  return async (system, user) => {
    switch (config.aiProvider) {
      case "anthropic":
        return anthropic(config, system, user);
      case "google":
        return google(config, system, user);
      case "openai":
        return openaiCompatible(
          config,
          "https://api.openai.com/v1",
          config.openaiKey,
          config.openaiModel,
          system,
          user,
        );
      case "compatible": {
        if (!config.aiBaseUrl) throw new Error("AI_BASE_URL é obrigatório com AI_PROVIDER=compatible");
        if (!config.aiModel) throw new Error("AI_MODEL é obrigatório com AI_PROVIDER=compatible");
        return openaiCompatible(config, config.aiBaseUrl, config.aiKey, config.aiModel, system, user);
      }
      default:
        return openaiCompatible(
          config,
          config.ollamaBaseUrl,
          "ollama",
          config.ollamaModel,
          system,
          user,
        );
    }
  };
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

async function openaiCompatible(
  config: Config,
  baseUrl: string,
  key: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const res = await fetch(`${trimSlash(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: config.aiTemperature,
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${redact(await res.text())}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

async function anthropic(config: Config, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: config.aiMaxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${redact(await res.text())}`);
  const json = (await res.json()) as { content?: { text?: string }[] };
  return json.content?.[0]?.text?.trim() ?? "";
}

async function google(config: Config, system: string, user: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": config.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${redact(await res.text())}`);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

/** Corpo de erro de provider às vezes ecoa a chave enviada. Nunca logamos isso cru. */
export function redact(text: string): string {
  return text
    .replace(/(sk-|xoxb-|ghp_|gho_)[A-Za-z0-9_-]{8,}/g, "$1***")
    .replace(/(bot)\d+:[A-Za-z0-9_-]+/g, "$1***")
    .replace(/(Bearer\s+)\S+/gi, "$1***")
    .replace(/("?(api[_-]?key|authorization|x-api-key)"?\s*[:=]\s*"?)[^"',\s]+/gi, "$1***")
    .slice(0, 500);
}
