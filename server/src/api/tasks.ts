import { Elysia } from "elysia";
import type { VaultIndex } from "../index/index";

export interface TaskItem {
  path: string;
  lineNo: number;
  done: boolean;
  text: string;
}

const TASK_RE = /^(\s*[-*+])\s+\[([ xX])\]\s+(.*)$/;

export function tasksRoutes(index: VaultIndex) {
  return new Elysia({ prefix: "/api" }).get("/tasks", () => {
    const out: TaskItem[] = [];
    for (const entry of index.entries()) {
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
