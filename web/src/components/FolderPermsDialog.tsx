import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Switch } from "./ui/switch";

interface Props {
  folderPath: string;
  onClose: () => void;
}

interface Perm {
  read: boolean;
  write: boolean;
}

// V52: per-folder MCP perms. Loads current map, shows the explicit override
// for this folder (or default rw if no override), Save upserts, Reset
// deletes the override (folder falls back to ancestor inheritance).
export function FolderPermsDialog({ folderPath, onClose }: Props) {
  const [perm, setPerm] = useState<Perm>({ read: true, write: true });
  const [hasOverride, setHasOverride] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/folder-mcp-perms");
        const map = (await r.json()) as Record<string, Perm>;
        if (cancelled) return;
        const cur = map[folderPath];
        if (cur) {
          setPerm(cur);
          setHasOverride(true);
        } else {
          setPerm({ read: true, write: true });
          setHasOverride(false);
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/folder-mcp-perms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: folderPath, ...perm }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      setMsg("Saved.");
      setHasOverride(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const enc = folderPath
        .split("/")
        .map((s) => encodeURIComponent(s))
        .join("/");
      const r = await fetch(`/api/folder-mcp-perms/${enc}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`${r.status}`);
      setMsg("Override removed. Folder now inherits.");
      setHasOverride(false);
      setPerm({ read: true, write: true });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>MCP permissions</DialogTitle>
          <DialogDescription className="truncate">
            {folderPath || "(vault root)"}
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-fg-3">
          Controls what the MCP server is allowed to do with notes in this
          folder (and descendants without their own override).
          {hasOverride ? " Currently overridden." : " Currently inherited (rw)."}
        </p>
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm text-fg-1">
            <span>MCP read</span>
            <Switch
              checked={perm.read}
              onCheckedChange={(c) => setPerm({ ...perm, read: c })}
              aria-label="Allow MCP read"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm text-fg-1">
            <span>MCP write</span>
            <Switch
              checked={perm.write}
              onCheckedChange={(c) => setPerm({ ...perm, write: c })}
              aria-label="Allow MCP write"
            />
          </label>
        </div>
        <div className="flex justify-between gap-2 pt-2">
          {hasOverride ? (
            <button
              type="button"
              disabled={busy}
              onClick={reset}
              className="rounded-1 px-3 py-1 text-sm text-fg-2 hover:bg-hover disabled:opacity-50"
            >
              Reset to inherited
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-1 px-3 py-1 text-sm text-fg-2 hover:bg-hover"
            >
              Close
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="rounded-1 bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
        {msg ? <p className="text-sm text-fg-3">{msg}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
