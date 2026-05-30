import { useCallback, useEffect, useState } from "react";
import type { Theme } from "../hooks/useTheme";
import { gitApi } from "../api/git";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Switch } from "./ui/switch";
import { useAuth } from "../hooks/useAuth";

interface RagConfigUI {
  enabled: boolean;
  provider: "local" | "openai-compat";
  local: { model: string; dim: number };
  openaiCompat: { baseURL: string; model: string; apiKey?: string; dim: number };
}

interface RagStatusUI {
  enabled: boolean;
  provider: "local" | "openai-compat";
  model: string;
  dim: number;
  chunks: number;
  lastIndexedAt: number | null;
  needsReindex: boolean;
  lastError: string | null;
}

interface Props {
  onClose: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  dailyDir: string;
  setDailyDir: (s: string) => void;
}

export function Settings({
  onClose,
  theme,
  setTheme,
  dailyDir,
  setDailyDir,
}: Props) {
  const [acEnabled, setAcEnabled] = useState<boolean>(true);
  const [acDebounce, setAcDebounce] = useState<number>(15000);
  const [acError, setAcError] = useState<string | null>(null);
  const [gitEnabled, setGitEnabled] = useState<boolean>(false);

  useEffect(() => {
    void gitApi
      .status()
      .then((s) => {
        setGitEnabled(s.enabled);
        setAcEnabled(s.autocommit.enabled);
        setAcDebounce(s.autocommit.debounceMs);
      })
      .catch(() => setGitEnabled(false));
  }, []);

  const saveAutocommit = async (next: { enabled?: boolean; debounceMs?: number }) => {
    try {
      const res = await gitApi.setAutocommit(next);
      setAcEnabled(res.enabled);
      setAcDebounce(res.debounceMs);
      setAcError(null);
    } catch (e) {
      setAcError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Vault, editor, git, AI, security, and appearance preferences.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="appearance" className="mt-2">
          <TabsList>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="vault">Vault</TabsTrigger>
            <TabsTrigger value="git">Git</TabsTrigger>
            <TabsTrigger value="ai">AI / RAG</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="editor">Editor</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="space-y-4 pt-2">
            <Field label="Theme">
              <select
                className="input"
                value={theme}
                onChange={(e) => setTheme(e.target.value as Theme)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Field>
          </TabsContent>

          <TabsContent value="vault" className="space-y-4 pt-2">
            <Field label="Daily notes folder">
              <input
                className="input"
                value={dailyDir}
                onChange={(e) => setDailyDir(e.target.value)}
                placeholder="Journal"
              />
            </Field>
          </TabsContent>

          <TabsContent value="git" className="space-y-4 pt-2">
            {!gitEnabled ? (
              <p className="text-sm text-fg-3">
                Git not initialised in vault. Restart server with{" "}
                <code className="rounded-1 bg-code px-1 py-0.5 font-mono text-xs">
                  GIT_AUTOCOMMIT=1
                </code>{" "}
                to enable.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 text-sm text-fg-1">
                  <span>Autocommit changes</span>
                  <Switch
                    checked={acEnabled}
                    onCheckedChange={(c) => void saveAutocommit({ enabled: c })}
                    aria-label="Autocommit changes"
                  />
                </div>
                <Field label="Debounce (ms)">
                  <input
                    className="input"
                    type="number"
                    min={500}
                    step={500}
                    value={acDebounce}
                    onChange={(e) => setAcDebounce(Number(e.target.value))}
                    onBlur={() => void saveAutocommit({ debounceMs: acDebounce })}
                  />
                </Field>
                {acError ? (
                  <p className="text-sm text-callout-danger">{acError}</p>
                ) : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="ai" className="space-y-4 pt-2">
            <RagPanel />
          </TabsContent>

          <TabsContent value="security" className="space-y-4 pt-2">
            <SecurityPanel />
          </TabsContent>

          <TabsContent value="editor" className="space-y-4 pt-2">
            <p className="text-sm text-fg-3">No editor preferences yet.</p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-fg-3">{label}</span>
      {children}
    </label>
  );
}

// V59: persistent error banner shown in the RAG panel when the embedder
// probe fails. Includes a "Search for help" link with a generically-scrubbed
// version of the error so users find Stack Overflow / GitHub issue threads.
function buildSearchQuery(err: string): string {
  // Strip leading prefixes our own code adds, then keep the part most
  // likely to be a stable, googleable identifier (lib names, exception
  // class names, file refs). Cap length so the URL stays small.
  const cleaned = err
    .replace(/^.*Original error:\s*/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\/Users\/[^\s'"]+|\/home\/[^\s'"]+|C:\\[^\s'"]+/g, "")
    .replace(/at\s+\S+\.\S+\s*\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned || err.slice(0, 200);
}

function RagErrorBanner({ error }: { error: string }) {
  const q = buildSearchQuery(error);
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`brain.md ${q}`)}`;
  return (
    <div
      role="alert"
      className="rounded-2 border border-callout-danger/40 bg-callout-danger/10 p-3 text-sm text-fg-1"
    >
      <div className="font-semibold text-callout-danger">RAG not working</div>
      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg-2">
        {error}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link underline hover:text-accent"
        >
          Search the error on Google
        </a>
        <span className="text-fg-3">
          Tip: try switching the provider to <em>OpenAI-compatible</em> + Ollama (
          <code>ollama pull nomic-embed-text</code>).
        </span>
      </div>
    </div>
  );
}

// -------- T110 RAG panel --------

function RagPanel() {
  const [cfg, setCfg] = useState<RagConfigUI | null>(null);
  const [status, setStatus] = useState<RagStatusUI | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([
        fetch("/api/settings").then((r) => r.json()),
        fetch("/api/rag/status").then((r) => r.json()),
      ]);
      setCfg(s.rag);
      setStatus(st);
    } catch (e) {
      setMsg(`Load failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (patch: Partial<RagConfigUI>) => {
    if (!cfg) return;
    setBusy(true);
    try {
      const next = { ...cfg, ...patch };
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rag: next }),
      });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      setCfg(next);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!cfg) return;
    setBusy(true);
    setMsg("Testing…");
    try {
      const r = await fetch("/api/rag/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: cfg.provider,
          local: cfg.provider === "local" ? cfg.local : undefined,
          openaiCompat:
            cfg.provider === "openai-compat" ? cfg.openaiCompat : undefined,
        }),
      });
      const j = await r.json();
      setMsg(j.ok ? `OK — dim=${j.dim}` : `Failed — ${j.error ?? "unknown"}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reindex = async () => {
    setBusy(true);
    setMsg("Reindexing…");
    try {
      const r = await fetch("/api/rag/reindex", { method: "POST" });
      const j = await r.json();
      setMsg(
        j.ok
          ? `Indexed ${j.indexed} notes (${j.skipped} skipped) in ${j.durationMs}ms`
          : `Failed — ${j.error ?? "unknown"}`,
      );
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <p className="text-sm text-fg-3">Loading…</p>;

  return (
    <div className="space-y-4">
      {/* div, not <label> — wrapping a Radix Switch (renders <button>) in
          <label> makes browsers forward the label click to the button AND
          fire the underlying click, toggling state twice → no-op. */}
      <div className="flex items-center justify-between gap-3 text-sm text-fg-1">
        <span>Enable RAG</span>
        <Switch
          checked={cfg.enabled}
          onCheckedChange={(c) => void save({ enabled: c })}
          aria-label="Enable RAG"
        />
      </div>
      {cfg.enabled && status?.lastError ? (
        <RagErrorBanner error={status.lastError} />
      ) : null}
      <Field label="Provider">
        <select
          className="input"
          value={cfg.provider}
          onChange={(e) =>
            void save({ provider: e.target.value as RagConfigUI["provider"] })
          }
        >
          <option value="local">Local (Xenova / bge-small)</option>
          <option value="openai-compat">OpenAI-compatible (Ollama, LM Studio, OpenAI)</option>
        </select>
      </Field>
      {cfg.provider === "local" ? (
        <>
          <Field label="Model">
            <input
              className="input"
              value={cfg.local.model}
              onChange={(e) =>
                setCfg({ ...cfg, local: { ...cfg.local, model: e.target.value } })
              }
              onBlur={() => void save({ local: cfg.local })}
            />
          </Field>
          <Field label="Dim">
            <input
              className="input"
              type="number"
              value={cfg.local.dim}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  local: { ...cfg.local, dim: Number(e.target.value) },
                })
              }
              onBlur={() => void save({ local: cfg.local })}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="Base URL">
            <input
              className="input"
              value={cfg.openaiCompat.baseURL}
              placeholder="http://localhost:11434/v1"
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  openaiCompat: { ...cfg.openaiCompat, baseURL: e.target.value },
                })
              }
              onBlur={() => void save({ openaiCompat: cfg.openaiCompat })}
            />
          </Field>
          <Field label="Model">
            <input
              className="input"
              value={cfg.openaiCompat.model}
              placeholder="nomic-embed-text"
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  openaiCompat: { ...cfg.openaiCompat, model: e.target.value },
                })
              }
              onBlur={() => void save({ openaiCompat: cfg.openaiCompat })}
            />
          </Field>
          <Field label="API key (optional)">
            <input
              className="input"
              type="password"
              value={cfg.openaiCompat.apiKey ?? ""}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  openaiCompat: { ...cfg.openaiCompat, apiKey: e.target.value },
                })
              }
              onBlur={() => void save({ openaiCompat: cfg.openaiCompat })}
            />
          </Field>
          <Field label="Dim">
            <input
              className="input"
              type="number"
              value={cfg.openaiCompat.dim}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  openaiCompat: {
                    ...cfg.openaiCompat,
                    dim: Number(e.target.value),
                  },
                })
              }
              onBlur={() => void save({ openaiCompat: cfg.openaiCompat })}
            />
          </Field>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={test}
          className="rounded-1 border border-border px-3 py-1 text-sm text-fg-1 hover:bg-hover disabled:opacity-50"
        >
          Test connection
        </button>
        <button
          type="button"
          disabled={busy || !cfg.enabled}
          onClick={reindex}
          className="rounded-1 bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
        >
          Reindex vault
        </button>
        {status ? (
          <span className="ml-auto text-xs text-fg-3">
            {status.chunks} chunks · {status.provider} · {status.model}
            {status.needsReindex ? " · needs reindex" : ""}
          </span>
        ) : null}
      </div>
      {msg ? <p className="text-sm text-fg-3">{msg}</p> : null}
    </div>
  );
}

// -------- T116 Security panel --------

function SecurityPanel() {
  const auth = useAuth();
  const [next, setNext] = useState("");
  const [current, setCurrent] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const set = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const ok = await auth.setPassword(next, auth.configured ? current : undefined);
    setMsg(ok ? "Password updated. Sign in again." : auth.error ?? "Failed");
    if (ok) {
      setNext("");
      setCurrent("");
    }
  };

  const clear = async () => {
    setMsg(null);
    const ok = await auth.clearPassword(current);
    setMsg(ok ? "Password removed. Auth is now off." : auth.error ?? "Failed");
    if (ok) setCurrent("");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-2">
        Status:{" "}
        <strong>
          {auth.loading ? "…" : auth.configured ? "password set" : "no auth"}
        </strong>
      </p>
      <form onSubmit={set} className="space-y-3">
        {auth.configured ? (
          <Field label="Current password">
            <input
              className="input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </Field>
        ) : null}
        <Field label={auth.configured ? "New password" : "Set password"}>
          <input
            className="input"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            minLength={4}
            placeholder="≥ 4 chars"
            required
          />
        </Field>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!next}
            className="rounded-1 bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
          >
            {auth.configured ? "Change password" : "Set password"}
          </button>
          {auth.configured ? (
            <button
              type="button"
              disabled={!current}
              onClick={clear}
              className="rounded-1 border border-callout-danger/40 px-3 py-1 text-sm text-callout-danger hover:bg-callout-danger/10 disabled:opacity-50"
            >
              Remove password
            </button>
          ) : null}
        </div>
      </form>
      {msg ? <p className="text-sm text-fg-3">{msg}</p> : null}

      <APIKeysPanel />
    </div>
  );
}

// -------- V66 API Keys panel --------

interface PublicAPIKey {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  prefix: string;
}

function APIKeysPanel() {
  const [keys, setKeys] = useState<PublicAPIKey[]>([]);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [justCreated, setJustCreated] = useState<{ name: string; token: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    try {
      const r = await fetch("/api/auth/keys");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { keys: PublicAPIKey[] };
      setKeys(data.keys);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const body: { name: string; expiresInDays?: number } = { name };
      const days = Number(expiresInDays);
      if (Number.isFinite(days) && days > 0) body.expiresInDays = days;
      const r = await fetch("/api/auth/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const created = (await r.json()) as { name: string; token: string };
      setJustCreated({ name: created.name, token: created.token });
      setName("");
      setExpiresInDays("");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this API key? Any client using it will start getting 401.")) return;
    setErr(null);
    try {
      const r = await fetch(`/api/auth/keys/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mt-6 space-y-3 border-t border-divider pt-4">
      <div>
        <h3 className="text-sm font-semibold">API Keys</h3>
        <p className="mt-1 text-xs text-fg-3">
          Long-lived bearer tokens for MCP clients (Claude Code, Cursor, curl scripts).
          Each key has a name and can be revoked individually. Tokens survive server restarts.
        </p>
      </div>

      <form onSubmit={generate} className="flex flex-wrap items-end gap-2">
        <Field label="Name">
          <input
            className="input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Claude Code laptop"
            required
            minLength={1}
            maxLength={200}
          />
        </Field>
        <Field label="Expires in days (optional)">
          <input
            className="input w-32"
            type="number"
            min={1}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            placeholder="never"
          />
        </Field>
        <button
          type="submit"
          disabled={!name}
          className="rounded-1 bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
        >
          Generate
        </button>
      </form>

      {justCreated ? (
        <div className="space-y-2 rounded-1 border border-accent/40 bg-accent/10 p-3">
          <p className="text-xs font-medium text-fg-1">
            Key <strong>{justCreated.name}</strong> created. Copy it now — the full
            token is shown ONCE and never again.
          </p>
          <code className="block w-full select-all break-all rounded-1 bg-app px-2 py-1 font-mono text-xs">
            {justCreated.token}
          </code>
          <button
            type="button"
            className="text-xs text-fg-3 underline"
            onClick={() => setJustCreated(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <p className="text-xs text-fg-3">No API keys yet.</p>
      ) : (
        <ul className="space-y-1">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 rounded-1 border border-divider px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-fg-1">{k.name}</div>
                <div className="mt-0.5 text-fg-3">
                  <code className="font-mono">{k.prefix}…</code> · created{" "}
                  {new Date(k.createdAt).toLocaleString()}{" "}
                  {k.lastUsedAt
                    ? `· last used ${new Date(k.lastUsedAt).toLocaleString()}`
                    : "· never used"}
                  {k.expiresAt
                    ? ` · expires ${new Date(k.expiresAt).toLocaleString()}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revoke(k.id)}
                className="rounded-1 border border-callout-danger/40 px-2 py-1 text-callout-danger hover:bg-callout-danger/10"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {err ? <p className="text-xs text-callout-danger">{err}</p> : null}
    </div>
  );
}
