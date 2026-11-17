import type { ChatFn, ChatUsage, Config } from "../types.ts";
import { isRateLimitError, withRetry } from "../util/retry.ts";
import { ModelChainError, runModelChain } from "./chain.ts";
import { redact } from "../util/redact.ts";

const DEFAULT_TIMEOUT_MS = 300_000;

export interface CreateChatOptions {
  /** Recebe os tokens de cada chamada que o provider informar. */
  onUsage?: (usage: ChatUsage) => void;
}

/** 429 é transitório: uma nova tentativa no mesmo modelo antes de passar ao próximo. */
const RATE_LIMIT_RETRY = { attempts: 2, baseMs: 2000, isRetryable: isRateLimitError };

/**
 * Chat single-shot com o provider configurado.
 * "compatible" cobre qualquer gateway OpenAI-compatible (LiteLLM, vLLM, Groq, OpenRouter).
 * Nos providers OpenAI-compatíveis, `aiFallbackModels` vira uma cadeia: erro ou
 * resposta vazia passa ao próximo modelo.
 */
export function createChat(config: Config, { onUsage }: CreateChatOptions = {}): ChatFn {
  const chain = (baseUrl: string, key: string, model: string, system: string, user: string) =>
    runModelChain(
      [model, ...(config.aiFallbackModels ?? [])].filter(Boolean),
      (m) => openaiCompatible(config, { baseUrl, key, model: m, system, user }, onUsage),
      { isEmpty: (text) => !text, retry: RATE_LIMIT_RETRY },
    ).catch((err) => {
      // Todos responderam vazio: mantém o contrato de devolver "" (o agente cai para a lista bruta).
      if (err instanceof ModelChainError && err.failures.every((f) => f.reason === "empty")) return "";
      throw err;
    });

  return async (system, user) => {
    switch (config.aiProvider) {
      case "anthropic":
        return withRetry(() => anthropic(config, system, user, onUsage), RATE_LIMIT_RETRY);
      case "google":
        return withRetry(() => google(config, system, user, onUsage), RATE_LIMIT_RETRY);
      case "openai":
        return chain("https://api.openai.com/v1", config.openaiKey, config.openaiModel, system, user);
      case "compatible": {
        if (!config.aiBaseUrl) throw new Error("AI_BASE_URL é obrigatório com AI_PROVIDER=compatible");
        if (!config.aiModel) throw new Error("AI_MODEL é obrigatório com AI_PROVIDER=compatible");
        return chain(config.aiBaseUrl, config.aiKey, config.aiModel, system, user);
      }
      case "ollama":
        return chain(config.ollamaBaseUrl, "ollama", config.ollamaModel, system, user);
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

type OnUsage = CreateChatOptions["onUsage"];

const tokens = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

async function openaiCompatible(
  config: Config,
  request: OpenAiRequest,
  onUsage?: OnUsage,
): Promise<string> {
  const json = await postJson<{
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>(
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
      // Sem teto, um modelo que se perde em raciocínio ou repetição cobra até o limite do contexto.
      max_tokens: config.aiMaxTokens,
    },
  );
  if (json.usage)
    onUsage?.({
      provider: config.aiProvider,
      model: request.model,
      inputTokens: tokens(json.usage.prompt_tokens),
      outputTokens: tokens(json.usage.completion_tokens),
    });
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

async function anthropic(
  config: Config,
  system: string,
  user: string,
  onUsage?: OnUsage,
): Promise<string> {
  const json = await postJson<{
    content?: { text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  }>(
    config,
    "Anthropic",
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": config.anthropicKey, "anthropic-version": "2023-06-01" },
    {
      model: config.anthropicModel,
      max_tokens: config.aiMaxTokens,
      system,
      temperature: config.aiTemperature,
      messages: [{ role: "user", content: user }],
    },
  );
  if (json.usage)
    onUsage?.({
      provider: "anthropic",
      model: config.anthropicModel,
      inputTokens: tokens(json.usage.input_tokens),
      outputTokens: tokens(json.usage.output_tokens),
    });
  return joinText(json.content);
}

async function google(
  config: Config,
  system: string,
  user: string,
  onUsage?: OnUsage,
): Promise<string> {
  const json = await postJson<{
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  }>(
    config,
    "Gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`,
    { "x-goog-api-key": config.geminiKey },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: config.aiMaxTokens, temperature: config.aiTemperature },
    },
  );
  if (json.usageMetadata)
    onUsage?.({
      provider: "google",
      model: config.geminiModel,
      inputTokens: tokens(json.usageMetadata.promptTokenCount),
      // Raciocínio é cobrado como saída.
      outputTokens:
        tokens(json.usageMetadata.candidatesTokenCount) + tokens(json.usageMetadata.thoughtsTokenCount),
    });
  return joinText(json.candidates?.[0]?.content?.parts);
}
