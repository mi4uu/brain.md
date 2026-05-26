import { createApp } from "./app";
import { config } from "./config";
import { mkdir } from "node:fs/promises";

async function main() {
  await mkdir(config.vaultDir, { recursive: true });
  const { app, index, repo, autocommit, settings } = createApp();

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
