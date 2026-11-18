import { api } from "../api/client";
import type { GraphInput } from "./engine";

// The full graph and the local one share one fetch. A short TTL keeps the
// local graph from refetching on every note switch, and saves still show
// up quickly.
const TTL_MS = 15_000;
let cached: { at: number; data: Promise<GraphInput> } | null = null;

export function loadGraph(force = false): Promise<GraphInput> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.data;
  const data = api.graph();
  cached = { at: Date.now(), data };
  data.catch(() => {
    if (cached?.data === data) cached = null;
  });
  return data;
}
