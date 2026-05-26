import { createApp } from "./app";
import { loadConfig } from "./config";
import { parseArgs, getUsage, CliError } from "./cli";
import { mkdir } from "node:fs/promises";

const VERSION = "0.1.0";

async function main() {
  let action;
  try {
    action = parseArgs(process.argv.slice(2));
  } catch (e) {
    const msg = e instanceof CliError ? e.message : String(e);
    process.stderr.write(`brain: ${msg}\n\nTry 'brain --help' for usage.\n`);
    process.exit(2);
  }

  if (action.kind === "help") {
    process.stdout.write(getUsage());
    process.exit(0);
  }
  if (action.kind === "version") {
    process.stdout.write(`brain ${VERSION}\n`);
    process.exit(0);
  }

  // V44: resolve config with cli > env > XDG default precedence
  const config = loadConfig(action.options);

  // mkdir -p so first run on a fresh XDG default doesn't crash
  await mkdir(config.vaultDir, { recursive: true });

  const { app, index, repo, autocommit, settings } = createApp({
    vaultDir: config.vaultDir,
    gitAutocommit: config.gitAutocommit,
    gitDebounceMs: config.gitDebounceMs,
  });

  const loaded = await settings.load();
  // settings.json overrides env defaults
  autocommit.setEnabled(loaded.git.autocommit);
  autocommit.setDebounceMs(loaded.git.debounceMs);

  if (autocommit.opts.enabled) {
    try {
      await repo.ensure();
    } catch (e) {
      console.warn("git init failed; autocommit disabled:", e);
      autocommit.setEnabled(false);
    }
  }
  await index.loadOrBuild();
  app.listen(config.port);
  console.log(`brain.md server :${config.port} → vault ${config.vaultDir}`);
}

void main();
