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

// Host allowlist for passwordless mode (see api/host-middleware.ts).
// ALLOWED_HOSTS adds hostnames beyond loopback, e.g. a LAN name or a tunnel
// hostname when the server runs without a password.
const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function resolveAllowedHosts(): string[] {
  const extra = (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  return Array.from(new Set([...DEFAULT_ALLOWED_HOSTS, ...extra]));
}

// Git author identity for the single-owner ("local") subject: password
// login proves no name or email of its own, so a human-readable author
// needs a configured fallback instead of guessing from the OS user.
const DEFAULT_OWNER_NAME = "brain.md owner";
const DEFAULT_OWNER_EMAIL = "owner@brain.local";

export interface AppConfig {
  vaultDir: string;
  port: number;
  brainDir: string;
  mediaDir: string;
  trashDir: string;
  indexFile: string;
  gitAutocommit: boolean;
  gitDebounceMs: number;
  allowedHosts: string[];
  ownerName: string;
  ownerEmail: string;
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
    allowedHosts: resolveAllowedHosts(),
    ownerName: process.env.BRAINMD_OWNER_NAME?.trim() || DEFAULT_OWNER_NAME,
    ownerEmail: process.env.BRAINMD_OWNER_EMAIL?.trim() || DEFAULT_OWNER_EMAIL,
  };
}

// Back-compat: module-level config used by app.ts when called without a CLI
// pre-parse. Reads env + XDG default but no CLI flags.
export const config: AppConfig = loadConfig();

export type Config = AppConfig;
