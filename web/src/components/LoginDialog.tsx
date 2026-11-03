import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import type { LoginMethodsConfig } from "../auth/api";

interface Props {
  open: boolean;
  onLogin: (password: string) => Promise<boolean>;
  error: string | null;
  loginMethods: LoginMethodsConfig;
}

// V53: blocking login when /api/auth/status reports configured && !authenticated.
// No close button, auth is the only way to interact with the app.
//
// board-plan Part B: the password form only renders when loginMethods.password
// is true, and one button per configured external provider sends the browser
// to GET /api/auth/idp/<id>/start, which redirects to the provider and, on
// success, back to this page with a handoff code useAuth() exchanges for a
// session token.
export function LoginDialog({ open, onLogin, error, loginMethods }: Props) {
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

  const hasPassword = loginMethods.password;
  const hasProviders = loginMethods.providers.length > 0;

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
            {hasPassword
              ? "This vault is password-protected. Enter the password to continue."
              : "Sign in with one of the options below to continue."}
          </DialogDescription>
        </DialogHeader>
        {hasPassword ? (
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
            <button
              type="submit"
              disabled={busy || !password}
              className="rounded-1 bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : null}
        {hasPassword && hasProviders ? (
          <div className="my-3 flex items-center gap-2 text-xs text-fg-3">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : null}
        {hasProviders ? (
          <div className="flex flex-col gap-2">
            {loginMethods.providers.map((p) => (
              <a
                key={p.id}
                href={`/api/auth/idp/${p.id}/start`}
                className="rounded-1 border border-border px-3 py-1.5 text-center text-sm font-medium text-fg-1 hover:bg-hover"
              >
                Continue with {p.label}
              </a>
            ))}
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm text-callout-danger">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
