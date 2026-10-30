import { Elysia } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { readFilterFor } from "./perm-guard";

export interface TaskItem {
  path: string;
  lineNo: number;
  done: boolean;
  text: string;
}

const TASK_RE = /^(\s*[-*+])\s+\[([ xX])\]\s+(.*)$/;

export function tasksRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia({ prefix: "/api" }).get("/tasks", async ({ request }) => {
    const allowed = await readFilterFor(vault, request);
    const out: TaskItem[] = [];
    for (const entry of index.entries()) {
      if (!allowed(entry.path)) continue;
      const lines = entry.body.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = (lines[i] ?? "").match(TASK_RE);
        if (!m) continue;
        out.push({
          path: entry.path,
          lineNo: i + 1,
          done: (m[2] ?? " ").toLowerCase() === "x",
          text: (m[3] ?? "").trim(),
        });
      }
    }
    return out;
  });
}
