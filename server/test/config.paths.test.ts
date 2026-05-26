import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getDefaultVaultDir,
  getDefaultSettingsDir,
} from "../src/config/paths";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("XDG defaults — V44", () => {
  test("getDefaultVaultDir falls back to $HOME/.local/share/brain.md/vault", () => {
    expect(getDefaultVaultDir()).toBe(
      join(homedir(), ".local/share", "brain.md", "vault"),
    );
  });

  test("getDefaultSettingsDir falls back to $HOME/.config/brain.md", () => {
    expect(getDefaultSettingsDir()).toBe(
      join(homedir(), ".config", "brain.md"),
    );
  });

  test("XDG_DATA_HOME overrides vault default", () => {
    process.env.XDG_DATA_HOME = "/tmp/xdgdata";
    expect(getDefaultVaultDir()).toBe("/tmp/xdgdata/brain.md/vault");
  });

  test("XDG_CONFIG_HOME overrides settings default", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdgconfig";
    expect(getDefaultSettingsDir()).toBe("/tmp/xdgconfig/brain.md");
  });

  test("empty XDG_DATA_HOME treated as unset", () => {
    process.env.XDG_DATA_HOME = "   ";
    expect(getDefaultVaultDir()).toBe(
      join(homedir(), ".local/share", "brain.md", "vault"),
    );
  });
});
