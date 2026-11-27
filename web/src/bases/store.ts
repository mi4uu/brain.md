import type { BaseQueryResponse } from "@brainmd/shared/base-types";

const STATE_LIMIT = 200;
const active = new Map<string, string>();

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > STATE_LIMIT) map.delete(map.keys().next().value as string);
}
const cache = new Map<string, { fingerprint: string; result: BaseQueryResponse }>();
const listeners = new Set<() => void>();
const CACHE_LIMIT = 40;

// Preview replaces its HTML on every edit, which destroys the mounted views.
// What the user picked, the open popover and the last result live here so a
// fresh mount continues where the old one stopped.
export const blockKey = (notePath: string | null, ordinal: number): string => `${notePath ?? ""}#${ordinal}`;

export const getActiveView = (key: string): string | undefined => active.get(key);
export const setActiveView = (key: string, name: string): void => remember(active, key, name);

export function getCached(key: string, fingerprint: string): BaseQueryResponse | undefined {
  const hit = cache.get(key);
  return hit && hit.fingerprint === fingerprint ? hit.result : undefined;
}

// The last result for a block whatever its fingerprint, so a remount after an
// edit paints the old rows at once while the new query runs.
export const getLast = (key: string): BaseQueryResponse | undefined => cache.get(key)?.result;

const openTools = new Map<string, string>();
export const getOpenTool = (key: string): string | null => openTools.get(key) ?? null;
export function setOpenTool(key: string, tool: string | null): void {
  if (tool === null) openTools.delete(key);
  else remember(openTools, key, tool);
}

export function setCached(key: string, fingerprint: string, result: BaseQueryResponse): void {
  cache.delete(key);
  cache.set(key, { fingerprint, result });
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

export function onBaseRefresh(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitBaseRefresh(): void {
  for (const fn of [...listeners]) fn();
}
