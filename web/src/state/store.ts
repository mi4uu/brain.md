import { useCallback, useEffect, useState } from "react";

type Listener = () => void;

export class Store<T> {
  private value: T;
  private listeners = new Set<Listener>();
  constructor(initial: T) {
    this.value = initial;
  }
  get(): T {
    return this.value;
  }
  set(next: T | ((prev: T) => T)): void {
    const v =
      typeof next === "function" ? (next as (p: T) => T)(this.value) : next;
    if (v === this.value) return;
    this.value = v;
    for (const l of this.listeners) l();
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

export function useStore<T>(store: Store<T>): T {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const getSnap = useCallback(() => store.get(), [store]);
  return useSyncExternalStoreCompat(subscribe, getSnap);
}

// React 18 includes useSyncExternalStore — use it.
import { useSyncExternalStore } from "react";
function useSyncExternalStoreCompat<T>(
  sub: (cb: () => void) => () => void,
  get: () => T,
): T {
  return useSyncExternalStore(sub, get, get);
}

export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });
  const setter = useCallback(
    (v: T) => {
      setVal(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // ignore
      }
    },
    [key],
  );
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setVal(JSON.parse(raw) as T);
    } catch {
      // ignore
    }
  }, [key]);
  return [val, setter];
}
