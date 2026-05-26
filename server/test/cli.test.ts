import { describe, test, expect } from "bun:test";
import { parseArgs, CliError } from "../src/cli";

describe("CLI parser — V45", () => {
  test("no args → run with empty options", () => {
    expect(parseArgs([])).toEqual({ kind: "run", options: {} });
  });

  test("--help → help action", () => {
    expect(parseArgs(["--help"]).kind).toBe("help");
  });

  test("-h short form → help", () => {
    expect(parseArgs(["-h"]).kind).toBe("help");
  });

  test("--version → version action", () => {
    expect(parseArgs(["--version"]).kind).toBe("version");
  });

  test("--vault-dir <path>", () => {
    const r = parseArgs(["--vault-dir", "/tmp/v"]);
    expect(r).toEqual({ kind: "run", options: { vaultDir: "/tmp/v" } });
  });

  test("-v short form", () => {
    expect(parseArgs(["-v", "/tmp/v"])).toEqual({
      kind: "run",
      options: { vaultDir: "/tmp/v" },
    });
  });

  test("--vault-dir=<path> with equals", () => {
    expect(parseArgs(["--vault-dir=/tmp/v"])).toEqual({
      kind: "run",
      options: { vaultDir: "/tmp/v" },
    });
  });

  test("--port <n>", () => {
    expect(parseArgs(["--port", "4000"])).toEqual({
      kind: "run",
      options: { port: 4000 },
    });
  });

  test("-p short form", () => {
    expect(parseArgs(["-p", "5000"])).toEqual({
      kind: "run",
      options: { port: 5000 },
    });
  });

  test("--port=<n> with equals", () => {
    expect(parseArgs(["--port=4242"])).toEqual({
      kind: "run",
      options: { port: 4242 },
    });
  });

  test("both flags combined", () => {
    expect(parseArgs(["-v", "/x", "-p", "9000"])).toEqual({
      kind: "run",
      options: { vaultDir: "/x", port: 9000 },
    });
  });

  test("unknown flag → CliError", () => {
    expect(() => parseArgs(["--zzz"])).toThrow(CliError);
  });

  test("missing value for --vault-dir → CliError", () => {
    expect(() => parseArgs(["--vault-dir"])).toThrow(CliError);
  });

  test("port followed by flag → CliError (missing value)", () => {
    expect(() => parseArgs(["--port", "--help"])).toThrow(CliError);
  });

  test("non-integer port → CliError", () => {
    expect(() => parseArgs(["--port", "abc"])).toThrow(CliError);
  });

  test("out-of-range port → CliError", () => {
    expect(() => parseArgs(["--port", "70000"])).toThrow(CliError);
    expect(() => parseArgs(["--port", "0"])).toThrow(CliError);
  });

  test("positional argument → CliError", () => {
    expect(() => parseArgs(["foo"])).toThrow(CliError);
  });
});
