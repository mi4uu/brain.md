// Thin client for /api/auth/*. Used by the login Dialog and the
// Security tab in Settings.

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export const authApi = {
  async status(): Promise<AuthStatus> {
    return jsonOrThrow(await fetch("/api/auth/status"));
  },
  async login(password: string): Promise<{ token: string; expiresAt: number }> {
    return jsonOrThrow(
      await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      }),
    );
  },
  async logout(token: string): Promise<void> {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  },
  async setPassword(newPassword: string, currentPassword?: string): Promise<void> {
    await jsonOrThrow(
      await fetch("/api/auth/set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword, currentPassword }),
      }),
    );
  },
  async clearPassword(currentPassword: string): Promise<void> {
    await jsonOrThrow(
      await fetch("/api/auth/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword }),
      }),
    );
  },
};
