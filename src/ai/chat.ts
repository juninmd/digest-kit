import type { ChatFn, ChatUsage, Config } from "../types.ts";
import { isRateLimitError } from "../util/retry.ts";
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
 * Chat single-shot via LiteLLM (API OpenAI). "ollama" fica só para rodar local.
 * `aiFallbackModels` vira uma cadeia: erro ou resposta vazia passa ao próximo modelo.
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
      case "litellm":
      case "compatible": {
        if (!config.aiBaseUrl) throw new Error(`AI_BASE_URL é obrigatório com AI_PROVIDER=${config.aiProvider}`);
        if (!config.aiModel) throw new Error(`AI_MODEL é obrigatório com AI_PROVIDER=${config.aiProvider}`);
        return chain(config.aiBaseUrl, config.aiKey, config.aiModel, system, user);
      }
      case "ollama":
        return chain(config.ollamaBaseUrl, "ollama", config.ollamaModel, system, user);
      default:
        // Provedores diretos (openai, anthropic, google) saíram: tudo passa pelo LiteLLM.
        // Antes um nome digitado errado caía em silêncio no Ollama local.
        throw new Error(
          `AI_PROVIDER desconhecido: "${config.aiProvider}" (use litellm, ou ollama para rodar local)`,
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
