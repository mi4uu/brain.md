import { useCallback, useEffect, useState } from "react";
import { authApi, type AuthStatus } from "../auth/api";
import { getToken, setToken } from "../auth/token";

// V53: client-side auth state. status polled on mount + after mutating
// actions (login, logout, set, clear). Returns helpers the LoginDialog
// and Security tab both consume.

export interface UseAuthValue extends AuthStatus {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setPassword: (next: string, current?: string) => Promise<boolean>;
  clearPassword: (current: string) => Promise<boolean>;
}

export function useAuth(): UseAuthValue {
  const [status, setStatus] = useState<AuthStatus>({
    configured: false,
    authenticated: true,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await authApi.status();
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (password: string) => {
      setError(null);
      try {
        const { token } = await authApi.login(password);
        setToken(token);
        // The App tree/settings/aliases fetches all ran BEFORE login and
        // returned 401 / empty. They aren't keyed on auth state so they
        // won't re-run automatically. Cheapest reliable fix: full reload.
        // (Refactoring every data hook to depend on auth.authenticated is
        // the deeper fix and lives in a future cleanup task.)
        if (typeof window !== "undefined") {
          window.location.reload();
          return true;
        }
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    const tok = getToken();
    if (tok) await authApi.logout(tok).catch(() => {});
    setToken(null);
    await refresh();
  }, [refresh]);

  const setPassword = useCallback(
    async (next: string, current?: string) => {
      setError(null);
      try {
        await authApi.setPassword(next, current);
        // configuring for first time → require re-login
        if (!status.configured) setToken(null);
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [refresh, status.configured],
  );

  const clearPassword = useCallback(
    async (current: string) => {
      setError(null);
      try {
        await authApi.clearPassword(current);
        setToken(null);
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [refresh],
  );

  return {
    ...status,
    loading,
    error,
    refresh,
    login,
    logout,
    setPassword,
    clearPassword,
  };
}
