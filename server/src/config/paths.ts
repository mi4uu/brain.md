import { homedir } from "node:os";
import { join } from "node:path";

// V44: XDG Base Directory Spec applied uniformly across macOS, Linux,
// Windows — no platform branching. Users get a single predictable
// default location regardless of OS.

const APP_DIR = "brain.md";

function xdg(envName: string, fallbackSubpath: string): string {
  const env = process.env[envName];
  if (env && env.trim() !== "") return env;
  return join(homedir(), fallbackSubpath);
}

export function getDefaultVaultDir(): string {
  // $XDG_DATA_HOME defaults to $HOME/.local/share per spec
  return join(xdg("XDG_DATA_HOME", ".local/share"), APP_DIR, "vault");
}

export function getDefaultSettingsDir(): string {
  // $XDG_CONFIG_HOME defaults to $HOME/.config per spec
  return join(xdg("XDG_CONFIG_HOME", ".config"), APP_DIR);
}
