export type Mode = "once" | "ingest" | "digest" | "loop" | "help";
export type Parsed = { mode: Mode; dryRun: boolean } | { error: string };

export const USAGE = `Uso: bun run src/index.ts [modo] [--dry-run]

Modos (um só):
  --once      coleta e envia o digest uma vez (padrão)
  --ingest    só coleta os feeds
  --digest    só monta e envia o digest
  --loop      agente contínuo (crons de ingestão e digest)
  --help, -h  mostra este texto

Flags:
  --dry-run   imprime o digest sem enviar e sem marcar itens (com --digest ou --once)`;

const MODES: Record<string, Mode> = {
  "--once": "once",
  "--ingest": "ingest",
  "--digest": "digest",
  "--loop": "loop",
  "--help": "help",
  "-h": "help",
};

/** Argumento errado vira erro, não um ciclo completo que envia digest por engano. */
export function parseArgs(argv: string[]): Parsed {
  const modes = new Set<Mode>();
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (MODES[arg]) modes.add(MODES[arg]);
    else return { error: `Argumento desconhecido: ${arg}` };
  }
  if (modes.size > 1) return { error: "Use apenas um modo por execução" };
  const mode = [...modes][0] ?? "once";
  if (dryRun && mode !== "digest" && mode !== "once") {
    return { error: "--dry-run só vale com --digest ou --once" };
  }
  return { mode, dryRun };
}
