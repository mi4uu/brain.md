import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp, type AppHandle } from "../src/app";

let dir!: string;
let handle!: AppHandle;
let client!: Client;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-conflict-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      handle.app.handle(new Request(input, init))) as unknown as typeof fetch,
  });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
});
afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, body: JSON.parse((r.content as Array<{ text: string }>)[0]!.text) };
}

describe("write conflicts between agents", () => {
  test("write_note with the revision it read succeeds; a stale one is refused", async () => {
    await call("write_note", { path: "plan.md", content: "v1\n" });
    const read = await call("read_note", { path: "plan.md" });
    const rev = read.body.revision as string;

    // Another agent edits in between.
    await call("write_note", { path: "plan.md", content: "v1\nother agent\n" });

    const stale = await call("write_note", { path: "plan.md", content: "v2 mine\n", base_revision: rev });
    expect(stale.isError).toBe(true);
    expect(stale.body.code).toBe("CONFLICT");
    expect(typeof stale.body.current_revision).toBe("string");
    expect((await handle.vault.readNote("plan.md")).content).toBe("v1\nother agent\n");

    const fresh = await call("write_note", {
      path: "plan.md",
      content: "v1\nother agent\nmine\n",
      base_revision: stale.body.current_revision,
    });
    expect(fresh.isError).toBe(false);
  });

  test("write_note without base_revision still overwrites, as before", async () => {
    await call("write_note", { path: "a.md", content: "one\n" });
    const r = await call("write_note", { path: "a.md", content: "two\n" });
    expect(r.isError).toBe(false);
  });

  test("create_only refuses to overwrite an existing note", async () => {
    await writeFile(join(dir, "taken.md"), "mine\n");
    const r = await call("write_note", { path: "taken.md", content: "theirs\n", create_only: true });
    expect(r.isError).toBe(true);
    expect(r.body.code).toBe("CONFLICT");
    expect((await call("write_note", { path: "new.md", content: "x\n", create_only: true })).isError).toBe(false);
  });

  test("append_note with a stale base_revision is refused; without one appends as before", async () => {
    await call("write_note", { path: "log.md", content: "start\n" });
    const rev = (await call("read_note", { path: "log.md" })).body.revision as string;
    await call("append_note", { path: "log.md", content: "agent A" });
    const stale = await call("append_note", { path: "log.md", content: "agent B", base_revision: rev });
    expect(stale.body.code).toBe("CONFLICT");
    const plain = await call("append_note", { path: "log.md", content: "agent B" });
    expect(plain.isError).toBe(false);
    expect((await handle.vault.readNote("log.md")).content).toBe("start\n\nagent A\n\nagent B\n");
  });
});
