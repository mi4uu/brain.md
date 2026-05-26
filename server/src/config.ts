import { resolve } from "node:path";

const cwd = process.cwd();

function resolveVaultDir(): string {
  const raw = process.env.VAULT_DIR;
  if (!raw || raw.trim() === "") return resolve(cwd, "../vault");
  return resolve(raw);
}

function boolEnv(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  return raw === "1" || raw.toLowerCase() === "true";
}

export const config = {
  vaultDir: resolveVaultDir(),
  port: Number(process.env.PORT ?? 3000),
  brainDir: ".brain",
  mediaDir: ".media",
  trashDir: ".brain/trash",
  indexFile: ".brain/index.json",
  gitAutocommit: boolEnv("GIT_AUTOCOMMIT", true),
  gitDebounceMs: Number(process.env.GIT_AUTOCOMMIT_DEBOUNCE_MS ?? 15000),
} as const;

export type Config = typeof config;
