import type { AgentDeps, Topic } from "../types.ts";
import { createAgent } from "./agent.ts";
import { parseArgs, USAGE } from "./args.ts";

/**
 * CLI padrão dos agentes: `--ingest`, `--digest`, `--loop`, ou um ciclo único.
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
  if (mode === "ingest") {
    await agent.ingest();
  } else if (mode === "digest") {
    await agent.digest({ dryRun });
  } else if (mode === "loop") {
    await agent.ingest();
    agent.startLoop();
    return; // fica de pé; não fecha o store
  } else {
    await agent.runOnce({ dryRun });
  }
  agent.close();
}
