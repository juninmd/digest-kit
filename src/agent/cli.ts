import type { Agent, AgentDeps, Topic } from "../types.ts";
import { createAgent } from "./agent.ts";
import { parseArgs, USAGE } from "./args.ts";

/** `--status`: só lê o banco. Não toca em feed, IA nem Telegram. */
function printStatus(agent: Agent, log: (msg: string) => void): void {
  const stats = agent.status();
  if (!stats) {
    log(`[status] ${agent.topic.name}: o store injetado não implementa stats()`);
    return;
  }
  log(
    `[status] ${agent.topic.name}: ${stats.pending} pendentes, ${stats.digested} enviados, ${stats.total} no total`,
  );
  log(`[status] última coleta: ${stats.lastFetchedAt ?? "nunca"}`);
}

/**
 * CLI padrão dos agentes: `--ingest`, `--digest`, `--loop`, `--status`, ou um ciclo único.
 * É o corpo inteiro do `src/index.ts` de um agente consumidor.
 */
export async function runAgent(
  topic: Topic,
  deps: AgentDeps = {},
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const { mode, dryRun } = parsed;
  if (mode === "help") {
    console.log(USAGE);
    return;
  }

  // Criado só depois de validar os argumentos: abre o banco e lê o ambiente.
  const agent = createAgent(topic, deps);
  let keepOpen = false;
  try {
    if (mode === "ingest") {
      await agent.ingest();
    } else if (mode === "digest") {
      await agent.digest({ dryRun });
    } else if (mode === "status") {
      printStatus(agent, deps.log ?? ((msg) => console.log(msg)));
    } else if (mode === "loop") {
      await agent.ingest();
      agent.startLoop();
      keepOpen = true; // fica de pé; os crons ainda usam o store
    } else {
      await agent.runOnce({ dryRun });
    }
  } finally {
    // Antes um erro no ciclo (ex.: Telegram fora do ar) pulava o close().
    if (!keepOpen) agent.close();
  }
}
