import { resolve } from "node:path";
import { getDefaultVaultDir } from "./paths";
import type { CliOptions } from "../cli";

function boolEnv(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  return raw === "1" || raw.toLowerCase() === "true";
}

function resolveVaultDir(cli?: CliOptions): string {
  // V44 + V45: CLI > env > XDG default
  if (cli?.vaultDir && cli.vaultDir.trim() !== "") return resolve(cli.vaultDir);
  const env = process.env.VAULT_DIR;
  if (env && env.trim() !== "") return resolve(env);
  return getDefaultVaultDir();
}

function resolvePort(cli?: CliOptions): number {
  if (cli?.port !== undefined) return cli.port;
  return Number(process.env.PORT ?? 3000);
}

export interface AppConfig {
  vaultDir: string;
  port: number;
  brainDir: string;
  mediaDir: string;
  trashDir: string;
  indexFile: string;
  gitAutocommit: boolean;
  gitDebounceMs: number;
}

export function loadConfig(cli?: CliOptions): AppConfig {
  return {
    vaultDir: resolveVaultDir(cli),
    port: resolvePort(cli),
    brainDir: ".brain",
    mediaDir: ".media",
    trashDir: ".brain/trash",
    indexFile: ".brain/index.json",
    gitAutocommit: boolEnv("GIT_AUTOCOMMIT", true),
    gitDebounceMs: Number(process.env.GIT_AUTOCOMMIT_DEBOUNCE_MS ?? 15000),
  };
}

// Back-compat: module-level config used by app.ts when called without a CLI
// pre-parse. Reads env + XDG default but no CLI flags.
export const config: AppConfig = loadConfig();

export type Config = AppConfig;
