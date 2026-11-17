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
  /** teto de espera por resposta do provider, em ms; 0 desliga. Padrão: 300000 */
  aiTimeoutMs?: number;
  /** modelos tentados em ordem se o principal falhar ou vier vazio (openai, compatible, ollama) */
  aiFallbackModels?: string[];

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
  /** quantos feeds são lidos ao mesmo tempo. Padrão: 8 */
  feedConcurrency?: number;
  timezone: string;
  locale: string;
  /** pendente mais velho que isso (horas) sai da fila sem ser enviado; 0 desliga. Padrão: 48 */
  pendingTtlHours?: number;
  /** teto de itens de uma mesma fonte por digest. Padrão: 4 */
  maxItemsPerSource?: number;
  /** o modelo cita `[n]` e o link entra depois, em vez de mandar URLs ao modelo. Padrão: true */
  digestLinkRefs?: boolean;
  /** itens enviados há mais dias que isso perdem o resumo (o id fica para a deduplicação); 0 desliga. Padrão: 30 */
  retentionDays?: number;
}

/** Tokens de uma chamada, quando o provider informa. */
export interface ChatUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
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

export interface StoreStats {
  total: number;
  pending: number;
  digested: number;
  /** `fetched_at` mais recente, ou null com o banco vazio */
  lastFetchedAt: string | null;
}

/**
 * Contrato mínimo de persistência. `insertItems` e `stats` são opcionais para
 * que um store próprio escrito contra a 0.4 continue válido; o agente usa os
 * dois quando existem.
 */
export interface Store {
  insertItem(row: NewItem): boolean;
  /** Grava o lote numa transação só. Retorna quantos eram novos. */
  insertItems?(rows: NewItem[]): number;
  pendingItems(limit: number): Item[];
  markDigested(ids: string[]): void;
  stats?(): StoreStats;
  /** Quais destes ids já existem no banco (qualquer estado). */
  knownIds?(ids: string[]): Set<string>;
  /** Tira da fila (sem enviar) os pendentes coletados antes de `before` (ISO). Retorna quantos. */
  expirePending?(before: string): number;
  /** Apaga o resumo dos enviados antes de `before` (ISO); a linha fica para a deduplicação. */
  compactDigested?(before: string): number;
  close(): void;
}

/** O store de `createStore`: implementa também as operações opcionais. */
export interface SqliteStore extends Store {
  insertItems(rows: NewItem[]): number;
  stats(): StoreStats;
  knownIds(ids: string[]): Set<string>;
  expirePending(before: string): number;
  compactDigested(before: string): number;
}

/** O que um digest entregou — para arquivar em outro lugar (ex.: second brain). */
export interface DigestEvent {
  topic: Topic;
  message: string;
  items: Item[];
}

export interface DigestOptions {
  /** monta a mensagem e devolve sem enviar, sem marcar itens e sem `onDigest` */
  dryRun?: boolean;
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
  /** chamado após um envio bem-sucedido; falha aqui só gera log, não desfaz o envio */
  onDigest?: (event: DigestEvent) => Promise<void>;
}

export interface Agent {
  topic: Topic;
  config: Config;
  store: Store;
  /** Lê todos os feeds e grava os itens novos. Retorna quantos entraram. */
  ingest(): Promise<number>;
  /** Monta o digest dos itens pendentes, envia e marca como enviados. */
  digest(options?: DigestOptions): Promise<string | null>;
  /** ingest + digest, uma vez. */
  runOnce(options?: DigestOptions): Promise<void>;
  /** agenda os dois crons e fica de pé. Retorna uma função para parar. */
  startLoop(): () => void;
  /** Contagem da fila, ou null se o store injetado não implementa `stats`. */
  status(): StoreStats | null;
  close(): void;
}
