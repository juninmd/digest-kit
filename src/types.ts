export interface Feed {
  name: string;
  url: string;
}

/** Tudo o que muda de um agente para outro. É o único arquivo que o consumidor escreve. */
export interface Topic {
  /** slug do agente, usado em log */
  name: string;
  /** título do digest no Telegram */
  title: string;
  emoji: string;
  /** assunto, injetado no prompt do usuário */
  subject: string;
  systemPrompt: string;
  feeds: Feed[];
}

export interface Item {
  id: string;
  title: string;
  link: string;
  source: string;
  summary: string | null;
  published: string | null;
  fetched_at: string;
  digested: number;
}

export type NewItem = Omit<Item, "digested">;

export type AiProvider = "ollama" | "openai" | "anthropic" | "google" | "compatible";

export interface Config {
  aiProvider: AiProvider;
  /** provider "compatible": qualquer gateway OpenAI-compatible (LiteLLM, vLLM, Groq…) */
  aiBaseUrl: string;
  aiKey: string;
  aiModel: string;
  aiTemperature: number;
  aiMaxTokens: number;

  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiKey: string;
  openaiModel: string;
  anthropicKey: string;
  anthropicModel: string;
  geminiKey: string;
  geminiModel: string;

  telegramToken: string;
  telegramChatIds: string[];

  cronIngestion: string;
  cronDigest: string;

  dbPath: string;
  maxItemsPerFeed: number;
  digestMaxItems: number;
  feedTimeoutMs: number;
  timezone: string;
  locale: string;
}

/** Chat single-shot: (system, user) -> texto. */
export type ChatFn = (system: string, user: string) => Promise<string>;

/** Envio de mensagem já formatada em Markdown. */
export type SendFn = (text: string) => Promise<void>;

export interface ParsedFeedItem {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
}

/** Busca e parseia um feed. Injetável para teste — nada de rede nos testes. */
export type FetchFeedFn = (feed: Feed) => Promise<ParsedFeedItem[]>;

export interface Store {
  insertItem(row: NewItem): boolean;
  pendingItems(limit: number): Item[];
  markDigested(ids: string[]): void;
  close(): void;
}

export interface AgentDeps {
  config?: Partial<Config>;
  chat?: ChatFn;
  send?: SendFn;
  fetchFeed?: FetchFeedFn;
  store?: Store;
  /** relógio injetável — os testes precisam de data estável */
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface Agent {
  topic: Topic;
  config: Config;
  store: Store;
  /** Lê todos os feeds e grava os itens novos. Retorna quantos entraram. */
  ingest(): Promise<number>;
  /** Monta o digest dos itens pendentes, envia e marca como enviados. */
  digest(): Promise<string | null>;
  /** ingest + digest, uma vez. */
  runOnce(): Promise<void>;
  /** agenda os dois crons e fica de pé. Retorna uma função para parar. */
  startLoop(): () => void;
  close(): void;
}
