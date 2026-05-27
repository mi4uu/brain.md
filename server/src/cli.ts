// V45: hand-rolled arg parser. No external dep.
// Returns parsed CLI options or a directive ("help" / "version") for the entry
// point to honour. Unknown flags throw `CliError`; caller decides exit code.

export interface CliOptions {
  vaultDir?: string;
  port?: number;
  mcpDisabled?: boolean;
}

export type CliAction =
  | { kind: "run"; options: CliOptions }
  | { kind: "help" }
  | { kind: "version" };

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

const USAGE = `Usage: brainmd [options]

A local-first second brain for you and your AI agents.

Options:
  -v, --vault-dir <path>   Path to the vault directory.
                           Default: $XDG_DATA_HOME/brain.md/vault
                                    ($HOME/.local/share/brain.md/vault)
  -p, --port <n>           HTTP port. Default: 3000
      --mcp-disabled       Don't mount the MCP server at /mcp/*
  -h, --help               Show this help and exit
      --version            Show version and exit

Environment:
  VAULT_DIR                 Same as --vault-dir (lower precedence than CLI)
  PORT                      Same as --port
  XDG_DATA_HOME             Base for default vault location
  XDG_CONFIG_HOME           Base for default settings location
  GIT_AUTOCOMMIT            "1" / "0" — bootstrap default
  GIT_AUTOCOMMIT_DEBOUNCE_MS

Precedence: CLI flag > env var > XDG default
`;

export function getUsage(): string {
  return USAGE;
}

function takeValue(
  argv: string[],
  i: number,
  flag: string,
): { value: string; nextIndex: number } {
  // support --flag=value and --flag value
  const cur = argv[i];
  if (cur === undefined) throw new CliError(`missing value for ${flag}`);
  const eq = cur.indexOf("=");
  if (eq > 0 && cur.startsWith("--")) {
    return { value: cur.slice(eq + 1), nextIndex: i + 1 };
  }
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("-")) {
    throw new CliError(`missing value for ${flag}`);
  }
  return { value: next, nextIndex: i + 2 };
}

export function parseArgs(argv: string[]): CliAction {
  const opts: CliOptions = {};
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === undefined) break;
    if (a === "-h" || a === "--help") return { kind: "help" };
    if (a === "--version") return { kind: "version" };
    if (a === "-v" || a === "--vault-dir" || a.startsWith("--vault-dir=")) {
      const { value, nextIndex } = takeValue(argv, i, "--vault-dir");
      opts.vaultDir = value;
      i = nextIndex;
      continue;
    }
    if (a === "--mcp-disabled") {
      opts.mcpDisabled = true;
      i++;
      continue;
    }
    if (a === "-p" || a === "--port" || a.startsWith("--port=")) {
      const { value, nextIndex } = takeValue(argv, i, "--port");
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new CliError(`invalid port: ${value}`);
      }
      opts.port = n;
      i = nextIndex;
      continue;
    }
    if (a.startsWith("-")) {
      throw new CliError(`unknown flag: ${a}`);
    }
    throw new CliError(`unexpected positional argument: ${a}`);
  }
  return { kind: "run", options: opts };
}
