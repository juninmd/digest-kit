import type { ChatFn, Config } from "../types.ts";
import { redact } from "../util/redact.ts";

const DEFAULT_TIMEOUT_MS = 300_000;

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
        return openaiCompatible(config, {
          baseUrl: "https://api.openai.com/v1",
          key: config.openaiKey,
          model: config.openaiModel,
          system,
          user,
        });
      case "compatible": {
        if (!config.aiBaseUrl) throw new Error("AI_BASE_URL é obrigatório com AI_PROVIDER=compatible");
        if (!config.aiModel) throw new Error("AI_MODEL é obrigatório com AI_PROVIDER=compatible");
        return openaiCompatible(config, {
          baseUrl: config.aiBaseUrl,
          key: config.aiKey,
          model: config.aiModel,
          system,
          user,
        });
      }
      case "ollama":
        return openaiCompatible(config, {
          baseUrl: config.ollamaBaseUrl,
          key: "ollama",
          model: config.ollamaModel,
          system,
          user,
        });
      default:
        // Antes um nome digitado errado caía em silêncio no Ollama local.
        throw new Error(
          `AI_PROVIDER desconhecido: "${config.aiProvider}" (use ollama, openai, anthropic, google ou compatible)`,
        );
    }
  };
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * POST JSON com teto de espera. Sem ele, um provider que aceita a conexão e
 * nunca responde segura o digest (e o cron) para sempre.
 */
async function postJson<T>(
  config: Config,
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<T> {
  const timeoutMs = config.aiTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  if (!res.ok) throw new Error(`${label} ${res.status}: ${redact(await res.text())}`);
  return (await res.json()) as T;
}

/** Providers devolvem o texto em um ou mais blocos; blocos sem texto (ex.: raciocínio) são pulados. */
const joinText = (parts: { text?: string; thought?: boolean }[] | undefined): string =>
  (parts ?? [])
    .map((part) => (part.thought ? "" : (part.text ?? "")))
    .join("")
    .trim();

interface OpenAiRequest {
  baseUrl: string;
  key: string;
  model: string;
  system: string;
  user: string;
}

async function openaiCompatible(config: Config, request: OpenAiRequest): Promise<string> {
  const json = await postJson<{ choices?: { message?: { content?: string } }[] }>(
    config,
    "AI",
    `${trimSlash(request.baseUrl)}/chat/completions`,
    { authorization: `Bearer ${request.key}` },
    {
      model: request.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      temperature: config.aiTemperature,
    },
  );
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

async function anthropic(config: Config, system: string, user: string): Promise<string> {
  const json = await postJson<{ content?: { text?: string }[] }>(
    config,
    "Anthropic",
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": config.anthropicKey, "anthropic-version": "2023-06-01" },
    {
      model: config.anthropicModel,
      max_tokens: config.aiMaxTokens,
      system,
      messages: [{ role: "user", content: user }],
    },
  );
  return joinText(json.content);
}

async function google(config: Config, system: string, user: string): Promise<string> {
  const json = await postJson<{
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  }>(
    config,
    "Gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`,
    { "x-goog-api-key": config.geminiKey },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
    },
  );
  return joinText(json.candidates?.[0]?.content?.parts);
}
