import { describe, expect, test } from "bun:test";
import { OAuthClientStore } from "../src/auth/oauth-clients";

function registerOne(store: OAuthClientStore, name: string) {
  const r = store.register({
    client_name: name,
    redirect_uris: ["http://localhost/cb"],
  });
  if (!r.ok) throw new Error(r.error_description);
  return r.client;
}

describe("OAuthClientStore cap (C5)", () => {
  test("unbounded registration doesn't grow past the cap", () => {
    const store = new OAuthClientStore();
    for (let i = 0; i < 520; i++) registerOne(store, `client-${i}`);
    expect(store.count()).toBeLessThanOrEqual(500);
  });

  test("evicts the stalest, least-recently-used registration first", () => {
    const store = new OAuthClientStore();
    const clients = Array.from({ length: 500 }, (_, i) => registerOne(store, `c${i}`));
    expect(store.count()).toBe(500);

    // Touch everything except the very first registration, so it's the
    // only one that's never been used since registering.
    for (let i = 1; i < clients.length; i++) {
      store.get(clients[i]!.client_id);
    }

    registerOne(store, "newcomer");
    expect(store.count()).toBeLessThanOrEqual(500);
    expect(store.get(clients[0]!.client_id)).toBeUndefined();
    expect(store.get(clients[1]!.client_id)).toBeDefined();
  });
});
