// V53: client-side token storage + fetch wrapper. Token persists in
// localStorage (device-local), gets attached to every /api/* + /mcp/*
// request via the wrapped fetch installed at module load.

const KEY = "brain.auth.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(KEY, token);
  else window.localStorage.removeItem(KEY);
  for (const l of listeners) l(token);
}

type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();
export function onTokenChange(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// Install a fetch wrapper exactly once. Adds Authorization header
// when a same-origin /api/* or /mcp/* request is made and we have a token.
let installed = false;
export function installAuthFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const isApi = url.startsWith("/api/") || url.startsWith("/mcp");
    const tok = getToken();
    if (!isApi || !tok) return original(input, init);
    const next: RequestInit = { ...(init ?? {}) };
    const headers = new Headers(next.headers ?? {});
    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${tok}`);
    }
    next.headers = headers;
    return original(input, next);
  };
}
