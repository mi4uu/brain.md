import { describe, expect, test } from "bun:test";
import {
  serializeFlowCookie,
  clearFlowCookie,
  readFlowCookie,
  serializeBindCookie,
  clearBindCookie,
  readBindCookie,
  type LoginFlowState,
} from "../src/auth/login-state-cookie";

function makeFlow(): LoginFlowState {
  return {
    provider: "oidc",
    state: "s",
    verifier: "v",
    nonce: "n",
    bind: "b",
    expiresAt: Date.now() + 60_000,
  };
}

describe("login-state-cookie: __Host- on HTTPS", () => {
  test("secure=true names the flow cookie __Host- and sets Secure", () => {
    const header = serializeFlowCookie(makeFlow(), true);
    expect(header).toMatch(/^__Host-brainmd_idp_flow=/);
    expect(header).toContain("Secure");
  });

  test("secure=false falls back to an explicit dev-only name, no Secure", () => {
    const header = serializeFlowCookie(makeFlow(), false);
    expect(header.startsWith("__Host-")).toBe(false);
    expect(header).not.toContain("Secure");
  });

  test("round-trips under the same secure flag", () => {
    const flow = makeFlow();
    const secureHeader = serializeFlowCookie(flow, true);
    expect(readFlowCookie(secureHeader, true)?.state).toBe("s");

    const devHeader = serializeFlowCookie(flow, false);
    expect(readFlowCookie(devHeader, false)?.state).toBe("s");
  });

  // Cookie-injection regression: a sibling subdomain can set a
  // same-named, non-__Host- cookie (it can't satisfy __Host-'s no-Domain
  // + Secure + Path=/ requirements for our host), but it could set a
  // plain "brainmd_idp_flow" cookie before this fix used a single
  // unprefixed name on both HTTP and HTTPS. Reading under secure=true
  // must ignore any cookie that isn't the __Host- prefixed one, and the
  // dev cookie set under secure=false must never satisfy a secure=true
  // read, or vice versa.
  test("a cookie set under one secure flag is not read back under the other", () => {
    const flow = makeFlow();
    const secureHeader = serializeFlowCookie(flow, true);
    const secureCookie = secureHeader.split(";")[0]!;
    expect(readFlowCookie(secureCookie, false)).toBeUndefined();

    const devHeader = serializeFlowCookie(flow, false);
    const devCookie = devHeader.split(";")[0]!;
    expect(readFlowCookie(devCookie, true)).toBeUndefined();
  });

  test("an injected cookie using the dev name is ignored on a secure read", () => {
    const flow = makeFlow();
    const devHeader = serializeFlowCookie(flow, false);
    const injected = devHeader.split(";")[0]!; // brainmd_idp_flow_dev=...
    expect(readFlowCookie(injected, true)).toBeUndefined();
  });

  test("clearFlowCookie clears the same name serializeFlowCookie sets", () => {
    expect(clearFlowCookie(true).split(";")[0]).toBe(serializeFlowCookie(makeFlow(), true).split(";")[0]!.split("=")[0] + "=");
    expect(clearFlowCookie(false).split(";")[0]).toBe(serializeFlowCookie(makeFlow(), false).split(";")[0]!.split("=")[0] + "=");
  });
});

describe("login-state-cookie: bind cookie __Host- on HTTPS", () => {
  test("secure=true names the bind cookie __Host- and sets Secure", () => {
    const header = serializeBindCookie("secret", true);
    expect(header).toMatch(/^__Host-brainmd_idp_bind=/);
    expect(header).toContain("Secure");
  });

  test("secure=false falls back to an explicit dev-only name, no Secure", () => {
    const header = serializeBindCookie("secret", false);
    expect(header.startsWith("__Host-")).toBe(false);
    expect(header).not.toContain("Secure");
  });

  test("round-trips under the same secure flag", () => {
    expect(readBindCookie(serializeBindCookie("secret", true).split(";")[0]!, true)).toBe("secret");
    expect(readBindCookie(serializeBindCookie("secret", false).split(";")[0]!, false)).toBe("secret");
  });

  test("a bind cookie set under one secure flag is not read back under the other", () => {
    const secureCookie = serializeBindCookie("secret", true).split(";")[0]!;
    expect(readBindCookie(secureCookie, false)).toBeUndefined();
    const devCookie = serializeBindCookie("secret", false).split(";")[0]!;
    expect(readBindCookie(devCookie, true)).toBeUndefined();
  });

  test("clearBindCookie clears the same name serializeBindCookie sets", () => {
    expect(clearBindCookie(true).split(";")[0]).toBe(serializeBindCookie("x", true).split(";")[0]!.split("=")[0] + "=");
    expect(clearBindCookie(false).split(";")[0]).toBe(serializeBindCookie("x", false).split(";")[0]!.split("=")[0] + "=");
  });
});
