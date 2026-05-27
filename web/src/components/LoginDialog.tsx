import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface Props {
  open: boolean;
  onLogin: (password: string) => Promise<boolean>;
  error: string | null;
}

// V53: blocking login when /api/auth/status reports configured && !authenticated.
// No close button — auth is the only way to interact with the app.
export function LoginDialog({ open, onLogin, error }: Props) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    try {
      const ok = await onLogin(password);
      if (ok) setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        showClose={false}
        className="max-w-sm"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>
            This vault is password-protected. Enter the password to continue.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="input w-full"
            disabled={busy}
          />
          {error ? (
            <p className="text-sm text-callout-danger">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !password}
            className="rounded-1 bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
