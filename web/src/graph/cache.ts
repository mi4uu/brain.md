import { api, setAfterMutation } from "../api/client";
import { onTokenChange } from "../auth/token";
import type { GraphInput } from "./engine";

// The full graph and the local one share one fetch. A short TTL keeps the
// local graph from refetching on every note switch; note writes and a
// changed login drop the cache at once and tell mounted graphs to reload.
const TTL_MS = 15_000;
let cached: { at: number; data: Promise<GraphInput> } | null = null;
const listeners = new Set<() => void>();

export function loadGraph(force = false): Promise<GraphInput> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.data;
  const data = api.graph();
  cached = { at: Date.now(), data };
  data.catch(() => {
    if (cached?.data === data) cached = null;
  });
  return data;
}

export function invalidateGraph(): void {
  cached = null;
  for (const l of listeners) l();
}

export function onGraphInvalidated(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

onTokenChange(() => invalidateGraph());

// Autosave writes often; drop the cache at once but tell mounted graphs to
// reload only after typing pauses.
let pending: ReturnType<typeof setTimeout> | null = null;
setAfterMutation(() => {
  cached = null;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    invalidateGraph();
  }, 2000);
});
