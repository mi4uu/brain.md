import { useCallback, useEffect, useState } from "react";
import { authApi, type AuthStatus, type LoginMethodsConfig } from "../auth/api";
import { getToken, setToken } from "../auth/token";

// V53: client-side auth state. status polled on mount + after mutating
// actions (login, logout, set, clear). Returns helpers the LoginDialog
// and Security tab both consume.
//
// board-plan Part B: also fetches which login methods are enabled, and
// on mount handles the two outcomes an external-provider redirect can
// land back on this page with: ?login_code=<handoff code> (success, trade
// it for a real session token the same way password login's response
// is stored) or ?login_error=<message> (shown in the dialog). Either way
// the query param is stripped so a reload doesn't replay it.

const DEFAULT_LOGIN_METHODS: LoginMethodsConfig = { password: true, providers: [] };

export interface UseAuthValue extends AuthStatus {
  loading: boolean;
  error: string | null;
  loginMethods: LoginMethodsConfig;
  refresh: () => Promise<void>;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setPassword: (next: string, current?: string) => Promise<boolean>;
  clearPassword: (current: string) => Promise<boolean>;
}

function stripLoginParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("login_code") && !url.searchParams.has("login_error")) return;
  url.searchParams.delete("login_code");
  url.searchParams.delete("login_error");
  window.history.replaceState(null, "", url.toString());
}

export function useAuth(): UseAuthValue {
  const [status, setStatus] = useState<AuthStatus>({
    configured: false,
    authenticated: true,
  });
  const [loginMethods, setLoginMethods] = useState<LoginMethodsConfig>(DEFAULT_LOGIN_METHODS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([authApi.status(), authApi.loginMethods()]);
      setStatus(s);
      setLoginMethods(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      void refresh();
      return;
    }
    const url = new URL(window.location.href);
    const code = url.searchParams.get("login_code");
    const loginError = url.searchParams.get("login_error");
    if (code) {
      stripLoginParams();
      void authApi
        .exchangeIdpCode(code)
        .then(({ token }) => {
          setToken(token);
          window.location.reload();
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e));
          void refresh();
        });
      return;
    }
    if (loginError) {
      stripLoginParams();
      setError(loginError);
    }
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
    loginMethods,
    refresh,
    login,
    logout,
    setPassword,
    clearPassword,
  };
}
